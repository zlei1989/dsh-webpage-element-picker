'use strict'
// 环境兼容性自检（跨平台；不联网、不启动浏览器、不安装依赖）
//
// 覆盖两处历史平台缺陷：
//  1) host 半边解析 npm 脚本入口（npm-cli.js）——旧实现把路径硬编码成
//     <nodeDir>/node_modules/npm/bin/npm-cli.js，在 macOS/Linux（nvm/Homebrew/
//     官方 pkg 均为 <prefix>/lib/node_modules/...）必然失败，报「未找到 npm
//     的脚本入口」。本脚本用假 harness 服务加载真实构建产物 lib/index.js，
//     走完 /invoke → ensureHelper 链路，断言解析出的入口真实存在且
//     `node <入口> --version` 能打印 npm 版本。
//  2) browser-probe.cjs 的浏览器候选清单——旧实现只有 Windows 路径；
//     本脚本既跑当前平台的真实 --list，也直接校验 win32/darwin/linux
//     三张候选表（Windows 行为回归 + macOS/Linux 新增覆盖）。
//
// 用法: node resources/test/check-env.cjs   （需先 pnpm build）
// 退出码: 0 全部通过；1 有失败（逐条打印 FAIL 与原因）
const assert = require('assert')
const cp = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')

const root = path.join(__dirname, '..', '..')
const failures = []
const notes = []

/** 记录一条通过信息。 */
function pass(msg) { console.log('[PASS] ' + msg) }
/** 记录一条失败信息（不中断，跑完全部检查再汇总）。 */
function fail(msg, err) {
  failures.push(msg + (err ? ' · ' + String((err && err.message) || err) : ''))
  console.log('[FAIL] ' + msg + (err ? ' · ' + String((err && err.message) || err) : ''))
}
/** 记录一条说明性信息（不参与判定）。 */
function info(msg) { notes.push(msg); console.log('[INFO] ' + msg) }

// ---- 假 harness 服务：只实现插件消费的接口表面，行为尽量贴近真实实现 ----

/**
 * 按真实 subprocess-local 的语义解析可执行文件：
 * 绝对路径 → stat + X_OK；裸名 → 扫 PATH（win32 追加 PATHEXT）。
 */
function resolveExecutableLike(command) {
  const candidates = []
  if (path.isAbsolute(command)) {
    candidates.push(command)
  } else {
    const exts = process.platform === 'win32' && !path.extname(command)
      ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
      : ['']
    for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
      if (!dir) continue
      for (const ext of exts) candidates.push(path.join(dir, command + ext))
    }
  }
  for (const c of candidates) {
    try {
      const st = fs.statSync(c)
      if (!st.isFile()) continue
      fs.accessSync(c, fs.constants.X_OK)
      return Promise.resolve(c)
    } catch (err) {
      // 试下一个候选
    }
  }
  return Promise.reject(new Error('subprocess-local: command ' + JSON.stringify(command) + ' was not found on PATH'))
}

/**
 * 组装假 ctx：services + effect。spawn 分流——bootstrap.cjs 由桩子接管
 * （避免真正安装 playwright-core），其余（如家目录探测）走真实子进程。
 */
function makeFakeCtx(state) {
  const routes = new Map()
  const fake = {
    subprocess: {
      resolveExecutable: resolveExecutableLike,
      spawn(spec) {
        if (String(spec.argv[1] || '').endsWith('bootstrap.cjs')) return stubBootstrap(spec, state, routes)
        const child = cp.spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd })
        return {
          stdin: { write: (c) => child.stdin.write(c), end: () => child.stdin.end() },
          stdout: child.stdout,
          done: new Promise((resolve) => { child.on('exit', (code) => resolve({ exitCode: code })) }),
          terminate: () => { try { child.kill() } catch (err) {} },
        }
      },
    },
    webServer: {
      port: 3080,
      register(route) { routes.set(route.path, route); return () => routes.delete(route.path) },
    },
    sandboxPolicy: { workspaceRoot: root },
    fs: {
      resolve: (p) => Promise.resolve(path.resolve(p)),
      stat: (p) => { try { return Promise.resolve(fs.statSync(p)) } catch (err) { return Promise.resolve(null) } },
      readText: (p) => Promise.resolve(fs.readFileSync(p, 'utf8')),
    },
    tools: { register: () => () => {} },
    systemPrompt: { context: () => () => {} },
    timer: { timeout: (cb, ms) => { const t = setTimeout(cb, ms); return () => clearTimeout(t) } },
  }
  const ctx = {
    get: (name) => fake[name],
    effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d() } },
  }
  return { ctx, routes }
}

/**
 * bootstrap.cjs 的桩子：按行协议回 READY → 收下 host 的 payload →
 * 扮演 helper 经 host 自己的 /poll + /events 路由取命令并回执。
 */
function stubBootstrap(spec, state, routes) {
  state.bootstrapSpec = spec
  state.payload = ''
  const stdoutQueue = ['READY\n']
  const handle = {
    stdin: {
      write(chunk) { state.payload += String(chunk) },
      end() {},
    },
    // 只吐 READY 后结束：host 的 readStdout 拿到握手即完成载荷回写
    stdout: (async function* () { while (stdoutQueue.length) yield stdoutQueue.shift() })(),
    done: new Promise(() => {}),
    collected: { stderr: { readFrom: () => ({ text: '' }) } },
    terminate() {},
  }
  // 扮演 helper：取 open 命令 → 回 reply（与真实 helper 的事件形状一致）
  setTimeout(async () => {
    try {
      const cmd = await callRoute(routes, '/dsh-webpage-element-picker/poll', null)
      if (!cmd || cmd === 'null') return
      const parsed = JSON.parse(cmd)
      await postEvent(routes, { type: 'helper-ready' })
      await postEvent(routes, { type: 'reply', id: parsed.id, ok: true, status: { state: 'open', url: (parsed.params || {}).url } })
    } catch (err) {
      state.stubError = String((err && err.stack) || err)
    }
  }, 50)
  return handle
}

/** 直接驱动 host 注册的某条路由，返回响应体文本。 */
function callRoute(routes, routePath, bodyObj) {
  const route = routes.get(routePath)
  if (!route) return Promise.reject(new Error('路由未注册: ' + routePath))
  return new Promise((resolve, reject) => {
    const listeners = {}
    const req = {
      on: (ev, cb) => { listeners[ev] = cb; return req },
      url: routePath,
    }
    const res = {
      writeHead: () => {},
      end: (body) => resolve(body === undefined ? '' : String(body)),
    }
    try {
      route.handler(req, res)
      if (bodyObj !== null && bodyObj !== undefined) {
        const raw = JSON.stringify(bodyObj)
        if (listeners.data) listeners.data(raw)
        if (listeners.end) listeners.end()
      }
    } catch (err) {
      reject(err)
    }
  })
}

/** 向 host 的 /events 路由投递一个 helper 事件。 */
function postEvent(routes, event) { return callRoute(routes, '/dsh-webpage-element-picker/events', { event }) }

// ---- 检查 1：host 解析 npm 脚本入口 ----

/**
 * 走真实构建产物：apply(fakeCtx) → /invoke picker-navigate → ensureHelper。
 * 断言的失败信息即用户看到的 UI 报错文本（未找到 npm 的脚本入口…）。
 */
async function checkHostLauncher() {
  let mod
  try {
    mod = await import(pathToFileURL(path.join(root, 'lib', 'index.js')).href)
  } catch (err) {
    fail('加载 lib/index.js 失败（先执行 pnpm build）', err)
    return
  }
  if (typeof mod.apply !== 'function') {
    fail('lib/index.js 未导出 apply（构建产物不符）')
    return
  }
  const state = {}
  const { ctx, routes } = makeFakeCtx(state)
  try {
    mod.apply(ctx)
  } catch (err) {
    fail('apply(ctx) 抛错', err)
    return
  }
  if (routes.size === 0) {
    fail('HTTP 路由未注册（apply 未生效）')
    return
  }

  let body
  try {
    body = await callRoute(routes, '/dsh-webpage-element-picker/invoke', { method: 'picker-navigate', params: { url: 'https://example.com/' } })
  } catch (err) {
    fail('调用 picker-navigate 失败', err)
    return
  }
  const result = JSON.parse(body || '{}')
  if (!result.ok) {
    // 这里就是用户报错的复现点
    fail('picker-navigate 返回失败（host 未能启动 helper）: ' + String(result.error || ''))
    return
  }
  if (state.stubError) info('桩子 helper 事件回执异常: ' + state.stubError)

  const spec = state.bootstrapSpec || {}
  const argv = spec.argv || []
  const launcher = String(argv[2] || '')
  const nodePath = String(argv[0] || '')
  if (!launcher) {
    fail('bootstrap argv[2] 缺少 npm 脚本入口')
    return
  }
  if (!fs.existsSync(launcher)) {
    fail('解析出的 npm 脚本入口不存在: ' + launcher)
    return
  }
  pass('npm 脚本入口解析成功: ' + launcher)

  // 最强证据：用同一个 node 跑该入口，应打印 npm 版本号
  try {
    const out = cp.execFileSync(nodePath || process.execPath, [launcher, '--version'], { encoding: 'utf8', timeout: 60000 })
    const version = String(out).trim().split('\n').pop().trim()
    assert.match(version, /^\d+\.\d+\.\d+/, 'npm --version 输出非版本号: ' + version)
    pass('node ' + path.basename(launcher) + ' --version → ' + version)
  } catch (err) {
    fail('解析出的 npm 入口无法运行（node <入口> --version 失败）', err)
  }

  // 载荷协议未受影响：stdin 应收到 helper + inspector 源码
  if (!state.payload || !state.payload.includes('<<<DSH_SPLIT>>>') || !state.payload.includes('<<<DSH_END>>>')) {
    fail('READY 握手后未按协议回写资源载荷（helper/inspector 源码）')
  } else {
    pass('READY 握手与资源载荷回写正常（' + state.payload.length + ' 字符）')
  }
}

// ---- 检查 2：browser-probe 浏览器候选清单 ----

/** 用桩 playwright-core 跑真实 --list，返回 [{ name, found, path }]。 */
function probeList() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-we-check-'))
  const pwDir = path.join(stateDir, 'pw-node', 'node_modules', 'playwright-core')
  fs.mkdirSync(pwDir, { recursive: true })
  fs.writeFileSync(path.join(pwDir, 'package.json'), JSON.stringify({ name: 'playwright-core', version: '0.0.0-stub', main: 'index.js' }))
  fs.writeFileSync(path.join(pwDir, 'index.js'), 'module.exports = { chromium: {} }\n')
  try {
    // --list 的清单走 stderr（stdout 只留给单行 JSON 协议），与日志同一约定
    const res = cp.spawnSync(process.execPath, [path.join(root, 'resources', 'browser-probe.cjs'), stateDir, '--list'], {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { NODE_PATH: path.join(stateDir, 'pw-node', 'node_modules') }),
      timeout: 60000,
    })
    const err = String(res.stderr || '')
    if (res.status !== 0 && err.includes('[ERROR]')) throw new Error(err.trim().split('\n').pop())
    return err.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const parts = line.split('|').map((s) => s.trim())
      return { name: parts[0] || '', found: parts[1] === 'FOUND', path: parts[2] || '' }
    }).filter((c) => c.name && (c.found || c.path) && !c.name.startsWith('probe:'))
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true })
  }
}

/** 校验当前平台的候选清单包含该平台的标准安装位置。 */
function checkCurrentPlatformCandidates(list) {
  const expected = {
    darwin: (p) => p.startsWith('/Applications/') || p.includes('.app/Contents/MacOS/'),
    linux: (p) => p.startsWith('/usr/bin/') || p.startsWith('/opt/') || p.startsWith('/snap/bin/'),
    win32: (p) => /\.exe$/i.test(p) && /Chrome|Edge|Chromium|Brave|Opera/i.test(p),
  }[process.platform]
  if (!expected) {
    info('未覆盖的平台 ' + process.platform + '：仅打印候选清单')
    return
  }
  if (list.length === 0) {
    fail('browser-probe 在当前平台（' + process.platform + '）没有任何候选路径')
    return
  }
  const hit = list.filter((c) => expected(c.path))
  if (hit.length === 0) {
    fail('browser-probe 候选清单缺少 ' + process.platform + ' 标准安装位置（例如 macOS 的 /Applications/*.app/Contents/MacOS/*）')
    return
  }
  pass('当前平台（' + process.platform + '）候选 ' + list.length + ' 条，其中标准安装位置 ' + hit.length + ' 条')
  for (const c of list) info('候选: ' + c.name.padEnd(9) + ' ' + (c.found ? 'FOUND  ' : 'missing') + ' ' + c.path)

  // 已安装的浏览器必须被识别为 FOUND（路径表打错即暴露）
  const installed = list.filter((c) => fs.existsSync(c.path))
  if (installed.length === 0) {
    info('本机未安装候选列表中的浏览器，跳过 FOUND 断言（插件会提示用户安装）')
  } else {
    for (const c of installed) {
      if (c.found) pass('已安装浏览器识别正确: ' + c.name + '（' + c.path + '）')
      else fail('已安装浏览器未被标记 FOUND: ' + c.path)
    }
  }
}

/** 直接校验三张平台候选表（含无法在本机运行的 win32/linux）。 */
function checkAllPlatformTables() {
  let probe
  try {
    probe = require(path.join(root, 'resources', 'browser-probe.cjs'))
  } catch (err) {
    fail('browser-probe.cjs 无法作为模块加载（缺少跨平台候选表导出）', err)
    return
  }
  if (typeof probe.candidateList !== 'function') {
    fail('browser-probe.cjs 未导出 candidateList（无法校验 win32/darwin/linux 候选表）')
    return
  }
  const cases = [
    { platform: 'win32', expect: (list) => list.some((c) => /chrome\.exe$/i.test(c.path)) && list.some((c) => /msedge\.exe$/i.test(c.path)) },
    { platform: 'darwin', expect: (list) => list.some((c) => c.path === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') && list.some((c) => c.path === '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge') },
    { platform: 'linux', expect: (list) => list.some((c) => c.path === '/usr/bin/google-chrome' || c.path === '/usr/bin/google-chrome-stable') && list.some((c) => c.path === '/usr/bin/chromium' || c.path === '/usr/bin/chromium-browser') },
  ]
  for (const c of cases) {
    try {
      const list = probe.candidateList({ platform: c.platform, env: {}, home: '/home/tester' })
      assert.ok(Array.isArray(list) && list.length > 0, c.platform + ' 候选清单为空')
      assert.ok(c.expect(list), c.platform + ' 候选清单缺少标准浏览器路径')
      pass(c.platform + ' 候选表校验通过（' + list.length + ' 条）')
    } catch (err) {
      fail(c.platform + ' 候选表校验失败', err)
    }
  }
  // Windows 才允许调用注册表（POSIX 上不得尝试 reg.exe）
  try {
    const calls = []
    const list = probe.candidateList({ platform: 'darwin', env: {}, home: '/Users/tester', readAppPath: (exe) => { calls.push(exe); return null } })
    assert.strictEqual(calls.length, 0, 'darwin 上不应查询 Windows 注册表')
    assert.ok(list.length > 0)
    pass('darwin 不触碰 Windows 注册表')
  } catch (err) {
    fail('平台分支校验失败（darwin 不应查询注册表）', err)
  }
}

// ---- 主流程 ----
;(async () => {
  console.log('== 检查 1/2：host 解析 npm 脚本入口（node ' + process.version + '，' + process.platform + '）==')
  await checkHostLauncher()
  console.log('\n== 检查 2/2：browser-probe 浏览器候选清单 ==')
  try {
    checkCurrentPlatformCandidates(probeList())
  } catch (err) {
    fail('运行 browser-probe --list 失败', err)
  }
  checkAllPlatformTables()

  console.log('\n== 汇总 ==')
  if (failures.length === 0) {
    console.log('[OK] 全部检查通过（' + notes.length + ' 条说明）')
    process.exit(0)
  }
  console.log('[NG] ' + failures.length + ' 项失败:')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
})().catch((err) => {
  console.error('[NG] 自检脚本自身异常: ' + String((err && err.stack) || err))
  process.exit(1)
})
