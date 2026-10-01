/**
 * 跨 host ↔ helper ↔ 浏览器 UI 边界的共享类型定义。
 *
 * host 半边和 client 半边运行在不同的程序中（Node 与 web shell），通过
 * harness webserver 路由（/poll、/events、/invoke）以纯 JSON 交换这些值。
 * 这里没有任何运行时的跨端导入——本文件在两端都仅用于类型。
 */

/** 报告给浏览器 UI 的选择器生命周期状态。 */
export interface PickerStatus {
  state: 'idle' | 'starting' | 'open' | 'ready' | 'closed' | 'error'
  message?: string
  url?: string
  title?: string
  browser?: string
  injected?: boolean
  modeExited?: boolean
  /** helper 的 status 回执专用：没有可用窗口（主页面已关闭）时为 true，此时不带 state。 */
  closed?: boolean
}

/**
 * 一个被选中的页面元素，由注入的 inspector 脚本上报。
 * 已知字段之外可能还有其他字段（HTML、CSS 路径、rect 等），会原样
 * 透传给模型（通过 read_picked_element 工具）。
 */
export interface DomElementPayload {
  tagName?: string
  id?: string
  className?: string
  textContent?: string
  attributes?: Record<string, string>
  pageUrl?: string
  [key: string]: unknown
}

/** 注册表条目：对话中引用的 DOMn id 及其载荷。 */
export interface DomRegistryEntry {
  id: string
  payload: DomElementPayload
}

/** 排入客户端轮询队列的已选元素（单调递增序号）。 */
export interface PendingElement {
  seq: number
  domId: string
  payload: DomElementPayload
}

/** helper 子进程 POST 到 /events 的事件。 */
export type HelperEvent =
  | { type: 'reply'; id: number; ok: boolean; error?: string; status?: PickerStatus }
  | { type: 'element-selected'; data?: DomElementPayload }
  | { type: 'browser'; name?: string }
  | { type: 'status'; url?: string; title?: string }
  | { type: 'injected'; url?: string; title?: string }
  | { type: 'mode-exited'; url?: string; title?: string }
  | { type: 'window-closed' }
  | { type: 'helper-ready' }
  | { type: 'error'; message: string }

/** 上下文历史节点的轻量摘要（picker-context-list 返回，不含大 payload）。 */
export interface ContextItemSummary {
  domId: string
  label: string
  pageUrl?: string
}

/**
 * 系统探测到的一个可驱动浏览器（picker-browsers 返回）。
 * 探测只做存在性检查（不启动浏览器、不要求 playwright-core 已安装），
 * 真正的可启动性由 helper 启动时的无头验证兜底。
 */
export interface BrowserOption {
  /** 规范名（Chrome/Edge/Chromium/Brave/Opera），同时用于 profile 目录与展示。 */
  name: string
  /** 可执行文件路径（同一浏览器的多个候选路径取首个存在的）。 */
  path: string
  /** 该可执行文件当前是否存在。 */
  exists: boolean
}

/** 用户的浏览器选择（client 记忆在 localStorage，随导航请求回传 host）。 */
export interface BrowserChoice {
  name: string
  path: string
}

/** /invoke 方法供浏览器 UI 调用的结果信封。 */
export interface InvokeResult {
  ok: boolean
  error?: string
  status?: PickerStatus
  elements?: PendingElement[]
  /** picker-pull 附带：host 当前最大元素序号（client 挂载后首次响应仅用它建立轮询基线，不重放历史）。 */
  lastSeq?: number
  /** picker-pull / picker-context-list 附带：当前上下文节点数（domRegistry 长度）。 */
  contextCount?: number
  /** picker-context-list 返回：上下文历史节点摘要列表（按选中先后排序）。 */
  items?: ContextItemSummary[]
  /** picker-browsers 返回：系统探测到的浏览器清单（按优先级排序，含未安装项）。 */
  browsers?: BrowserOption[]
  /** picker-browsers 返回：当前 helper 实际使用的浏览器（未运行时为空）。 */
  current?: BrowserChoice
  /** picker-reinject 返回：浏览器当时没开着，已按传入网址先执行打开（再注入）时为 true。 */
  reopened?: boolean
}
