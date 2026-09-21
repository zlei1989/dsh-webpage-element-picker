'use strict'
// 探测系统已安装的 Chromium 系浏览器（优先级：Chrome > Edge > Chromium > Brave > Opera）
// 用法: node browser-probe.cjs <stateDir> [--list]
//   成功: stdout 输出一行 JSON { name, path, cached? }，exit 0
//   失败: stderr 输出原因，exit 1
// 候选来源按平台切换：win32 注册表 App Paths + 安装目录；darwin /Applications
// 与 ~/Applications 下的 .app；linux /usr/bin、/opt、/snap/bin（另加 PATH 兜底）。
// 绝不下载任何浏览器：只用 playwright-core 启动"已存在"的可执行文件做无头验证。
// 日志约定：stdout 只保留给协议行（单行 JSON 结果）；日志一律走 stderr
//           并带级别前缀。DEBUG 级默认关闭，DSH_WE_DEBUG=1 打开。
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const stateDirArg = process.argv[2]

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
 * 主流程：加载 playwright-core → 组装候选 → 缓存命中直接返回 →
 * 逐候选无头验证 → 首个可用者写入缓存并输出协议行。
 * 任一环节失败：stderr 输出原因并以 exit 1 终止（绝不下载浏览器）。
 */
async function main() {
  const stateDir = stateDirArg
  const listOnly = process.argv.includes('--list')
  let pw
  try {
    pw = require('playwright-core')
  } catch (err) {
    logError('playwright-core 运行时未安装（应先在 ' + path.join(stateDir || '', 'pw-node') + ' 完成安装）')
    process.exit(1)
  }

  const candidates = candidateList()
  if (listOnly) {
    for (const c of candidates) {
      process.stderr.write(c.name.padEnd(9) + ' | ' + (fs.existsSync(c.path) ? 'FOUND  ' : 'missing') + ' | ' + c.path + '\n')
    }
    process.exit(0)
  }
  logDebug('候选浏览器 ' + candidates.length + ' 个: ' + candidates.map((c) => c.path).join(' | '))

  // 缓存优先：上次探测成功且文件仍存在 → 直接返回（秒开，不再启动探测进程）
  const configFile = path.join(stateDir, 'browser-config.json')
  try {
    const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'))
    if (cfg && cfg.path && fs.existsSync(cfg.path)) {
      logInfo('缓存命中，跳过无头验证: ' + (cfg.name || 'Browser') + '（' + cfg.path + '）')
      console.log(JSON.stringify({ name: cfg.name || 'Browser', path: cfg.path, cached: true }))
      return
    }
  } catch (err) {
    logDebug('浏览器缓存不可用（首次或已损坏），重新探测')
  }

  const existing = candidates.filter((c) => fs.existsSync(c.path))
  if (existing.length === 0) {
    logError('未检测到任何已安装的浏览器。')
    logError('已检查: ' + (candidates.length ? candidates.map((c) => c.path).join(' | ') : '(无候选路径)'))
    logError('请安装 Chrome 或 Edge 后重试。本插件不会自动下载任何浏览器。')
    process.exit(1)
  }

  for (const c of existing) {
    const startedAt = Date.now()
    logInfo('验证 ' + c.name + ' … ' + c.path)
    const ok = await probeLaunch(pw, c.path)
    if (ok) {
      try {
        fs.writeFileSync(configFile, JSON.stringify({
          name: c.name, path: c.path, probedAt: new Date().toISOString(),
        }))
      } catch (err) {
        logWarn('浏览器缓存写入失败（下次启动需重新无头验证，可继续）')
      }
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
