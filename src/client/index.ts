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
 * 打包（external `react` 与 `@deepseek-ai/dsh-client-ui-primitives`——
 * 浏览器模块表通过注入的 `require` 提供两者），包裹在 web boot 握手中
 * （`window.__ModuleLoader__.load({id, factory})`）。它通过 harness
 * webserver 的 /dsh-webpage-element-picker/invoke 路由（同源 fetch）
 * 与 host 半边通信。
 *
 * 样式：对话框结构复用 DSH 官方 Modal + Button 原语，其余细节（URL
 * 输入框、状态行、历史菜单）只用 `--dsw-*` 语义令牌，因此浅色/深色
 * 完全跟随 harness 的 body[data-ds-dark-theme] 切换，插件内不写任何
 * 颜色字面量，也不做主题分支（见 docs/web-styling.md）。
 *
 * 日志：DEBUG 级走 console.debug——浏览器 DevTools 默认级别下不可见，
 * 等价于生产默认关闭；INFO/ERROR 直接输出。
 */

import { React, h } from './react'
import { PRIMITIVES } from './primitives'
import type { ClientCtx, PickerEntryProps } from './services'
import type { PrimitiveButtonProps, PrimitiveModalProps } from './primitives-types'
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

/** 通知的语气：错误走红色，其余（未就绪/已添加）走琥珀提示色。 */
type NoticeTone = 'info' | 'error'

/**
 * 渲染按钮：优先 DSH Button 原语；原语不可用时降级为等价样式的原生按钮。
 * 降级分支只影响观感，点击/禁用语义与官方组件保持一致。
 */
function renderButton(props: PrimitiveButtonProps): React.ReactNode {
  const el = h
  if (PRIMITIVES.module) return el(PRIMITIVES.module.Button, props)
  const primary = props.variant === 'primary'
  return el(
    'button',
    {
      type: 'button',
      className: primary ? 'dsh-we-btnPrimary' : 'dsh-we-btnOutline',
      onClick: props.onClick,
      disabled: props.disabled,
      title: props.title,
    },
    props.children,
  )
}

/**
 * 渲染对话框外壳：优先 DSH Modal 原语（Portal 到 body，自带 Esc 与点遮罩关闭）；
 * 原语不可用时降级为结构等价的遮罩 + 卡片，尺寸与配色由 .dsh-we-* 样式表提供。
 * children 即卡片内容（正文 + 底部栏），两种渲染路径消费同一份节点。
 */
function renderDialogShell(props: PrimitiveModalProps): React.ReactNode {
  const el = h
  if (PRIMITIVES.module) return el(PRIMITIVES.module.Modal, props)
  return el(
    'div',
    {
      className: 'dsh-we-overlay',
      role: 'presentation',
      onMouseDown: function (e: React.MouseEvent) {
        if (e.target === e.currentTarget || (e.target as HTMLElement).className === 'dsh-we-mask') props.onClose()
      },
    },
    el('div', { className: 'dsh-we-mask', 'aria-hidden': 'true' }),
    el(
      'div',
      { className: 'dsh-we-panel dsh-we-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': props.title },
      el(
        'div',
        { className: 'dsh-we-fallbackHeader' },
        el('h2', { className: 'dsh-we-fallbackTitle' }, props.title),
        el('button', { type: 'button', className: 'dsh-we-fallbackClose', 'aria-label': props.closeLabel, onClick: props.onClose }, '×'),
      ),
      props.children,
    ),
  )
}

/**
 * 插件自有样式表（注入到 document.head 的单个 <style>）。
 *
 * 分两层：
 * 1. `.dsh-we-panel` 是 Modal 原语的等价卡片样式，仅在原语不可用时兜底
 *    （见 primitives.ts）；原语可用时这些声明被原语的 CSS Module 覆盖。
 * 2. `.dsh-we-*` 是插件自有区块，颜色一律取 `--dsw-alias-*` 语义令牌，
 *    输入框圆角/描边对齐 DSH 对话框内 textarea 的既定做法（见
 *    ui-message-feedback 的 FeedbackDialog）。
 *
 * 卡片几何用 `.dsh-we-dialog.dsh-we-dialog` 双类提高特异性：className
 * 透传给原语卡片，而原语卡片的 CSS Module 类必须被覆盖（DSH 内部同样
 * 用双类覆盖 Modal 几何）。
 */
const STYLE_CSS =
  // ---- 兜底层：Modal 原语不可用时的卡片外观（约等于原语 Modal 的实现） ----
  '.dsh-we-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; }' +
  '.dsh-we-mask { position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1); backdrop-filter: var(--dsw-mask-blur); }' +
  '.dsh-we-panel { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 20px; width: min(380px, 100%); padding: 0 0 24px; overflow: hidden; border: 0; border-radius: 24px; background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-elevation-prominent); color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family); }' +
  '.dsh-we-panelBody { display: flex; flex-direction: column; gap: 20px; }' +
  // ---- 卡片几何：宽度放宽以容纳网址输入框与提示文案 ----
  '.dsh-we-dialog.dsh-we-dialog { width: min(560px, 100%); gap: 0; }' +
  // ---- 原语不可用时的头部/关闭按钮与按钮降级（原语可用时不会渲染） ----
  '.dsh-we-fallbackHeader { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 22px 14px 12px 24px; }' +
  '.dsh-we-fallbackTitle { margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; color: var(--dsw-alias-label-primary); }' +
  '.dsh-we-fallbackClose { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 18px; line-height: 1; cursor: pointer; }' +
  '.dsh-we-fallbackClose:hover { background: var(--dsw-alias-interactive-bg-hover); }' +
  '.dsh-we-btnOutline, .dsh-we-btnPrimary { display: inline-flex; align-items: center; justify-content: center; height: 36px; padding: 0 14px; border-radius: 18px; font-family: inherit; font-size: 14px; line-height: 22px; cursor: pointer; }' +
  '.dsh-we-btnOutline { border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); }' +
  '.dsh-we-btnOutline:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }' +
  '.dsh-we-btnPrimary { border: none; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }' +
  '.dsh-we-btnPrimary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }' +
  '.dsh-we-btnOutline:disabled, .dsh-we-btnPrimary:disabled { opacity: 0.4; cursor: not-allowed; }' +
  // ---- 正文区块 ----
  '.dsh-we-body { display: flex; flex-direction: column; gap: 10px; padding: 0 24px; }' +
  '.dsh-we-input { box-sizing: border-box; width: 100%; min-height: 92px; padding: 12px 14px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: 16px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family); font-size: 14px; line-height: 22px; resize: vertical; outline: none; transition: border-color 120ms ease, box-shadow 120ms ease; }' +
  '.dsh-we-input::placeholder { color: var(--dsw-alias-label-caption); }' +
  '.dsh-we-input:focus { border-color: var(--dsw-alias-border-l3); box-shadow: 0 0 0 1px var(--dsw-alias-border-l3); }' +
  '.dsh-we-status { font-size: 13px; line-height: 20px; color: var(--dsw-alias-state-business-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +
  '.dsh-we-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-caption); }' +
  '.dsh-we-notice { font-size: 12px; line-height: 18px; }' +
  '.dsh-we-noticeInfo { color: var(--dsw-alias-state-warn-label); }' +
  '.dsh-we-noticeError { color: var(--dsw-alias-state-error-primary); }' +
  // ---- 底部栏：左侧上下文计数（悬浮展开历史菜单），右侧操作按钮 ----
  '.dsh-we-footer { display: flex; align-items: center; gap: 8px; justify-content: space-between; margin-top: 20px; padding: 16px 24px 0; border-top: 0.5px solid var(--dsw-alias-border-l1); }' +
  '.dsh-we-footerLeft { position: relative; display: flex; align-items: center; }' +
  '.dsh-we-footerRight { display: flex; align-items: center; gap: 8px; }' +
  '.dsh-we-ctxCount { padding: 4px 8px; border-radius: 8px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; cursor: default; user-select: none; }' +
  '.dsh-we-ctxCount:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }' +
  // ---- 历史节点菜单（向上展开；悬浮层：elevation + scrollbar l2 重绑） ----
  // z-index 显式抬升：菜单与对话框正文同处一个层叠上下文，靠 DOM 顺序压住正文
  // 在部分合成路径下不够稳，这里直接按悬浮层语义声明层级
  '.dsh-we-menu { position: absolute; left: 0; bottom: 100%; z-index: 1; display: flex; flex-direction: column; width: 280px; overflow: hidden; border: 0; border-radius: 12px; background: var(--dsw-alias-bg-layer-2); --dsw-elevation-stroke-color: var(--dsw-alias-border-l1); box-shadow: var(--dsw-elevation-panel); --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); }' +
  '.dsh-we-menuHeader { padding: 8px 10px 6px; border-bottom: 0.5px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 16px; }' +
  '.dsh-we-menuList { max-height: 200px; overflow-y: auto; }' +
  '.dsh-we-menuItem { display: flex; gap: 8px; align-items: baseline; width: 100%; padding: 6px 10px; border: none; background: transparent; font-family: inherit; text-align: left; cursor: pointer; }' +
  '.dsh-we-menuItem:hover { background: var(--dsw-alias-interactive-bg-hover); }' +
  '.dsh-we-menuItemId { flex-shrink: 0; color: var(--dsw-alias-state-business-primary); font-size: 12px; line-height: 18px; }' +
  '.dsh-we-menuItemLabel { overflow: hidden; color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }' +
  '.dsh-we-menuEmpty { padding: 12px 10px; color: var(--dsw-alias-label-caption); font-size: 12px; line-height: 18px; text-align: center; }' +
  '.dsh-we-menuFooter { display: flex; justify-content: flex-end; padding: 6px 10px; border-top: 0.5px solid var(--dsw-alias-border-l1); }' +
  // ---- 输入框工具行的十字图标按钮（本轮不改动其尺寸，仅令牌化配色） ----
  '.dsh-we-iconBtn { display: inline-flex; align-items: center; justify-content: center; padding: 5px; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }' +
  '.dsh-we-iconBtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }' +
  '.dsh-we-iconBtn:disabled { opacity: 0.4; cursor: default; }' +
  // ---- 键盘可达性：焦点环与按钮一致，动效跟随系统减少动效偏好 ----
  '.dsh-we-iconBtn:focus-visible, .dsh-we-input:focus-visible, .dsh-we-fallbackClose:focus-visible { outline: 2px solid var(--dsw-alias-button-primary-fill); outline-offset: 2px; }' +
  '@media (prefers-reduced-motion: reduce) { .dsh-we-input { transition: none; } }'

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
  // 通知分语气：错误（打开/清空失败）红色，提示（已添加/已注入）琥珀色
  const noticeState = React.useState<{ text: string; tone: NoticeTone } | null>(null)
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
  const showNotice = function (text: string, tone?: NoticeTone): void {
    const next = { text: text, tone: tone || 'info' }
    setNotice(next)
    window.setTimeout(function () {
      setNotice(function (cur) { return cur && cur.text === text ? null : cur })
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
          showNotice('清空失败：' + ((res && res.error) || '未知错误'), 'error')
        }
      })
      .catch(function (err) {
        logError('清空上下文失败', err)
        showNotice('清空失败：' + String((err && err.message) || err), 'error')
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
      showNotice('请先输入网址', 'error')
      return
    }
    if (!/^https?:\/\//i.test(url)) {
      logDebug('网址校验未通过（需 http/https）: ' + url)
      showNotice('网址需以 http:// 或 https:// 开头', 'error')
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
          showNotice('打开失败：' + ((res && res.error) || '未知错误'), 'error')
        }
      })
      .catch(function (err) {
        logError('打开网址失败: ' + url, err)
        showNotice('打开失败：' + String((err && err.message) || err), 'error')
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
          showNotice('重新注入失败：' + ((res && res.error) || '未知错误'), 'error')
        }
      })
      .catch(function (err) {
        logError('重新注入失败', err)
        showNotice('重新注入失败：' + String((err && err.message) || err), 'error')
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

  /** 对话框中的状态行文案（原语 Modal 不可用时兜底卡片与它在同一层）。 */
  const statusLine = status
    ? '状态：' +
      (status.message ||
        (status.state === 'open'
          ? browserLabel + '已打开 ' + (status.url || '') +
            (status.modeExited ? ' · 选择模式已退出' : status.injected ? ' · 已注入选择功能' : '')
          : status.state === 'ready'
            ? '浏览器已就绪'
            : status.state))
    : ''

  /**
   * 渲染上下文历史节点悬浮菜单（footer 左下角「上下文：N 项」悬停时出现，
   * 向上展开）。菜单项最新在上，点击插入占位符；底部是二次确认的清空按钮。
   */
  const renderContextMenu = function (): React.ReactNode {
    const items = contextItems.slice().reverse()
    return el(
      'div',
      { className: 'dsh-we-menu', role: 'menu' },
      el('div', { className: 'dsh-we-menuHeader' }, '历史节点（点击插入输入框）'),
      items.length
        ? el(
            'div',
            { className: 'dsh-we-menuList' },
            items.map(function (item) {
              return el(
                'button',
                {
                  key: item.domId,
                  type: 'button',
                  className: 'dsh-we-menuItem',
                  title: item.pageUrl || item.domId,
                  onClick: function () { insertContextItem(item) },
                },
                el('span', { className: 'dsh-we-menuItemId' }, item.domId),
                el('span', { className: 'dsh-we-menuItemLabel' }, item.label || '(无标签)'),
              )
            }),
          )
        : el('div', { className: 'dsh-we-menuEmpty' }, contextCount > 0 ? '列表加载失败，请重新悬停重试' : '暂无历史节点'),
      el(
        'div',
        { className: 'dsh-we-menuFooter' },
        renderButton({
          variant: 'outline',
          size: 'sm',
          onClick: onClearClick,
          disabled: !contextCount && !clearArmed,
          title: clearArmed ? '再次点击清空全部历史节点' : '清空全部历史节点',
          children: clearArmed ? '确认清空？' : '清空',
        }),
      ),
    )
  }

  /**
   * 渲染对话框正文：网址输入框 → 状态行 → 通知 → 使用提示。
   * 结构复用原语 Modal 的 body（左右 24px 内边距），此处只补区块间距。
   */
  const renderDialogBody = function (): React.ReactNode {
    return el(
      'div',
      { className: 'dsh-we-body' },
      el('textarea', {
        value: urlText,
        onChange: function (e: React.ChangeEvent<HTMLTextAreaElement>) { setUrlText(e.target.value) },
        rows: 3,
        placeholder: '输入网址（每行一个，使用第一行），例如：\nhttps://example.com',
        'aria-label': '网址',
        className: 'dsh-we-input',
      }),
      statusLine ? el('div', { className: 'dsh-we-status' }, statusLine) : null,
      notice
        ? el('div', { className: 'dsh-we-notice ' + (notice.tone === 'error' ? 'dsh-we-noticeError' : 'dsh-we-noticeInfo'), role: 'status' }, notice.text)
        : null,
      el(
        'div',
        { className: 'dsh-we-hint' },
        '提示：在页面中点击元素，再点「添加到对话」，即可在输入框插入 [标签][DOMn] 引用式占位符；完整元素信息由模型按需通过 read_picked_element 工具读取。浏览器使用系统已安装的 Chrome/Edge 等（自动探测，绝不下载）；首次打开需安装约 13MB 的 playwright-core 运行时（不含浏览器）并探测系统浏览器，之后秒开。需要登录时：先点页面右下角的「选择模式」悬浮按钮（或按 ` 键）暂停选择，登录完成后回到这里点「仅重新注入」即可在当前页面恢复选择功能；如需回到输入的网址则点「打开」。',
      ),
    )
  }

  /**
   * 渲染对话框底部栏：左侧上下文计数（悬浮历史菜单），右侧关闭/重注入/打开。
   * 按钮一律使用 DSH Button 原语（outline + primary），间距由其自带的 8px gap 提供。
   */
  const renderDialogFooter = function (): React.ReactNode {
    return el(
      'div',
      { className: 'dsh-we-footer' },
      // 左区：上下文计数 + 悬浮历史菜单。菜单与计数在同一个包裹元素内，
      // 鼠标在两者间移动不触发 mouseleave，移出整个区域才关闭菜单
      el(
        'div',
        {
          className: 'dsh-we-footerLeft',
          onMouseEnter: function () {
            setMenuOpen(true)
            loadContextItems()
          },
          onMouseLeave: function () {
            setMenuOpen(false)
            setClearArmed(false)
          },
        },
        el('span', { className: 'dsh-we-ctxCount' }, '上下文：' + contextCount + ' 项'),
        menuOpen ? renderContextMenu() : null,
      ),
      el(
        'div',
        { className: 'dsh-we-footerRight' },
        // 尺寸取原语默认的 md（36px 胶囊，r18）：与 DSH 对话框底部按钮同规格
        renderButton({ variant: 'outline', onClick: function () { setOpen(false) }, children: '关闭' }),
        renderButton({ variant: 'outline', onClick: onReinject, disabled: busy, children: '仅重新注入' }),
        renderButton({ variant: 'primary', onClick: onConfirm, disabled: busy, children: busy ? '打开中…' : '打开' }),
      ),
    )
  }

  /** 渲染「添加页面元素」对话框（原语 Modal：Esc 与点击遮罩关闭）。 */
  const renderDialog = function (): React.ReactNode {
    return renderDialogShell({
      open: true,
      title: '添加页面元素',
      closeLabel: '关闭',
      onClose: function () { setOpen(false) },
      className: 'dsh-we-dialog',
      // 正文与底部栏包在同一个弹性列里：卡片 gap 置 0 后由这个容器统一排版，
      // 原语可用与否都由 .dsh-we-panelBody 给出同一套 20px 节奏
      children: el('div', { className: 'dsh-we-panelBody' }, renderDialogBody(), renderDialogFooter()),
    })
  }

  return el(
    React.Fragment,
    null,
    el(
      'button',
      {
        type: 'button',
        className: 'dsh-we-iconBtn',
        onClick: function () {
          setOpen(true)
          setNotice(null)
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

  logInfo(
    PRIMITIVES.module
      ? 'client 插件已加载（槽位 conversation.input.left，UI 使用 DSH 原语 Modal/Button）'
      : 'client 插件已加载（槽位 conversation.input.left，UI 原语不可用，已降级为内置样式：' + PRIMITIVES.error + '）',
  )
}

// loader 契约：bundle 外层包裹（tsup banner）提供局部 module/exports，
// 这里导出插件表面供 window.__ModuleLoader__ 读取
module.exports = {
  name: PLUGIN_ID,
  inject: ['slots'],
  apply: apply,
}
