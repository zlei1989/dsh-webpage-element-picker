'use strict'
// 视口一致性检查（helper 启动参数改前/改后对比，人工跑，不参与 pnpm test）。
//
// 背景：Playwright 的 viewport 选项是「设备度量覆盖」，窗口装不下也照报——屏幕工作区
// 1440x852 时请求 1200x820，加上约 91px 浏览器 chrome 已超过工作区，窗口被系统压扁，
// 真实渲染区只有约 1195x747，而页面仍按 1200x820 排版：底部约 73px 画在屏幕外。
// inspector 只信 window.innerHeight，于是把操作栏放进那条看不见的带里 =「卡片溢出
// 屏幕、看不到也点不到」。helper 的修法是 viewport: null（不覆盖，视口恒等于真实渲染区）
// + --start-maximized（窗口仍占满工作区）。
//
// 本脚本用真实浏览器复现两种启动参数，打印：
//   page   页面自报的 innerWidth/innerHeight 及 outerHeight
//   cards  两个「贴近屏幕下沿」的节点选中后，操作栏的矩形（页面坐标）
// 配合外部像素取证（截窗口图看红色底栏/卡片是否真的显示在屏幕上）判定修复效果。
//
// 用法: node viewport-fit-check.cjs <浏览器可执行文件路径> <old|new> [保持窗口毫秒数]
const fs = require('fs')
const os = require('os')
const path = require('path')

const exe = process.argv[2]
const mode = process.argv[3] || 'new'
const holdMs = Number(process.argv[4] || 12000)
if (!exe) {
  console.error('usage: node viewport-fit-check.cjs <browser exe> <old|new> [holdMs]')
  process.exit(2)
}

// playwright-core 由 bootstrap 装在插件自有缓存里（与 bootstrap.cjs 的 pwNode 一致）
const pwRoot = path.join(os.tmpdir(), 'dsh-webpage-element-picker', 'pw-node', 'node_modules', 'playwright-core')
const inspectorPath = path.join(__dirname, '..', 'inspector.js')
const { chromium } = require(pwRoot)

/** helper-playwright.js 里对应的两套启动参数。 */
const LAUNCH = {
  old: { headless: false, viewport: { width: 1200, height: 820 } },
  new: { headless: false, viewport: null, args: ['--start-maximized'] },
}

/**
 * 探测页：顶部绿条（页面 y=0 起）、底部红条（贴页面最下沿，放在节点下层不遮挡点选）、
 * 两个下沿节点。节点都在「页面自报视口」内，但在被压扁/挂到屏幕外的真实窗口里会落到
 * 屏幕外——这正是操作栏「溢出屏幕」的现场。
 */
const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>viewport-fit</title>
<style>
  html, body { margin:0; padding:0; background:#fff; font-family:system-ui,sans-serif; }
  #top { position:fixed; left:0; top:0; width:100%; height:24px; background:#22c55e; color:#fff; font:700 14px/24px system-ui; z-index:6 }
  #bottom { position:fixed; left:0; bottom:0; width:100%; height:40px; background:#ef4444; color:#fff; font:700 16px/40px system-ui; text-align:center; z-index:1; pointer-events:none }
  .n { position:absolute; background:#dbeafe; border:2px solid #2563eb; box-sizing:border-box; z-index:4; font:14px/26px system-ui; text-align:center }
</style></head><body>
  <div id="top">TOP marker (y=0..24)</div>
  <div id="bottom">BOTTOM marker (最后 40px)</div>
  <div id="nodeA" class="n" style="left:300px;width:200px;height:30px">nodeA 贴近可见下沿</div>
  <div id="nodeB" class="n" style="left:700px;width:200px;height:24px">nodeB 最下沿</div>
</body></html>`

/** 按元素中心派发 pointerdown（等价用户在页面上点一下，与 resources/test/test-drive.js 同法）。 */
const SELECT_JS = `(function (id) {
  var el = document.getElementById(id)
  var r = el.getBoundingClientRect()
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }))
})`

async function main() {
  const profileDir = path.join(os.tmpdir(), 'dsh-we-viewport-check-' + mode)
  const ctx = await chromium.launchPersistentContext(profileDir, Object.assign({ executablePath: exe }, LAUNCH[mode]))
  const p = ctx.pages()[0] || (await ctx.newPage())
  await p.setContent(HTML, { waitUntil: 'load' })
  // 两个节点贴着「自报视口」的下沿摆放：nodeA 底边在 H-90，nodeB 底边在 H-40
  await p.evaluate(() => {
    const H = window.innerHeight
    document.getElementById('nodeA').style.top = (H - 120) + 'px'
    document.getElementById('nodeB').style.top = (H - 40) + 'px'
  })
  await p.addScriptTag({ path: inspectorPath })

  /** 选中一个节点并量出节点/操作栏矩形（ov 含 2px 边框，故比节点大 4px）。 */
  const selectAndMeasure = async (id) => {
    await p.evaluate(SELECT_JS + "('" + id + "')")
    await p.waitForTimeout(80)
    return p.evaluate(() => {
      const ab = document.querySelector('[data-dsh-we="ab"]')
      const r = ab.getBoundingClientRect()
      const node = document.querySelector('[data-dsh-we="ov"]').getBoundingClientRect()
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      const bs = [].slice.call(ab.querySelectorAll('button'))
      const hits = bs.map((b) => {
        const br = b.getBoundingClientRect()
        const el = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2)
        return { text: b.textContent, hit: el === b }
      })
      return {
        node: { top: Math.round(node.top), bottom: Math.round(node.bottom) },
        card: { left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) },
        cardCenterHit: at ? (at.getAttribute('data-dsh-we') || at.tagName.toLowerCase()) : 'none',
        // 页面自认的「可点击」：注意它只在视口==真实渲染区时才等价于真的能点到
        buttonsHit: hits.map((x) => x.text + '=' + (x.hit ? 'ok' : 'BLOCKED')),
      }
    })
  }

  /** 点「取消」回到悬停态，便于选中下一个节点（chip 也会随之恢复显示）。 */
  const cancel = async () => {
    await p.evaluate("(function(){ var bs=[].slice.call(document.querySelectorAll('[data-dsh-we=\"ab\"] button')); for (var i=0;i<bs.length;i++) if (bs[i].textContent === '取消') { bs[i].click(); return } })()")
    await p.waitForTimeout(60)
  }

  const cards = {}
  cards.nodeA = await selectAndMeasure('nodeA')
  await cancel()
  cards.nodeB = await selectAndMeasure('nodeB')
  await cancel()
  // 收尾：把 nodeB 挪到「页面最下沿」（底边距页面底 6px）再选中，并**保持卡片显示**，
  // 便于外部对窗口截图取证：卡片是否真的显示在屏幕上（旧配置会落到屏幕外）
  await p.evaluate(() => { document.getElementById('nodeB').style.top = (window.innerHeight - 30) + 'px' })
  cards.bottomMost = await selectAndMeasure('nodeB')
  cards.bottomMost.staysVisible = true

  const page = await p.evaluate(() => ({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight, dpr: window.devicePixelRatio }))
  const out = { mode, launch: LAUNCH[mode], page, chromeHint: page.outerHeight - page.innerHeight, cards, inspector: inspectorPath }
  // 同时落盘（stdout 经管道时可能被缓冲，落盘便于随时取数）
  const outPath = path.join(os.tmpdir(), 'dsh-we-viewport-check-' + mode + '.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log('FIT_CHECK ' + JSON.stringify(out))
  console.log('FIT_CHECK_JSON ' + outPath)
  await new Promise((r) => setTimeout(r, holdMs))
  await ctx.close()
}

main().catch((err) => {
  console.error('FIT_CHECK_ERROR ' + String((err && err.stack) || err))
  process.exit(1)
})
