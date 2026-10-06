// 操作栏（data-dsh-we="ab"）定位回归探针（Playwright MCP 专用）。
// 由 browser_run_code_unsafe({ filename }) 调用，文件内容必须是一个函数表达式（入参 page）。
// 做法：在真实 Chromium 里往探测页注入 inspector.js，用一个可任意摆放的节点扫过视口内所有
// 极端位置/尺寸，逐个点选并量出操作栏几何、溢出边、按钮可点击性、chip 覆盖情况。
// 视口 1200x820、DPR 1，与 helper-playwright.js 的启动参数一致。
//
// 判定（全部必须通过）：
//   overflow      卡片任一边超出视口（innerWidth/innerHeight）
//   blocked       按钮中心 elementFromPoint 命中的不是按钮自己（被别的浮层盖住 = 点不到）
//   anchor        极小节点（宽高 <= 16）时卡片应贴在节点右下（右侧放不下才改左侧）
//   chipVisible   选中态下右下角暂停按钮必须收起（否则盖住卡片、点上去变暂停）
async (page) => {
  // 改前 / 改后两份 inspector 做 A/B（改前 = git show HEAD:resources/inspector.js）
  const IMPLS = [
    { name: 'before', path: '.playwright-mcp/inspector-before.js' },
    { name: 'after', path: 'D:\\Github\\dsh-webpage-element-picker\\resources\\inspector.js' },
  ]
  const VW = 1200
  const VH = 820

  /**
   * 场景：[说明, left, top, width, height]，坐标为视口坐标。
   * 每个视口尺寸单独生成一份：极端位置按该视口的下沿/右沿取。
   */
  const scenariosFor = (vw, vh) => {
    const list = []
    const xs = [0, 2, Math.round(vw / 2), vw - 4]
    const ys = [0, 2, 400, vh - 14, vh - 8]
    for (let i = 0; i < xs.length; i++) {
      for (let j = 0; j < ys.length; j++) list.push(['tiny@(' + xs[i] + ',' + ys[j] + ')', xs[i], ys[j], 4, 4])
    }
    list.push(['strip-bottom-visible', Math.round(vw / 4), vh - 10, Math.round(vw / 2), 10])
    list.push(['strip-overflow-bottom', Math.round(vw / 4), vh - 5, Math.round(vw / 2), 20])
    list.push(['node-bottom-band', Math.round(vw / 4), vh - 120, 200, 30])   // 旧代码会把卡片放到屏幕外那条带里
    list.push(['tall-left', 10, 0, 40, vh - 20])
    list.push(['tall-partial-top', 10, -300, 40, vh + 280])
    list.push(['full-viewport', 0, 0, vw, vh])
    list.push(['side-strip-left', 0, 100, 3, Math.round(vh / 2)])
    list.push(['side-strip-right', vw - 3, 100, 3, Math.round(vh / 2)])
    list.push(['icon-16x16@left-bottom', 2, vh - 60, 16, 16])
    list.push(['icon-16x16@right-bottom', vw - 18, vh - 60, 16, 16])
    list.push(['icon-16x16@left-top', 2, 2, 16, 16])
    list.push(['card-bottom-right', vw - 120, vh - 40, 110, 30])   // 落在右下角暂停按钮区域
    return list
  }

  /** 视口变体：常规 + 放大 line-height 的页面 + 很小的窗口（考验夹取与换行） */
  const VIEWPORTS = [
    { name: '1200x820', w: 1200, h: 820, css: '' },
    { name: '1200x820/lh2', w: 1200, h: 820, css: 'html, body, button { line-height: 2; }' },
    { name: '420x300', w: 420, h: 300, css: '' },
  ]

  /** 探测页：单个可摆放节点（body 即背景），页面不滚动。 */
  const buildHtml = (vw, vh, extra) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ab probe</title>
<style>
  html, body { margin:0; padding:0; }
  body { position:relative; height:${vh}px; overflow:hidden; background:#fff; font-family:system-ui,sans-serif; }
  #node { position:absolute; background:#eef; border:1px solid #99c; box-sizing:border-box; z-index:1; }
  ${extra}
</style></head><body><div id="node"></div></body></html>`

  /** 单个场景：重新注入 inspector → 摆好节点 → 点选 → 量几何与可点击性。 */
  const runOne = async (p, impl, s) => {
    await p.evaluate('(function(){ try { if (window.__dsh_we_cleanup__) window.__dsh_we_cleanup__() } catch(e){} })()')
    await p.addScriptTag({ path: impl.path })
    await p.evaluate(({ l, t, w, h }) => {
      const n = document.getElementById('node')
      n.style.left = l + 'px'; n.style.top = t + 'px'
      n.style.width = w + 'px'; n.style.height = h + 'px'
    }, { l: s[1], t: s[2], w: s[3], h: s[4] })
    const click = await p.evaluate(() => {
      const r = document.getElementById('node').getBoundingClientRect()
      const l = Math.max(1, r.left), t = Math.max(1, r.top)
      const rr = Math.min(window.innerWidth - 1, r.right), rb = Math.min(window.innerHeight - 1, r.bottom)
      const chip = document.querySelector('[data-dsh-we="chip"]')
      const c = chip.getBoundingClientRect()
      const x = (l + rr) / 2, y = (t + rb) / 2
      return { x, y, visible: rr > l && rb > t, inChip: x >= c.left && x <= c.right && y >= c.top && y <= c.bottom }
    })
    if (!click.visible) return { id: s[0], skipped: '节点不可见' }
    // 点右下角暂停按钮 = 切换暂停（它自己的功能），不作为卡片用例
    if (click.inChip) return { id: s[0], skipped: '落在暂停按钮上（点它=暂停）' }
    await p.mouse.click(click.x, click.y)
    await p.waitForTimeout(40)
    const m = await p.evaluate(() => {
      const ab = document.querySelector('[data-dsh-we="ab"]')
      const chip = document.querySelector('[data-dsh-we="chip"]')
      const node = document.getElementById('node')
      const r = ab.getBoundingClientRect()
      const nr = node.getBoundingClientRect()
      const name = (el) => (!el ? 'none' : (el.getAttribute && el.getAttribute('data-dsh-we')) || el.id || el.tagName.toLowerCase())
      const hits = [...ab.querySelectorAll('button')].map((b) => {
        const br = b.getBoundingClientRect()
        const at = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2)
        return { text: b.textContent, hit: name(at), ok: at === b }
      })
      return {
        state: window.__dsh_we_test_state__(),
        vw: window.innerWidth, vh: window.innerHeight,
        card: { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height },
        node: { l: nr.left, t: nr.top, r: nr.right, b: nr.bottom, w: nr.width, h: nr.height },
        chipDisplay: chip.style.display,
        hits,
      }
    })
    const c = m.card
    const sides = []
    if (c.l < 0 - 0.5) sides.push('left:' + Math.round(c.l))
    if (c.t < 0 - 0.5) sides.push('top:' + Math.round(c.t))
    if (c.r > m.vw + 0.5) sides.push('right:+' + Math.round(c.r - m.vw))
    if (c.b > m.vh + 0.5) sides.push('bottom:+' + Math.round(c.b - m.vh))
    const blocked = m.hits.filter((x) => !x.ok)
    const tiny = m.node.w <= 16 && m.node.h <= 16
    // 极小节点：右侧放得下就必须贴节点右边缘，右侧不行、左侧放得下则改到节点左侧；
    // 两侧都放不下（可视区比卡片宽不了多少）属于几何无解，只要求卡片不溢出（见 overflow）
    let anchorOk = true
    if (tiny && m.state === 'selected') {
      const roomRight = m.node.r + 6 + c.w <= m.vw - 6
      const roomLeft = m.node.l - 6 - c.w >= 6
      if (roomRight) anchorOk = c.l >= m.node.r - 0.5
      else if (roomLeft) anchorOk = c.r <= m.node.l + 0.5
    }
    return {
      id: s[0],
      state: m.state,
      card: Math.round(c.l) + ',' + Math.round(c.t) + ' ' + Math.round(c.w) + 'x' + Math.round(c.h),
      node: Math.round(m.node.l) + ',' + Math.round(m.node.t) + ' ' + Math.round(m.node.w) + 'x' + Math.round(m.node.h),
      overflow: sides.join(' '),
      blocked: blocked.map((x) => x.text + '<-' + x.hit).join(' '),
      anchorOk,
      chipVisible: m.chipDisplay !== 'none',
    }
  }

  const p = await page.context().newPage()
  try {
    const report = []
    for (let i = 0; i < IMPLS.length; i++) {
      const impl = IMPLS[i]
      const rows = []
      for (let v = 0; v < VIEWPORTS.length; v++) {
        const vp = VIEWPORTS[v]
        const scenarios = scenariosFor(vp.w, vp.h)
        await p.setViewportSize({ width: vp.w, height: vp.h })
        await p.setContent(buildHtml(vp.w, vp.h, vp.css), { waitUntil: 'load' })
        await p.waitForTimeout(60)
        for (let s = 0; s < scenarios.length; s++) {
          const row = await runOne(p, impl, scenarios[s])
          row.variant = vp.name
          rows.push(row)
        }
      }
      const fails = rows.filter((r) => r.skipped ? false : (r.state !== 'selected' || r.overflow || r.blocked || !r.anchorOk || r.chipVisible))
      report.push({
        impl: impl.name,
        scenarios: rows.length,
        skipped: rows.filter((r) => r.skipped).length,
        failCount: fails.length,
        fails: fails.map((r) => r.variant + ' ' + r.id + ' node@' + r.node + ' card@' + r.card + ' state=' + r.state + ' → ' + [r.overflow ? 'overflow:' + r.overflow : '', r.blocked ? 'blocked:' + r.blocked : '', !r.anchorOk ? 'anchor-wrong' : '', r.chipVisible ? 'chip-still-visible' : ''].filter(Boolean).join(' | ')),
        sample: rows.filter((r) => !r.skipped && /icon-16x16@left-bottom|node-bottom-band|full-viewport/.test(r.id)).map((r) => r.variant + ' ' + r.id + ' card@' + r.card),
      })
    }
    return report
  } finally {
    await p.close().catch(() => {})
  }
}
