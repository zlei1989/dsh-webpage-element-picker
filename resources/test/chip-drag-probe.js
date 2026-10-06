// chip（⌖ 选择模式悬浮按钮）拖动 / 四角吸附 / 状态外观回归探针（Playwright MCP 专用）。
// 由 browser_run_code_unsafe({ filename }) 调用，文件内容必须是一个函数表达式（入参 page）。
// 用**真实鼠标事件**（page.mouse）驱动拖动与点击（Chromium 会据此合成 pointer 事件），
// 断言五类行为：
//   corner    松手后吸附到最近的角：距视口 16px 内边距，left/top 与角一致
//   persist   角落写进 localStorage['__dsh_we_corner__']，页面重载/重新注入后仍在那个角
//   click     位移不超过阈值 = 点击 = 暂停/恢复（既不移动 chip，也不被误判成拖动）
//   opacity   开启态不透明度不变（computed = 1），暂停态 < 1
//   clamp     窄视口拖动不越界；视口尺寸变化后按当前角落重新贴角
// 页面经 page.route 以 http 源提供——about:blank/file 源取不到 localStorage，
// 那样「按站点记忆」这条根本测不了。
async (page) => {
  const IMPLS = [
    { name: 'before', path: '.playwright-mcp/inspector-before.js' },
    { name: 'after', path: 'D:\\Github\\dsh-webpage-element-picker\\resources\\inspector.js' },
  ]
  const VW = 1200
  const VH = 820
  const INSET = 16
  const ORIGIN = 'http://dsh-we-probe.local/index.html'
  const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>chip probe</title>
<style>html,body{margin:0;padding:0;height:100%;background:#fff;font-family:system-ui,sans-serif}
#box{position:absolute;left:200px;top:200px;width:300px;height:160px;background:#eef;border:1px solid #99c}</style>
</head><body><div id="box">probe content</div></body></html>`

  const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1.5 : tol)
  const p = await page.context().newPage()
  const report = []
  try {
    await p.route('http://dsh-we-probe.local/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE }))

    /** 量 chip 几何 + 记忆值 + 状态外观。 */
    const chipInfo = () => p.evaluate(() => {
      const chip = document.querySelector('[data-dsh-we="chip"]')
      if (!chip) return null
      const r = chip.getBoundingClientRect()
      let corner = null
      try { corner = localStorage.getItem('__dsh_we_corner__') } catch (e) { corner = 'unavailable' }
      return {
        left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height,
        cx: r.left + r.width / 2, cy: r.top + r.height / 2,
        opacity: getComputedStyle(chip).opacity,
        text: chip.textContent, corner: corner, state: window.__dsh_we_test_state__(),
      }
    })

    /** 重开页面（localStorage 保留）→ 可选清记忆 → 注入 inspector。 */
    const reset = async (impl, vw, vh, clearCorner) => {
      await p.setViewportSize({ width: vw, height: vh })
      await p.goto(ORIGIN, { waitUntil: 'load' })
      await p.evaluate((clear) => {
        try { if (clear) localStorage.removeItem('__dsh_we_corner__') } catch (e) {}
      }, !!clearCorner)
      await p.addScriptTag({ path: impl.path })
      await p.waitForTimeout(80)
    }

    /**
     * 真实鼠标拖动：先越过阈值再移到目标点，松手后等吸附过渡（120ms）结束。
     * 落点刻意离角落 60px——避免松手位置正好压在 chip 上（那会额外产生一个 click 事件，
     * 把「拖动不该触发暂停」这条测糊）。
     */
    const dragTo = async (tx, ty) => {
      const c = await chipInfo()
      await p.mouse.move(c.cx, c.cy)
      await p.mouse.down()
      await p.mouse.move(c.cx + 12, c.cy + 12, { steps: 2 })
      await p.mouse.move(tx, ty, { steps: 6 })
      await p.mouse.up()
      await p.waitForTimeout(260)
    }

    /** 原地点击 chip（down/up 同一坐标，位移 0 → 必须当点击处理）。 */
    const clickChip = async () => {
      const c = await chipInfo()
      await p.mouse.move(c.cx, c.cy)
      await p.mouse.down()
      await p.mouse.up()
      await p.waitForTimeout(100)
    }

    for (let i = 0; i < IMPLS.length; i++) {
      const impl = IMPLS[i]
      const cases = []
      const check = (name, ok, detail) => cases.push({ name: name, ok: !!ok, detail: detail || '' })

      // 1) 默认角落 = 右下（无记忆）
      await reset(impl, VW, VH, true)
      let c = await chipInfo()
      check('default-corner-is-br', c && near(c.right, VW - INSET) && near(c.bottom, VH - INSET), c ? 'right=' + Math.round(c.right) + ' bottom=' + Math.round(c.bottom) : 'chip 不存在')

      // 2) 拖到左上：吸附 + 记忆 + 不误触发暂停、不选中元素
      await dragTo(60, 60)
      c = await chipInfo()
      check('drag-to-tl', c && near(c.left, INSET) && near(c.top, INSET), c ? 'left=' + Math.round(c.left) + ' top=' + Math.round(c.top) : 'chip 不存在')
      check('tl-remembered', c && c.corner === 'tl', c ? 'corner=' + c.corner : '')
      check('drag-does-not-pause', c && c.text.indexOf('开启') >= 0, c ? 'text=' + c.text : '')
      check('drag-does-not-select', c && c.state === 'hover', c ? 'state=' + c.state : '')

      // 3) 依次拖到右上 / 左下 / 右下
      await dragTo(VW - 60, 60)
      c = await chipInfo()
      check('drag-to-tr', c && near(c.right, VW - INSET) && near(c.top, INSET) && c.corner === 'tr', c ? 'right=' + Math.round(c.right) + ' top=' + Math.round(c.top) + ' corner=' + c.corner : '')
      await dragTo(60, VH - 60)
      c = await chipInfo()
      check('drag-to-bl', c && near(c.left, INSET) && near(c.bottom, VH - INSET) && c.corner === 'bl', c ? 'left=' + Math.round(c.left) + ' bottom=' + Math.round(c.bottom) + ' corner=' + c.corner : '')
      await dragTo(VW - 60, VH - 60)
      c = await chipInfo()
      check('drag-to-br', c && near(c.right, VW - INSET) && near(c.bottom, VH - INSET) && c.corner === 'br', c ? 'right=' + Math.round(c.right) + ' bottom=' + Math.round(c.bottom) + ' corner=' + c.corner : '')

      // 4) 原地点击 = 暂停/恢复；暂停态不透明度 < 1，开启态回到 1；锚定的角不被点击带跑
      //   （只比锚定边：chip 文字变短会改宽度，右锚定时 left 本来就会变）
      await dragTo(60, 60)
      await clickChip()
      c = await chipInfo()
      check('click-pauses', c && c.text.indexOf('已暂停') >= 0, c ? 'text=' + c.text : '')
      check('paused-opacity-lower', c && parseFloat(c.opacity) < 1, c ? 'opacity=' + c.opacity : '')
      check('click-keeps-corner', c && near(c.left, INSET) && near(c.top, INSET), c ? 'left=' + Math.round(c.left) + ' top=' + Math.round(c.top) : '')
      await clickChip()
      c = await chipInfo()
      check('click-resumes', c && c.text.indexOf('开启') >= 0, c ? 'text=' + c.text : '')
      check('active-opacity-unchanged', c && parseFloat(c.opacity) === 1, c ? 'opacity=' + c.opacity : '')

      // 5) 暂停态也能拖（登录场景要把它挪开）
      await clickChip()
      await dragTo(VW - 60, VH - 60)
      c = await chipInfo()
      check('drag-while-paused-works', c && near(c.right, VW - INSET) && near(c.bottom, VH - INSET), c ? 'right=' + Math.round(c.right) + ' bottom=' + Math.round(c.bottom) : '')
      check('paused-visible-while-dragged', c && c.text.indexOf('已暂停') >= 0 && parseFloat(c.opacity) < 1, c ? 'text=' + c.text + ' opacity=' + c.opacity : '')
      await clickChip() // 恢复开启，避免影响后续

      // 6) 重开页面后仍记得角落（先移到左上，再整页重开）
      await dragTo(60, 60)
      await reset(impl, VW, VH, false)
      c = await chipInfo()
      check('corner-survives-reload', c && near(c.left, INSET) && near(c.top, INSET), c ? 'left=' + Math.round(c.left) + ' top=' + Math.round(c.top) : '')

      // 7) 视口尺寸变化后按当前角落重新贴角（左上）
      await p.setViewportSize({ width: 700, height: 500 })
      await p.waitForTimeout(160)
      c = await chipInfo()
      check('reanchor-on-resize', c && near(c.left, INSET) && near(c.top, INSET), c ? 'left=' + Math.round(c.left) + ' top=' + Math.round(c.top) : '')

      // 8) 窄视口：拖到右下角外侧也不越界（整块可见）
      await reset(impl, 420, 300, true)
      await dragTo(415, 295)
      c = await chipInfo()
      check('narrow-viewport-stays-inside', c && c.left >= INSET - 0.5 && c.top >= INSET - 0.5 && c.right <= 420 - INSET + 0.5 && c.bottom <= 300 - INSET + 0.5, c ? 'left=' + Math.round(c.left) + ' top=' + Math.round(c.top) + ' right=' + Math.round(c.right) + ' bottom=' + Math.round(c.bottom) : '')

      report.push({
        impl: impl.name,
        pass: cases.filter((x) => x.ok).length,
        fail: cases.filter((x) => !x.ok).length,
        fails: cases.filter((x) => !x.ok).map((x) => x.name + (x.detail ? ' → ' + x.detail : '')),
      })
    }
    return report
  } finally {
    await p.close().catch(() => {})
  }
}
