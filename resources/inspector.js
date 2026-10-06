// DSH 页面元素选择插件：页面内 inspector（由 helper 经 page.evaluate 注入执行）。
// 职责：悬停高亮 → 点选锁定 → 「添加到对话」→ 采集元素数据（选择器/DOM路径/
//       属性/位置尺寸/HTML 片段）回传；支持暂停/恢复与退出清理。
// 通信协议：console.log('__DSH_WE__:' + JSON) 是唯一数据通道（helper 的
//           console 桥按前缀截取），因此本脚本严禁用 console.log 输出其他内容；
//           DEBUG 日志走 console.debug（无前缀、不会误触发桥接），默认关闭，
//           在页面里执行 sessionStorage.__dsh_we_debug__='1' 后重新注入可打开。
// 生命周期：注入即激活（__dsh_we_active__ 防重入）；exitMode/cleanupAll 移除
//           全部事件监听与注入 DOM；暴露 __dsh_we_cleanup__ 供再次注入前先清理。
// 硬约束：宿主页由框架（React/Next 等）拥有 <html>/<body>——本脚本**绝不写这两个元素的
//           行内样式**，否则框架 hydration 时会判定属性不一致并拒绝修补（Next.js 16 +
//           React 19 实测报 hydration mismatch）。需要页面级效果（十字准星光标）时，
//           改为注入本插件自有的 <style data-dsh-we="cursor">（见 cursorStyleEl）。
(function () {
  'use strict'
  if (window.__dsh_we_active__) return
  window.__dsh_we_active__ = true

  var DEBUG = false
  try { DEBUG = sessionStorage.getItem('__dsh_we_debug__') === '1' } catch (e) {}
  /** DEBUG：选择流程分支走向（默认关闭；console.debug 不带协议前缀，桥接不会截获）。 */
  function logDebug(msg) { if (DEBUG) console.debug('[dsh-we] ' + msg) }

  function setStyle(el, s) { for (var k in s) el.style[k] = s[k] }

  /* ---- 悬浮高亮覆盖层（跟随悬停元素，蓝框） ---- */
  var ov = document.createElement('div')
  ov.setAttribute('data-dsh-we', 'ov')
  setStyle(ov, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483640', border: '2px solid #3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', borderRadius: '3px', display: 'none' })

  /* ---- 悬浮标签（显示标签名与尺寸） ---- */
  var lb = document.createElement('div')
  lb.setAttribute('data-dsh-we', 'lb')
  setStyle(lb, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483640', backgroundColor: '#3b82f6', color: '#fff', fontSize: '11px', fontFamily: 'monospace', padding: '2px 6px', borderRadius: '3px', whiteSpace: 'nowrap', display: 'none' })

  /* ---- 操作栏（点选后出现：添加到对话 / 选择父节点 / 取消） ---- */
  var ab = document.createElement('div')
  ab.setAttribute('data-dsh-we', 'ab')
  // zIndex 取得比暂停按钮（2147483642）高：两者都在右下角，被盖住就点不到了；
  // boxSizing:border-box 让 maxWidth（按安全区宽度限制）算上内边距；
  // flexWrap:wrap 让窄窗口下按钮换行而不是整张卡片溢出屏幕。
  setStyle(ab, { position: 'fixed', zIndex: '2147483644', boxSizing: 'border-box', flexWrap: 'wrap', background: '#1e1e1e', borderRadius: '6px', display: 'none', flexDirection: 'row', alignItems: 'center', gap: '4px', padding: '4px 6px', boxShadow: '0 2px 8px rgba(0,0,0,0.5)' })
  var btnAdd = document.createElement('button')
  btnAdd.setAttribute('data-dsh-we-add', '1')
  setStyle(btnAdd, { background: '#2d2d2d', color: '#fff', fontSize: '12px', border: 'none', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' })
  btnAdd.textContent = '添加到对话'
  var btnParent = document.createElement('button')
  btnParent.setAttribute('data-dsh-we-parent', '1')
  setStyle(btnParent, { background: '#2d2d2d', color: '#fff', fontSize: '12px', border: 'none', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' })
  btnParent.textContent = '选择父节点'
  var btnCancel = document.createElement('button')
  setStyle(btnCancel, { background: '#2d2d2d', color: '#fff', fontSize: '12px', border: 'none', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' })
  btnCancel.textContent = '取消'
  ab.appendChild(btnAdd)
  ab.appendChild(btnParent)
  ab.appendChild(btnCancel)

  /* ---- 暂停/恢复悬浮按钮（可拖到四角吸附的常驻入口） ---- */
  var chip = document.createElement('div')
  chip.setAttribute('data-dsh-we', 'chip')
  // 位置统一用 left/top 表达（四个角共用一套算法，不再写死 bottom/right）；
  // touchAction:none 让触屏/触控板拖动不会顺带滚动页面；whiteSpace:nowrap 保证 chip 永远
  // 单行——换行会让高度从 26px 变 41px，贴角时量到的尺寸就不是最终尺寸了；
  // 先 visibility:hidden，等量出尺寸贴好角再显示，避免闪一下错误位置。
  setStyle(chip, { position: 'fixed', left: '0px', top: '0px', visibility: 'hidden', whiteSpace: 'nowrap', zIndex: '2147483642', background: '#1e1e1e', color: '#fff', fontSize: '12px', fontFamily: 'system-ui,sans-serif', borderRadius: '16px', padding: '5px 12px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.5)', userSelect: 'none', touchAction: 'none' })
  chip.textContent = '⌖ 选择模式：开启（点击暂停，或按 `）'
  // 不挂 click：拖动结束时浏览器也可能补发 click，暂停/恢复统一在 pointerup 里判（见 onChipUp）
  chip.addEventListener('pointerdown', onChipDown)

  var state = 'hover'
  var selEl = null
  var selData = null
  var paused = false

  /* ---- 光标：经自注入样式表表达，绝不写 <html> 的行内 style ---- */
  /** 两种形态的光标规则（选择模式 = 十字准星；拖动 chip = 抓取）。 */
  var CURSOR_RULE = { crosshair: 'html,body{cursor:crosshair !important}', grabbing: 'html,body{cursor:grabbing !important}' }
  /**
   * 自注入样式表节点（十字准星规则，见 syncCursor）。
   * 为什么不写 `document.documentElement.style.cursor`：<html> 是宿主框架（React/Next 等）
   * 拥有的节点，hydration 时框架会读它的属性；注入期改行内 style 会让框架判定
   * 「服务端 HTML 与客户端属性不一致」并**拒绝修补**——Next.js 16 + React 19 实测报
   * 「A tree hydrated but some attributes of the server rendered HTML didn't match」，
   * 且 `style="cursor: crosshair"` 会永久留在 <html> 上。改成注入一个本插件自有的
   * <style> 节点：它不在框架的虚拟 DOM 里，框架不管；退出时随 cleanupAll 一起移除。
   * 放在 head（文档级样式表，早于 <body> 注入）；宿主页那时可能还没 <body>，兜底挂 <html>。
   */
  var cursorStyleEl = null

  /**
   * 创建样式表节点（幂等）：crosshair 规则 + 挂到 head（文档级样式表，早于 <body> 注入；
   * 宿主页那时可能还没 <body>，兜底挂 <html>）。只创建不挂载——挂/摘统一走 applyCursor。
   */
  function ensureCursorStyle() {
    if (cursorStyleEl) return
    cursorStyleEl = document.createElement('style')
    cursorStyleEl.setAttribute('data-dsh-we', 'cursor')
    cursorStyleEl.textContent = CURSOR_RULE.crosshair
    var host = document.head || document.documentElement || document.body
    if (host) host.appendChild(cursorStyleEl)
  }

  /**
   * 按十字准星 / 抓取两种形态挂载或摘除规则：paused 时整条规则摘掉（宿主页恢复自己的
   * 光标语义），否则挂上并写好对应形态。规则同时作用于 html 与 body 并带 !important——
   * 与旧写法（写在 documentElement 行内 style 上）优先级等价：压过宿主页普通的光标声明
   * （如 body{cursor:default}），但不压宿主页的 !important 声明；子元素自己的
   * cursor:pointer/text 等仍照旧生效（光标继承自根元素，子元素有声明就用自己的）。
   */
  function applyCursor(kind) {
    ensureCursorStyle()
    cursorStyleEl.textContent = CURSOR_RULE[kind]
    if (paused) {
      if (cursorStyleEl.parentNode) cursorStyleEl.parentNode.removeChild(cursorStyleEl)
    } else if (!cursorStyleEl.parentNode) {
      var host = document.head || document.documentElement || document.body
      if (host) host.appendChild(cursorStyleEl)
    }
  }

  /** 同步当前模式的光标（开启态 = 十字准星，暂停态 = 无规则）。 */
  function syncCursor() {
    applyCursor('crosshair')
  }

  document.documentElement.appendChild(ov)
  document.documentElement.appendChild(lb)
  document.documentElement.appendChild(ab)
  document.documentElement.appendChild(chip)

  /* ---- 数据采集 ---- */

  /**
   * 生成元素的 CSS 选择器：有 id 直接用 #id；否则沿父链向上最多 5 层，
   * 每段拼 tag.class1.class2（过滤下划线开头的工具类名），同标签兄弟
   * 多于 1 个时补 :nth-child 消歧，遇带 id 祖先即收敛。
   * 父链走不动时（元素本身就是 body/html）退回裸标签名——否则会回传空选择器。
   */
  function cSel(el) {
    if (el.id) return '#' + CSS.escape(el.id)
    var ps = [], nd = el
    while (nd && nd !== document.body && ps.length < 5) {
      var sg = nd.tagName.toLowerCase()
      if (nd.id) { ps.unshift('#' + CSS.escape(nd.id)); break }
      if (typeof nd.className === 'string' && nd.className.trim()) {
        var cls = nd.className.trim().split(/\s+/).filter(function (c) { return c.charAt(0) !== '_' }).slice(0, 2)
        if (cls.length) sg += '.' + cls.map(function (c) { return CSS.escape(c) }).join('.')
      }
      var pa = nd.parentElement
      if (pa) {
        var sibs = Array.prototype.filter.call(pa.children, function (c) { return c.tagName === nd.tagName })
        if (sibs.length > 1) sg += ':nth-child(' + (sibs.indexOf(nd) + 1) + ')'
      }
      ps.unshift(sg)
      nd = nd.parentElement
    }
    return ps.join(' > ') || el.tagName.toLowerCase()
  }

  /**
   * 生成人类可读的 DOM 路径：沿父链向上最多 8 层，
   * 每段为 `tag 类名（前 3 个）`，供模型理解元素在文档中的位置。
   */
  function domPath(el) {
    var parts = [], node = el, depth = 0
    while (node && node.nodeType === 1 && depth < 8) {
      var seg = node.tagName.toLowerCase()
      if (typeof node.className === 'string') {
        var cls = node.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join(' ')
        if (cls) seg += ' ' + cls
      }
      parts.unshift(seg)
      node = node.parentElement
      depth++
    }
    return parts.join(' > ')
  }

  /**
   * 采集元素属性：固定的语义白名单（role/name/type/href/placeholder/
   * value/aria-label/title/alt/src）+ 最多 3 个 data-* 属性。
   */
  function collectAttrs(el) {
    var o = {}
    var keys = ['role', 'name', 'type', 'href', 'placeholder', 'value', 'aria-label', 'title', 'alt', 'src']
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i]
      var v = el.getAttribute(k)
      if (v != null && v !== '') o[k] = v
    }
    var dataKeys = []
    for (var j = 0; j < el.attributes.length && dataKeys.length < 3; j++) {
      var a = el.attributes[j]
      if (a.name.indexOf('data-') === 0 && !(a.name in o)) dataKeys.push(a.name)
    }
    for (var m = 0; m < dataKeys.length; m++) o[dataKeys[m]] = el.getAttribute(dataKeys[m])
    return o
  }

  /**
   * 文本去重并截断：折叠空白后，检测"整串由两半相同文本拼接"的重复
   * 模式（站点常见的 SEO 文本重复），重复则取一半；最长保留 500 字符。
   */
  function dedupe(raw) {
    var t = (raw || '').replace(/\s+/g, ' ').trim()
    if (!t) return ''
    var n = t.length
    for (var half = Math.floor(n / 2); half >= 2; half--) {
      if (t.slice(0, half) === t.slice(half, half * 2)) return t.slice(0, half).trim()
    }
    return t.slice(0, 500)
  }

  /** 汇总元素完整数据包（经 element-selected 事件透传给模型的载荷）。 */
  function collectData(el) {
    var rect = el.getBoundingClientRect()
    return {
      tagName: el.tagName.toLowerCase(),
      id: el.id || '',
      className: typeof el.className === 'string' ? el.className : '',
      textContent: dedupe(el.innerText || el.textContent || ''),
      cssSelector: cSel(el),
      domPath: domPath(el),
      attributes: collectAttrs(el),
      boundingRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      outerHTML: el.outerHTML.length > 800 ? el.outerHTML.slice(0, 800) + '...' : el.outerHTML,
      pageUrl: location.href,
      pageTitle: document.title,
      time: new Date().toISOString()
    }
  }

  /** 经 console 桥回传数据（协议：`__DSH_WE__:` 前缀 + JSON，勿改前缀）。 */
  function sendData(data) {
    console.log('__DSH_WE__:' + JSON.stringify(data))
  }

  /** 判断是否为本插件注入的 UI 元素（悬停/点选需排除自身）。 */
  function isOurEl(el) {
    return !!(el && el.closest && el.closest('[data-dsh-we]'))
  }

  /* ---- UI 辅助函数 ---- */

  /** 卡片与节点之间、以及卡片与可见区边缘之间的留白（px）。 */
  var GAP = 6
  var MARGIN = 6
  /** 「极小节点」阈值：宽高都不超过它就按「节点右下」对齐（点/分隔线/小图标）。 */
  var TINY = 16

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v) }

  /**
   * 真实可见区：优先 visualViewport——捏合缩放、软键盘弹出时它才是真正可见的范围；
   * 拿不到再退化到 innerWidth/innerHeight。
   */
  function visibleRect() {
    var vv = window.visualViewport
    if (vv && vv.width && vv.height) {
      return { left: vv.offsetLeft, top: vv.offsetTop, right: vv.offsetLeft + vv.width, bottom: vv.offsetTop + vv.height }
    }
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  }

  /**
   * 可见安全区（可见区内缩 MARGIN）：操作栏/标签一律收敛到这里，超出即看不到也点不到。
   */
  function safeArea() {
    var v = visibleRect()
    return { left: v.left + MARGIN, top: v.top + MARGIN, right: v.right - MARGIN, bottom: v.bottom - MARGIN }
  }

  /**
   * 操作栏定位（算法）：
   * 1. 先量卡片真实尺寸（offsetWidth/offsetHeight），不写死高度——卡片只设了内联
   *    font-size，line-height 由宿主页面继承，写死会把翻转判断算少，卡片就被放到
   *    屏幕下沿之外。
   * 2. 纵向优先放节点下方；越过安全区下沿就翻到节点上方；上下都放不下（节点比
   *    可见区还高）再夹取到安全区内。
   * 3. 横向默认与节点左边对齐；节点极小（点/分隔线/小图标）时改为贴节点右下角，
   *    否则卡片会紧贴屏幕左边缘、也看不出它属于哪个节点；右侧放不下就改到节点
   *    左侧，两侧都放不下再夹取。
   * 4. 最后统一夹取到安全区：任何极端位置都保证整张卡片可见、可点。
   * 注意：这里算的是「页面自称的可见区」，它必须等于窗口真实渲染区——否则
   * 卡片会落进屏幕外那条看不见的带里（helper 侧已用 viewport:null 保证这一点）。
   */
  function positionAb(rect) {
    var area = safeArea()
    // 先按安全区宽度限制卡片宽度（窄窗口下按钮换行），再量尺寸。
    // 下限 160px：可视区窄到装不下按钮时不把卡片压成 0 宽（那样反而整块都看不见）
    var maxW = Math.max(area.right - area.left, 160)
    ab.style.maxWidth = Math.round(maxW) + 'px'
    var cw = ab.offsetWidth || 200
    var ch = ab.offsetHeight || 36
    var top
    if (rect.bottom + GAP + ch <= area.bottom) top = rect.bottom + GAP          // 下方放得下
    else if (rect.top - GAP - ch >= area.top) top = rect.top - GAP - ch         // 下方不够 → 翻到上方
    else top = area.top                                                         // 上下都放不下 → 贴安全区上沿
    var left = rect.left
    if (rect.width <= TINY && rect.height <= TINY) {
      // 极小节点：贴它的右下角，节点本身不被卡片压住
      left = rect.right + GAP
      if (left + cw > area.right) left = rect.left - GAP - cw
    }
    top = clamp(top, area.top, Math.max(area.top, area.bottom - ch))
    left = clamp(left, area.left, Math.max(area.left, area.right - cw))
    ab.style.left = Math.round(left) + 'px'
    ab.style.top = Math.round(top) + 'px'
  }

  /**
   * 显示操作栏：先 display 再量尺寸（隐藏元素量不出宽高），定位后收起右下角的
   * 暂停按钮——它与操作栏同处右下角、层级又相邻，会把卡片按钮盖住（点上去反而
   * 切到暂停）。选中态下「取消」就是退出入口，` 键也仍可暂停。
   */
  function showAb(el) {
    ab.style.display = 'flex'
    positionAb(el.getBoundingClientRect())
    chip.style.display = 'none'
  }

  /* ---- chip：拖动 → 四角吸附 → 按站点记住角落 ---- */

  /** chip 贴角内边距、拖动判定阈值（px）、暂停态不透明度。 */
  var CHIP_INSET = 16
  var DRAG_THRESHOLD = 4
  var PAUSED_OPACITY = 0.72
  /** chip 角落记忆的 localStorage 键（按站点；与 harness 的浏览器选择记忆各管各的）。 */
  var CORNER_KEY = '__dsh_we_corner__'

  var chipCorner = 'br'
  var chipDrag = null

  /** 读回记住的角落：只认四个合法值；取不到存储（file:// 等）或值非法一律回退右下角。 */
  function readCorner() {
    try {
      var v = localStorage.getItem(CORNER_KEY)
      if (v === 'tl' || v === 'tr' || v === 'bl' || v === 'br') return v
    } catch (e) {}
    return 'br'
  }

  /** 记住角落：存储不可用时静默忽略（本页仍生效，只是下次回到默认角）。 */
  function writeCorner(c) {
    try { localStorage.setItem(CORNER_KEY, c) } catch (e) {}
  }

  /**
   * 角落 → chip 左上角坐标：按可见区内缩 CHIP_INSET 贴角；可见区比 chip 还小时
   * 退化成「完整可见优先」——先保证整块在屏幕内，再谈内边距。
   */
  function cornerPos(corner) {
    var vp = visibleRect()
    var w = chip.offsetWidth || 0
    var h = chip.offsetHeight || 0
    var left = (corner === 'tl' || corner === 'bl') ? vp.left + CHIP_INSET : vp.right - CHIP_INSET - w
    var top = (corner === 'tl' || corner === 'tr') ? vp.top + CHIP_INSET : vp.bottom - CHIP_INSET - h
    return {
      left: Math.round(clamp(left, vp.left, Math.max(vp.left, vp.right - w))),
      top: Math.round(clamp(top, vp.top, Math.max(vp.top, vp.bottom - h)))
    }
  }

  /** 把 chip 贴到指定角落（不传则保持当前角）；animate=true 给 120ms 过渡，吸附不突兀。 */
  function placeChip(corner, animate) {
    if (corner) chipCorner = corner
    var p = cornerPos(chipCorner)
    chip.style.transition = animate ? 'left .12s ease, top .12s ease' : 'none'
    chip.style.left = p.left + 'px'
    chip.style.top = p.top + 'px'
  }

  /**
   * 同步 chip 状态外观：开启态保持原色（清掉 opacity，视觉与以前一致），暂停态整块
   * 轻微透明——文字本身也会变，两者一起让「已暂停」一眼可辨。
   * 文案变化会改 chip 宽度，所以顺便按当前角再贴一次（否则贴右/下角时会整体偏移）。
   */
  function syncChip() {
    chip.style.opacity = paused ? String(PAUSED_OPACITY) : ''
    placeChip(null, false)
  }

  /**
   * chip 按下：记录起点与指针在 chip 内的偏移。是否算拖动要等位移超过 DRAG_THRESHOLD
   * ——否则「点一下暂停/恢复」会被误判成拖动。
   */
  function onChipDown(e) {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    var r = chip.getBoundingClientRect()
    chipDrag = { x0: e.clientX, y0: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top, moved: false }
    // 挂 window 捕获阶段：页面里的 mouseup/click 拦截（onBlockUp）不会吃掉这两个监听
    window.addEventListener('pointermove', onChipMove, true)
    window.addEventListener('pointerup', onChipUp, true)
    window.addEventListener('pointercancel', onChipUp, true)
  }

  /** chip 拖动中：跟手移动，并按可见区夹取——拖到屏幕外也只贴边，始终整块可见。 */
  function onChipMove(e) {
    if (!chipDrag) return
    if (!chipDrag.moved) {
      if (Math.abs(e.clientX - chipDrag.x0) < DRAG_THRESHOLD && Math.abs(e.clientY - chipDrag.y0) < DRAG_THRESHOLD) return
      chipDrag.moved = true
      chip.style.transition = 'none' // 跟手，不要吸附动画
      chip.style.cursor = 'grabbing'
      applyCursor('grabbing')
      logDebug('chip 开始拖动')
    }
    e.preventDefault()
    e.stopPropagation()
    var vp = visibleRect()
    var w = chip.offsetWidth || 0
    var h = chip.offsetHeight || 0
    chip.style.left = Math.round(clamp(e.clientX - chipDrag.offX, vp.left, Math.max(vp.left, vp.right - w))) + 'px'
    chip.style.top = Math.round(clamp(e.clientY - chipDrag.offY, vp.top, Math.max(vp.top, vp.bottom - h))) + 'px'
  }

  /**
   * chip 抬起：拖动过 → 吸附到最近的角并记住；没拖动过 → 暂停/恢复（原挂在 click 上的
   * 行为搬到这里，因为拖动结束时浏览器仍可能补发 click，留着旧监听会多切一次状态）。
   * pointercancel 只收尾不切状态——交互被系统打断时不该改选择模式。
   */
  function onChipUp(e) {
    window.removeEventListener('pointermove', onChipMove, true)
    window.removeEventListener('pointerup', onChipUp, true)
    window.removeEventListener('pointercancel', onChipUp, true)
    var drag = chipDrag
    chipDrag = null
    chip.style.cursor = 'pointer'
    // 拖动结束：光标从 grabbing 回到十字准星；暂停态下 applyCursor 会只更新文本不挂规则
    applyCursor('crosshair')
    if (!drag) return
    if (drag.moved) {
      e.preventDefault()
      e.stopPropagation()
      snapChip()
      return
    }
    if (e.type !== 'pointercancel') togglePause()
  }

  /** 吸附：按 chip 中心落在可见区的哪个象限决定角落，贴过去并记住（按站点）。 */
  function snapChip() {
    var vp = visibleRect()
    var w = chip.offsetWidth || 0
    var h = chip.offsetHeight || 0
    var cx = (parseFloat(chip.style.left) || 0) + w / 2
    var cy = (parseFloat(chip.style.top) || 0) + h / 2
    var corner = (cy < (vp.top + vp.bottom) / 2 ? 't' : 'b') + (cx < (vp.left + vp.right) / 2 ? 'l' : 'r')
    placeChip(corner, true)
    writeCorner(corner)
    logDebug('chip 吸附到 ' + corner + ' 角')
  }

  /** 视口尺寸变化（窗口缩放/旋转）后按当前角落重新贴角；拖动中、或 chip 正收起（选中态）时不抢位置。 */
  function onViewportResize() {
    if (chipDrag && chipDrag.moved) return
    if (chip.style.display === 'none') return
    placeChip(null, false)
  }

  /**
   * 「选择父节点」的目标：当前锁定元素的父元素；父元素不存在或是 <html> 时返回 null
   * （再往上就是文档本身，没有可引用的上下文）。
   */
  function parentTarget() {
    if (!selEl) return null
    var p = selEl.parentElement
    if (!p || p.tagName === 'HTML') return null
    return p
  }

  /** 同步「选择父节点」按钮状态：还能上移就可用，已到顶层则置灰并写明原因。 */
  function syncParentBtn() {
    var p = parentTarget()
    btnParent.disabled = !p
    btnParent.style.opacity = p ? '1' : '0.45'
    btnParent.style.cursor = p ? 'pointer' : 'not-allowed'
    btnParent.title = p ? '把选择框移到父节点 <' + p.tagName.toLowerCase() + '>' : '已到最顶层'
  }

  /** 点选锁定：覆盖层换成橙色边框定格在选中元素上，隐藏悬停标签。 */
  function lockOverlay(el) {
    var r = el.getBoundingClientRect()
    setStyle(ov, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', border: '2px solid #f59e0b' })
    lb.style.display = 'none'
  }

  /** 回到悬停态：清空选中数据、隐藏全部浮层、恢复暂停按钮（回到它记住的角）。 */
  function returnToHover() {
    state = 'hover'
    selEl = null
    selData = null
    ab.style.display = 'none'
    ov.style.display = 'none'
    lb.style.display = 'none'
    chip.style.display = ''
    syncChip()
  }

  /* ---- 事件处理 ---- */

  /**
   * 悬停高亮：mousemove 时用 elementFromPoint 取光标下元素并移动覆盖层/标签。
   * 标签先设文案再量宽，按安全区左右夹取——否则贴着右边缘的元素（长文案）
   * 会把标签顶出屏幕。
   */
  function onMM(e) {
    if (paused || state !== 'hover') return
    var el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el || isOurEl(el)) { ov.style.display = 'none'; lb.style.display = 'none'; return }
    var r = el.getBoundingClientRect()
    setStyle(ov, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', border: '2px solid #3b82f6' })
    lb.textContent = '<' + el.tagName.toLowerCase() + '> ' + Math.round(r.width) + 'x' + Math.round(r.height)
    lb.style.display = 'block'
    var area = safeArea()
    lb.style.left = Math.round(clamp(r.left, area.left, Math.max(area.left, area.right - (lb.offsetWidth || 0)))) + 'px'
    lb.style.top = Math.max(area.top, r.top - 22) + 'px'
  }

  /**
   * 点选：pointerdown 捕获阶段拦截（阻止页面自身交互），hover 态选中
   * 并锁定元素；selected 态再点页面任意处则放弃当前选中回到 hover。
   */
  function onPD(e) {
    if (paused) return
    if (e.button === 2) return
    if (isOurEl(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    var target = document.elementFromPoint(e.clientX, e.clientY)
    if (!target || isOurEl(target)) return
    if (state === 'hover') {
      selEl = target
      selData = collectData(target)
      state = 'selected'
      logDebug('选中元素: <' + selData.tagName + '> ' + selData.cssSelector)
      lockOverlay(target)
      showAb(target)
      syncParentBtn()
    } else {
      returnToHover()
    }
  }

  /** 选择模式下吞掉页面的 mouseup/pointerup/click，防止触发页面自身行为。 */
  function onBlockUp(e) {
    if (paused || isOurEl(e.target)) return
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  /** 选择模式下的键盘：` 暂停/恢复，Escape 退出选择模式。 */
  function onKD(e) {
    if (e.key === '`') {
      e.preventDefault()
      e.stopPropagation()
      togglePause()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      exitMode()
    }
  }

  /** 暂停态下唯一保留的键盘监听：` 恢复（其余监听已摘除）。 */
  function onBacktick(e) {
    if (e.key === '`') {
      e.preventDefault()
      e.stopPropagation()
      togglePause()
    }
  }

  function togglePause() {
    if (paused) resume()
    else pause()
  }

  /**
   * 暂停选择：摘除全部拦截监听（页面恢复可交互，供登录等人工操作），
   * 只留 ` 键恢复入口；清空选中态并隐藏浮层，chip 转为半透明状态标记。
   */
  function pause() {
    paused = true
    document.removeEventListener('mousemove', onMM, true)
    document.removeEventListener('pointerdown', onPD, true)
    document.removeEventListener('mouseup', onBlockUp, true)
    document.removeEventListener('pointerup', onBlockUp, true)
    document.removeEventListener('click', onBlockUp, true)
    document.removeEventListener('keydown', onKD, true)
    document.addEventListener('keydown', onBacktick, true)
    ov.style.display = 'none'
    lb.style.display = 'none'
    ab.style.display = 'none'
    chip.style.display = ''
    syncCursor()
    chip.textContent = '⌖ 选择模式：已暂停（点击恢复，或按 `）'
    syncChip()
    state = 'hover'
    selEl = null
    selData = null
    logDebug('选择模式已暂停')
  }

  /** 恢复选择：重新挂载全部监听，光标换成十字准星，chip 回到开启态外观。 */
  function resume() {
    paused = false
    document.removeEventListener('keydown', onBacktick, true)
    document.addEventListener('mousemove', onMM, true)
    document.addEventListener('pointerdown', onPD, true)
    document.addEventListener('mouseup', onBlockUp, true)
    document.addEventListener('pointerup', onBlockUp, true)
    document.addEventListener('click', onBlockUp, true)
    document.addEventListener('keydown', onKD, true)
    syncCursor()
    chip.textContent = '⌖ 选择模式：开启（点击暂停，或按 `）'
    syncChip()
    logDebug('选择模式已恢复')
  }

  /* ---- 按钮 ---- */

  /** 「添加到对话」：把选中数据包桥接给 helper，然后退出选择模式。 */
  btnAdd.addEventListener('click', function (e) {
    e.stopPropagation()
    if (!selEl || !selData) return
    var data = {}
    for (var k in selData) data[k] = selData[k]
    data.action = 'add-to-chat'
    logDebug('回传元素数据: <' + data.tagName + '> ' + data.cssSelector)
    sendData(data)
    exitMode()
  })

  /**
   * 「选择父节点」：把锁定目标换成当前元素的父元素，重新采集数据并把锁定框/
   * 操作栏移到父元素上（可连点，一路向上到 <body> 为止）；此后点「添加到对话」
   * 回传的就是父节点的上下文。
   */
  btnParent.addEventListener('click', function (e) {
    e.stopPropagation()
    var p = parentTarget()
    if (!p) return
    selEl = p
    selData = collectData(p)
    logDebug('上移到父节点: <' + selData.tagName + '> ' + selData.cssSelector)
    lockOverlay(p)
    showAb(p)
    syncParentBtn()
  })

  /** 「取消」：放弃当前选中，回到悬停态。 */
  btnCancel.addEventListener('click', function (e) {
    e.stopPropagation()
    returnToHover()
  })

  /* ---- 操作栏按钮的悬浮样式（禁用态不改背景） ---- */
  ;[btnAdd, btnParent, btnCancel].forEach(function (b) {
    b.addEventListener('mouseenter', function () { if (!b.disabled) b.style.background = '#3d3d3d' })
    b.addEventListener('mouseleave', function () { if (!b.disabled) b.style.background = '#2d2d2d' })
  })

  /* ---- 首次运行提示（每会话一次，3 秒淡出） ---- */
  try {
    if (!sessionStorage.getItem('__dsh_we_hint__')) {
      sessionStorage.setItem('__dsh_we_hint__', '1')
      var th = document.createElement('div')
      setStyle(th, { position: 'fixed', bottom: '64px', left: '50%', transform: 'translateX(-50%)', zIndex: '2147483643', background: 'rgba(30,30,30,0.92)', color: '#fff', fontSize: '12px', fontFamily: 'system-ui,sans-serif', padding: '7px 16px', borderRadius: '20px', pointerEvents: 'none', whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.45)', transition: 'opacity 0.4s' })
      th.textContent = '🔍 页面元素选择已开启 · 点「添加到对话」交给模型 · 层级不对可点「选择父节点」上移 · 按 ` 暂停'
      document.documentElement.appendChild(th)
      setTimeout(function () { th.style.opacity = '0' }, 2600)
      setTimeout(function () { if (th.parentNode) th.parentNode.removeChild(th) }, 3000)
    }
  } catch (err) {}

  /* ---- chip 落位：读回记住的角落 → 贴角 → 显示 → 视口变化时重新贴角 ----
     必须放在所有 var 常量（CHIP_INSET/CORNER_KEY/MARGIN）赋值之后：var 提升只提声明
     不提初值，提前调用会把常量读成 undefined，算出 NaN 坐标（实测 chip 会停在左上角）。 */
  chipCorner = readCorner()
  placeChip(chipCorner, false)
  chip.style.visibility = ''
  window.addEventListener('resize', onViewportResize)

  /* ---- 激活：挂载全部监听（捕获阶段），光标换成十字准星 ---- */
  document.addEventListener('mousemove', onMM, true)
  document.addEventListener('pointerdown', onPD, true)
  document.addEventListener('mouseup', onBlockUp, true)
  document.addEventListener('pointerup', onBlockUp, true)
  document.addEventListener('click', onBlockUp, true)
  document.addEventListener('keydown', onKD, true)
  syncCursor()

  /* ---- 退出选择模式：通知 host，然后移除所有元素 ---- */
  function exitMode() {
    try {
      logDebug('退出选择模式')
      sendData({ action: 'exit-mode', pageUrl: location.href, pageTitle: document.title })
    } catch (err) {}
    cleanupAll()
  }

  /* ---- 清理 ---- */
  window.__dsh_we_test_state__ = function () { return state }
  /** 全量清理：摘除监听、移除注入 DOM、恢复光标、删除全局标记（供退出与重复注入前调用）。 */
  function cleanupAll() {
    document.removeEventListener('mousemove', onMM, true)
    document.removeEventListener('pointerdown', onPD, true)
    document.removeEventListener('mouseup', onBlockUp, true)
    document.removeEventListener('pointerup', onBlockUp, true)
    document.removeEventListener('click', onBlockUp, true)
    document.removeEventListener('keydown', onKD, true)
    document.removeEventListener('keydown', onBacktick, true)
    // chip 的拖动监听挂在 window 上，不随元素移除而消失，必须显式摘掉
    window.removeEventListener('resize', onViewportResize)
    window.removeEventListener('pointermove', onChipMove, true)
    window.removeEventListener('pointerup', onChipUp, true)
    window.removeEventListener('pointercancel', onChipUp, true)
    chipDrag = null
    var els = [ov, lb, ab, chip, cursorStyleEl]
    for (var i = 0; i < els.length; i++) {
      if (els[i] && els[i].parentNode) els[i].parentNode.removeChild(els[i])
    }
    // 光标规则随样式表一起消失：<html> 不留任何本插件写入的行内样式（见 cursorStyleEl 注释）
    delete window.__dsh_we_active__
    delete window.__dsh_we_cleanup__
    delete window.__dsh_we_test_state__
    logDebug('inspector 已清理')
  }
  window.__dsh_we_cleanup__ = cleanupAll
})()
