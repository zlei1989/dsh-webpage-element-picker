# dsh-webpage-element-picker

DSH（DeepSeek Harness）动态插件：在对话输入框工具行提供一个十字图标按钮，打开内置 Electron 浏览器、注入元素选择脚本，把选中的页面元素以 `[标签][DOMn]` 引用式占位符加入输入框，完整信息由模型按需通过 `read_picked_element` 工具读取。

## 特性

- 输入框工具行纯图标入口（`conversation.input.left`），状态信息显示在 tooltip
- 网址输入宽容：不带 `http://`/`https://` 时自动补 `https://`（`example.com` → `https://example.com`，`localhost:3080` 同样按缺头处理），补过的网址回写输入框；`ftp:`/`about:`/`mailto:` 等不支持的协议直接拒绝并说明原因（host 侧再校验一次兜底）
- 对话框采用 DSH 默认风格：外壳复用官方 `Modal` + `Button` 原语（遮罩模糊、24px 圆角卡片、elevation 阴影、Esc/点遮罩关闭），URL 输入框与历史菜单只用 `--dsw-*` 语义令牌——**浅色与深色跟随 harness 设置实时切换，插件内不写颜色字面量、不做主题分支**
- 使用系统已安装的浏览器（自动探测 Chrome > Edge > Chromium > Brave > Opera，**绝不下载任何浏览器**）：通过 `npm` 安装约 13MB 的 `playwright-core` 运行时（仅一次），之后秒开
- 「打开」是**拆分按钮**：左半按当前选择打开网址，右半箭头展开浏览器菜单——列出系统实际探测到的浏览器（含「自动探测」项），点一下即记住选择（写入 `localStorage`，下次打开对话框仍是它）；换浏览器时先关掉当前窗口再以新浏览器打开（各自独立的登录 profile 目录），所选浏览器已卸载/无法启动时自动回退到系统优先级探测并在对话框里提示实际使用的那一个
- 页面注入元素选择脚本：悬浮高亮 → 点击锁定 → 「添加到对话」；操作栏还有「选择父节点」——可连点把选择框一路往上移（父 → 祖父 → … 到 `<body>` 为止，到顶层自动置灰），此后「添加到对话」加入的是该祖先节点的上下文；`` ` `` 键或页面右下角按钮可暂停/恢复（登录场景）；Esc 退出选择模式
- 选中元素后输入框插入 markdown 引用式占位符：`[提交订单][DOM1]`（标签取元素文本/无障碍属性/tag#id，最长 10 字）
- 已插入过的元素视为已消费：发送对话、对话框重开或页面刷新后不会重放历史元素，只插入新选中的节点
- 对话框左下角实时显示上下文节点数；悬浮展开历史节点菜单（最新在上），点击任意节点可再次插入其占位符；菜单底部「清空」按钮二次确认后清空全部上下文节点（DOM 编号继续递增不重置，旧消息引用不错位）
- Host 注册动态工具 `read_picked_element`：模型按编号读取完整元素信息（HTML/CSS选择器/DOM路径/属性/位置尺寸/URL）
- 系统提示注入一行一元素的摘要清单（极小），把占位符与元素信息关联
- 登录态持久化（独立浏览器 profile），登录后可重新「打开」跳转+注入
- 「仅重新注入」带兜底：浏览器没开着（没启动/窗口被关/还停在 about:blank）时，按输入框里的网址先执行打开、再由它注入选择功能，并明确告知走了这条路；浏览器开着则只注入、绝不重新导航

## 安装

适用对象：DSH（本仓库部署形态）的 `web` profile。需要机器有 **Node.js（含 npm）**、到 npm 源的网络，以及系统已安装 **Chrome / Edge / Chromium / Brave / Opera 之一**。支持 **Windows / macOS / Linux**：npm 脚本入口按 Node 安装布局自适应解析（Windows 官方安装器与 nvm-windows 的 `<nodeDir>/node_modules/npm`，macOS/Linux（nvm、Homebrew、官方 pkg、发行版包）的 `<prefix>/lib/node_modules/npm`，并覆盖 Volta/asdf 等 shim 与 PATH 反推）；浏览器候选按平台切换（Windows 注册表 + 安装目录，macOS `/Applications` 与 `~/Applications` 的 `.app`，Linux `/usr/bin`、`/opt`、`/snap/bin` 及 PATH）。

```sh
dsh plugin --profile web add "github:zlei1989/dsh-webpage-element-picker#main"
```

### 构建

本仓库是 TypeScript 源码 + tsup 构建的组合包（`lib/` 为构建产物，不入库，克隆后需先构建）：

```sh
pnpm install
pnpm build        # tsup：src/host → lib/index.js（ESM），src/client → lib/client.js（loader 包裹）
```

`pnpm watch` 可持续构建；`pnpm test` 跑 `tsc --noEmit` 类型检查，`pnpm test:env` 跑跨平台环境自检（npm 脚本入口解析 + 浏览器候选清单，不联网、不启动浏览器）。

### 长期安装：bundle + profile

本仓库是符合 DSH **组合包（bundle）** 格式的 npm 包：

- `package.json` 声明 `dsh.bundle`（`cordis.patch.yml` 配置层）与 `dsh.client`（浏览器半 `exports["./client"]`，`external` 声明对 DSH UI 原语的运行时依赖）；
- host 半 `src/host/index.ts`（构建为 `lib/index.js`）是原生 Cordis 插件，`inject` 声明的七个服务就绪后才运行；client 半 `src/client/index.ts`（构建为 `lib/client.js`，`window.__ModuleLoader__.load` 工厂）；
- `cordis.patch.yml` 插入一行 `name: dsh-webpage-element-picker`，同一行同时被 Loader（host 半）和 client-modules 扫描（浏览器半）使用。

### 客户端依赖

client 半的运行时外部依赖只有两个，都由 harness 浏览器模块表提供（不随包分发）：

| specifier | 用途 | 声明位置 |
|-----------|------|----------|
| `react` | 组件运行时（经 `src/client/react.ts` 单点引入） | tsdown/tsup client external |
| `@deepseek-ai/dsh-client-ui-primitives` | 官方 `Modal` + `Button` 原语（经 `src/client/primitives.ts` 单点引入），对话框因此与 DSH 自身界面像素一致 | `package.json` 的 `dsh.client.external` + `tsup.config.ts` 的 client `external` |

`dsh.client.external` 是 host 排 boot 图的依据：改了其中一个必须同步改另一个。宿主 DSH 若未提供原语（旧版本），插件不会崩——`src/client/primitives.ts` 会回报失败原因并降级为等价的内置样式（控制台 INFO 日志会写明）。

在插件 checkout 内执行（`dsh` CLI 与 pnpm 需在 PATH 上）：

```sh
pnpm install && pnpm build   # 首次，或修改 src/ 后
pnpm dsh plugin --profile web add .
```

首次执行会自动初始化 `web` profile（若缺失）并把本包加入 `$DSH_HOME/profiles/web` 的 `dsh.profile.bundles` 层栈（`dsh plugin` 检测到 `dsh.bundle` 声明后自动追加）。随后**重启** `dsh web` 进程，输入框工具行即出现十字图标。

- 验证层已生效：`pnpm dsh --profile web --dump-config` 应出现 `# == dsh-webpage-element-picker` 层与 `webpage-element-picker` 行。
- 卸载：`pnpm dsh plugin --profile web remove dsh-webpage-element-picker`。
- 修改 `src/` 后需重跑 `pnpm build` 再重启 `dsh web`（client-modules 按 bundle rev 缓存，仅 HMR 开发模式可热更）。
- 无 npm 发布也可分发：`pnpm build && pnpm pack` 出 tarball 后 `pnpm dsh plugin --profile web add ./dsh-webpage-element-picker-<ver>.tgz`。

## 使用

1. 点击十字图标 → 「添加页面元素」对话框输入网址（不带 `http://`/`https://` 会自动补 `https://`）→ 「打开」（成功后对话框自动隐藏）。
2. 需要指定浏览器时点「打开」右侧箭头：菜单列出系统探测到的浏览器（Chrome/Edge/…，带「运行中」标注），选中即记住（`localStorage`）；「自动探测」表示回到系统优先级。选择在下次「打开」时生效。
3. 在浏览器页面中点击元素 → 「添加到对话」→ 输入框插入 `[标签][DOMn]`；选择模式随即退出。选到的层级不对（点中的是按钮而不是它所在的卡片/容器）时，先点操作栏的「选择父节点」把选择框上移到父级（可连点一路向上，到 `<body>` 为止），再点「添加到对话」——加入的就是父级节点的上下文。
4. 继续输入你的问题（如「把 [提交订单][DOM1] 改成红色」）并发送。
5. 模型需要细节时自动调用 `read_picked_element` 工具读取完整数据。
6. 登录场景：页面右下角「选择模式」悬浮按钮（或按 ` 键）暂停 → 登录 → 回到对话框点「仅重新注入」在当前页面恢复选择（如需回到输入的网址则点「打开」重新跳转+注入）。浏览器已经关掉时不用先点「打开」：输入框里填好网址再点「仅重新注入」，它会先打开该网址再注入（没填网址会提示先填）。

## 目录结构

```
src/
  host/
    index.ts       # Host 半：原生 Cordis 插件（子进程/路由/工具/系统提示），构建为 lib/index.js
    services.ts    # Host 侧服务接口（subprocess/webServer/fs/tools/…，type-only）
  client/
    index.ts       # Client 半：conversation.input.left 十字图标 + 对话框，构建为 lib/client.js
                   #   内含 STYLE_CSS（插件自有样式表，全部 --dsw-* 令牌）与降级渲染
                   #   浏览器选择（拆分按钮 + 下拉菜单）记忆在 localStorage 的
                   #   dsh-webpage-element-picker.browser 键（值 { name, path }）
    primitives.ts  # 从模块表取 DSH UI 原语（Modal/Button）的唯一入口，失败回报原因
    primitives-types.d.ts # 原语的本地类型表面（该包不列入本包依赖）
    services.ts    # Client 侧服务接口（slots/输入框标准 props，type-only）
    react.ts       # 由注入 require 取得 react 的唯一入口
    globals.d.ts   # 浏览器 bundle 的运行时全局（require/module/exports）声明
  shared/
    types.ts       # host ↔ client 经 HTTP 交换的状态/事件形状（type-only）
resources/         # 运行时资源（四个文件：bootstrap.cjs / helper-playwright.js / inspector.js / browser-probe.cjs）
  test/            # 测试：check-env.cjs（跨平台环境自检，不联网）/ driver.cjs 冒烟驱动 + CSP 测试页
tsup.config.ts     # 双入口构建：host→ESM，client→CJS+loader 包裹
tsconfig.json
cordis.patch.yml   # bundle 配置层：插入 name: dsh-webpage-element-picker 行
```

## 架构

```
DSH Host(插件) ──subprocess──▶ node bootstrap.cjs
      │                             ├─ npm install playwright-core@固定版本（自有缓存，无浏览器下载）
      │                             ├─ browser-probe.cjs：探测系统浏览器（Chrome>Edge>Chromium>Brave>Opera，
      │                             │   无头启动验证，结果缓存 browser-config.json 的 auto/preferred 两槽；
      │                             │   --prefer <路径> 优先验证用户在 UI 里选定的浏览器，失败回退自动
      │                             │   探测；--list 只做存在性检查输出 JSON 清单，全失败→报错退出，绝不下载）
      │                             └─▶ node helper-playwright.js（playwright-core 驱动系统浏览器）
      │  ▲ 命令长轮询 /dsh-webpage-element-picker/poll                        │
      │  └── 事件 POST  /dsh-webpage-element-picker/events ◀──────────────────┘
      ├─ ctx.tools.register：read_picked_element
      ├─ ctx.systemPrompt.context：DOMn 摘要清单
      └─ POST /dsh-webpage-element-picker/invoke：picker-navigate/browsers/reinject/status/close/pull
DSH Client(插件) ── conversation.input.left 图标 ── fetch /invoke ──▶ Host
```

浏览器选择的数据流：client 把 `localStorage` 里记住的选择随 `picker-navigate` 回传 host → host 比对当前 helper 的浏览器，不同则先 `quit` 关窗再以新浏览器重启（同一浏览器直接复用）→ bootstrap 以 `--prefer <路径>` 让探测优先无头验证它，失败回退自动探测 → 回报实际使用的浏览器名，client 与选择不一致时在对话框里提示。菜单清单由 `picker-browsers` 提供：host 跑 `browser-probe.cjs --list`（只查文件存在性，不启动浏览器、不要求 playwright-core 已装，百毫秒级）。

浏览器与 DSH 之间不依赖进程管道传递数据（Chromium 在 Windows 上会关闭 stdin），命令与事件都走 DSH 自带 HTTP 服务器上的路由：helper 用 `/poll`（长轮询）+ `/events`，浏览器 UI 用 `/invoke`（同源 fetch，复用同一命令队列与应答关联）。

## 已知限制

- bundle 形态跨 DSH 重启持久（`dsh.profile.bundles` 层）。
- 对话框的原语复用要求宿主 DSH 在浏览器模块表里提供 `@deepseek-ai/dsh-client-ui-primitives`（带 UI 的常规 DSH 版本都有）。若宿主没有，插件自动降级为等价的内置样式，功能不受影响，控制台会打一条 INFO 说明原因。
- 支持 Windows / macOS / Linux；需要系统已安装 Chrome/Edge/Chromium/Brave/Opera 之一（候选位置按平台自动切换）。原生 Firefox 无法被 Playwright 驱动，不在支持列表。Windows 与 macOS 已跑通端到端冒烟测试（`resources/test/driver.cjs`），Linux 只做了候选清单与路径逻辑校验、未做实机验证。
- 浏览器菜单只按**可执行文件是否存在**列出（打开菜单要快），真正能否被驱动由启动时的无头验证决定；因此个别"存在但起不来"的浏览器会在选中后才暴露，此时插件自动回退到自动探测并提示实际使用的浏览器。
- 改回「自动探测」不会关掉正在运行的窗口（无谓关窗会丢掉当前页面状态）：已在运行的浏览器继续用到关窗为止，新启动时才按系统优先级重新探测。
- 每个浏览器有独立的持久化 profile 目录（`profile-<名字>`），所以切换浏览器不会共享登录态。
- 严格 CSP 页面（`style-src` 禁内联样式）上高亮框的视觉效果会被浏览器拦截，但选择逻辑不受影响。
- 同一 DSH 进程内多个 profile/实例同时运行本插件时，HTTP 路由存在占用冲突（后者注册失败并告警）。
- 首次打开需要联网安装 playwright-core 运行时（约 13MB，仅一次）；无网络或系统无浏览器时会给出明确报错。

## License

MIT
