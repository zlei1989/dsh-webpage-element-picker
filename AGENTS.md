# AGENTS.md

用中文交流。

## 约束

- **代码变更后、进入审查阶段前，必须先执行类型检查** — `pnpm typecheck`（即 `tsc --noEmit`），修复所有错误后再进入代码审查；本仓库无 ESLint/formatter 配置
- **host 半（`src/host/`）禁止引入 npm 运行时依赖** — 只能导入 node 内置模块与 `@deepseek-ai/cordis` 类型，其余全部内联打包；client 半（`src/client/`）运行时只允许两个外部依赖：`react`（经 `src/client/react.ts` 单点引入）与 `@deepseek-ai/dsh-client-ui-primitives`（经 `src/client/primitives.ts` 单点引入）。两者都由 harness 浏览器模块表提供，必须在 `package.json` 的 `dsh.client.external` 声明并同步到 `tsup.config.ts` 的 client `external`
- **client 样式只用 `--dsw-*` 语义令牌** — 插件自有 CSS 内联在 `src/client/index.ts` 的 `STYLE_CSS` 字符串里（无 CSS 构建步骤），颜色一律取令牌；不写颜色字面量、不做 `data-ds-dark-theme` 主题分支（浅/深色由 harness 切 `body` 属性 + 令牌自动生效）
- **别和原语 Modal 的内边距叠加** — 原语 `.body` 自带 24px 左右内边距（降级卡片没有），所以自有区块在 `.dsh-we-dialogPrimitive` 下把自己的左右内边距清零，否则左右 48px、底边只有卡片的 24px，四周留白失衡（"底部边缘太窄"就是这么来的）；卡片底边 24px 由原语 `padding: 0 0 24px` 提供，底部栏不再叠 `margin-top`（`.dsh-we-panelBody` 的 20px gap 已给出与正文的间距）
- **浏览器视口必须等于窗口真实渲染区** — 不许给 `launchPersistentContext` 设 `viewport`。Playwright 的 viewport 是**设备度量覆盖**：窗口装不下也照报。实测本机工作区 1440x852，请求 1200x820 时窗口要 820+约 91px 浏览器 chrome ≈ 911px，窗口挂到屏幕外，真实渲染区只有 1195x747，而页面仍按 1200x820 排版——底部 73px 画在屏幕外。inspector 只信 `window.innerHeight`（见 `positionAb`），于是把操作栏放进那条看不见的带里 =「卡片溢出屏幕、看不到也点不到」。所以 helper 用 `viewport: null` + `--start-maximized`；改回固定 viewport 就会复发。回归探针见下面「测试」段
- **chip（悬浮按钮）有两条硬约束** — ① 必须 `whiteSpace: nowrap`：换行会让高度 26→41px，贴角时量到的尺寸就不是最终尺寸（贴右/下角会偏 15px）；② chip 的落位初始化（`chipCorner = readCorner()` / `placeChip` / 挂 resize）必须放在所有 `var` 常量赋值**之后**：`var` 只提升声明不提初值，提前调用会把 `CHIP_INSET` 读成 undefined、算出 `NaNpx`（实测 chip 停在左上角、重载后也不记得角落）。chip 的角落按站点存 `localStorage['__dsh_we_corner__']`
- **绝不往 `<html>`/`<body>` 写行内样式** — 这两个节点归宿主页框架所有（React/Next 等），注入期改它们的 `style` 会让框架 hydration 时判定「服务端 HTML 与客户端属性不一致」并**拒绝修补**：Next.js 16 + React 19 实测报 `A tree hydrated but some attributes of the server rendered HTML didn't match the client properties`，且 `style="cursor: crosshair"` 会永久留在 `<html>` 上。页面级效果（十字准星光标）改为注入插件自有的 `<style data-dsh-we="cursor">`（`inspector.js` 的 `ensureCursorStyle`/`applyCursor`），随 `cleanupAll` 一起摘除。注入时机在 `domcontentloaded`，早于 Next 的 async hydration 脚本，所以这条约束只能靠「不改框架节点」满足，靠「再晚点注入」绕不过去
- **修改 `src/` 后必须重新 `pnpm build`** — client 半被 DSH client-modules 按 bundle rev 缓存，构建后需重启 `dsh web`（仅 HMR 开发模式可热更）
- **绝不下载浏览器** — 运行时只探测系统已安装的 Chrome > Edge > Chromium > Brave > Opera；全失败则报错退出。UI 里选定的浏览器只作为"优先验证"（probe `--prefer`），验证不过仍回退自动探测，不允许用户选择让启动直接失败
- **浏览器选择记忆在 client 的 localStorage**（键 `dsh-webpage-element-picker.browser`，值 `{name, path}`），随 `picker-navigate` 回传 host；host 侧换浏览器 = 先 `quit` 关旧窗口再以新浏览器重启 helper，同一浏览器不重启
- 数据通道不依赖子进程管道（Chromium 在 Windows 会关闭 stdin）— 命令/事件一律走 DSH 自带 HTTP 路由（`/poll` 长轮询、`/events`、`/invoke`）

## 目录

```text
dsh-webpage-element-picker/  # DSH 组合包（bundle），单包，pnpm 管理
├── src/
│   ├── host/       # Host 半：原生 Cordis 插件（子进程/HTTP 路由/动态工具/系统提示），构建为 lib/index.js（ESM）
│   ├── client/     # Client 半：conversation.input.left 十字图标 + 对话框，构建为 lib/client.js（CJS + ModuleLoader 包裹）
│   │               #   primitives.ts 取 DSH 官方 Modal/Button；primitives-types.d.ts 声明其类型表面
│   │               #   「打开」为拆分按钮：左半打开、右半展开浏览器下拉菜单（记忆在 localStorage）
│   └── shared/     # host ↔ client 经 HTTP 交换的状态/事件形状（type-only）
├── resources/      # 运行时资源：bootstrap.cjs / browser-probe.cjs / helper-playwright.js / inspector.js
│   └── test/       # 测试：check-env.cjs（跨平台环境自检）/ driver.cjs 冒烟驱动 + CSP 测试页
│                   #   操作栏定位回归（改 viewport/定位算法后必跑，见下方「测试」段）：
│                   #   ab-position-probe.js（页内几何穷举 A/B）/ viewport-fit-check.cjs（真实窗口视口一致性）
│                   #   capture-window.ps1（截窗口取证）+ analyze-capture.py（按标记色量可见范围）
│                   #   hydration-probe.cjs + hydration-page.html（根元素行内样式/hydration 失配回归）
├── tsup.config.ts  # 双入口构建配置
├── cordis.patch.yml# bundle 配置层：插入 name: dsh-webpage-element-picker 行
└── lib/            # 构建产物，不入库
```

依赖方向：`host`/`client` → `shared`；host 与 client 互不依赖，运行时经 DSH HTTP 路由通信。

## 命令

| 命令 | 说明 |
|------|------|
| `pnpm install` | 安装依赖 |
| `pnpm build` | tsup 双入口构建（host→ESM，client→CJS+loader 包裹） |
| `pnpm watch` | tsup 持续构建 |
| `pnpm typecheck` | TypeScript 类型检查（`tsc --noEmit`） |
| `pnpm test` | 同 `pnpm typecheck` |
| `pnpm test:env` | 跨平台环境自检（npm 脚本入口解析 + 三平台浏览器候选表；不联网、不启动浏览器，需先 `pnpm build`） |
| `pnpm dsh plugin --profile web add .` | 装入 DSH `web` profile（详见 README.md） |

## 测试

| 层次 | 怎么跑 | 判据 |
|------|--------|------|
| 类型/环境 | `pnpm typecheck`、`pnpm test:env` | 无错误 |
| 端到端冒烟 | `node resources/test/driver.cjs <npm-cli.js> [优先浏览器路径]` | `result.json` 里出现 `helper-ready`/`injected`/`element-selected`；第二个参数用于避开已被别的 helper 占用的浏览器 profile |
| 操作栏几何 | Playwright MCP 的 `browser_run_code_unsafe({ filename: '<allowed root>/ab-position-probe.js' })` | `before` 89 失败 / `after` 0 失败（96 场景 × 3 视口）；卡片不越界、按钮都点得到、极小节点贴右下、选中态收起 chip |
| chip 拖动/吸附 | 同上，跑 `chip-drag-probe.js` | `before` 10 失败 / `after` 0 失败（18 用例）；四角吸附+按站点记忆、原地点击仍是暂停、暂停态 opacity<1 且开启态=1、窄视口不越界、视口变化重新贴角 |
| 真实窗口视口一致性 | `node resources/test/viewport-fit-check.cjs <浏览器路径> <old\|new> [holdMs]` + `capture-window.ps1` + `analyze-capture.py` | 页面自报 `innerHeight` 必须等于渲染子窗口高度（旧参数 820 vs 721，卡片只露 3px；新参数 721=721，卡片完整可见） |
| 根元素行内样式 / hydration | `node resources/test/hydration-probe.cjs [url] [inspector 路径] 1`（默认 url 不可达时自动回退 `hydration-page.html`） | `rootInlineStyle=false`、`attrsChangedVsSnapshot=false`、`hydrationMismatch=false`、`crosshairActive=true`、`childCursorsPreserved=true`；旧版（写 `documentElement.style.cursor`）在 Next.js 16 + React 19 真页上 `rootInlineStyle=true` 且控制台出现 hydration mismatch |

> `ab-position-probe.js` 必须放在 Playwright MCP 的允许根目录下（相对路径按 MCP 进程 cwd 解析，见全局 AGENTS.md）；
> `analyze-capture.py` 依赖 Pillow（仓库不含 Python 运行时，用 DSH 自带 Python 即可）。

## 注释

| 规则 | 说明 |
|------|------|
| 风格 | TS 用 JSDoc；中文，简洁，先说"做什么"再说"怎么做" |
| 文件头 | 简要说明文件职责 + 注意事项 |
| 嵌套 > 2 层 | 必须注释业务含义 |
| 功能点 | 方法、条件分支、事件处理、数据转换等独立功能单元都需说明其业务目的和关键逻辑 |
| 重要方法 | 必须注释算法思路或业务逻辑 |
| 特殊处理 | 环境判断、响应处理等需注释原因 |
| 密度 | 同文件内保持一致 |

## 日志

| 级别 | 场景 |
|------|------|
| ERROR | 业务异常、外部调用失败 — 必须打印堆栈和业务上下文 |
| WARN | 降级、重试、超时、配置缺失但可继续 |
| INFO | 请求入口、关键状态变更、外部调用耗时 >500ms |
| DEBUG | 分支走向、中间变量、循环关键节点（生产默认关闭） |

**必须打日志的点位**：请求入口（INFO + 标识）、外部调用（DEBUG 参数 + INFO 耗时）、异常捕获（ERROR + 堆栈 + 上下文）、关键分支（DEBUG + 依据）

## 技术栈

- **语言/构建** — TypeScript（strict + `verbatimModuleSyntax`）+ tsup 双入口；`moduleResolution: Bundler`，无路径别名
- **Host 半** — Cordis 原生插件，`inject` 声明的服务就绪后运行；注册动态工具 `read_picked_element`、系统提示注入、HTTP 路由；目标 `es2022` ESM
- **Client 半** — `window.__ModuleLoader__.load` 闭包工厂格式，`module.exports` 为插件表面；目标 `es2020`，external 为 `react` 与 `@deepseek-ai/dsh-client-ui-primitives`；对话框结构复用 DSH 官方 Modal/Button 原语，自有区块用 `--dsw-*` 令牌（浅/深色随 harness 自动切换）；原语缺失时按 `src/client/index.ts` 的 `renderDialogShell`/`renderButton` 降级
- **浏览器驱动** — `playwright-core`（首次由 bootstrap 经 npm 安装到自有缓存，约 13MB，不下载浏览器）
- **目标平台** — Windows / macOS / Linux。两处平台相关逻辑必须保持自适应：npm 脚本入口按 Node 安装布局解析（`src/host/index.ts` 的 `resolveNpmCli`），浏览器候选按平台切换（`resources/browser-probe.cjs` 的 `browserDefs`）；改动后跑 `pnpm test:env` 校验，Linux 仅逻辑校验未实机验证
