'use strict'
// 回归探针：inspector 注入态不得改动 React 拥有的节点（documentElement/body）的行内样式。
// 背景：旧版把 `document.documentElement.style.cursor = 'crosshair'` 直接写在 <html> 上；
//       React 19 在 hydration 时读这个内联属性，判定与服务端 HTML 不一致 →
//       「A tree hydrated but some attributes of the server rendered HTML didn't match the
//       client properties」并拒绝修补（该 style 永久留在 <html> 上）。
// 判据（结论行 verdict，全部为 false/false/false/true/true 才算通过）：
//   rootInlineStyle          注入后 <html>/<body> 是否被写进了行内 style（必须 false）
//   attrsChangedVsSnapshot   根元素行内 style 是否偏离「服务端快照」（必须 false；
//                            真页无快照标记 → 与 null 比，即「本来没有、现在也没有」）
//   hydrationMismatch        控制台是否出现 hydration 报错（必须 false）
//   crosshairActive          开启态 computed cursor 是否为 crosshair（必须 true）
//   childCursorsPreserved    子元素 cursor:pointer/text 是否仍生效（必须 true）
//   退出后再看 afterCleanup：注入节点与 <style> 清零、光标恢复
// 用法: node hydration-probe.cjs [url] [inspectorPath] [domReady]
//       默认 url = http://localhost:3083/runs（Next.js 16 + React 19 真页，hydration 窗口真实）；
//       该地址不可用时自动回退到本地 hydration-page.html（含 html/body 光标声明与
//       「服务端序列化属性」快照，可离线判定注入前后有没有往 <html>/<body> 写行内样式）。
//       默认 inspectorPath = ../inspector.js；对比旧版可传旧副本落盘路径做 A/B。
//       domReady=1 时把注入推迟到 DOMContentLoaded：这是最贴近真实注入点的时机
//       （helper 在 domcontentloaded/load 上 rehook）——此时 <html> 已存在，而 Next 的
//       RSC/hydration 脚本是 async，尚未执行，所以注入仍发生在 hydration 之前。
//       注意 <html> 上的行内 style 被 CSS 规范定义为「文档根元素的声明块」，
//       documentElement.style.cursor 读的是声明值而非继承值，所以 htmlCursor 记的是
//       声明值（旧版这里会是 crosshair），bodyCursor 才是继承下来的实际值。
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const defaultUrl = 'http://localhost:3083/runs'
const fallbackUrl = 'file:///' + path.join(__dirname, 'hydration-page.html').replace(/\\/g, '/')

/** 目标地址是否可达（不可达就回退本地页，避免探针因外部服务未启动而失败）。 */
function reachable(target, timeoutMs) {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok) => { if (!done) { done = true; resolve(ok) } }
    const req = http.get(target, (res) => { res.resume(); finish(res.statusCode < 500) })
    req.setTimeout(timeoutMs, () => { req.destroy(); finish(false) })
    req.on('error', () => finish(false))
  })
}

let url = process.argv[2] || defaultUrl
const inspectorPath = process.argv[3] || path.join(__dirname, '..', 'inspector.js')
const domReady = process.argv[4] === '1'
const pwNode = path.join(os.tmpdir(), 'dsh-webpage-element-picker', 'pw-node', 'node_modules')
const inspectorCode = fs.readFileSync(inspectorPath, 'utf8')
const CHROME = 'C:\\Users\\Zlei1\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'

/** 注入体：domReady 时包一层 DOMContentLoaded 延迟（init script 阶段还没有 documentElement）。 */
const initCode = domReady
  ? '(function () { var src = ' + JSON.stringify(inspectorCode) + ';' +
    ' window.__dsh_we_probe_stages__ = ["wrapper:" + document.readyState + ":root=" + (document.documentElement ? "yes" : "no")];' +
    ' var run = function () { try { (0, eval)(src); window.__dsh_we_probe_stages__.push("inspector:ok") }' +
    ' catch (e) { window.__dsh_we_probe_stages__.push("inspector:throw:" + String((e && e.message) || e)) } };' +
    ' if (document.readyState === "loading") { window.__dsh_we_probe_stages__.push("wait-domcontentloaded"); document.addEventListener("DOMContentLoaded", run, { once: true }) }' +
    ' else { window.__dsh_we_probe_stages__.push("run-now"); run() } })()\n'
  : 'window.__dsh_we_probe_init__ = location.href\n' + inspectorCode

const { chromium } = require(path.join(pwNode, 'playwright-core'))

/** 页面侧取样：html/body 的行内 style + 计算光标 + 注入节点数量。 */
const SAMPLE = `(() => {
  const h = document.documentElement, b = document.body
  const btn = document.getElementById('btn'), txt = document.getElementById('txt')
  return {
    htmlStyleAttr: h.getAttribute('style'),
    bodyStyleAttr: b.getAttribute('style'),
    // 回退页的「服务端快照」标记（真页没有这两个属性 → null，不影响判定）
    serverHtmlStyle: b.getAttribute('data-server-html-style'),
    serverBodyStyle: b.getAttribute('data-server-body-style'),
    htmlCursor: getComputedStyle(h).cursor,
    bodyCursor: getComputedStyle(b).cursor,
    styleNodes: document.querySelectorAll('style[data-dsh-we]').length,
    ourNodes: document.querySelectorAll('[data-dsh-we]').length,
    active: typeof window.__dsh_we_active__ !== 'undefined',
    btnCursor: btn ? getComputedStyle(btn).cursor : null,
    txtCursor: txt ? getComputedStyle(txt).cursor : null
  }
})()`

;(async () => {
  if (!process.argv[2] && !(await reachable(defaultUrl, 2500))) {
    url = fallbackUrl
    console.error('[probe] ' + defaultUrl + ' 不可达，回退本地页 ' + fallbackUrl)
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-we-hydration-'))
  const observations = {}
  const consoleErrors = []
  const pageErrors = []
  let browser
  try {
    // 持久化上下文 + 独立 profile：不与用户正在使用的 Chrome profile 争抢
    const ctx = await chromium.launchPersistentContext(userDataDir, { executablePath: CHROME, headless: true })
    browser = ctx
    const page = ctx.pages()[0] || (await ctx.newPage())
    page.on('console', (m) => {
      const t = m.text()
      if (m.type() === 'error' || /hydrat/i.test(t)) consoleErrors.push(m.type() + ': ' + t.slice(0, 400))
    })
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)))

    // 关键：init script 在页面脚本之前执行 —— 等价于宿主页 hydration 之前完成注入
    await page.addInitScript({ content: initCode })
    await page.goto(url, { waitUntil: 'load', timeout: 45000 })
    await page.waitForTimeout(1200) // 给 hydration 留出执行并报错的窗口
    observations.afterLoad = await page.evaluate(SAMPLE)
    observations.afterLoad.initMarker = await page.evaluate('window.__dsh_we_probe_init__ || null')
    observations.afterLoad.stages = await page.evaluate('window.__dsh_we_probe_stages__ || null')
    observations.afterLoad.readyState = await page.evaluate('document.readyState')
    observations.afterLoad.href = await page.evaluate('location.href')
    observations.afterLoad.chipText = await page.evaluate(`(() => { const c = document.querySelector('[data-dsh-we="chip"]'); return c ? c.textContent : null })()`)

    // 选中一个真实节点（走 pointerdown 捕获路径），确认功能未被破坏
    const target = await page.evaluate(`(() => {
      const all = Array.prototype.slice.call(document.querySelectorAll('table th, table td, button, a, div'))
      for (const el of all) {
        const r = el.getBoundingClientRect()
        if (r.width > 8 && r.height > 8 && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth) {
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tag: el.tagName, cls: String(el.className).slice(0, 40) }
        }
      }
      return null
    })()`)
    observations.target = target
    if (target) {
      await page.mouse.move(target.x, target.y)
      await page.mouse.down()
      await page.mouse.up()
      await page.waitForTimeout(150)
      observations.afterSelect = await page.evaluate(SAMPLE)
      observations.selectedState = await page.evaluate('window.__dsh_we_test_state__()')
      // 取消 → 回悬停态
      await page.evaluate(`(() => {
        const bs = Array.prototype.slice.call(document.querySelectorAll('[data-dsh-we="ab"] button'))
        for (const b of bs) if (b.textContent === '取消') { b.click(); return true }
        return false
      })()`)
      await page.waitForTimeout(100)
    }

    // 暂停 / 恢复：光标必须跟着切
    await page.evaluate(`(() => {
      const c = document.querySelector('[data-dsh-we="chip"]')
      const r = c.getBoundingClientRect()
      c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: r.left + 5, clientY: r.top + 5 }))
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: r.left + 5, clientY: r.top + 5 }))
      return true
    })()`)
    await page.waitForTimeout(120)
    observations.afterPause = await page.evaluate(SAMPLE)
    await page.keyboard.press('`')
    await page.waitForTimeout(120)
    observations.afterResume = await page.evaluate(SAMPLE)

    // 退出选择模式：注入物应全部消失
    await page.evaluate('window.__dsh_we_cleanup__()')
    await page.waitForTimeout(120)
    observations.afterCleanup = await page.evaluate(SAMPLE)

    observations.consoleErrors = consoleErrors
    observations.pageErrors = pageErrors
    observations.inspectorPath = inspectorPath
    observations.url = url
  } catch (err) {
    observations.fatal = String((err && err.stack) || err)
  } finally {
    try { if (browser) await browser.close() } catch (e) {}
  }
  // 结论行：给人一眼看懂「根元素有没有被写过行内样式 / 有没有 hydration 失配」
  const h = observations.afterLoad || {}
  /** 回退页用 data-server-* 充当服务端快照；真页没有标记（取 null）→ 与当前属性同口径比较。 */
  const snapshot = (server, current) => {
    const expected = server === null || server === undefined ? null : (server === 'null' ? null : server)
    return expected !== current
  }
  const verdict = {
    rootInlineStyle: !!(h.htmlStyleAttr || h.bodyStyleAttr),
    attrsChangedVsSnapshot: snapshot(h.serverHtmlStyle, h.htmlStyleAttr) || snapshot(h.serverBodyStyle, h.bodyStyleAttr),
    hydrationMismatch: consoleErrors.some((e) => /hydrat/i.test(e)),
    crosshairActive: h.htmlCursor === 'crosshair' || h.bodyCursor === 'crosshair',
    childCursorsPreserved: (h.btnCursor === null && h.txtCursor === null) || (h.btnCursor === 'pointer' && h.txtCursor === 'text'),
    injectedNodes: h.ourNodes,
  }
  console.log(JSON.stringify({ url, inspectorPath, verdict, observations }, null, 2))
})()
