# AGENT.md

用中文交流。

## 约束

- **代码变更后、进入审查阶段前，必须先执行类型检查** — `pnpm typecheck`（即 `tsc --noEmit`），修复所有错误后再进入代码审查；本仓库无 ESLint/formatter 配置
- **host 半（`src/host/`）禁止引入 npm 运行时依赖** — 只能导入 node 内置模块与 `@deepseek-ai/cordis` 类型，其余全部内联打包；client 半（`src/client/`）运行时只允许两个外部依赖：`react`（经 `src/client/react.ts` 单点引入）与 `@deepseek-ai/dsh-client-ui-primitives`（经 `src/client/primitives.ts` 单点引入）。两者都由 harness 浏览器模块表提供，必须在 `package.json` 的 `dsh.client.external` 声明并同步到 `tsup.config.ts` 的 client `external`
- **client 样式只用 `--dsw-*` 语义令牌** — 插件自有 CSS 内联在 `src/client/index.ts` 的 `STYLE_CSS` 字符串里（无 CSS 构建步骤），颜色一律取令牌；不写颜色字面量、不做 `data-ds-dark-theme` 主题分支（浅/深色由 harness 切 `body` 属性 + 令牌自动生效）
- **修改 `src/` 后必须重新 `pnpm build`** — client 半被 DSH client-modules 按 bundle rev 缓存，构建后需重启 `dsh web`（仅 HMR 开发模式可热更）
- **绝不下载浏览器** — 运行时只探测系统已安装的 Chrome > Edge > Chromium > Brave > Opera；全失败则报错退出
- 数据通道不依赖子进程管道（Chromium 在 Windows 会关闭 stdin）— 命令/事件一律走 DSH 自带 HTTP 路由（`/poll` 长轮询、`/events`、`/invoke`）

## 目录

```text
dsh-webpage-element-picker/  # DSH 组合包（bundle），单包，pnpm 管理
├── src/
│   ├── host/       # Host 半：原生 Cordis 插件（子进程/HTTP 路由/动态工具/系统提示），构建为 lib/index.js（ESM）
│   ├── client/     # Client 半：conversation.input.left 十字图标 + 对话框，构建为 lib/client.js（CJS + ModuleLoader 包裹）
│   │               #   primitives.ts 取 DSH 官方 Modal/Button；primitives-types.d.ts 声明其类型表面
│   └── shared/     # host ↔ client 经 HTTP 交换的状态/事件形状（type-only）
├── resources/      # 运行时资源：bootstrap.cjs / browser-probe.cjs / helper-playwright.js / inspector.js
│   └── test/       # 测试：check-env.cjs（跨平台环境自检）/ driver.cjs 冒烟驱动 + CSP 测试页
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
