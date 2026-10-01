'use strict'
// 探测系统已安装的 Chromium 系浏览器（优先级：Chrome > Edge > Chromium > Brave > Opera）
// 用法: node browser-probe.cjs [stateDir] [--list] [--prefer <exePath>]
//   默认（验证模式）:
//     成功: stdout 输出一行 JSON { name, path, cached? | preferred? }，exit 0
//     失败: stderr 输出原因，exit 1
//   --list（清单模式）: 只按存在性列出探测到的浏览器（不启动浏览器、不需要
//     playwright-core 已安装），stdout 输出一行 JSON 数组
//     [{ name, path, exists }]，exit 0——供插件 UI 的浏览器下拉菜单使用。
//   --prefer <exePath>: 用户在 UI 里显式选择的浏览器路径，优先无头验证它；
//     验证失败则回退自动探测（绝不下载任何浏览器）。
// stateDir 省略时用默认缓存目录（与 bootstrap.cjs 落盘位置一致）。
// 候选来源按平台切换：win32 注册表 App Paths + 安装目录；darwin /Applications
// 与 ~/Applications 下的 .app；linux /usr/bin、/opt、/snap/bin（另加 PATH 兜底）。
// 绝不下载任何浏览器：只用 playwright-core 启动"已存在"的可执行文件做无头验证。
// 日志约定：stdout 只保留给协议行（单行 JSON 结果）；日志一律走 stderr
//           并带级别前缀。DEBUG 级默认关闭，DSH_WE_DEBUG=1 打开。
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

// ---- 参数解析：[stateDir] [--list] [--prefer <path>] 任意顺序 ----
const args = process.argv.slice(2)
const listOnly = args.includes('--list')
const preferAt = args.indexOf('--prefer')
const preferPath = preferAt >= 0 ? String(args[preferAt + 1] || '').trim() : ''
/** --prefer 的取值也是裸参数，取第一个裸参数作 stateDir 时必须跳过它。 */
const preferValueAt = preferAt >= 0 ? preferAt + 1 : -1
const stateDir = args.filter((a, i) => !a.startsWith('--') && i !== preferValueAt)[0]
  || path.join(os.tmpdir(), 'dsh-webpage-element-picker')

const DEBUG = process.env.DSH_WE_DEBUG === '1'
/** DEBUG：分支走向、候选清单等中间变量（生产默认关闭）。 */
function logDebug(msg) { if (DEBUG) process.stderr.write('probe: [DEBUG] ' + msg + '\n') }
/** INFO：关键状态变更、外部调用（无头验证）耗时。 */
function logInfo(msg) { process.stderr.write('probe: [INFO] ' + msg + '\n') }
/** WARN：单个候选验证失败等可继续的降级。 */
function logWarn(msg) { process.stderr.write('probe: [WARN] ' + msg + '\n') }
/** ERROR：业务异常——整体探测失败的原因与上下文。 */
function logError(msg) { process.stderr.write('probe: [ERROR] ' + msg + '\n') }

// ---- 注册表 App Paths 查询（只读 reg.exe query，仅 Windows）----
/**
 * 从注册表 App Paths 读浏览器可执行文件路径（只在 win32 调用）。
 * 依次查 HKLM 64 位与 WOW6432Node 视图；键不存在时 reg.exe 报错属预期
 * 噪音（stdio 忽略 stderr），失败返回 null 继续走候选目录。
 */
function readAppPath(exe) {
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\' + exe,
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\' + exe,
  ]
  for (const key of keys) {
    try {
      const out = cp.execFileSync('reg.exe', ['query', key, '/ve'], {
        encoding: 'utf8', windowsHide: true, timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'], // 键不存在时 reg.exe 的报错是预期噪音
      })
      const m = out.match(/REG_SZ\s+(\S.*)$/m)
      if (m && m[1]) return m[1].trim()
    } catch (err) {
      logDebug('注册表查询未命中: ' + key)
    }
  }
  return null
}

// ---- 候选浏览器清单（按平台：注册表 / 标准安装目录 / PATH，去重）----
/**
 * 各平台的浏览器定义（优先级 Chrome > Edge > Chromium > Brave > Opera）：
 *   - win32：注册表 App Paths 键名 + ProgramFiles/ProgramFiles(x86)/LOCALAPPDATA
 *   - darwin：/Applications 与 ~/Applications 下的 .app 包内可执行文件
 *   - linux 及其他 POSIX：发行版惯例路径（/usr/bin、/opt、/snap/bin）
 * 非 Windows 另加 PATH 扫描兜底（Homebrew/Nix 等非标准前缀）。
 * 目标平台未安装任何候选浏览器时由调用方报错，绝不下载浏览器。
 */
function browserDefs(platform, env, home) {
  if (platform === 'win32') {
    const pf = env.ProgramFiles || 'C:\\Program Files'
    const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const la = env.LOCALAPPDATA || ''
    return [
      { name: 'Chrome', exe: 'chrome.exe', paths: [
        pf + '\\Google\\Chrome\\Application\\chrome.exe',
        pf86 + '\\Google\\Chrome\\Application\\chrome.exe',
        la + '\\Google\\Chrome\\Application\\chrome.exe',
      ] },
      { name: 'Edge', exe: 'msedge.exe', paths: [
        pf86 + '\\Microsoft\\Edge\\Application\\msedge.exe',
        pf + '\\Microsoft\\Edge\\Application\\msedge.exe',
      ] },
      { name: 'Chromium', exe: 'chromium.exe', paths: [
        la + '\\Chromium\\Application\\chrome.exe',
        pf + '\\Chromium\\Application\\chrome.exe',
      ] },
      { name: 'Brave', exe: 'brave.exe', paths: [
        pf + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        pf86 + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        la + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      ] },
      { name: 'Opera', exe: 'opera.exe', paths: [
        la + '\\Programs\\Opera\\opera.exe',
        pf + '\\Opera\\opera.exe',
      ] },
    ]
  }

  if (platform === 'darwin') {
    // macOS 的浏览器一律是 .app 包：可执行文件在 Contents/MacOS/ 下
    const macApp = (rel) => ['/Applications/' + rel]
      .concat(home ? [path.join(home, 'Applications', rel)] : [])
    return [
      { name: 'Chrome', cmds: ['google-chrome', 'chrome'], paths: macApp('Google Chrome.app/Contents/MacOS/Google Chrome') },
      { name: 'Edge', cmds: ['microsoft-edge', 'msedge'], paths: macApp('Microsoft Edge.app/Contents/MacOS/Microsoft Edge') },
      { name: 'Chromium', cmds: ['chromium', 'chromium-browser'], paths: macApp('Chromium.app/Contents/MacOS/Chromium') },
      { name: 'Brave', cmds: ['brave-browser', 'brave'], paths: macApp('Brave Browser.app/Contents/MacOS/Brave Browser') },
      { name: 'Opera', cmds: ['opera'], paths: macApp('Opera.app/Contents/MacOS/Opera') },
    ]
  }

  // linux（及其他 POSIX）：发行版常见的包安装位置 + snap
  return [
    { name: 'Chrome', cmds: ['google-chrome', 'google-chrome-stable', 'chrome'], paths: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/opt/google/chrome/chrome',
    ] },
    { name: 'Edge', cmds: ['microsoft-edge', 'microsoft-edge-stable', 'msedge'], paths: [
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/opt/microsoft/msedge/microsoft-edge',
    ] },
    { name: 'Chromium', cmds: ['chromium', 'chromium-browser'], paths: [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/lib/chromium/chromium',
      '/snap/bin/chromium',
    ] },
    { name: 'Brave', cmds: ['brave-browser', 'brave'], paths: [
      '/usr/bin/brave-browser',
      '/usr/bin/brave',
      '/opt/brave.com/brave/brave-browser',
      '/snap/bin/brave',
    ] },
    { name: 'Opera', cmds: ['opera'], paths: [
      '/usr/bin/opera',
      '/usr/lib/x86_64-linux-gnu/opera/opera',
      '/snap/bin/opera',
    ] },
  ]
}

/**
 * 在 PATH 中查找命令名对应的可执行文件（非 Windows 兜底）：
 * 覆盖 Homebrew、Nix、自定义 prefix 等不在标准目录的安装。
 */
function lookupInPath(cmds, env) {
  const dirs = String(env.PATH || '').split(path.delimiter).filter(Boolean)
  const out = []
  for (const cmd of cmds || []) {
    for (const dir of dirs) {
      const p = path.join(dir, cmd)
      try {
        if (fs.existsSync(p)) out.push(p)
      } catch (err) {
        // 单个 PATH 项不可读：忽略继续
      }
    }
  }
  return out
}

/**
 * 组装候选清单：平台标准安装目录 + Windows 注册表 App Paths + PATH 兜底，
 * 按浏览器优先级排列、按平台规则去重（Windows 大小写不敏感）。
 * 测试钩子：DSH_WE_BROWSER_HINTS="路径1;路径2" 直接指定候选（跳过默认探测）。
 * 可注入项（platform/env/home/readAppPath）便于在任意平台校验各平台清单。
 */
function candidateList(opts) {
  const platform = (opts && opts.platform) || process.platform
  const env = (opts && opts.env) || process.env
  const home = opts && 'home' in opts ? opts.home : os.homedir()
  const queryAppPath = (opts && opts.readAppPath) || readAppPath

  // 测试钩子：DSH_WE_BROWSER_HINTS="路径1;路径2" 直接指定候选（跳过默认探测）
  const hints = env.DSH_WE_BROWSER_HINTS
  if (hints) {
    return hints.split(';').map((s) => s.trim()).filter(Boolean).map((p) => ({
      name: path.basename(p, path.extname(p)), path: p,
    }))
  }

  const defs = browserDefs(platform, env, home)
  const out = []
  const seen = new Set()
  const keyOf = (p) => (platform === 'win32' ? p.toLowerCase() : p)
  const add = (name, p) => {
    if (!p) return
    const k = keyOf(p)
    if (seen.has(k)) return
    seen.add(k)
    out.push({ name: name, path: p })
  }
  for (const def of defs) {
    // 注册表只在 Windows 查询：POSIX 上没有 reg.exe
    if (platform === 'win32' && def.exe) add(def.name, queryAppPath(def.exe))
    for (const p of def.paths || []) add(def.name, p)
    if (platform !== 'win32') {
      for (const p of lookupInPath(def.cmds, env)) add(def.name, p)
    }
  }
  return out
}

// ---- 按浏览器名归并候选（清单模式与首选验证共用）----
/**
 * 把候选清单按浏览器名归并成「每浏览器一条」：同名候选里优先取第一个存在的
 * 路径（不存在则退回第一条候选路径并标记 exists=false）。
 * 供 UI 下拉菜单展示（一个浏览器一行）与 --prefer 的路径→名称反查使用。
 */
function groupedCandidates() {
  const groups = []
  const byName = new Map()
  for (const c of candidateList()) {
    let g = byName.get(c.name)
    if (!g) {
      g = { name: c.name, paths: [] }
      byName.set(c.name, g)
      groups.push(g)
    }
    if (!g.paths.includes(c.path)) g.paths.push(c.path)
  }
  return groups.map((g) => {
    const found = g.paths.filter((p) => fs.existsSync(p))[0]
    return { name: g.name, path: found || g.paths[0], exists: !!found }
  })
}

/** 由可执行文件路径反查浏览器名（命中候选清单则用清单里的规范名，否则退回文件名）。 */
function nameForPath(exePath) {
  const target = String(exePath).toLowerCase()
  const hit = groupedCandidates().filter((c) => c.path.toLowerCase() === target)[0]
  return hit ? hit.name : (path.basename(exePath, path.extname(exePath)) || 'Browser')
}

/** Windows 路径比较（大小写不敏感）。 */
function samePath(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase()
}

// ---- 探测缓存（browser-config.json）：auto / preferred 两槽互不污染 ----
const configFile = path.join(stateDir, 'browser-config.json')

/**
 * 读缓存并归一化为 { auto?, preferred? } 两槽。
 * 兼容旧格式（顶层 { name, path } 单槽）——按自动探测槽处理，避免升级后重复验证。
 */
function readCache() {
  let raw = null
  try {
    raw = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  } catch (err) {
    logDebug('浏览器缓存不可用（首次或已损坏），重新探测')
    return {}
  }
  if (!raw || typeof raw !== 'object') return {}
  const cache = {}
  if (raw.auto && raw.auto.path) cache.auto = raw.auto
  else if (raw.path) cache.auto = { name: raw.name, path: raw.path, probedAt: raw.probedAt }
  if (raw.preferred && raw.preferred.path) cache.preferred = raw.preferred
  return cache
}

/**
 * 写入一个缓存槽（保留另一槽）：用户显式选择写 preferred，自动探测写 auto——
 * 显式选择不会顶掉自动探测结果，用户改回「自动」时仍按系统优先级探测。
 */
function writeCache(patch) {
  const next = Object.assign(readCache(), patch)
  try {
    fs.writeFileSync(configFile, JSON.stringify(next))
  } catch (err) {
    logWarn('浏览器缓存写入失败（下次启动需重新无头验证，可继续）')
  }
}

// ---- 无头启动验证（10s 超时）----
/**
 * 用 playwright-core 无头拉起候选浏览器做活体验证：开页面 →
 * data: URL 导航 → evaluate 求值，全通过才算可用（10s 超时兜底）。
 * 验证用的临时 user-data-dir 在 finally 中清理，不残留。
 */
function probeLaunch(pw, exe) {
  return new Promise((resolve) => {
    let ctxRef = null
    let udd = ''
    const timer = setTimeout(() => {
      logDebug('无头验证超时（10s）: ' + exe)
      resolve(false)
      try { if (ctxRef) ctxRef.close().catch(() => {}) } catch (err) {}
    }, 10000)
    ;(async () => {
      try {
        udd = path.join(os.tmpdir(), 'dsh-we-probe-' + process.pid + '-' + Date.now())
        const ctx = await pw.chromium.launchPersistentContext(udd, {
          executablePath: exe,
          headless: true,
        })
        ctxRef = ctx
        const page = ctx.pages()[0] || await ctx.newPage()
        await page.goto('data:text/html,<title>dsh-we-probe</title>', { timeout: 8000 })
        await page.evaluate('1+1')
        await ctx.close()
        clearTimeout(timer)
        resolve(true)
      } catch (err) {
        clearTimeout(timer)
        try { if (ctxRef) await ctxRef.close().catch(() => {}) } catch (e) {}
        logDebug('无头验证失败: ' + exe + ' · ' + String((err && err.message) || err))
        resolve(false)
      } finally {
        try { fs.rmSync(udd, { recursive: true, force: true }) } catch (e) {}
      }
    })()
  })
}

// ---- 主流程 ----
/**
 * 主流程：
 *   1) 清单模式（--list）：只做存在性检查后输出 JSON 数组并退出（不需要 playwright-core）。
 *   2) 用户显式指定（--prefer）：缓存同路径秒回；否则无头验证它，通过则写 preferred 槽；
 *      失败只降级（WARN）继续走自动探测。
 *   3) 自动探测：auto 槽缓存命中直接返回，否则逐候选无头验证，首个可用者写入 auto 槽。
 * 任一环节失败：stderr 输出原因并以 exit 1 终止（绝不下载浏览器）。
 */
async function main() {
  if (listOnly) {
    const found = groupedCandidates()
    for (const c of found) {
      process.stderr.write(c.name.padEnd(9) + ' | ' + (c.exists ? 'FOUND  ' : 'missing') + ' | ' + c.path + '\n')
    }
    console.log(JSON.stringify(found))
    return
  }

  let pw
  try {
    pw = require('playwright-core')
  } catch (err) {
    logError('playwright-core 运行时未安装（应先在 ' + path.join(stateDir || '', 'pw-node') + ' 完成安装）')
    process.exit(1)
  }

  const cache = readCache()

  // ---- 用户显式选择的浏览器优先 ----
  if (preferPath) {
    if (cache.preferred && samePath(cache.preferred.path, preferPath) && fs.existsSync(cache.preferred.path)) {
      logInfo('缓存命中（用户指定），跳过无头验证: ' + (cache.preferred.name || 'Browser') + '（' + cache.preferred.path + '）')
      console.log(JSON.stringify({ name: cache.preferred.name || 'Browser', path: cache.preferred.path, cached: true, preferred: true }))
      return
    }
    if (!fs.existsSync(preferPath)) {
      logWarn('用户指定的浏览器已不存在，回退自动探测: ' + preferPath)
    } else {
      const name = nameForPath(preferPath)
      const startedAt = Date.now()
      logInfo('验证用户指定浏览器 ' + name + ' … ' + preferPath)
      if (await probeLaunch(pw, preferPath)) {
        writeCache({ preferred: { name: name, path: preferPath, probedAt: new Date().toISOString() } })
        logInfo(name + ' 无头验证通过（用户指定，耗时 ' + (Date.now() - startedAt) + 'ms）')
        console.log(JSON.stringify({ name: name, path: preferPath, preferred: true }))
        return
      }
      logWarn('用户指定的浏览器无法启动，回退自动探测: ' + preferPath)
    }
  }

  // ---- 自动探测：缓存优先 ----
  if (cache.auto && fs.existsSync(cache.auto.path)) {
    logInfo('缓存命中，跳过无头验证: ' + (cache.auto.name || 'Browser') + '（' + cache.auto.path + '）')
    console.log(JSON.stringify({ name: cache.auto.name || 'Browser', path: cache.auto.path, cached: true }))
    return
  }

  const existing = groupedCandidates().filter((c) => c.exists)
  if (existing.length === 0) {
    const all = groupedCandidates()
    logError('未检测到任何已安装的浏览器。')
    logError('已检查: ' + (all.length ? all.map((c) => c.path).join(' | ') : '(无候选路径)'))
    logError('请安装 Chrome 或 Edge 后重试。本插件不会自动下载任何浏览器。')
    process.exit(1)
  }

  for (const c of existing) {
    const startedAt = Date.now()
    logInfo('验证 ' + c.name + ' … ' + c.path)
    const ok = await probeLaunch(pw, c.path)
    if (ok) {
      writeCache({ auto: { name: c.name, path: c.path, probedAt: new Date().toISOString() } })
      logInfo(c.name + ' 无头验证通过（耗时 ' + (Date.now() - startedAt) + 'ms）')
      console.log(JSON.stringify({ name: c.name, path: c.path }))
      return
    }
    logWarn(c.name + ' 无法启动，尝试下一个…')
  }
  logError('所有检测到的浏览器都无法启动。已尝试: ' + existing.map((c) => c.path).join(' | '))
  process.exit(1)
}

// 作为脚本运行时才执行主流程；被 require 时只暴露候选表等内部函数，
// 便于测试脚本在任意平台校验 win32/darwin/linux 三张候选清单。
if (require.main === module) {
  main().catch((err) => {
    logError(String((err && err.stack) || (err && err.message) || err))
    process.exit(1)
  })
}

module.exports = { candidateList, browserDefs, lookupInPath, readAppPath, probeLaunch }
