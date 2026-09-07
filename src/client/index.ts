/**
 * dsh-webpage-element-picker — Client 半边（已安装包 bundle 入口）。
 *
 * 在 `conversation.input.left` 槽位注册一个十字图标按钮。点击后打开
 * "添加页面元素"对话框：将内嵌系统浏览器导航到某个 URL，用注入的
 * inspector 选择页面元素，并在输入框草稿中插入 `[标签][DOMn]` 引用式
 * 占位符——模型通过 host 侧的 read_picked_element 工具按需读取完整
 * 元素详情。
 *
 * 本模块是包的 `./client` bundle 主体：tsup（tsup.config.ts）将其
 * 打包（external `react`——浏览器模块表通过注入的 `require` 提供），
 * 包裹在 web boot 握手中（`window.__ModuleLoader__.load({id, factory})`）。
 * 它通过 harness webserver 的 /dsh-webpage-element-picker/invoke 路由
 * （同源 fetch）与 host 半边通信。
 *
 * 日志：DEBUG 级走 console.debug——浏览器 DevTools 默认级别下不可见，
 * 等价于生产默认关闭；INFO/ERROR 直接输出。
 */

import { React, h } from './react'
import type { ClientCtx, PickerEntryProps } from './services'
import type { ContextItemSummary, InvokeResult, PendingElement, PickerStatus } from '../shared/types'

const PLUGIN_ID = 'dsh-webpage-element-picker'
const INVOKE_PATH = '/dsh-webpage-element-picker/invoke'

/** 日志统一前缀（DevTools 控制台检索用）。 */
const LOG_PREFIX = '[dsh-webpage-element-picker]'

/** DEBUG：分支走向、中间变量（console.debug，DevTools 默认级别不可见）。 */
function logDebug(msg: string): void {
  console.debug(LOG_PREFIX + ' [DEBUG] ' + msg)
}
/** INFO：请求入口、关键状态变更、外部调用耗时 >500ms。 */
function logInfo(msg: string): void {
  console.info(LOG_PREFIX + ' [INFO] ' + msg)
}
/** ERROR：业务异常、外部调用失败——带堆栈和业务上下文。 */
function logError(msg: string, err?: unknown): void {
  const e = err as Error | null | undefined
  const detail = e && e.stack ? e.stack : String((e && e.message) || err || '')
  console.error(LOG_PREFIX + ' [ERROR] ' + msg + (detail ? '\n' + detail : ''))
}

const STYLE_CSS =
  '.dsh-we-icon-btn { background: transparent; border: none; color: #9a9aa6; padding: 5px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }' +
  '.dsh-we-icon-btn:hover { background: rgba(255,255,255,0.08); color: #d8d8e0; }' +
  '.dsh-we-icon-btn:disabled { opacity: 0.5; cursor: default; }' +
  '.dsh-we-ctx-count { color: #8b8b96; font-size: 12px; padding: 4px 8px; border-radius: 6px; cursor: default; user-select: none; }' +
  '.dsh-we-ctx-count:hover { background: rgba(255,255,255,0.06); color: #d8d8e0; }' +
  '.dsh-we-ctx-item { background: transparent; border: none; width: 100%; text-align: left; cursor: pointer; display: flex; gap: 8px; align-items: baseline; padding: 6px 10px; font-family: inherit; }' +
  '.dsh-we-ctx-item:hover { background: rgba(255,255,255,0.07); }'

/**
 * 调用 host 半边的 picker-* 处理器（POST 到 harness webserver 路由）。
 * 日志：DEBUG 记录方法与参数；耗时 >500ms 记 INFO（首次安装运行时/
 * 冷启动系统浏览器会显著变慢）；失败抛给调用方的 catch 统一处理。
 */
function hostCall(method: string, params?: Record<string, unknown>): Promise<InvokeResult> {
  // 同源调用：web shell 与插件 API 同 origin，空 base 兜底非浏览器环境
  const base = typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin : ''
  const startedAt = Date.now()
  logDebug('host 调用: ' + method + ' 参数: ' + JSON.stringify(params || {}))
  return fetch(base + INVOKE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: method, params: params || {} }),
  }).then((res) => {
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return res.json() as Promise<InvokeResult>
  }).then((value) => {
    const cost = Date.now() - startedAt
    if (cost > 500) logInfo('host 调用 ' + method + ' 耗时 ' + cost + 'ms')
    return value
  })
}

/** 折叠所有空白为单空格并截断为最长 10 字，用作占位符里的短标签。 */
function shortText(s: unknown): string {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.length > 10 ? t.slice(0, 10) + '…' : t
}

/**
 * 生成元素的人类可读标签，按优先级回退：
 * 可见文本 → aria-label/placeholder/alt/title/value 语义属性 →
 * tag#id → tag.class（前两个类名）→ 裸 tag。
 */
function labelOf(p: Record<string, unknown>): string {
  if (p.textContent) return shortText(p.textContent)
  const attrs = (p.attributes || {}) as Record<string, string>
  const keys = ['aria-label', 'placeholder', 'alt', 'title', 'value']
  for (const key of keys) {
    if (attrs[key]) return shortText(attrs[key])
  }
  const tag = String(p.tagName || '?')
  if (p.id) return tag + '#' + String(p.id)
  const cls = String(p.className || '').trim().split(/\s+/).slice(0, 2).join('.')
  if (cls) return tag + '.' + cls
  return tag
}

/**
 * 生成插入输入框的 `[标签][DOMn]` 引用式占位符；
 * 无可用标签时退化为裸 `[DOMn]`。
 */
function placeholderLine(item: PendingElement): string {
  const p = (item.payload || {}) as Record<string, unknown>
  const id = item.domId || 'DOM'
  const label = labelOf(p)
  if (!label || label === '?') return '[' + id + ']'
  return '[' + label + '][' + id + ']'
}

const S: Record<string, React.CSSProperties> = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  panel: { width: 560, maxWidth: '92vw', background: '#1b1b22', border: '1px solid #34343e', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.55)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #2a2a33' },
  title: { color: '#e6e6eb', fontSize: 14, fontWeight: 600 },
  closeBtn: { background: 'none', border: 'none', color: '#8b8b96', fontSize: 18, cursor: 'pointer', padding: '0 4px', lineHeight: 1 },
  body: { padding: 16, display: 'flex', flexDirection: 'column', gap: 10 },
  textarea: { width: '100%', boxSizing: 'border-box', background: '#121218', color: '#e6e6eb', border: '1px solid #34343e', borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none', minHeight: 84, lineHeight: 1.5 },
  statusLine: { color: '#9fd0ff', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  notice: { color: '#f5c56b', fontSize: 12 },
  hint: { color: '#8b8b96', fontSize: 11, lineHeight: 1.6 },
  footer: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '12px 16px', borderTop: '1px solid #2a2a33' },
  footerLeft: { position: 'relative', display: 'flex', alignItems: 'center' },
  footerRight: { display: 'flex', gap: 8 },
  contextMenu: { position: 'absolute', left: 0, bottom: '100%', width: 280, background: '#121218', border: '1px solid #34343e', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  menuHeader: { color: '#8b8b96', fontSize: 11, padding: '8px 10px 6px', borderBottom: '1px solid #2a2a33' },
  menuList: { overflowY: 'auto', maxHeight: 200 },
  menuItemId: { color: '#9fd0ff', fontSize: 12, flexShrink: 0 },
  menuItemLabel: { color: '#c9c9d1', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  menuEmpty: { color: '#8b8b96', fontSize: 12, padding: '12px 10px', textAlign: 'center' },
  menuFooter: { borderTop: '1px solid #2a2a33', padding: '6px 10px', display: 'flex', justifyContent: 'flex-end' },
  clearBtn: { background: 'transparent', color: '#c9c9d1', border: '1px solid #34343e', borderRadius: 6, padding: '3px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' },
  clearBtnArmed: { background: '#b33939', color: '#fff', border: '1px solid #d64545', borderRadius: 6, padding: '3px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' },
  ghostBtn: { background: 'transparent', color: '#c9c9d1', border: '1px solid #34343e', borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  primaryBtn: { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 16px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
}

/** 十字准星 SVG 图标（输入框左侧槽位按钮的内容）。 */
function crosshairIcon(el: typeof h): React.ReactNode {
  return el(
    'svg',
    {
      width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      strokeWidth: 2, strokeLinecap: 'round',
    },
    el('circle', { cx: 12, cy: 12, r: 7 }),
    el('line', { x1: 12, y1: 2, x2: 12, y2: 6 }),
    el('line', { x1: 12, y1: 18, x2: 12, y2: 22 }),
    el('line', { x1: 2, y1: 12, x2: 6, y2: 12 }),
    el('line', { x1: 18, y1: 12, x2: 22, y2: 12 }),
  )
}

/**
 * 槽位组件主体：十字图标按钮 + 「添加页面元素」对话框。
 * 对话框负责网址输入与状态展示；轮询 host 拉取新选中元素并插入草稿。
 */
function PickerEntry(props: PickerEntryProps): React.ReactNode {
  const el = h
  // 读取宿主输入框草稿（useInput 是槽位标准 props；缺失时退化为空草稿兜底）
  const input = props.useInput ? props.useInput(function (s) { return s }) : { draft: '' }
  // st 用 state[0] 对象做可变引用：轮询闭包内需要读到最新的 draft/afterSeq，
  // 又不能让轮询 effect 依赖 draft（会导致每次打字都退订重订）。
  // synced 标记是否已用 host 的 lastSeq 建立过轮询基线（组件每次挂载只建一次）；
  // clearTimer 是「清空」二次确认按钮的自动还原定时器 id（0 表示无）。
  const st = React.useState(function () { return { afterSeq: 0, draft: '', synced: false, clearTimer: 0 } })[0]
  st.draft = input.draft

  const openState = React.useState(false)
  const open = openState[0]
  const setOpen = openState[1]
  const urlState = React.useState('')
  const urlText = urlState[0]
  const setUrlText = urlState[1]
  const busyState = React.useState(false)
  const busy = busyState[0]
  const setBusy = busyState[1]
  const statusState2 = React.useState<PickerStatus | null>(null)
  const status = statusState2[0]
  const setStatus = statusState2[1]
  const noticeState = React.useState('')
  const notice = noticeState[0]
  const setNotice = noticeState[1]
  // 上下文区域状态：计数随轮询更新；菜单/列表/清空确认仅对话框内交互使用
  const contextCountState = React.useState(0)
  const contextCount = contextCountState[0]
  const setContextCount = contextCountState[1]
  const menuOpenState = React.useState(false)
  const menuOpen = menuOpenState[0]
  const setMenuOpen = menuOpenState[1]
  const contextItemsState = React.useState<ContextItemSummary[]>([])
  const contextItems = contextItemsState[0]
  const setContextItems = contextItemsState[1]
  const clearArmedState = React.useState(false)
  const clearArmed = clearArmedState[0]
  const setClearArmed = clearArmedState[1]
  const statusState = status ? status.state : null

  /** 显示一条通知，5 秒后自动清除（仅当内容未被后续通知覆盖时）。 */
  const showNotice = function (text: string): void {
    setNotice(text)
    window.setTimeout(function () {
      setNotice(function (cur) { return cur === text ? '' : cur })
    }, 5000)
  }

  /**
   * 把新选中的元素追加为输入框草稿里的占位符行，
   * 并推进轮询游标 afterSeq（游标语义保证同一元素不重复插入）。
   */
  const insertElements = function (elements: PendingElement[]): void {
    // 防御纵深：按当前游标再过滤一次——与基线请求并发在途的迟到响应可能
    // 携带游标之前的元素，过滤后自然归零，任何情况下同一元素不重复插入
    const fresh = elements.filter(function (e) { return e.seq > st.afterSeq })
    if (!fresh.length) return
    let draft = st.draft
    for (const item of fresh) {
      draft += (draft ? '\n' : '') + placeholderLine(item)
    }
    if (props.inputActions && typeof props.inputActions.setDraft === 'function') {
      props.inputActions.setDraft(draft)
    }
    st.draft = draft
    st.afterSeq = fresh[fresh.length - 1].seq
    logDebug('已插入 ' + fresh.length + ' 个占位符: ' + fresh.map(function (e) { return e.domId }).join(', '))
  }

  /**
   * 悬浮打开上下文菜单时拉取一次历史节点摘要（不随 1.5s 轮询高频刷新，
   * 避免 200 条摘要反复传输）；失败仅记日志，菜单展示旧数据。
   */
  const loadContextItems = function (): void {
    hostCall('picker-context-list', {})
      .then(function (res) {
        if (!res || !res.ok) return
        setContextItems(res.items || [])
        if (typeof res.contextCount === 'number') setContextCount(res.contextCount)
      })
      .catch(function (err) {
        logDebug('picker-context-list 失败（菜单保留旧数据）: ' + String((err && err.message) || err))
      })
  }

  /**
   * 点击菜单中的历史节点：把它的 [标签][DOMn] 占位符追加到输入框草稿。
   * 不经过 afterSeq 游标（历史节点序号必小于游标），与轮询插入互不干扰。
   * 不去重：同一节点允许显式重复插入（用户主动点击，与轮询的游标去重语义不同）。
   */
  const insertContextItem = function (item: ContextItemSummary): void {
    // 与 placeholderLine 同规则：空标签或 '?'（无 tagName）退化为裸 [DOMn]
    const label = item.label && item.label !== '?' ? item.label : ''
    const line = label ? '[' + label + '][' + item.domId + ']' : '[' + item.domId + ']'
    const draft = (st.draft ? st.draft + '\n' : '') + line
    if (props.inputActions && typeof props.inputActions.setDraft === 'function') {
      props.inputActions.setDraft(draft)
    }
    st.draft = draft
    setMenuOpen(false)
    setClearArmed(false)
    logDebug('已从历史菜单插入占位符: ' + item.domId)
    showNotice('已插入 ' + item.domId + ' 到输入框')
  }

  /**
   * 「清空」二次确认：第一次点击进入确认态（按钮变红，3 秒无操作自动还原）；
   * 确认态下再点才真正调 host 清空全部上下文节点，成功后计数归零、列表清空。
   */
  const onClearClick = function (): void {
    if (!clearArmed) {
      setClearArmed(true)
      if (st.clearTimer) window.clearTimeout(st.clearTimer)
      st.clearTimer = window.setTimeout(function () {
        st.clearTimer = 0
        setClearArmed(false)
      }, 3000)
      return
    }
    if (st.clearTimer) {
      window.clearTimeout(st.clearTimer)
      st.clearTimer = 0
    }
    setClearArmed(false)
    logInfo('用户确认清空全部上下文节点')
    hostCall('picker-clear-context', {})
      .then(function (res) {
        if (res && res.ok) {
          setContextItems([])
          setContextCount(0)
          showNotice('已清空全部上下文节点（输入框中已有占位符的引用将失效）')
        } else {
          showNotice('清空失败：' + ((res && res.error) || '未知错误'))
        }
      })
      .catch(function (err) {
        logError('清空上下文失败', err)
        showNotice('清空失败：' + String((err && err.message) || err))
      })
  }

  /**
   * 处理一次 picker-pull 响应：状态/计数更新 → 挂载后首次响应仅建立游标基线
   * （afterSeq 对齐 host 的 lastSeq，不插入——发送对话后组件重挂载/页面刷新时，
   * host pending 里的历史元素不会被重放进新草稿）→ 之后按增量正常插入。
   */
  const processPullResponse = function (res: InvokeResult, dialogOpen: boolean): void {
    if (res.status) setStatus(res.status)
    if (typeof res.contextCount === 'number') setContextCount(res.contextCount)
    if (!st.synced) {
      st.synced = true
      st.afterSeq = typeof res.lastSeq === 'number' ? res.lastSeq : 0
      logDebug('轮询基线已建立: afterSeq=' + st.afterSeq)
      return
    }
    const elements = res.elements || []
    if (elements.length) {
      insertElements(elements)
      if (dialogOpen) showNotice('已添加 ' + elements.length + ' 个页面元素到输入框')
    }
  }

  // 挂载时播种一次 picker-pull：恢复 status（浏览器仍 open 时下方轮询立即
  // 恢复），避免「组件卸载期间新选中的元素」积压到下次重开对话框建基线时
  // 被整体吞掉；浏览器未启动时 host 返回 idle 状态，无副作用
  React.useEffect(function () {
    let cancelled = false
    hostCall('picker-pull', { afterSeq: st.afterSeq })
      .then(function (res) {
        if (cancelled || !res) return
        processPullResponse(res, false)
      })
      .catch(function (err) {
        logDebug('挂载播种 picker-pull 失败（浏览器未就绪），忽略: ' + String((err && err.message) || err))
      })
    return function () { cancelled = true }
  }, [])

  // 卸载时清理「清空」确认态的自动还原定时器，避免在已卸载组件上 setState
  React.useEffect(function () {
    return function () {
      if (st.clearTimer) {
        window.clearTimeout(st.clearTimer)
        st.clearTimer = 0
      }
    }
  }, [])

  // 轮询 host 的 picker-pull：对话框打开期间或浏览器处于 open 状态时，
  // 每 1.5s 拉取一次新选中元素与最新状态
  React.useEffect(function () {
    if (!open && statusState !== 'open') return
    let cancelled = false
    const poll = function (): void {
      hostCall('picker-pull', { afterSeq: st.afterSeq })
        .then(function (res) {
          if (cancelled || !res) return
          processPullResponse(res, open)
        })
        .catch(function (err) {
          // 内置浏览器尚未就绪时 host 会拒绝请求——属预期，静默继续轮询
          logDebug('picker-pull 失败（浏览器未就绪），继续轮询: ' + String((err && err.message) || err))
        })
    }
    poll()
    const intervalId = window.setInterval(poll, 1500)
    return function () {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [open, statusState])

  /** 事件处理「打开」：取第一行网址 → 协议校验 → 调 picker-navigate。 */
  const onConfirm = function (): void {
    // 多行输入只取第一个非空行（提示文案已说明"每行一个，使用第一行"）
    const url = String(urlText || '').split('\n').map(function (s) { return s.trim() }).filter(Boolean)[0] || ''
    if (!url) {
      showNotice('请先输入网址')
      return
    }
    if (!/^https?:\/\//i.test(url)) {
      logDebug('网址校验未通过（需 http/https）: ' + url)
      showNotice('网址需以 http:// 或 https:// 开头')
      return
    }
    logInfo('用户请求打开网址: ' + url)
    setBusy(true)
    hostCall('picker-navigate', { url: url })
      .then(function (res) {
        if (res && res.ok) {
          setStatus(Object.assign({ state: 'open' as const }, res.status || { url: url }))
          setOpen(false)
        } else {
          showNotice('打开失败：' + ((res && res.error) || '未知错误'))
        }
      })
      .catch(function (err) {
        logError('打开网址失败: ' + url, err)
        showNotice('打开失败：' + String((err && err.message) || err))
      })
      .finally(function () {
        setBusy(false)
      })
  }

  /** 事件处理「仅重新注入」：不重新导航，在当前页面恢复选择功能（登录后场景）。 */
  const onReinject = function (): void {
    logInfo('用户请求重新注入选择功能')
    setBusy(true)
    hostCall('picker-reinject', {})
      .then(function (res) {
        if (res && res.ok) {
          setStatus(Object.assign({ state: 'open' as const }, res.status || status))
          showNotice('已重新注入选择功能')
        } else {
          showNotice('重新注入失败：' + ((res && res.error) || '未知错误'))
        }
      })
      .catch(function (err) {
        logError('重新注入失败', err)
        showNotice('重新注入失败：' + String((err && err.message) || err))
      })
      .finally(function () {
        setBusy(false)
      })
  }

  // 图标按钮悬浮提示：优先 host 状态消息，否则按 open 状态组装摘要
  const browserLabel = status && status.browser ? '浏览器: ' + status.browser + ' · ' : ''
  const tooltip = status
    ? status.message ||
      (status.state === 'open'
        ? browserLabel + '已打开: ' + (status.title || status.url || '') +
          (status.modeExited ? ' · 选择模式已退出（点击图标可重新打开）' : status.injected ? ' · 已注入选择功能' : '')
        : '')
    : ''
  const buttonTitle = tooltip || '打开浏览器并选择页面元素'

  /**
   * 渲染上下文历史节点悬浮菜单（footer 左下角「上下文：N 项」悬停时出现，
   * 向上展开）。菜单项最新在上，点击插入占位符；底部是二次确认的清空按钮。
   */
  const renderContextMenu = function (): React.ReactNode {
    const items = contextItems.slice().reverse()
    return el(
      'div',
      { style: S.contextMenu },
      el('div', { style: S.menuHeader }, '历史节点（点击插入输入框）'),
      items.length
        ? el(
            'div',
            { style: S.menuList },
            items.map(function (item) {
              return el(
                'button',
                {
                  key: item.domId,
                  className: 'dsh-we-ctx-item',
                  title: item.pageUrl || item.domId,
                  onClick: function () { insertContextItem(item) },
                },
                el('span', { style: S.menuItemId }, item.domId),
                el('span', { style: S.menuItemLabel }, item.label || '(无标签)'),
              )
            }),
          )
        : el('div', { style: S.menuEmpty }, contextCount > 0 ? '列表加载失败，请重新悬停重试' : '暂无历史节点'),
      el(
        'div',
        { style: S.menuFooter },
        el(
          'button',
          { onClick: onClearClick, disabled: !contextCount && !clearArmed, style: clearArmed ? S.clearBtnArmed : S.clearBtn },
          clearArmed ? '确认清空？' : '清空',
        ),
      ),
    )
  }

  /** 渲染「添加页面元素」对话框（点击 backdrop 空白处关闭）。 */
  const renderDialog = function (): React.ReactNode {
    return el(
      'div',
      {
        style: S.backdrop,
        onMouseDown: function (e: React.MouseEvent) {
          if (e.target === e.currentTarget) setOpen(false)
        },
      },
      el(
        'div',
        { style: S.panel },
        el(
          'div',
          { style: S.header },
          el('div', { style: S.title }, '添加页面元素'),
          el('button', { onClick: function () { setOpen(false) }, style: S.closeBtn }, '×'),
        ),
        el(
          'div',
          { style: S.body },
          el('textarea', {
            value: urlText,
            onChange: function (e: React.ChangeEvent<HTMLTextAreaElement>) { setUrlText(e.target.value) },
            rows: 4,
            placeholder: '输入网址（每行一个，使用第一行），例如：\nhttps://example.com',
            style: S.textarea,
          }),
          status
            ? el(
                'div',
                { style: S.statusLine },
                '状态：' +
                  (status.message ||
                    (status.state === 'open'
                      ? browserLabel + '已打开 ' + (status.url || '') +
                        (status.modeExited ? ' · 选择模式已退出' : status.injected ? ' · 已注入选择功能' : '')
                      : status.state === 'ready'
                        ? '浏览器已就绪'
                        : status.state)),
              )
            : null,
          notice ? el('div', { style: S.notice }, notice) : null,
          el(
            'div',
            { style: S.hint },
            '提示：在页面中点击元素，再点「添加到对话」，即可在输入框插入 [标签][DOMn] 引用式占位符；完整元素信息由模型按需通过 read_picked_element 工具读取。浏览器使用系统已安装的 Chrome/Edge 等（自动探测，绝不下载）；首次打开需安装约 13MB 的 playwright-core 运行时（不含浏览器）并探测系统浏览器，之后秒开。需要登录时：先点页面右下角的「选择模式」悬浮按钮（或按 ` 键）暂停选择，登录完成后回到这里点「仅重新注入」即可在当前页面恢复选择功能；如需回到输入的网址则点「打开」。',
          ),
        ),
        el(
          'div',
          { style: S.footer },
          // 左区：上下文计数 + 悬浮历史菜单。菜单与计数在同一个包裹元素内，
          // 鼠标在两者间移动不触发 mouseleave，移出整个区域才关闭菜单
          el(
            'div',
            {
              style: S.footerLeft,
              onMouseEnter: function () {
                setMenuOpen(true)
                loadContextItems()
              },
              onMouseLeave: function () {
                setMenuOpen(false)
                setClearArmed(false)
              },
            },
            el('span', { className: 'dsh-we-ctx-count' }, '上下文：' + contextCount + ' 项'),
            menuOpen ? renderContextMenu() : null,
          ),
          // 右区：原操作按钮组
          el(
            'div',
            { style: S.footerRight },
            el('button', { onClick: function () { setOpen(false) }, style: S.ghostBtn }, '关闭'),
            el('button', { onClick: onReinject, disabled: busy, style: S.ghostBtn }, '仅重新注入'),
            el('button', { onClick: onConfirm, disabled: busy, style: S.primaryBtn }, busy ? '打开中…' : '打开'),
          ),
        ),
      ),
    )
  }

  return el(
    React.Fragment,
    null,
    el(
      'button',
      {
        className: 'dsh-we-icon-btn',
        onClick: function () {
          setOpen(true)
          setNotice('')
        },
        title: buttonTitle,
        'aria-label': '添加页面元素',
        'aria-haspopup': 'dialog',
        'aria-expanded': open ? 'true' : 'false',
      },
      crosshairIcon(el),
    ),
    open ? renderDialog() : null,
  )
}

/**
 * 插件入口：注入图标按钮样式 + 注册 conversation.input.left 槽位组件；
 * 均经 ctx.effect 登记清理器，插件卸载时自动移除。
 */
function apply(ctx: ClientCtx): void {
  ctx.effect(function () {
    let tag: HTMLStyleElement | null = null
    if (typeof document !== 'undefined') {
      tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.textContent = STYLE_CSS
      document.head.appendChild(tag)
    }
    return function () {
      if (tag && tag.parentNode) tag.parentNode.removeChild(tag)
    }
  }, 'dsh-webpage-element-picker: styles')

  ctx.effect(function () {
    return ctx.slots.inject('conversation.input.left', function () {
      return ctx.slots.register(
        {
          name: 'conversation.input.left',
          id: PLUGIN_ID,
          order: 0,
        },
        PickerEntry as (props: Record<string, unknown>) => unknown,
      )
    })
  }, 'dsh-webpage-element-picker: slot registration')

  logInfo('client 插件已加载（槽位 conversation.input.left）')
}

// loader 契约：bundle 外层包裹（tsup banner）提供局部 module/exports，
// 这里导出插件表面供 window.__ModuleLoader__ 读取
module.exports = {
  name: PLUGIN_ID,
  inject: ['slots'],
  apply: apply,
}
