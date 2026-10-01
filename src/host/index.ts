/**
 * dsh-webpage-element-picker — Host 半边（已安装包入口）。
 *
 * 一个普通的 Cordis 插件模块（ESM），由 profile loader 作为
 * `dsh-webpage-element-picker` 行加载。它提供：
 *   - `read_picked_element` 工具（通过 ctx.tools.register）
 *   - 每元素一行的动态上下文段（ctx.systemPrompt.context）
 *   - harness webserver 上的 HTTP 路由：/poll + /events 供内嵌浏览器
 *     helper 使用，/invoke 供浏览器 UI 使用
 *   - helper 子进程生命周期（node bootstrap.cjs + playwright-core）
 *
 * 模块级 `inject` 是唯一的门控：Cordis 会保持此插件 PENDING 状态，
 * 直到下方所有 provider 都 ACTIVE——没有它的话，`apply` 会在 profile
 * 加载时与服务纤程竞态，`ctx.get(...)`（严格模式）会返回 undefined。
 * 全部七个服务随 web profile 出货（@deepseek-ai/dsh-base
 * + @deepseek-ai/dsh-web-app）。切勿添加 `export default apply`：Loader 的
 * unwrapExports（`exports.default ?? exports`）会把模块坍缩为裸函数并
 * 丢弃 inject。
 *
 * 资源（bootstrap.cjs / helper-playwright.js / inspector.js /
 * browser-probe.cjs）优先按包内路径解析，同时保留旧版
 * `~/.dsh/_dsh-webpage-element-picker` 和工作区兜底路径以增强健壮性。
 *
 * 日志：统一走模块级 logDebug/logInfo/logWarn/logError（带插件前缀）；
 * DEBUG 级生产默认关闭，设 `DSH_WE_DEBUG=1` 环境变量打开。
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {
  FsFace,
  SandboxPolicyFace,
  SubprocessFace,
  SubprocessHandleLike,
  SystemPromptFace,
  TimerFace,
  ToolsFace,
  WebServerFace,
} from './services'
import type {
  BrowserChoice,
  BrowserOption,
  ContextItemSummary,
  DomElementPayload,
  DomRegistryEntry,
  HelperEvent,
  InvokeResult,
  PendingElement,
  PickerStatus,
} from '../shared/types'

export const name = 'dsh-webpage-element-picker'

/** 必需服务：Cordis 会保持此纤程挂起，直到所有服务激活。 */
export const inject = ['subprocess', 'webServer', 'sandboxPolicy', 'fs', 'tools', 'systemPrompt', 'timer']

/** 日志统一前缀（便于在 harness 日志流中检索本插件条目）。 */
const LOG_PREFIX = '[dsh-webpage-element-picker]'
/** DEBUG 级开关：生产默认关闭，环境变量 `DSH_WE_DEBUG=1` 打开。 */
const DEBUG_ENABLED = typeof process !== 'undefined' && !!(process.env && process.env.DSH_WE_DEBUG)

/**
 * 浏览器清单探测（browser-probe.cjs --list）的单次上限。
 * 不能按"探测本身很轻"来估：经 harness subprocess 服务起子进程要额外付
 * runner（node + tsx）启动成本，probe 内部的 reg.exe 首次调用也要 ~1s；
 * 宿主繁忙时（页面刚加载、正在跑 agent）实测会超过 20s。给足余量，
 * 免得冷启动那一次就把下拉菜单打成"探测失败"。
 */
const BROWSER_PROBE_TIMEOUT_MS = 60000

/**
 * 浏览器清单探测结果的缓存有效期。系统装了哪些浏览器几乎不变，而菜单
 * 每次展开都探测一次：缓存让重复展开秒开，同时几分钟后自动重探，
 * 新装的浏览器仍能被发现。
 */
const BROWSER_LIST_TTL_MS = 5 * 60 * 1000

/** DEBUG：分支走向、中间变量、循环关键节点（生产默认关闭）。 */
function logDebug(msg: string): void {
  if (DEBUG_ENABLED) console.debug(LOG_PREFIX + ' [DEBUG] ' + msg)
}
/** INFO：请求入口、关键状态变更、外部调用耗时。 */
function logInfo(msg: string): void {
  console.info(LOG_PREFIX + ' [INFO] ' + msg)
}
/** WARN：降级、重试、超时、配置缺失但可继续。 */
function logWarn(msg: string): void {
  console.warn(LOG_PREFIX + ' [WARN] ' + msg)
}
/** ERROR：业务异常、外部调用失败——必须带堆栈和业务上下文。 */
function logError(msg: string, err?: unknown): void {
  const e = err as Error | null | undefined
  const detail = e && e.stack ? e.stack : String((e && e.message) || err || '')
  console.error(LOG_PREFIX + ' [ERROR] ' + msg + (detail ? '\n' + detail : ''))
}

/** 挂在 /poll 上的长轮询等待者，直到有命令入队或超时。 */
interface PollWaiter {
  finish(cmd: unknown): void
}

/** 等待其 reply 事件的待处理 helper 请求。 */
interface RequestWaiter {
  resolve(ev: { ok: boolean; status?: PickerStatus; error?: string }): void
  reject(err: Error): void
  /** 发起时间戳：reply 到达或超时拒绝时计算往返耗时。 */
  at: number
}

type Handler = (params: Record<string, unknown>) => Promise<InvokeResult>

/** 规范化结果：成功带最终网址，失败带错误文案。 */
type UrlNormalization = { ok: true; url: string } | { ok: false; error: string }

/**
 * 规范化输入的网址：缺协议头时补 `https://`（跟浏览器地址栏一个习惯）。
 * 与 client 半边的同名实现保持一致（两半是独立 bundle，共享不了运行时函数）：
 * 已带 http/https 原样返回；其它协议头（ftp:/about:/mailto:）明确拒绝；
 * `host:port` 不算协议头；只写一个斜杠的 http(s) 按同协议补齐 `//`。
 * host 侧再做一次是兜底：client 传参异常/被绕过时，helper 的 open 也只会收到合法网址。
 */
function normalizeUrl(raw: string): UrlNormalization {
  const url = String(raw || '').trim()
  if (!url) return { ok: false, error: '请先输入网址' }
  if (/^https?:\/\//i.test(url)) return { ok: true, url: url }
  const scheme = url.match(/^([a-z][a-z0-9+.-]*):(?!\d)/i)
  if (!scheme) return { ok: true, url: 'https://' + url }
  const name = scheme[1].toLowerCase()
  if (name === 'http' || name === 'https') {
    return { ok: true, url: name + '://' + url.slice(scheme[0].length).replace(/^\/+/, '') }
  }
  return { ok: false, error: '只支持 http/https 网址（不支持 ' + name + ': 协议）' }
}

export function apply(ctx: Context): void {
  const subprocess = ctx.get('subprocess') as SubprocessFace
  const webServer = ctx.get('webServer') as WebServerFace
  const timer = ctx.get('timer') as TimerFace
  const fs = ctx.get('fs') as FsFace
  const tools = ctx.get('tools') as ToolsFace
  const systemPrompt = ctx.get('systemPrompt') as SystemPromptFace
  const workspaceRoot = (ctx.get('sandboxPolicy') as SandboxPolicyFace).workspaceRoot as string

  let handle: SubprocessHandleLike | null = null
  let starting: Promise<SubprocessHandleLike> | null = null
  let payloadSent = false
  let cmdSeq = 0
  const waiters = new Map<number, RequestWaiter>()
  let lastSeq = 0
  let pending: PendingElement[] = []
  let status: PickerStatus = { state: 'idle', message: '浏览器未启动' }
  let lineBuf = ''
  let lastBrowserName = ''
  /**
   * 当前 helper 启动时使用的浏览器路径（空串表示按系统优先级自动探测）。
   * 与本次请求的用户选择比较，决定是否需要重启 helper 换浏览器。
   */
  let helperBrowserPath = ''

  let domCounter = 0
  let domRegistry: DomRegistryEntry[] = []
  /**
   * 浏览器清单探测结果的短时缓存（见 BROWSER_LIST_TTL_MS）。
   * 只缓存"探测成功"的清单：失败不写缓存，下次展开菜单立刻重试。
   */
  let browsersCache: { at: number; browsers: BrowserOption[] } | null = null

  // ---- 资源目录解析：包内 resources/ 优先（bundle 形态），家目录/工作区兜底 ----

  /** 包内 resources/ 目录（bundle 形态下的首选）；无法从 import.meta.url 推导时返回空串跳过。 */
  const pkgResourceDir = ((): string => {
    try {
      return fileURLToPath(new URL('../resources/', import.meta.url))
    } catch {
      return ''
    }
  })()
  let homeProbePromise: Promise<string> | null = null
  /**
   * 探测用户家目录（供旧版资源目录兜底）。
   * 经 harness subprocess 服务起子进程打印 home，而不是直接读本进程
   * process.env：保证与后续 spawn 出来的 helper 处于同一环境视图。
   * 结果经 homeProbePromise 缓存，全程只探测一次；失败返回空串（可继续）。
   */
  const discoverHome = (): Promise<string> => {
    if (homeProbePromise) return homeProbePromise
    homeProbePromise = (async (): Promise<string> => {
      try {
        const node = await subprocess.resolveExecutable('node')
        const probe = subprocess.spawn({
          argv: [node, '-e', "console.log(process.env.USERPROFILE || process.env.HOME || '')"],
          cwd: workspaceRoot,
          stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' },
          graceMs: 3000,
        })
        return await new Promise<string>((resolve) => {
          let buf = ''
          let done = false
          // 只取第一行输出（家目录路径），之后不再读
          const finish = (v: string): void => {
            if (!done) {
              done = true
              resolve(v)
            }
          }
          ;(async () => {
            for await (const chunk of probe.stdout) {
              buf += String(chunk)
              const i = buf.indexOf('\n')
              if (i >= 0) {
                finish(buf.slice(0, i).replace(/\r$/, '').trim())
                break
              }
            }
          })().catch(() => finish(''))
          probe.done.then(
            () => {
              // 进程退出但 stdout 未换行结尾时，用已收集的全部缓冲兜底
              if (buf.length === 0) finish('')
              else finish(buf.split('\n')[0].replace(/\r$/, '').trim())
            },
            () => finish(''),
          )
        })
      } catch {
        logDebug('家目录探测失败，跳过家目录资源候选（不影响包内资源解析）')
        return ''
      }
    })()
    return homeProbePromise
  }

  /**
   * 生成资源目录候选列表（按优先级排序）：
   * 包内 resources/ → 家目录旧版安装位（.dsh / .dph）→ 工作区目录。
   */
  const resourceDirCandidates = async (): Promise<string[]> => {
    const dirs: string[] = []
    if (pkgResourceDir) dirs.push(pkgResourceDir)
    const home = await discoverHome()
    if (home) {
      dirs.push(home + '/.dsh/_dsh-webpage-element-picker')
      dirs.push(home + '/.dph/_dsh-webpage-element-picker')
    }
    dirs.push(workspaceRoot + '/_dsh-webpage-element-picker')
    return dirs
  }

  /**
   * 选定资源目录：逐候选检查 4 个必需文件是否齐全（经沙箱 fs 服务），
   * 第一个齐全的候选胜出；全部缺失时报错并列出已尝试路径。
   */
  const resolveResourceDir = async (): Promise<string> => {
    const needFiles = ['bootstrap.cjs', 'helper-playwright.js', 'inspector.js', 'browser-probe.cjs']
    const candidates = await resourceDirCandidates()
    for (const c of candidates) {
      let ok = true
      for (const name of needFiles) {
        try {
          const target = await fs.resolve(c + '/' + name)
          const info = await fs.stat(target)
          if (!info) {
            ok = false
            break
          }
        } catch {
          ok = false
          break
        }
      }
      if (ok) {
        logInfo('资源目录: ' + c)
        return c
      }
      logDebug('资源候选不完整，跳过: ' + c)
    }
    throw new Error(
      '未找到页面元素选择器的资源目录（需要 4 个文件: ' + needFiles.join(' / ') + '；已尝试: ' + candidates.join(' | ') + '）',
    )
  }

  /**
   * 读取 helper 与 inspector 的源文本。
   * 不直接给 helper 传文件路径：bootstrap 可能运行在无沙箱读权限的位置，
   * 源文本稍后按行协议经 stdin 发送给 bootstrap，由它落盘到 %TEMP%。
   */
  const loadResources = async (resourceDir: string): Promise<{ helper: string; inspector: string }> => {
    const readFile = async (name: string): Promise<string> => {
      const target = await fs.resolve(resourceDir + '/' + name)
      return await fs.readText(target)
    }
    return {
      helper: await readFile('helper-playwright.js'),
      inspector: await readFile('inspector.js'),
    }
  }

  const pollWaiters: PollWaiter[] = []
  const commandQueue: unknown[] = []

  /**
   * 向 helper 派发一条命令。
   * 有长轮询等待者则直推（实时性最好）；否则入队等下一次 /poll。
   * 队列截断到 100 条：helper 长时间不在线时防止内存无限膨胀。
   */
  const sendCommand = (cmd: unknown): void => {
    const c = cmd as { id?: unknown; method?: unknown }
    if (pollWaiters.length > 0) {
      pollWaiters.shift()!.finish(cmd)
      logDebug('命令直推长轮询: id=' + String(c.id) + ' method=' + String(c.method))
      return
    }
    commandQueue.push(cmd)
    if (commandQueue.length > 100) commandQueue.splice(0, commandQueue.length - 100)
    logDebug('命令入队等待 /poll: id=' + String(c.id) + ' method=' + String(c.method) + '（队列长度 ' + commandQueue.length + '）')
  }

  /**
   * 生成元素的短标签（≤10 字），与 client 侧插入占位符时的 labelOf 规则一致：
   * 可见文本 → aria-label/placeholder/alt/title/value → tag#id → tag.class → tag。
   * 供 picker-context-list 的菜单摘要使用，保证历史节点再插入时占位符外观相同。
   */
  const registryLabel = (p: DomElementPayload): string => {
    const short = (s: unknown): string => {
      const t = String(s || '').replace(/\s+/g, ' ').trim()
      return t.length > 10 ? t.slice(0, 10) + '…' : t
    }
    // 与 client labelOf 边界一致：textContent 非空（哪怕纯空白）即以其为准，
    // 纯空白得到空标签，由调用方按「无标签」退化为裸 [DOMn]
    if (p.textContent) return short(p.textContent)
    const attrs = (p.attributes || {}) as Record<string, string>
    for (const key of ['aria-label', 'placeholder', 'alt', 'title', 'value']) {
      const t = short(attrs[key])
      if (t) return t
    }
    const tag = String(p.tagName || '?')
    if (p.id) return tag + '#' + String(p.id)
    const cls = String(p.className || '').trim().split(/\s+/).slice(0, 2).join('.')
    if (cls) return tag + '.' + cls
    return tag
  }

  /**
   * 生成系统提示中的「页面元素列表」段落：每元素一行摘要（标签/文本/URL），
   * 末尾附 read_picked_element 工具用法；无元素时返回空串，不占用上下文。
   */
  const buildSummary = (): string => {
    if (domRegistry.length === 0) return ''
    const lines = ['页面元素列表（用户消息中的 [DOMn] 占位符与下列编号一一对应）：']
    for (const e of domRegistry) {
      const p = e.payload || {}
      const parts = [String(p.tagName || '?')]
      if (p.id) parts.push('#' + p.id)
      if (p.textContent) parts.push('“' + String(p.textContent).slice(0, 40) + '”')
      lines.push(e.id + '=' + parts.join(' ') + ' (' + (p.pageUrl || '') + ')')
    }
    lines.push(
      '需要某个元素的完整信息（HTML/CSS选择器/属性/位置尺寸）时，调用 read_picked_element 工具，参数如 {"id":"DOM1"}。',
    )
    return lines.join('\n')
  }

  // 注册系统提示动态上下文段：每次组装提示时回调 buildSummary 取最新注册表
  try {
    ctx.effect(() => systemPrompt.context({
      name: 'webpage-element-picker',
      order: 60,
      text: () => buildSummary(),
    }))
  } catch (err) {
    logError('系统提示上下文注册失败（页面元素列表将不会出现在系统提示中）', err)
  }

  // 注册动态工具：模型按 DOMn 编号读取元素完整信息
  try {
    ctx.effect(() => tools.register({
      name: 'read_picked_element',
      description:
        '读取「添加页面元素」功能从内置浏览器中选中的页面元素完整信息（HTML、CSS选择器、DOM路径、属性、位置尺寸、页面URL等）。系统提示中的页面元素列表给出了可用的 DOM 编号，用户消息中的 [DOMn] 占位符与之一一对应；需要元素细节时按编号读取。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'DOM 编号，如 DOM1（见系统提示中的页面元素列表）' },
        },
        required: ['id'],
      },
      output: {
        schema: {},
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args: unknown): Promise<unknown> {
        const id = String((args && (args as { id?: unknown }).id) || '')
        logInfo('工具调用 read_picked_element: id=' + (id || '(空)'))
        if (!id) throw new Error('read_picked_element 需要参数 id（如 DOM1）')
        const entry = domRegistry.find((e) => e.id === id)
        if (!entry) {
          // 编号不存在：返回可用编号清单，便于模型自我纠正后重试
          logDebug('元素编号未命中: ' + id + '（当前可用 ' + domRegistry.length + ' 个）')
          return { ok: false, error: '未找到元素 ' + id + '，可用编号: ' + domRegistry.map((e) => e.id).join(', ') }
        }
        return { ok: true, id: entry.id, element: entry.payload }
      },
    }))
    logInfo('动态工具 read_picked_element 已注册')
  } catch (err) {
    logError('工具注册失败（模型将无法读取页面元素详情）', err)
  }

  /**
   * 处理 helper 经 /events 上报的事件：
   * reply 按 id 分发回请求等待者；其余事件驱动 status / domRegistry 状态机，
   * 状态由浏览器 UI 经 picker-status / picker-pull 轮询消费。
   */
  const handleEvent = (ev: HelperEvent): void => {
    if (!ev || typeof ev.type !== 'string') return
    if (ev.type === 'reply') {
      const w = waiters.get(ev.id)
      if (w) {
        waiters.delete(ev.id)
        logDebug('收到 reply: id=' + ev.id + ' ok=' + ev.ok + ' 耗时 ' + (Date.now() - w.at) + 'ms')
        if (ev.ok) w.resolve(ev)
        else w.reject(new Error(ev.error || '内置浏览器返回错误'))
      }
      return
    }
    if (ev.type === 'element-selected') {
      // 关键状态变更：注册新 DOMn 编号并入客户端轮询队列；
      // 两个容器都截断（200/100），防止长会话无限增长
      domCounter += 1
      const domId = 'DOM' + domCounter
      domRegistry.push({ id: domId, payload: ev.data || {} })
      if (domRegistry.length > 200) domRegistry = domRegistry.slice(-200)
      pending.push({ seq: ++lastSeq, domId: domId, payload: ev.data || {} })
      if (pending.length > 100) pending = pending.slice(-100)
      const p = (ev.data || {}) as DomElementPayload
      logInfo('页面元素已选中: ' + domId + ' ' + String(p.tagName || '?') + ' (' + String(p.pageUrl || '') + ')')
      return
    }
    if (ev.type === 'browser') {
      lastBrowserName = ev.name || '浏览器'
      logInfo('已探测到系统浏览器: ' + lastBrowserName)
      status = { state: 'starting', message: '正在启动 ' + lastBrowserName + '…', browser: lastBrowserName }
      return
    }
    if (ev.type === 'status') {
      logDebug('页面状态更新: ' + String(ev.url || ''))
      status = { state: 'open', url: ev.url, title: ev.title, browser: lastBrowserName }
      return
    }
    if (ev.type === 'injected') {
      logDebug('inspector 已注入: ' + String(ev.url || ''))
      status = { state: 'open', url: ev.url, title: ev.title, injected: true, browser: lastBrowserName }
      return
    }
    if (ev.type === 'mode-exited') {
      logInfo('选择模式已退出: ' + String(ev.url || ''))
      status = { state: 'open', url: ev.url, title: ev.title, modeExited: true, browser: lastBrowserName }
      return
    }
    if (ev.type === 'window-closed') {
      logInfo('浏览器窗口已关闭')
      status = { state: 'closed', message: '浏览器窗口已关闭，可重新点击打开按钮打开' }
      return
    }
    if (ev.type === 'helper-ready') {
      logInfo('浏览器已就绪' + (lastBrowserName ? '（' + lastBrowserName + '）' : ''))
      status = { state: 'ready', message: '浏览器已就绪' + (lastBrowserName ? '（' + lastBrowserName + '）' : ''), browser: lastBrowserName }
      return
    }
    if (ev.type === 'error') {
      logError('浏览器侧错误: ' + ev.message)
      status = { state: 'error', message: ev.message }
      return
    }
  }

  // 浏览器 UI 侧可调用的方法（POST /invoke 分发）。
  const handlers = new Map<string, Handler>()

  // 注册三条 HTTP 路由：/poll（helper 长轮询取命令）、/events（helper 事件上报）、
  // /invoke（浏览器 UI 调用入口）。数据通道不依赖子进程管道——Chromium 在
  // Windows 会关闭 stdin，所以命令/事件一律走 harness 自带 HTTP 路由。
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      disposers.push(webServer.register({
        kind: 'exact',
        path: '/dsh-webpage-element-picker/poll',
        handler: (req, res) => {
          // 队列非空：立即返回队首命令
          if (commandQueue.length > 0) {
            const cmd = commandQueue.shift()
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(cmd))
            return
          }
          // 队列空：挂起为长轮询等待者。25s 心跳超时返回 null（helper 侧
          // 收到 null 后 250ms 再重连）；客户端断开连接时同样清理等待者
          let finished = false
          let timeoutDisposer: (() => void) | null = null
          const entry: PollWaiter = {
            finish: (cmd) => {
              if (finished) return
              finished = true
              if (timeoutDisposer) timeoutDisposer()
              const idx = pollWaiters.indexOf(entry)
              if (idx >= 0) pollWaiters.splice(idx, 1)
              try {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(cmd === null ? 'null' : JSON.stringify(cmd))
              } catch {
                // 响应已关闭
              }
            },
          }
          timeoutDisposer = timer.timeout(() => entry.finish(null), 25000)
          pollWaiters.push(entry)
          logDebug('长轮询挂起（当前等待者 ' + pollWaiters.length + '）')
          req.on('close', () => entry.finish(null))
        },
      }))
      disposers.push(webServer.register({
        kind: 'exact',
        path: '/dsh-webpage-element-picker/events',
        handler: (req, res) => {
          let body = ''
          let overflow = false
          req.on('data', (d) => {
            if (overflow) return
            body += String(d)
            // 1MB 上限防滥用：超出即丢弃整包（helper 是唯一调用方，载荷很小）
            if (body.length > 1000000) {
              overflow = true
              body = ''
              logWarn('事件载荷超过 1MB，已丢弃')
            }
          })
          req.on('end', () => {
            if (!overflow) {
              let msg: { event?: HelperEvent } | null = null
              try {
                msg = JSON.parse(body || '{}')
              } catch {
                // 忽略格式错误的载荷（helper 是唯一调用方，报错无意义）
              }
              if (msg && msg.event) handleEvent(msg.event)
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end('{}')
          })
        },
      }))
      // 浏览器 UI 的调用入口：POST { method, params } → 执行 handlers → JSON 结果。
      disposers.push(webServer.register({
        kind: 'exact',
        path: '/dsh-webpage-element-picker/invoke',
        handler: (req, res) => {
          let body = ''
          let overflow = false
          req.on('data', (d) => {
            if (overflow) return
            body += String(d)
            // 1MB 上限防滥用，同 /events
            if (body.length > 1000000) {
              overflow = true
              body = ''
              logWarn('调用载荷超过 1MB，已丢弃')
            }
          })
          req.on('end', () => {
            let msg: { method?: unknown; params?: unknown } | null = null
            try {
              msg = JSON.parse(body || '{}')
            } catch {
              // 忽略格式错误的载荷
            }
            const method = msg && typeof msg.method === 'string' ? msg.method : ''
            const params = (msg && typeof msg.params === 'object' && msg.params !== null ? msg.params : {}) as Record<string, unknown>
            // 请求入口日志：picker-status / picker-pull 是客户端 1.5s 轮询的
            // 高频只读方法，记 DEBUG 防刷屏；操作类方法记 INFO
            if (method === 'picker-status' || method === 'picker-pull') {
              logDebug('请求入口 /invoke: ' + method)
            } else {
              logInfo('请求入口 /invoke: ' + method + (method === 'picker-navigate' ? ' url=' + String(params.url || '') : ''))
            }
            const handler = handlers.get(method)
            if (!handler) {
              logWarn('未知调用方法: ' + (method || '(空)'))
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: '未知方法: ' + method }))
              return
            }
            Promise.resolve()
              .then(() => handler(params))
              .then((result) => {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify(result))
              })
              .catch((err: unknown) => {
                // 处理器异常：错误详情回给 UI 展示，同时本地留堆栈
                logError('调用 ' + method + ' 失败', err)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: String((err && (err as Error).message) || err) }))
              })
          })
        },
      }))
      logInfo('HTTP 路由已注册: /poll /events /invoke')
    } catch (err) {
      logError('路由注册失败（可能被本插件的另一个实例占用）', err)
    }
    return () => {
      for (const d of disposers) {
        try {
          d()
        } catch {
          // 尽力清理
        }
      }
    }
  })

  /**
   * 消费 bootstrap stdout 的行协议：首行 READY 表示 stdin 可写，
   * 随即回写资源载荷（helper + inspector 源码文本）；载荷发送后
   * 忽略后续所有行——helper 日志走 stderr，事件走 HTTP /events。
   */
  const readStdout = async (boot: SubprocessHandleLike, payloadText: string): Promise<void> => {
    try {
      if (!boot || !boot.stdout) return
      for await (const chunk of boot.stdout) {
        lineBuf += String(chunk)
        let i: number
        while ((i = lineBuf.indexOf('\n')) >= 0) {
          const line = lineBuf.slice(0, i).replace(/\r$/, '')
          lineBuf = lineBuf.slice(i + 1)
          if (!line) continue
          if (!payloadSent && line === 'READY') {
            payloadSent = true
            logDebug('收到 READY 握手，回写资源载荷（' + payloadText.length + ' 字符）')
            try {
              boot.stdin.write(payloadText)
            } catch (err) {
              logError('发送资源文件失败（helper 将收不到源码，启动会失败）', err)
            }
          }
        }
      }
    } catch {
      // stdout 已结束
      logDebug('helper stdout 流结束')
    }
  }

  /**
   * 取子进程 stderr 环形缓冲区的最后一个非空行（截断 300 字符），
   * 用于 helper 进程退出时的退出原因诊断。
   */
  const stderrTail = (boot: SubprocessHandleLike): string => {
    try {
      const c = boot.collected && boot.collected.stderr
      if (!c) return ''
      const read = c.readFrom(0)
      const lines = String(read.text || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      return lines.length ? lines[lines.length - 1].slice(0, 300) : ''
    } catch {
      logDebug('读取 helper stderr 尾部失败')
      return ''
    }
  }

  /**
   * 解析 npm 的脚本入口（npm-cli.js）——按 Node 安装布局自适应，跨平台。
   *
   * 为什么不用 PATH 上的 npm 启动：Windows 下它是 npm.cmd，spawn 受限；
   * 统一以 `node <npm-cli.js>` 运行。而 npm-cli.js 的位置随安装方式而异：
   *   - Windows 官方安装器 / nvm-windows：<nodeDir>/node_modules/npm/bin/npm-cli.js
   *   - macOS / Linux（nvm、Homebrew、官方 pkg、发行版包）：
   *     <prefix>/lib/node_modules/npm/bin/npm-cli.js（<prefix> 为 bin 的上级）
   * 旧实现只推导 Windows 布局，在 macOS/Linux 上必然报「未找到 npm 的脚本入口」。
   *
   * 做法：从三种可执行文件路径反推同安装根下的候选（实际使用的 node →
   * PATH 上的 npm，覆盖 Volta/asdf 等 shim 场景 → 承载本插件的 node 兜底），
   * 逐一探测存在性，命中即返回；全部落空时抛出含候选清单的错误便于定位。
   */
  const resolveNpmCli = async (nodePath: string): Promise<string> => {
    const candidates: string[] = []
    const seen = new Set<string>()
    /** 追加候选并去重（同一路径可能被多条来源推导出来）。 */
    const push = (p: string): void => {
      if (!p || seen.has(p)) return
      seen.add(p)
      candidates.push(p)
    }
    /** 由可执行文件路径（node 或 npm shim）推导其安装根下的 npm 脚本入口。 */
    const pushFromExecutable = (exePath: string): void => {
      if (!exePath) return
      const binDir = dirname(exePath)
      const prefix = dirname(binDir)
      push(join(binDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')) // Windows 官方安装器 / nvm-windows
      push(join(prefix, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')) // macOS / Linux 标准布局
      push(join(prefix, 'node_modules', 'npm', 'bin', 'npm-cli.js')) // 自定义 prefix / 少数发行版
      push(join(binDir, 'npm-cli.js')) // 少数安装把入口直接放在 bin 目录
    }
    pushFromExecutable(nodePath)
    try {
      pushFromExecutable(await subprocess.resolveExecutable('npm'))
    } catch {
      logDebug('PATH 上未解析到 npm，跳过 shim 反推候选')
    }
    pushFromExecutable(process.execPath)
    logDebug('npm 脚本入口候选 ' + candidates.length + ' 个: ' + candidates.join(' | '))

    /**
     * 候选存在性判定：优先用 subprocess 服务（真实可执行文件语义）；
     * 失败再退回 fs.stat——npm-cli.js 只需作为 node 的脚本参数，
     * 打包器可能不带可执行位，此时它同样可用。
     */
    const exists = async (p: string): Promise<boolean> => {
      try {
        await subprocess.resolveExecutable(p)
        return true
      } catch {
        try {
          const info = (await fs.stat(await fs.resolve(p))) as { isFile?: () => boolean } | null
          return !!(info && (!info.isFile || info.isFile()))
        } catch {
          return false
        }
      }
    }
    for (const c of candidates) {
      if (await exists(c)) {
        logDebug('npm 脚本入口命中: ' + c)
        return c
      }
    }
    throw new Error('未找到 npm 的脚本入口（已尝试: ' + candidates.join(' | ') + '），请确认 Node.js 安装完整')
  }

  /**
   * 跑一次性子进程并收集 stdout（browser-probe.cjs --list 用）。
   * 与 discoverHome 同一模式：长驻进程才走 handle 单例，一次性调用用完即弃；
   * 超时终止子进程并以错误拒绝，避免 UI 请求永挂。
   */
  const runCapture = (argv: string[], timeoutMs: number): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      let out = ''
      let settled = false
      let timerDisposer: (() => void) | null = null
      const child = subprocess.spawn({
        argv: argv,
        cwd: workspaceRoot,
        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' },
        graceMs: 3000,
      })
      const finish = (err: Error | null): void => {
        if (settled) return
        settled = true
        if (timerDisposer) timerDisposer()
        if (err) reject(err)
        else resolve(out)
      }
      // stderr 忽略：probe 的日志噪音不需要回流；stdout 只承载协议行
      ;(async () => {
        try {
          for await (const chunk of child.stdout) out += String(chunk)
        } catch {
          // stdout 提前结束：按已收集内容处理
        }
      })()
      child.done.then(
        (outcome) => finish(outcome.exitCode === 0 || out.length > 0 ? null : new Error('退出码 ' + outcome.exitCode)),
        (err) => finish(new Error(String((err && (err as Error).message) || err))),
      )
      timerDisposer = timer.timeout(() => {
        logWarn('一次性子进程超时（' + timeoutMs + 'ms），已终止: ' + argv.join(' '))
        try {
          child.terminate()
        } catch {
          // 进程可能已退出
        }
        finish(new Error('子进程超时 ' + timeoutMs + 'ms'))
      }, timeoutMs)
    })
  }

  /**
   * 停掉当前 helper：先发 quit 让它自己关窗退出（先礼），超时或没反应再
   * terminate（后兵），并等进程真正结束——用于切换浏览器时重建。
   * 调用即置空 handle：新请求不会挂到正在退出的进程上。
   */
  const stopHelper = async (reason: string): Promise<void> => {
    const boot = handle
    if (boot === null) return
    handle = null
    helperBrowserPath = ''
    logInfo('正在关闭内置浏览器（' + reason + '）')
    // 在途请求立即失败：quit 之后不会再收到它们的 reply，等下去只会挂到超时
    for (const [id, w] of Array.from(waiters)) {
      waiters.delete(id)
      w.reject(new Error('浏览器正在重启（' + reason + '）'))
    }
    // 命令走 HTTP 长轮询队列（不是 stdin——stdin 只用于启动载荷）
    sendCommand({ id: ++cmdSeq, method: 'quit', params: {} })
    // quit 会先 reply 再关窗退出；等进程结束（最多 8s）后兜底 terminate
    await Promise.race([
      boot.done.then(() => undefined, () => undefined),
      new Promise<void>((resolve) => {
        timer.timeout(resolve, 8000)
      }),
    ])
    try {
      boot.terminate()
    } catch {
      // 已退出
    }
    // 旧进程再也不会来取命令：丢弃队列残留（否则新 helper 会收到过期的 quit/open）
    if (commandQueue.length > 0) {
      logDebug('丢弃旧 helper 未取走的 ' + commandQueue.length + ' 条命令（切换浏览器前入队）')
      commandQueue.length = 0
    }
  }

  /**
   * 确保 helper 子进程已启动（单例）。
   * preferPath 是本次请求的用户选择（空串=自动探测）：
   *   - 未指定浏览器（自动探测）或与当前一致：复用正在运行的 helper——
   *     已在运行的窗口/登录态不因「改回自动」被无谓关掉；
   *   - 明确指定了另一个浏览器：先关旧窗口再以新浏览器打开（用户的显式意图）。
   * 启动中复用同一 Promise，防止并发调用重复 spawn；
   * 启动失败写入 status 供 UI 轮询展示，并把异常抛回调用方。
   */
  const ensureHelper = async (preferPath?: string): Promise<SubprocessHandleLike> => {
    const prefer = String(preferPath || '').trim()
    if (handle !== null) {
      if (!prefer || prefer.toLowerCase() === helperBrowserPath.toLowerCase()) return handle
      await stopHelper('切换浏览器')
    }
    if (starting) {
      logDebug('helper 正在启动中，复用进行中的启动 Promise（本次选择: ' + (prefer || '自动探测') + '）')
      return starting
    }
    starting = (async (): Promise<SubprocessHandleLike> => {
      try {
        const startedAt = Date.now()
        const resourceDir = await resolveResourceDir()
        const res = await loadResources(resourceDir)
        const payloadText = res.helper + '\n<<<DSH_SPLIT>>>\n' + res.inspector + '\n<<<DSH_END>>>\n'
        const node = await subprocess.resolveExecutable('node')
        // npm 安装 playwright-core 运行时（首次数秒，无浏览器下载）后启动系统浏览器；
        // 入口路径按安装布局自适应解析（见 resolveNpmCli），Windows 下也不 spawn .cmd
        const launcher = await resolveNpmCli(node)
        const port = typeof webServer.port === 'number' && webServer.port > 0 ? webServer.port : 0
        if (port === 0) throw new Error('DSH web 服务器端口不可用')
        logDebug('启动参数: node=' + node + ' npmCli=' + launcher + ' webPort=' + port + ' browser=' + (prefer || '(自动探测)'))
        // argv[4] = 用户选定的浏览器路径（可空）：bootstrap 转成 probe 的 --prefer
        const bootArgv = [node, resourceDir + '/bootstrap.cjs', launcher, String(port)]
        if (prefer) bootArgv.push(prefer)
        const boot = subprocess.spawn({
          argv: bootArgv,
          cwd: workspaceRoot,
          stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 65536 } },
          graceMs: 3000,
        })
        handle = boot
        helperBrowserPath = prefer
        payloadSent = false
        lineBuf = ''
        logInfo('helper 子进程已启动（耗时 ' + (Date.now() - startedAt) + 'ms，后续 READY 握手与浏览器探测由 bootstrap 驱动）')
        boot.done.then((outcome) => {
          // 已被换浏览器的替换流程接管：旧进程的退出不再改写状态
          if (handle !== boot) {
            logDebug('旧 helper 进程退出（已被替换，忽略其退出码对状态的影响）')
            return
          }
          handle = null
          helperBrowserPath = ''
          const tail = stderrTail(boot)
          const detail = '浏览器进程已退出 (code ' + outcome.exitCode + ')' + (tail ? ' · ' + tail : '')
          // 退出码 0 多为用户正常关窗（INFO）；非零为异常退出（WARN，可重新打开）
          if (outcome.exitCode === 0) logInfo(detail)
          else logWarn(detail)
          status = { state: 'closed', message: detail }
          // 进程已死：所有等待 reply 的请求立即失败，避免挂到超时
          for (const [id, w] of Array.from(waiters)) {
            waiters.delete(id)
            w.reject(new Error('浏览器进程已退出'))
          }
        }, () => {})
        readStdout(boot, payloadText)
        return boot
      } catch (err) {
        logError('启动 helper 失败（资源目录: ' + pkgResourceDir + '）', err)
        status = { state: 'error', message: String((err && (err as Error).message) || err) }
        throw err
      } finally {
        starting = null
      }
    })()
    return starting
  }

  /**
   * 发送一条命令并等待同 id 的 reply 事件（Promise 化）。
   * 超时（默认 60s，调用方可覆盖）自动清理等待者并拒绝，
   * 防止 helper 无响应时 Promise 永远挂起。
   */
  const request = (method: string, params: Record<string, unknown> | undefined, timeoutMs?: number): Promise<{ ok: boolean; status?: PickerStatus; error?: string }> => {
    const id = ++cmdSeq
    return new Promise((resolve, reject) => {
      if (handle === null) {
        reject(new Error('浏览器未运行'))
        return
      }
      waiters.set(id, { resolve, reject, at: Date.now() })
      sendCommand({ id: id, method: method, params: params || {} })
      timer.timeout(() => {
        const w = waiters.get(id)
        if (w) {
          waiters.delete(id)
          logWarn('命令超时: ' + method + '（id=' + id + '，' + (timeoutMs || 60000) + 'ms 未收到 reply）')
          w.reject(new Error(method + ' 超时'))
        }
      }, timeoutMs || 60000)
    })
  }

  /**
   * 从 /invoke 参数里解析用户的浏览器选择（client 从 localStorage 记忆里带上来）。
   * 只认 { name?, path } 且 path 为非空字符串的形态；不合法一律当"未选择"（自动探测），
   * 避免 UI 传参异常时反而让打开失败。
   */
  const parseBrowserChoice = (raw: unknown): string => {
    if (!raw || typeof raw !== 'object') return ''
    const path = (raw as { path?: unknown }).path
    return typeof path === 'string' ? path.trim() : ''
  }

  /**
   * picker-navigate：把内嵌浏览器导航到指定网址。
   * 规范化（缺协议头补 https://）→ 确保 helper 已启动（按 args.browser 选择浏览器，
   * 换浏览器会先关掉旧窗口）→ 发 open 命令；首次使用需安装 playwright-core 运行时
   * + 探测系统浏览器（约 10-30 秒），超时放宽到 120s。
   */
  const pickerNavigate: Handler = async (args) => {
    const norm = normalizeUrl(String((args && args.url) || ''))
    if (!norm.ok) {
      logDebug('网址校验未通过: ' + norm.error)
      return { ok: false, error: norm.error }
    }
    const url = norm.url
    const preferPath = parseBrowserChoice(args && args.browser)
    if (preferPath) logInfo('用户选择浏览器: ' + preferPath)
    try {
      await ensureHelper(preferPath)
      const r = await request('open', { url: url }, 120000)
      // 带上实际使用的浏览器名：UI 用它判断「所选浏览器不可用已回退」并更新提示
      return r && r.ok
        ? {
            ok: true,
            status: Object.assign(
              { state: 'open' as const },
              lastBrowserName ? { browser: lastBrowserName } : {},
              r.status || { url: url },
            ),
          }
        : { ok: false, error: (r && r.error) || '打开失败' }
    } catch (err) {
      logError('打开网址失败: ' + url, err)
      return { ok: false, error: String((err && (err as Error).message) || err) }
    }
  }

  /**
   * picker-browsers：探测系统已安装的 Chromium 系浏览器（供「打开」按钮右侧
   * 下拉菜单选择）。跑 browser-probe.cjs 的清单模式——只做存在性检查，不启动
   * 浏览器、不要求 playwright-core 已装，因此打开菜单只需百毫秒级；
   * 真正能不能被驱动由 helper 启动时的无头验证兜底（不可用会回退自动探测）。
   */
  const pickerBrowsers: Handler = async () => {
    const startedAt = Date.now()
    const current: BrowserChoice | undefined = helperBrowserPath
      ? { name: lastBrowserName || 'Browser', path: helperBrowserPath }
      : undefined
    // 缓存命中直接返回：current（正在运行的浏览器）每次都现算，只有系统清单走缓存
    if (browsersCache && Date.now() - browsersCache.at < BROWSER_LIST_TTL_MS) {
      logDebug('浏览器清单缓存命中（' + Math.round((Date.now() - browsersCache.at) / 1000) + 's 前探测）')
      return { ok: true, browsers: browsersCache.browsers, current: current }
    }
    let browsers: BrowserOption[] = []
    try {
      const resourceDir = await resolveResourceDir()
      const node = await subprocess.resolveExecutable('node')
      const out = await runCapture([node, resourceDir + '/browser-probe.cjs', '--list'], BROWSER_PROBE_TIMEOUT_MS)
      const line = String(out).split('\n').map((s) => s.trim()).filter(Boolean).pop() || ''
      const parsed = JSON.parse(line) as BrowserOption[]
      if (!Array.isArray(parsed)) throw new Error('探测结果不是数组: ' + line.slice(0, 200))
      browsers = parsed.filter((b) => b && typeof b.path === 'string' && b.path)
      browsersCache = { at: Date.now(), browsers: browsers }
      logInfo('浏览器清单探测完成（' + browsers.filter((b) => b.exists).length + ' 个可用 / ' + browsers.length + ' 个候选，耗时 ' + (Date.now() - startedAt) + 'ms）')
    } catch (err) {
      logError('浏览器清单探测失败（下拉菜单将只显示错误提示）', err)
      return { ok: false, error: String((err && (err as Error).message) || err) }
    }
    return { ok: true, browsers: browsers, current: current }
  }

  /**
   * picker-reinject：在当前页面仅重新注入选择功能（不重新导航），
   * 用于登录等人工操作后恢复选择模式。
   * 浏览器没开着时（helper 没起/窗口被关/还停在 about:blank 空页）不再报
   * "no window" 了事：带着输入框里的网址先执行打开（helper 的 open 本身
   * 就会在加载后注入），并用 reopened 标记告知 UI 走的是这条路。
   */
  const pickerReinject: Handler = async (args) => {
    const url = String((args && args.url) || '')
    const preferPath = parseBrowserChoice(args && args.browser)
    try {
      // 已在运行的 helper 不因浏览器选择不同而重启：仅重新注入不该动当前窗口；
      // 尚未启动时才用用户选择（与「打开」一致）
      await ensureHelper(handle === null ? preferPath : '')
      const st = await request('status', {}, 8000).catch(() => null)
      const cur = st && st.ok ? st.status : undefined
      // 「没开着」的判据：无窗口（closed）、无 URL、或仅剩 about:blank 空页
      const noPage = !cur || cur.closed === true || !cur.url || /^about:blank$/i.test(cur.url)
      if (noPage) {
        // 兜底打开的网址同样先规范化：只填 `example.com` 也能开
        const norm = normalizeUrl(url)
        if (!norm.ok) {
          logDebug('浏览器未打开且网址不可用: ' + norm.error)
          // 没填网址与填了不支持的协议要分开说，别把后者含糊成"请先输入网址"
          return { ok: false, error: url ? norm.error : '内置浏览器未打开，请先输入网址（或点「打开」）' }
        }
        logInfo('浏览器未打开（' + String((cur && cur.url) || '无窗口') + '），先打开再注入: ' + norm.url)
        const r = await request('open', { url: norm.url }, 120000)
        return r && r.ok
          ? {
              ok: true,
              reopened: true,
              status: Object.assign(
                { state: 'open' as const },
                lastBrowserName ? { browser: lastBrowserName } : {},
                r.status || { url: norm.url },
              ),
            }
          : { ok: false, error: (r && r.error) || '打开失败' }
      }
      const r = await request('reinject', {}, 15000)
      return r && r.ok
        ? { ok: true, status: Object.assign({ state: 'open' as const }, r.status || {}) }
        : { ok: false, error: (r && r.error) || '重新注入失败' }
    } catch (err) {
      logError('重新注入失败', err)
      return { ok: false, error: String((err && (err as Error).message) || err) }
    }
  }

  /**
   * picker-status：查询当前状态。helper 不在线直接回本地缓存状态；
   * 在线则问 helper，问不动时回退本地缓存（降级，不报错给 UI）。
   */
  const pickerStatus: Handler = async () => {
    if (handle === null) return { ok: true, status: status }
    try {
      const r = await request('status', {}, 8000)
      return r && r.ok ? { ok: true, status: r.status } : { ok: true, status: status }
    } catch {
      // helper 状态查询失败：降级为本地缓存状态（UI 轮询高频，不宜报错）
      logDebug('helper 状态查询失败，降级为本地缓存状态')
      return { ok: true, status: status }
    }
  }

  /** picker-close：关闭浏览器窗口（尽力而为），本地状态立即置 closed。 */
  const pickerClose: Handler = async () => {
    if (handle !== null) {
      try {
        await request('close', {}, 5000)
      } catch {
        // 关闭是尽力而为
        logDebug('close 命令未获确认（helper 可能已退出），忽略')
      }
    }
    status = { state: 'closed', message: '浏览器窗口已关闭' }
    return { ok: true, status: status }
  }

  /**
   * picker-pull：客户端 1.5s 轮询的增量拉取——返回 afterSeq 之后新选中的
   * 元素列表 + 当前状态，游标语义保证不重复投递。
   * 附带 lastSeq（host 最大序号）与 contextCount（上下文节点数）：
   * client 挂载后的首次响应只用 lastSeq 建立基线，历史 pending 不重放——
   * 发送对话后组件重挂载/页面刷新时，旧元素不会被再次插入输入框。
   */
  const pickerPull: Handler = async (args) => {
    const after = Number((args && args.afterSeq) || 0)
    const elements = pending
      .filter((e) => e.seq > after)
      .map((e) => ({ seq: e.seq, domId: e.domId, payload: e.payload }))
    if (elements.length) logDebug('picker-pull 投递 ' + elements.length + ' 个元素（afterSeq=' + after + '）')
    return { ok: true, elements: elements, status: status, lastSeq: lastSeq, contextCount: domRegistry.length }
  }

  /**
   * picker-context-list：返回上下文历史节点的轻量摘要（domId/标签/URL），
   * 供对话框左下角的悬浮菜单展示；不含 payload 大字段，最多 200 条。
   */
  const pickerContextList: Handler = async () => {
    const items: ContextItemSummary[] = domRegistry.map((e) => {
      const p = e.payload || {}
      return { domId: e.id, label: registryLabel(p), pageUrl: String(p.pageUrl || '') || undefined }
    })
    logDebug('picker-context-list 返回 ' + items.length + ' 个历史节点')
    return { ok: true, items: items, contextCount: domRegistry.length }
  }

  /**
   * picker-clear-context：清空全部上下文节点（domRegistry）与待插入队列
   * （pending）。domCounter 不重置——旧对话消息中的 [DOMn] 引用不会因编号
   * 复用而错指到新元素；系统提示的页面元素列表随注册表为空自动消失。
   */
  const pickerClearContext: Handler = async () => {
    const removed = domRegistry.length
    domRegistry = []
    pending = []
    logInfo('上下文已清空（移除 ' + removed + ' 个节点；编号计数保留，下一元素为 DOM' + (domCounter + 1) + '）')
    return { ok: true, contextCount: 0 }
  }

  handlers.set('picker-navigate', pickerNavigate)
  handlers.set('picker-browsers', pickerBrowsers)
  handlers.set('picker-reinject', pickerReinject)
  handlers.set('picker-status', pickerStatus)
  handlers.set('picker-close', pickerClose)
  handlers.set('picker-pull', pickerPull)
  handlers.set('picker-context-list', pickerContextList)
  handlers.set('picker-clear-context', pickerClearContext)

  // 插件卸载清理：尽力关闭 helper 子进程（先礼后兵：stdin.end 再 terminate）
  ctx.effect(() => () => {
    if (handle) {
      try {
        if (handle.stdin) handle.stdin.end()
      } catch {
        // stdin 已关闭
      }
      handle.terminate()
      handle = null
      logInfo('插件卸载，helper 子进程已终止')
    }
  })
}
