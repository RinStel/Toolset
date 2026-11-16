# Toolset 嵌入式工具箱 v1 实施规格（串口上位机）

> 本文件是交给实施 Agent 的唯一规格来源。凡写明「必须」的条目都是验收条件。
> 本文未覆盖的细节，按「最简单、且不违反第 3 节分层规则」的原则自行决定，并把决定记入 `docs/decisions.md`（一条一行：日期、问题、决定、理由）。
> 不得删减本文已规定的功能；如果确实无法实现，在 `docs/decisions.md` 中说明原因和替代方案。

------

## 0. 实施规则（给实施 Agent）

1. 工作目录：`G:\Develop\Toolset`（Windows 10，Git Bash）。已验证：目录可写，Node v24.19.0，pnpm 10.13.1。只使用 pnpm。
2. 不创建 Git 提交，不推送，不发布。可以执行 `git init`。
3. 每个阶段结束时必须运行该阶段「完成判据」中列出的命令并全部通过，才能进入下一阶段。
4. 不得把未执行或失败的测试报告为通过。环境原因（例如无法下载 Playwright 浏览器）导致无法执行时，在最终报告中列出：命令、错误输出、已采用的替代验证方式。
5. 不引入本文第 4.2 节以外的运行依赖。确需新增时，先写入 `docs/decisions.md` 并说明理由。
6. 所有界面文案使用简体中文；代码标识符、注释、提交到文档中的 API 名称使用英文。
7. 不访问外部网络资源（字体、CDN、统计）；运行时不得发起任何网络请求。
8. 最终交付时提交一份报告，内容包括：
   - 各验证命令的结果；
   - 未完成项；
   - `docs/decisions.md` 的摘要；
   - 开发服务器的访问地址。

------

## 1. 产品目标与验收标准

构建一个纯静态部署的嵌入式开发工具集网站。v1 只实现「串口上位机」一个工具（工具 id 为 `serial`）。它由两部分组成：

- **串口调试**：收发、日志、协议解析、发送。
- **上位机仪表盘**：把接收到的数据显示为波形、数值、仪表等图表，并提供按钮、滑块等控件向设备发送命令。定位可参考 VOFA+，但要做到更直观、更易用：
  - 收到的数据变量自动出现在变量列表中；
  - 拖动变量即可生成图表；
  - 一键生成仪表盘；
  - 所有组件都可以在属性面板中调节；
  - 可以编写自定义控件。

此外，站点提供「导出/导入本机配置」，用于备份和迁移所有本地数据。

架构必须满足：

- **多工具**：以后加入数据格式转换、阻抗计算等工具时，只需新增工具目录。
- **多通道**：以后加入 TCP/UDP（WebSocket）、BLE UART、WebUSB 等字节流通道时，只需新增传输提供者；协议、日志、发送、转发、仪表盘都不用改。
- **多组件**：新增一种内置仪表盘组件，只需新增一个组件目录；用户可以在站内编写自定义控件，不需要重新构建。

术语约定（全文统一使用）：

- **通道**：一个字节流连接（串口、演示端口等），即一个 `LinkSession`。
- **变量**：一路数值时间序列，例如 `ch0`、`temp`。来源是协议解码结果。
- **组件**：仪表盘中的一个图表或控件实例。「控件」专指会向设备发送命令的组件。

### 1.1 验收清单（全部必须满足）

| 编号 | 条件 |
|------|------|
| A1 | 在 Chrome/Edge 中可以授权、打开、关闭串口，收发文本和 HEX；同一页面可以同时打开多个端口 |
| A2 | 日志可以开关时间戳、发送记录、系统记录、转发记录；可以分别设置 RX/TX/系统/错误/时间戳/解析行的颜色，设置刷新后保留 |
| A3 | 协议插件可以在站内新建、编辑、校验、预览、保存、导入、导出、删除；日志支持「仅原始 / 仅解析 / 原始+解析」三种显示模式 |
| A4 | 插件抛出异常、死循环、产生超大帧时，页面不冻结；只禁用该会话的协议，其他会话正常接收 |
| A5 | 发送支持：文本/HEX、4 种编码、4 种行尾、7 种校验、历史、快捷发送、定时重复发送、宏序列、协议结构化发送、DTR/RTS/Break |
| A6 | 复用：同一会话可以在两个分屏窗格中显示；可以保存并套用连接预设；可以记住设备上次的配置；两个会话之间可以单向或双向转发 |
| A7 | 协议、宏、快捷发送、预设、设备记忆、工具设置、外观设置在刷新后保留；日志和转发规则不保留；日志可以导出为 TXT、CSV、BIN |
| A8 | 新增工具只需添加 `src/tools/<id>/`，首页卡片、导航、路由、设置分组和帮助章节自动出现，不需要修改 `src/app/` |
| A9 | 新增通道只需添加 `src/domains/link/transports/<kind>/provider.ts`，串口助手侧栏会自动出现对应的「新增」入口 |
| A10 | 入口包中不含领域代码、工具视图、CodeMirror、uPlot；入口 JS 的 gzip 体积不超过 120KB |
| A11 | 以下 8 条命令全部通过：`pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm check:arch`、`pnpm build`、`pnpm check:chunks`、`pnpm test:e2e`、`pnpm format:check` |
| A12 | 在不支持 Web Serial 的环境中显示明确提示；演示端口仍然可用 |
| A13 | 仪表盘：<br>• 内置 FireWater、JustFloat、键值文本三种数据格式，协议插件解码出的变量也能使用；<br>• 提供 14 种内置组件（第 8.11 节）；<br>• 24 列网格，拖拽和缩放时自动吸附；<br>• 支持编辑/运行模式、撤销/重做、属性面板调节、一键生成仪表盘、多个仪表盘、导入/导出；<br>• 控件可以按模板、协议表单、控制线发送命令；<br>• 演示端口以 JustFloat 格式、8 个变量、1kHz 发送 60 秒时，页面可以正常操作，变量数据不丢失 |
| A14 | 自定义控件：<br>• 可以在站内编写、预览、保存、导入、导出；<br>• 声明的属性会自动生成属性面板；<br>• 可以读取变量的最新值和历史数据，可以发送命令；<br>• 单个控件抛出异常或执行过慢时，只停用该控件；<br>• 提供安全模式，可以从疑似卡死中恢复 |
| A15 | 本机配置：<br>• 可以导出全部或选定的本地数据（外观设置、工具设置、协议、预设、设备记忆、快捷发送、宏、仪表盘、自定义控件）为一个 JSON 文件；<br>• 导入时可以选择「合并」或「替换」，导入后数据完整恢复；<br>• 可以清除全部本地数据 |

### 1.2 浏览器范围

- 完整支持：Chrome/Edge 89+；Firefox 桌面版 151+。
- 必须是安全上下文（HTTPS 或 `localhost`/`127.0.0.1`）。
- Safari、移动端浏览器：页面可以打开，串口不可用，显示提示，演示端口可用。

------

## 2. 已确认的决策（不得更改）

| 事项 | 决策 |
|------|------|
| 技术栈 | Vue 3（`<script setup>` + Composition API）、Vite、TypeScript（strict）、Vue Router（hash 模式）、Pinia |
| 部署 | 纯静态部署；Vite `base: './'`，可部署到任意子路径 |
| 工程组织 | 单个 Vite 应用；不采用 monorepo、微前端、运行时远程加载 |
| UI | 自研轻量组件，不使用组件库和 CSS 框架；默认深色，可切换浅色或跟随系统 |
| 图标 | `lucide-vue-next`，按需引入单个图标组件 |
| 协议插件 | 声明式分帧 + JS `decode`/`encode` 钩子；CodeMirror 6 编辑器；每个会话使用独立 Worker |
| 通道抽象 | 通用字节流领域 `domains/link`；v1 只实现 `web-serial` 和 `virtual`（演示端口）两个传输提供者 |
| 解析显示 | 日志条目同时保存原始字节和解析结果；三种显示模式，默认为「原始+解析」 |
| 复用 | 会话可在窗格/工具之间共享 + 连接预设 + 设备记忆 + 转发/桥接 |
| 多端口界面 | 标签页 + 最多两个分屏窗格；每个窗格可以显示「终端」（日志 + 发送）或「仪表盘」 |
| 仪表盘数据来源 | 协议解码结果中的变量。内置 FireWater、JustFloat（VOFA+ 兼容）和键值文本三种数据格式，以内置协议的形式实现 |
| 仪表盘布局 | 24 列网格，拖拽和缩放时吸附，组件之间不重叠，自动向上压紧 |
| 图表渲染 | 波形图、XY 图、频谱使用 `uplot`（只在仪表盘分包中动态加载）；其余组件用 SVG/CSS 自行实现 |
| 自定义控件 | JS 函数体，在主页面中直接运行（不放进沙箱），使用 DOM/Canvas 绘制；通过 try/catch、耗时监测和安全模式降低风险 |
| 本机配置 | 应用层的备份服务按存储命名空间枚举全部本地数据，导出为单个 JSON 文件；各工具和领域不需要额外编写导出代码 |
| 不做 | 本地桥接程序、Electron/Tauri、PWA/Service Worker、账号与云同步、使用数据上报、i18n 框架、插件或自定义控件的安全沙箱 |

------

## 3. 分层架构

### 3.1 分层与依赖方向

```
app/                应用外壳：路由、首页、导航、设置抽屉、帮助面板、工具注册表
  │ 只能经由 app/registry 接触 tools/*/manifest.ts 和 routes.ts
  ▼
tools/<id>/         工具：页面、组件、工具级 store
  │ 只能导入领域的 public.ts 和 shared/*
  ▼
domains/<name>/     纯 TypeScript 业务逻辑，不依赖 Vue
  │ 依赖方向：bytes ← protocol ← link ← series ← dashboard
  │           （dashboard 还依赖 bytes；以后的 convert、impedance 只依赖 bytes）
  ▼
shared/
  ├─ contracts/     纯类型契约（ToolManifest、SettingField 等）
  ├─ lib/           纯 TS 工具：存储、备份、事件、能力检测、格式化
  └─ ui/            Vue 通用组件、样式、Toast/Confirm 服务、通用 composables
```

### 3.2 依赖规则（由 dependency-cruiser 强制）

| 规则名 | 来源 | 禁止导入 |
|--------|------|----------|
| `shared-pure` | `src/shared/(lib\|contracts)/` | `vue`、`pinia`、`*.vue`、`src/shared/ui/`、`src/domains/`、`src/tools/`、`src/app/` |
| `shared-ui` | `src/shared/ui/` | `src/domains/`、`src/tools/`、`src/app/` |
| `domain-no-ui` | `src/domains/` | `vue`、`pinia`、`vue-router`、`*.vue`、`src/shared/ui/`、`src/tools/`、`src/app/` |
| `domain-public-only` | `src/domains/<A>/` | `src/domains/<B>/` 中除 `public.ts` 以外的任何文件（A≠B） |
| `domain-direction` | `src/domains/bytes/` | 任何其他领域 |
| `domain-direction` | `src/domains/protocol/` | 除 `bytes` 以外的领域 |
| `domain-direction` | `src/domains/link/` | 除 `bytes`、`protocol` 以外的领域 |
| `domain-direction` | `src/domains/series/` | 除 `bytes`、`protocol`、`link` 以外的领域 |
| `domain-direction` | `src/domains/dashboard/` | 除 `bytes`、`protocol`、`link`、`series` 以外的领域 |
| `tool-isolation` | `src/tools/<A>/` | `src/tools/<B>/`（A≠B） |
| `tool-domain-public` | `src/tools/` | `src/domains/*/` 中除 `public.ts` 以外的文件 |
| `app-boundary` | `src/app/` | `src/domains/`；`src/tools/*/` 中除 `manifest.ts`、`routes.ts` 以外的文件 |
| `manifest-light` | `src/tools/*/(manifest\|routes).ts` | `src/domains/`、`*.vue`（只允许动态 `import()`）、`codemirror`、`@codemirror/*`、`uplot` |
| `widget-definition-light` | `src/tools/*/dashboard/widgets/*/definition.ts` | `*.vue`（只允许动态 `import()`）、`uplot`、`codemirror`、`@codemirror/*` |
| `no-circular` | 全部 | 循环依赖 |

补充约束：

- 领域之间的导入只能指向对方的 `public.ts`，方向见上表。
- 领域的 Worker 入口文件（`*.worker.ts`）遵守同样的规则。
- `tests/architecture/fixtures/` 中为上表每条规则各放一个故意违规的样例文件。`tests/architecture/depcruise.test.ts` 对每个样例运行 dependency-cruiser，并断言它被对应规则拦截。主检查 `pnpm check:arch` 只扫描 `src/`。

### 3.3 分包规则（由 `scripts/check-chunks.mjs` 强制）

- 编写一个 Vite 插件 `scripts/vite-chunk-report.ts`。它在 `generateBundle` 阶段把每个 chunk 的以下信息写入 `dist/.vite/chunk-report.json`：`fileName`、`isEntry`、`isDynamicEntry`、`imports`、`dynamicImports`、`moduleIds`（转为相对于项目根目录的 POSIX 路径）。
- `check-chunks.mjs` 读取该报告，依次检查：
  1. 从入口 chunk 出发，只沿 `imports`（静态导入）递归，得到入口闭包。闭包中的 `moduleIds` 不得匹配以下任何一项：
     - `src/domains/`
     - `src/tools/[^/]+/(views|components|panels|stores|composables)/`
     - `src/tools/[^/]+/dashboard/`
     - `node_modules/.*/(codemirror|@codemirror)/`
     - `node_modules/.*/uplot/`
  2. 以下文件都必须位于非入口 chunk 中：
     - 每个 `src/tools/*/views/*.vue`、`src/tools/*/panels/*.vue`；
     - 每个 `src/tools/*/dashboard/widgets/*/Widget.vue`。
  3. `dist/assets/` 中必须存在协议 Worker 的独立产物。
  4. 包含 `uplot` 的 chunk 不得被串口工具的「终端」视图静态导入：从 `SerialToolView.vue` 所在的 chunk 出发，沿静态导入得到的闭包中不得包含 `uplot`。
  5. 入口闭包内所有 JS 文件 gzip 后的总大小不超过 120KB（用 `node:zlib` 计算）。
- 任一项失败时，输出违规模块列表，并以非零码退出。

------

## 4. 工程初始化

### 4.1 脚手架

`create-vue` 不能在非空目录中直接生成，因此按以下步骤操作：

```bash
pnpm create vue@latest .scaffold -- --ts --router --pinia --vitest --playwright --eslint --prettier
# 若标志名称不被识别，以 `pnpm create vue@latest --help` 的输出为准，选择等价选项
# 把 .scaffold/ 的内容移动到项目根目录（不要覆盖 plan.md），然后删除 .scaffold/
pnpm install
```

接着删除示例组件、示例视图和示例 store，只保留空的 `App.vue`。

### 4.2 依赖

- 运行依赖（只允许这些）：
  - `vue`、`vue-router`、`pinia`
  - `codemirror`、`@codemirror/lang-javascript`、`@codemirror/autocomplete`、`@codemirror/state`、`@codemirror/view`
  - `lucide-vue-next`
  - `uplot`（只在仪表盘的波形图、XY 图、频谱组件中动态加载）
- 开发依赖：脚手架自带的工具，另加：
  - `dependency-cruiser`
  - `@vue/test-utils`、`happy-dom`（脚手架未带时再加）
  - `fake-indexeddb`（单元测试使用）
- 安装后，把实际版本号记录在 README 的「环境」一节。

### 4.3 配置

- 路径别名：`@/` 指向 `src/`，在 `vite.config.ts` 和 `tsconfig` 中同时配置。
- `vite.config.ts`：
  - `base: './'`；
  - `build.manifest: true`；
  - 引入 `chunk-report` 插件；
  - `worker.format: 'es'`。
- Vitest：
  - 默认环境为 `node`；
  - `tests/components/**` 使用 `happy-dom`；
  - `tests/unit/**` 需要 IndexedDB 时引入 `fake-indexeddb/auto`。
- Playwright：
  - 只使用 Chromium；
  - `webServer` 运行 `pnpm build && pnpm preview --port 4173 --strictPort`；
  - `baseURL` 设为 `http://127.0.0.1:4173`。

### 4.4 package.json 脚本（名称必须一致）

```json
{
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "typecheck": "vue-tsc --build --force",
  "lint": "eslint .",
  "format": "prettier --write src tests scripts docs",
  "format:check": "prettier --check src tests scripts docs",
  "test:unit": "vitest run",
  "test:e2e": "playwright test",
  "check:arch": "depcruise src --config .dependency-cruiser.cjs",
  "check:chunks": "node scripts/check-chunks.mjs",
  "verify": "pnpm typecheck && pnpm lint && pnpm format:check && pnpm test:unit && pnpm check:arch && pnpm build && pnpm check:chunks && pnpm test:e2e"
}
```

------

## 5. 目录与文件清单

带 `*` 的是必须存在的文件，其余可以按需拆分或合并。

```
index.html*                      # 含首屏主题内联脚本和安全模式检测（见 7.4、6.10）
.dependency-cruiser.cjs*
scripts/
  vite-chunk-report.ts*
  check-chunks.mjs*
src/
  main.ts*                       # 创建 app、pinia、router；挂载全局错误处理
  App.vue*                       # 只渲染 <AppShell/>
  app/
    config/app.ts*               # APP_NAME = 'Toolset · 嵌入式工具箱'
    config/categories.ts*        # 分类表
    config/roadmap.ts*           # 首页「后续规划」文字列表
    registry/index.ts*           # 工具发现、校验、导出 tools[]、toolRoutes[]
    registry/validate.ts*
    router/index.ts*
    router/ToolRouteView.vue*    # 错误边界 + Suspense + KeepAlive
    router/ToolErrorView.vue*
    layout/AppShell.vue*
    layout/AppHeader.vue*
    layout/HomeView.vue*
    layout/NotFoundView.vue*
    layout/SettingsDrawer.vue*
    layout/HelpPanel.vue*
    layout/DataSettings.vue*     # 设置抽屉中的「数据」分组：导出、导入、清除本机配置
    config/backup-labels.ts*     # 领域和应用命名空间的中文名称
    stores/appearance.ts*        # 主题、字号、密度
  shared/
    contracts/tool.ts*
    contracts/settings.ts*       # SettingField（通用表单字段描述）
    lib/storage/local.ts*        # createLocalStore
    lib/storage/idb.ts*          # IndexedDB 键值封装
    lib/storage/namespace.ts*    # createToolStorage / createDomainStorage / createAppStorage
    lib/storage/backup.ts*       # 枚举、导出、校验、导入、清除本机数据
    lib/events.ts*               # 类型化事件发射器
    lib/batch.ts*                # 按时间窗口合并事件
    lib/support.ts*              # isSecureContext、hasWebSerial
    lib/web-serial.d.ts*         # Web Serial 最小类型声明
    lib/format.ts*               # 时间格式化、字节数格式化
    lib/download.ts*
    lib/id.ts*                   # 生成 uuid 和自增 id
    ui/components/               # UiButton、UiIconButton、UiInput、UiNumberInput、UiSelect、UiCheckbox、UiSwitch、
                                 # UiSegmented、UiDialog、UiDrawer、UiTabs、UiSplitPane、UiMenu、UiTooltip、
                                 # UiEmpty、UiBadge、UiColorInput、UiFormField、SettingForm（按 SettingField 渲染）
    ui/services/toast.ts*
    ui/services/confirm.ts*
    ui/services/ServiceHost.vue* # 挂载 Toast 和 Confirm 容器，由 AppShell 引用
    ui/composables/useExternalStore.ts*
    ui/styles/tokens.css*
    ui/styles/base.css*
  domains/
    bytes/
      hex.ts* text.ts* gbk.ts* checksum.ts* numeric.ts* writer.ts*
      public.ts*
    protocol/
      types.ts*
      validate.ts*
      framing/{line,delimiter,fixed,length,idle,index}.ts*
      sdk.ts*
      runtime/protocol.worker.ts*
      runtime/client.ts*         # ProtocolRuntime（主线程）、看门狗
      runtime/compile.ts*        # 在 Worker 内编译插件
      repository.ts*             # 插件仓库（IndexedDB + 索引）
      builtin/sensor-a5.ts*
      builtin/firewater.ts*      # VOFA+ FireWater 兼容格式
      builtin/justfloat.ts*      # VOFA+ JustFloat 兼容格式
      builtin/kv-text.ts*        # 键值文本格式
      templates/{minimal,line,length-crc,idle,variables}.ts*
      public.ts*
    link/
      transport/types.ts*
      transport/registry.ts*     # import.meta.glob('../transports/*/provider.ts', { eager: true })
      transports/web-serial/provider.ts*
      transports/web-serial/transport.ts*
      transports/virtual/provider.ts*
      transports/virtual/device.ts*   # 演示设备行为
      session/manager.ts*        # LinkManager 单例
      session/session.ts*        # LinkSession
      session/state.ts*          # 状态机
      session/rx-framer.ts*      # 无协议时的主线程分帧
      log/buffer.ts*
      log/export.ts*
      send/compose.ts*           # 组包
      send/repeat.ts*
      send/macro.ts*
      bridge/service.ts*
      presets/presets.ts*
      presets/devices.ts*
      public.ts*
    series/                      # 变量时间序列
      hub.ts*                    # SeriesHub：自动挂接所有会话
      source.ts*                 # SeriesSource：单个会话的变量集合
      ring.ts*                   # 定长环形缓冲（idx、t、v 三个 Float64Array）
      extract.ts*                # 从 DecodedFrame 提取变量样本
      timestamps.ts*             # 同批帧时间戳插值
      computed.ts*               # 计算变量（表达式编译与求值）
      fft.ts*                    # 基 2 FFT 与窗函数
      decimate.ts*               # 按像素宽度做最小/最大值抽取
      export.ts*                 # 变量 CSV 导出
      public.ts*
    dashboard/                   # 仪表盘模型（纯 TS）
      types.ts*                  # Dashboard、WidgetInstance、CommandSpec 等
      schema.ts*                 # 校验、默认值、版本迁移
      layout.ts*                 # 24 列网格：碰撞、压紧、移动、缩放、放置
      commands.ts*               # 命令模板解析与渲染
      history.ts*                # 撤销/重做栈
      generate.ts*               # 一键生成仪表盘
      custom/compile.ts*         # 自定义控件编译与定义校验
      custom/guard.ts*           # 调用保护：异常计数、耗时监测
      custom/safe-mode.ts*       # 疑似卡死标记与安全模式
      custom/templates.ts*       # 自定义控件模板
      public.ts*
  tools/
    serial/
      manifest.ts* routes.ts*
      views/SerialToolView.vue*
      components/                # 终端相关组件，见第 8 节
      panels/Settings.vue* panels/Help.vue*
      stores/{settings,sessions,layout,quickSend,macros,dashboards,customWidgets}.ts*
      dashboard/                 # 仪表盘界面，必须整体通过动态 import() 加载
        DashboardPane.vue*       # 仪表盘窗格入口
        DashboardToolbar.vue*
        GridCanvas.vue*          # 网格、拖拽、缩放、选中
        WidgetFrame.vue*         # 组件外框：标题、错误边界、选中态
        WidgetLibrary.vue*       # 组件库（编辑模式左栏）
        VariableList.vue*        # 变量列表（实时值、迷你曲线、可拖拽）
        PropertyPanel.vue*       # 属性面板（编辑模式右栏）
        prop-editors/            # 各类属性编辑器：颜色、变量、阈值、命令、表达式等
        widget-registry.ts*      # import.meta.glob('./widgets/*/definition.ts', { eager: true })
        widgets/<type>/definition.ts* + Widget.vue*   # 14 种内置组件，见 8.11
        custom/CustomWidgetHost.vue*
        custom/CustomWidgetEditor.vue*
        runtime/frame-loop.ts*   # 统一的 rAF 刷新调度
tests/
  unit/ components/ architecture/ e2e/
  e2e/fixtures/fake-serial.ts*
docs/
  architecture.md* tool-module.md* transport-provider.md* protocol-plugin.md* decisions.md*
  dashboard.md* custom-widget.md* data-formats.md* backup.md*
README.md*
```

------

## 6. 接口规格

### 6.1 工具契约（`shared/contracts/tool.ts`）

```ts
import type { Component } from 'vue'   // 只导入类型，不产生运行时依赖
import type { RouteRecordRaw } from 'vue-router'

export interface ToolManifest {
  id: string                            // 必须匹配 /^[a-z][a-z0-9-]*$/ 且等于目录名
  title: string
  summary: string                       // 不超过 40 个字
  category: string                      // categories.ts 中的 key；未知值归入 'other'
  icon: Component
  order?: number                        // 同一分类内升序排列，默认 100
  layout: 'workspace' | 'page'
  keepAlive?: boolean                   // 默认 false
  keywords?: string[]
  settings?: () => Promise<{ default: Component }>
  help?: () => Promise<{ default: Component }>
  backupLabels?: Record<string, string> // 本机配置导出界面中各存储项的中文名，键为存储项 name（不含前缀和版本后缀）
}
export type ToolRoutes = RouteRecordRaw[]   // path 为相对路径，'' 表示工具首页
```

分类表（`app/config/categories.ts`）：

```ts
[
  { key: 'comm',  title: '通信调试', order: 1 },
  { key: 'convert', title: '数据转换', order: 2 },
  { key: 'calc',  title: '计算工具', order: 3 },
  { key: 'other', title: '其他',     order: 99 },
]
```

串口上位机的 manifest 为：

```ts
{
  id: 'serial', title: '串口上位机', summary: '串口调试、协议解析、波形图表与控件面板',
  category: 'comm', layout: 'workspace', keepAlive: true, icon: Cable,
  keywords: ['串口', 'serial', 'uart', '上位机', '波形', 'vofa', '示波器'],
  backupLabels: {
    settings: '工具设置', layout: '窗口布局', quick: '快捷发送', macros: '宏',
    dashboards: '仪表盘', 'dashboards/*': '仪表盘内容',
    widgets: '自定义控件', 'widgets/*': '自定义控件代码',
  },
}
```

下文中的「串口助手」都指这个工具。

### 6.2 注册表（`app/registry`）

- 使用以下两条语句发现工具：
  - `import.meta.glob('/src/tools/*/manifest.ts', { eager: true, import: 'default' })`
  - `import.meta.glob('/src/tools/*/routes.ts', { eager: true, import: 'default' })`
- 校验项：
  1. manifest 和 routes 必须成对出现；
  2. `id` 等于目录名，且符合正则；
  3. `id` 唯一；
  4. `layout` 合法；
  5. 分类已知（否则归入 `other` 并警告）；
  6. routes 中的 path 不以 `/` 开头。
- 第 1–4、6 项校验失败时：开发模式（`import.meta.env.DEV`）抛出错误；生产模式跳过该工具，并用 `console.error` 输出原因。
- 每个工具生成一条路由：`{ path: '/tools/<id>', component: ToolRouteView, meta: { toolId }, children: routes }`。
- 导出 `tools: ToolManifest[]`（已排序）和 `getTool(id)`。
- 为了便于单元测试，校验逻辑写成纯函数 `buildRegistry(manifestModules, routeModules)`。

### 6.3 存储（`shared/lib/storage`）

```ts
interface LocalStore<T> { get(): T; set(v: T): void; update(fn: (v: T) => T): void; subscribe(cb: (v: T) => void): () => void; reset(): void }
function createLocalStore<T>(key: string, opts: { version: number; defaults: () => T; migrate?: (raw: unknown, fromVersion: number) => T | null }): LocalStore<T>
interface KvStore { get<T>(key: string): Promise<T | undefined>; set(key: string, v: unknown): Promise<void>; delete(key: string): Promise<void>; keys(prefix?: string): Promise<string[]> }
function createToolStorage(toolId: string): { local<T>(name: string, opts): LocalStore<T>; kv: KvStore }      // 前缀 toolset/tool/<id>/
function createDomainStorage(domain: string): { local<T>(name: string, opts): LocalStore<T>; kv: KvStore }    // 前缀 toolset/<domain>/
function createAppStorage(): { local<T>(name: string, opts): LocalStore<T> }                                   // 前缀 toolset/app/
```

- localStorage 中保存的格式为 `{ "version": n, "data": ... }`，键名为 `<前缀><name>.v<主版本>`。
- 读取时出现以下情况：JSON 解析失败、版本高于当前版本、`migrate` 返回 `null`。处理方式：
  1. 把原始字符串另存为 `<key>.corrupt.<时间戳>`；
  2. 使用默认值；
  3. 通过 `onStorageIssue` 回调通知上层。存储层属于 `shared/lib`，不能直接调用 Toast；由 `main.ts` 在回调中弹出 Toast：「本地数据已损坏，已恢复默认值（原数据已备份）」。
- 写入时抛出 `QuotaExceededError`：保留内存中的值，并通过 `onStorageIssue` 通知「本地存储空间不足，本次修改仅在当前页面有效」。
- 监听 `window` 的 `storage` 事件，键名匹配时重新读取数据并通知订阅者（用于多标签页同步）。
- IndexedDB：数据库名 `toolset`，版本 1，只有一个对象仓库 `kv`，键为字符串。打开或写入失败时，降级为内存 Map，并通过 `onStorageIssue` 通知。
- **KvStore 的完整键**为 `<前缀><key>`，例如 `toolset/protocol/plugins/<id>`。
- **KvStore 只接受 JSON 可序列化的值**，以保证可以导出为备份：
  - `set` 时在开发模式下用 `JSON.stringify` 做一次往返比较；不一致就抛出 `TypeError('KvStore value must be JSON-serializable')`。
  - 二进制数据由调用方转成 HEX 字符串后再存。
- **所有本地数据都必须经由本节的 API 读写**，禁止直接调用 `localStorage` 或 `indexedDB`。例外只有 `index.html` 中的主题读取，以及 6.10 节的安全模式标记。这条规则保证备份能完整枚举所有数据。

### 6.4 字节领域（`domains/bytes/public.ts`）

```ts
// hex
parseHex(input: string): { ok: true; bytes: Uint8Array } | { ok: false; error: string; index: number }
//   允许：空白、逗号、0x/0X 前缀；每个字节必须是 2 位十六进制（不接受 "A" 这样的 1 位写法，除非带 0x 前缀，如 "0xA"）
//   错误文案示例：「第 5 个字符 'G' 不是十六进制数字」「HEX 位数为奇数」
toHex(bytes: Uint8Array, sep?: string /* 默认 ' ' */, upper?: boolean /* 默认 true */): string

// 文本
type TextEncodingName = 'utf-8' | 'ascii' | 'latin1' | 'gbk'
encodeText(text: string, enc: TextEncodingName): { ok: true; bytes: Uint8Array } | { ok: false; error: string; char: string; index: number }
//   ascii：码点 > 0x7F 时报错；latin1：码点 > 0xFF 时报错；gbk：查不到映射时报错
createStreamDecoder(enc: TextEncodingName): { decode(chunk: Uint8Array): string; flush(): string }
//   用 TextDecoder 的 stream 模式实现（ascii 按 'windows-1252' 解码后，把码点 > 0x7F 的字符替换为 '\uFFFD'）

// GBK 编码表：首次使用时，用 TextDecoder('gbk') 枚举双字节 0x81–0xFE × 0x40–0xFE，构建 Map<码点, 字节对>，结果缓存在模块内

// 校验
type ChecksumKind = 'sum8' | 'xor8' | 'lrc' | 'crc8' | 'crc16-modbus' | 'crc16-ccitt'
checksum(kind: ChecksumKind, data: Uint8Array): number
checksumWidth(kind): 1 | 2
//   sum8：所有字节之和 & 0xFF
//   xor8：所有字节异或
//   lrc：(-sum) & 0xFF（Modbus ASCII LRC）
//   crc8：CRC-8/SMBUS，poly 0x07，init 0x00，不反射，xorout 0
//   crc16-modbus：poly 0x8005（反射实现用 0xA001），init 0xFFFF
//   crc16-ccitt：CRC-16/CCITT-FALSE，poly 0x1021，init 0xFFFF，不反射
//   对 ASCII "123456789" 的标准结果：crc8 = 0xF4，crc16-modbus = 0x4B37，crc16-ccitt = 0x29B1

// 数值读写
read: u8 i8 u16le u16be i16le i16be u32le u32be i32le i32be f32le f32be f64le f64be (bytes, offset) => number
bits(value: number, start: number, length: number): number
class ByteWriter { u8(v); i8(v); u16le(v); …（与 read 系列一一对应）; bytes(b: ArrayLike<number>); ascii(s: string); toBytes(): Uint8Array }
```

### 6.5 协议领域（`domains/protocol`）

```ts
interface ProtocolDefinition {
  apiVersion: 1
  meta: { name: string; description?: string; version?: string }
  framing: FramingSpec
  decode?(frame: Uint8Array, ctx: DecodeContext): DecodeResult | DecodeResult[] | null
  sendForm?: { fields: SendField[] }
  encode?(values: Record<string, SendValue>, ctx: EncodeContext): Uint8Array | number[]
}

type FramingSpec =
  | { type: 'line'; eol?: 'lf' | 'crlf' | 'cr'; includeEol?: boolean; maxFrameLength?: number }
  | { type: 'delimiter'; start?: string; end: string; include?: 'content' | 'both'; maxFrameLength?: number }
  | { type: 'fixed'; length: number; header?: string; trailer?: string; maxFrameLength?: number }
  | { type: 'length'; header?: string; length: LengthField; maxFrameLength?: number }
  | { type: 'idle'; gapMs: number; maxFrameLength?: number }

interface LengthField { offset: number; size: 1 | 2 | 4; endian?: 'le' | 'be'; includes: 'frame' | 'after'; adjust?: number }

interface DecodeContext { direction: 'rx' | 'tx'; timestamp: number; state: Record<string, unknown> }
interface EncodeContext { state: Record<string, unknown> }
// state 是该会话内持久的可写对象，用于跨帧保存状态；切换或重载协议时清空

interface DecodeResult {
  type?: string
  summary: string
  fields?: DecodeField[]
  level?: 'info' | 'warn' | 'error'     // 默认 'info'
  variables?: Record<string, number>    // 供仪表盘使用的变量样本，键必须匹配 /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/
  variableMeta?: Record<string, { unit?: string; label?: string }>   // 可选，帮助仪表盘显示单位和名称
  noVariables?: boolean                 // true 时不从 fields 自动提取变量
}
interface DecodeField { label: string; value: string | number | boolean; unit?: string; format?: 'text' | 'hex' | 'dec'; key?: string }
// 变量提取规则（domains/series/extract.ts）：
//   1. 有 variables 时只使用 variables，值必须是有限数（NaN/Infinity 丢弃并计入 invalidSamples）。
//   2. 没有 variables 且 noVariables 不为 true 时，从 fields 自动提取：
//      值为 number 的字段，以 key ?? label 作为变量名；值为 boolean 的字段记为 0/1；
//      label 不符合变量名规则时，把非法字符替换为 '_'，开头不是字母时加前缀 'v_'。
//   3. level 为 'error' 的结果不提取变量。

type SendField =
  | { key: string; label: string; type: 'number'; min?: number; max?: number; step?: number; default?: number; unit?: string }
  | { key: string; label: string; type: 'text'; maxLength?: number; default?: string }
  | { key: string; label: string; type: 'select'; options: Array<{ label: string; value: string | number }>; default?: string | number }
  | { key: string; label: string; type: 'checkbox'; default?: boolean }
  | { key: string; label: string; type: 'hex'; default?: string }
type SendValue = number | string | boolean | Uint8Array   // hex 字段传入解析后的 Uint8Array
```

**分帧语义**（所有十六进制字符串均为空格分隔的字节，如 `"A5 5A"`）：

| 模式 | 语义 |
|------|------|
| 公共 | `maxFrameLength` 默认 4096，取值范围 1–65536。缓冲区超过上限仍未成帧时，丢弃缓冲区中所有字节（计入丢弃统计），重新开始。所有被丢弃的字节都通过 `discard` 事件上报 |
| `line` | `eol` 默认 `'lf'`。`'lf'` 以 0x0A 结尾，并去掉其前面的 0x0D；`'crlf'` 只以 0x0D 0x0A 结尾；`'cr'` 以 0x0D 结尾。`includeEol` 默认 false |
| `delimiter` | 指定了 `start` 时，`start` 之前的字节被丢弃；帧在 `end` 处结束。`include` 默认 `'content'`（不含起止符），`'both'` 表示保留起止符 |
| `fixed` | 帧长等于 `length`。有 `header` 时，先按 `header` 同步，帧从 `header` 开始。有 `trailer` 但帧尾不匹配时，丢弃当前帧的第一个字节，重新同步 |
| `length` | 帧从 `header` 开始（没有 `header` 时，从当前缓冲区开头开始）。长度字段位于帧起点偏移 `offset` 处。`includes: 'frame'` 时，总帧长 = 值 + `adjust`；`includes: 'after'` 时，总帧长 = `offset + size + 值 + adjust`。`adjust` 默认 0。总帧长小于 `offset + size` 或大于 `maxFrameLength` 时，丢弃起点的 1 个字节，重新同步 |
| `idle` | 自上一个字节起静默超过 `gapMs`（1–1000）后，把缓冲区作为一帧输出。由主线程在每块数据到达后启动或重置定时器，到期时发送 `flush` 消息；Worker 同时检查块时间戳，相邻块间隔大于 `gapMs` 时先结束上一帧 |

**插件 SDK**（类型名为 `PluginSdk`。在 Worker 内作为 `sdk` 参数注入；自定义控件中通过 `ctx.sdk` 和编译参数 `sdk` 提供同一个实现）：

```
sdk.hex(bytes, sep?)          sdk.fromHex(str) → Uint8Array（非法时抛错）
sdk.bytes(...items)           // 由数字和数组拼接成 Uint8Array
sdk.read.u8/i8/u16le/…/f64be(bytes, offset)
sdk.bits(value, start, len)
sdk.writer() → ByteWriter
sdk.checksum.sum8/xor8/lrc/crc8/crc16modbus/crc16ccitt(bytes) → number
sdk.text(bytes, encoding?)    // 默认 'utf-8'
sdk.assert(cond, message)     // 条件不成立时抛出 Error(message)
```

插件代码的格式：一个 JS 函数体。运行时通过 `new Function('sdk', 'console', code)` 编译后调用，必须 `return` 一个 `ProtocolDefinition`。注入的 `console` 收集 `log`、`warn`、`error` 的输出，参数用 `String`/`JSON.stringify` 转成字符串，每行最多 500 字。

**定义校验（`validate.ts`，Worker 和主线程共用）**：

- `apiVersion === 1`；`meta.name` 是非空字符串。
- `framing` 符合上表：各字段类型正确，十六进制字符串可以解析，数值在范围内。
- `decode`、`encode` 如果存在必须是函数；有 `sendForm` 时必须有 `encode`。
- 字段的 `key` 唯一且非空；`select` 至少有 1 个选项。
- 代码不超过 256KB。

**结果规范化**：

- `decode` 返回非对象或缺少 `summary` 时，视为解码错误。
- `summary` 截断到 200 字；`fields` 最多 64 个。
- `encode` 必须返回 `Uint8Array` 或 0–255 的整数数组，长度为 1–65536，否则视为编码错误。

**Worker 消息协议**：

```ts
// 主线程 → Worker
{ t: 'init'; code: string; maxFrameLength?: number }
{ t: 'feed'; id: number; chunks: Array<{ bytes: Uint8Array; at: number }> }   // RX，按批发送
{ t: 'flush'; id: number }                                                     // idle 模式超时
{ t: 'decodeTx'; id: number; bytes: Uint8Array; at: number }                  // TX 整帧解码，不经过分帧器
{ t: 'encode'; id: number; values: Record<string, SendValue> }
{ t: 'reset' }
// Worker → 主线程
{ t: 'ready'; meta; sendForm?; framing }
{ t: 'initError'; error: string }
{ t: 'frames'; id: number; frames: Array<{ bytes: Uint8Array; at: number; direction: 'rx' | 'tx'; results: DecodeResult[]; error?: string }> }
{ t: 'discard'; id: number; bytes: Uint8Array; at: number }
{ t: 'encoded'; id: number; bytes: Uint8Array } | { t: 'encodeError'; id: number; error: string }
{ t: 'log'; level: 'log' | 'warn' | 'error'; text: string }
{ t: 'done'; id: number }                                                      // 一条请求处理完毕
```

**`ProtocolRuntime`（主线程，`runtime/client.ts`）**：

```ts
interface ProtocolRuntime {
  readonly info: { meta; sendForm?; framing }
  feed(chunk: Uint8Array, at: number): void
  decodeTx(bytes: Uint8Array, at: number): void
  encode(values: Record<string, SendValue>): Promise<Uint8Array>
  on(ev: 'frames' | 'discard' | 'log' | 'fatal', cb): () => void
  dispose(): void
}
function createProtocolRuntime(code: string, opts?: { maxFrameLength?: number }): Promise<ProtocolRuntime>  // 初始化失败时 reject
```

- **批量发送**：`feed` 先累积数据，满足以下任一条件就发送一条 `feed` 消息：距离上次发送 16ms、累积达到 16KB。
- **看门狗**：
  - `init` 超过 2000ms 没有回复 `ready`/`initError` 时，终止 Worker 并 reject；
  - 任一带 `id` 的请求超过 500ms 没有回复 `done`/`encoded`/`encodeError` 时，终止 Worker 并触发 `fatal`，原因为「协议执行超时（可能存在死循环）」。
- **输入队列上限**：已发出但尚未完成的请求，加上待发送的数据，总量超过 2MB 时，丢弃最旧的待发送数据，并通过 `discard` 事件上报（`reason: 'overflow'`）。
- **单帧异常**：`decode` 抛错时，该帧照常输出，`results` 为空，`error` 为错误消息，不会触发 `fatal`。

**插件仓库（`repository.ts`）**：

- 记录结构：`{ id: string; name: string; code: string; createdAt: number; updatedAt: number }`。
- 存储位置：
  - 代码：`createDomainStorage('protocol').kv`，键为 `plugins/<id>`；
  - 索引：local store `index`，内容为 `Array<{ id, name, updatedAt }>`。
- 内置协议：共 4 个（见下方「内置数据格式」和 8.6 节），id 以 `builtin:` 开头，只读，不进入存储。内置协议的实现方式与用户插件相同，都是插件代码字符串，以便验证插件 API 的表达能力。
- API：`list()`、`get(id)`、`save(rec)`、`remove(id)`、`importFile(text, fileName)`、`exportFile(id)`、`subscribe(cb)`。
  - 导入时，`meta.name` 取自编译结果；如果编译失败，就用文件名。
  - 导出的文件名为 `<name>.protocol.js`。

**内置数据格式（作为内置协议提供，仪表盘的主要数据来源）**：

| id | 名称 | 分帧 | 解析规则 | 变量 |
|----|------|------|----------|------|
| `builtin:firewater` | FireWater（VOFA+ 兼容） | `line`，LF（自动去掉 CR），maxFrameLength 4096 | 1. 如果行内含 `:`，且冒号前的部分不是数字，则把冒号前的部分作为前缀，用作摘要标签，不参与解析。<br>2. 剩余部分按 `,` 分割并去掉首尾空白，每段用 `Number()` 解析。<br>3. 全部段都是有限数时，生成变量；否则把整行作为文本消息（`summary` 为原文，不生成变量）。 | `ch0`…`chN-1`，最多 256 个 |
| `builtin:justfloat` | JustFloat（VOFA+ 兼容） | `delimiter`，`end: '00 00 80 7F'`，`include: 'content'`，maxFrameLength 1024 | 内容长度必须是 4 的正整数倍，否则返回 `level: 'error'`、`summary: '帧长度不是 4 的倍数'`。按 f32le 依次读取。 | `ch0`…`chN-1`，最多 256 个 |
| `builtin:kv-text` | 键值文本 | `line`，LF（自动去掉 CR），maxFrameLength 4096 | 1. 一行内用 `,`、`;` 或空白分隔若干项，每项格式为 `key:value` 或 `key=value`。<br>2. key 必须符合变量名规则。<br>3. 值能用 `Number()` 解析为有限数的成为变量；其余作为文本字段。<br>4. 一项都不匹配时，把整行作为文本消息。 | 各 key |
| `builtin:sensor-a5` | 传感器帧（A5 5A） | 见 8.6 节 | 见 8.6 节 | `temp`（°C）、`hum`（%RH）、`volt`（mV）、`count` |

- 摘要格式：前三种为 `ch0=1.23 ch1=4.56 …`，最多显示 8 项，超出部分用 `…(+N)` 表示。
- 内置数据格式的 `meta.description` 中必须给出下位机的发送示例：
  - FireWater：C 语言 `printf("%f,%f\n", a, b)`。
  - JustFloat：以 float 数组加尾帧 `{0x00, 0x00, 0x80, 0x7F}` 的方式发送。
  - 这些示例也要写入 `docs/data-formats.md`。
- 「新建协议」模板新增 `variables`：演示如何在 `decode` 中返回 `variables` 和 `variableMeta`。

### 6.6 通道领域（`domains/link`）

```ts
interface TransportCapabilities { lineSettings: boolean; signals: boolean; break: boolean }

interface ByteTransport {
  readonly kind: string
  readonly deviceKey: string            // 用于设备记忆，如 'serial:1A86:7523'、'serial:unknown'、'virtual'
  readonly label: string                // 如 'USB 串口 (1A86:7523)'、'演示端口 1'
  readonly capabilities: TransportCapabilities
  open(settings: Record<string, unknown>): Promise<void>
  close(): Promise<void>
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  setSignals?(s: { dtr?: boolean; rts?: boolean; brk?: boolean }): Promise<void>
  onDisconnect(cb: () => void): () => void
  isSameDevice(other: ByteTransport): boolean   // 用于避免同一设备重复创建会话
}

interface TransportProvider {
  readonly kind: string                 // 'web-serial' | 'virtual'
  readonly title: string                // '串口' | '演示端口'
  readonly addLabel: string             // '新增串口' | '新增演示端口'
  readonly order: number
  isSupported(): { ok: boolean; reason?: string }
  request(): Promise<ByteTransport | null>        // 用户取消时返回 null，不抛错
  listAuthorized(): Promise<ByteTransport[]>      // virtual 返回 []
  onAvailabilityChange?(cb: () => void): () => void
  readonly settingsSchema: SettingField[]
  defaultSettings(): Record<string, unknown>
}
```

`SettingField`（`shared/contracts/settings.ts`）的类型为 `number | select | checkbox | text`，字段与 `SendField` 一致，另加 `advanced?: boolean`（默认折叠）、`allowCustom?: boolean`（用于 select，可以输入自定义数值）。

Web Serial 的参数表：

| key | 类型 | 取值 | 默认值 |
|-----|------|------|--------|
| baudRate | select（allowCustom） | 300、1200、2400、4800、9600、19200、38400、57600、115200、230400、460800、921600、1000000、1500000、2000000；自定义范围 1–20000000 | 115200 |
| dataBits | select | 7、8 | 8 |
| stopBits | select | 1、2 | 1 |
| parity | select | none、even、odd | none |
| flowControl | select | none、hardware | none |
| bufferSize | number（advanced） | 255–16777216 | 255 |

演示端口的参数表（能力为 `{ lineSettings: false, signals: true, break: false }`）：

| key | 类型 | 取值 | 默认值 |
|-----|------|------|--------|
| format | select | `sensor-a5`（传感器帧）、`firewater`、`justfloat`、`kv-text` | `sensor-a5` |
| interval | number | 1–10000 ms；`sensor-a5` 格式下最小 100 | 1000（`sensor-a5`）；切换到其他格式时自动改为 10 |
| channels | number | 1–16，只对 `firewater` 和 `justfloat` 生效 | 8 |

演示设备的行为见 8.7 节。

`LinkSession`：

```ts
type SessionState = 'idle' | 'opening' | 'open' | 'closing' | 'closed' | 'error'
type Origin = 'manual' | 'quick' | 'repeat' | 'macro' | 'protocol' | 'bridge' | 'widget' | 'device'
// 日志中 TX 来源标记：手动不显示；quick→快捷，repeat→定时，macro→宏，protocol→协议，bridge→转发，widget→控件

interface DecodedFrame { seq: number; bytes: Uint8Array; at: number; direction: 'rx' | 'tx'; results: DecodeResult[]; error?: string }
// seq 是会话内单调递增的帧序号（独立于日志 seq），不受日志抽样影响

interface LinkSession {
  readonly id: string                    // 's1'、's2'…，在页面生命周期内自增
  readonly transport: ByteTransport
  readonly providerKind: string
  name: string                           // 默认等于 transport.label，可重命名
  readonly state: SessionState
  readonly lastError: string | null
  readonly settings: Readonly<Record<string, unknown>>
  readonly stats: { rxBytes: number; txBytes: number; rxFrames: number; droppedBytes: number; decodeErrors: number }
  readonly log: LogBuffer
  readonly protocol: { id: string; name: string; sendForm?: SendField[]; status: 'active' | 'disabled'; error?: string } | null
  readonly signals: { dtr: boolean | null; rts: boolean | null }   // null 表示「未设置」
  rxOptions: RxOptions                   // 无协议时的分帧方式与显示编码
  logPolicy: LogPolicy                   // 解码帧写入日志的策略
  open(): Promise<void>
  close(): Promise<void>
  dispose(): Promise<void>               // 停止所有任务，close，从 manager 移除
  updateSettings(patch: Record<string, unknown>): void   // 仅限 idle/closed/error 状态，否则抛 IllegalStateError
  setProtocol(id: string | null): Promise<void>
  send(bytes: Uint8Array, origin: Origin): Promise<void>
  sendForm(values: Record<string, SendValue>): Promise<void>   // 协议编码后发送，origin = 'protocol'
  setSignals(s: { dtr?: boolean; rts?: boolean; brk?: boolean }): Promise<void>
  readonly tasks: { repeat: RepeatStatus | null; macro: MacroStatus | null }
  startRepeat(opts: RepeatOptions): void
  stopRepeat(): void
  startMacro(macro: Macro): void
  stopMacro(): void
  on(ev: 'state' | 'entries' | 'stats' | 'protocol' | 'tasks' | 'signals' | 'settings' | 'logPolicy', cb): () => void
  on(ev: 'frames', cb: (frames: DecodedFrame[]) => void): () => void
  // 'frames'：每收到一批 Worker 解码结果就同步发出一次，包含全部帧（不抽样、不合并），供 series 领域使用
}

interface LogPolicy { mode: 'all' | 'sampled' | 'none'; maxPerSecond: number; auto: boolean }
// 默认 { mode: 'all', maxPerSecond: 20, auto: true }
//   all：每个解码帧都写日志
//   sampled：每秒最多写 maxPerSecond 条（取每个时间片内的第一帧），其余只计数，
//            每秒写一条 system 日志「已省略 N 帧」（N 为 0 时不写）
//   none：解码帧不写日志，未成帧数据、错误帧、TX 照常写
//   auto 为 true 时，连续 2 秒解码帧速率超过 200 帧/秒，自动切换为 sampled，
//   并写 system 日志「数据帧速率过高（约 N 帧/秒），日志已切换为抽样记录，可在日志工具栏中修改」；
//   用户手动修改 mode 后，auto 置为 false
// error 级别的帧和带 decoded.error 的帧在任何模式下都写日志（受第 9 节「每秒最多 1 条」的限制）

interface RxOptions { framing: 'line' | 'idle' | 'chunk'; idleMs: number; encoding: TextEncodingName }
// 默认值 { framing: 'line', idleMs: 20, encoding: 'utf-8' }
//   line：按 LF 分行；如果 idleMs 内没有新数据，把未成行的缓冲区作为一条输出
//   idle：只按静默时间分帧
//   chunk：每个读取块作为一条
//   三种方式的最大长度都是 4096 字节，超过后强制输出

interface LinkManager {
  listProviders(): TransportProvider[]
  listAuthorized(): Promise<Array<{ provider: TransportProvider; transport: ByteTransport; sessionId: string | null }>>
  request(kind: string): Promise<LinkSession | null>   // 设备已有会话时直接返回已有会话
  createFrom(transport: ByteTransport): LinkSession    // 设备已有会话时直接返回已有会话
  sessions(): LinkSession[]
  get(id: string): LinkSession | undefined
  on(ev: 'sessions', cb): () => void
}
```

**状态机**（不在表中的转换一律抛出 `IllegalStateError`，界面相应按钮置灰）：

| 当前状态 | 事件 | 下一状态 |
|----------|------|----------|
| idle / closed / error | `open()` | opening |
| opening | 打开成功 | open |
| opening | 打开失败 | error（`lastError` 为中文原因） |
| open | `close()` | closing → closed |
| open | 读取发生致命错误 / 设备断开 | error |
| opening | `close()` | 等待打开完成后立即关闭 → closed |

**读循环（web-serial）**：

```
while (port.readable && !closing) {
  reader = port.readable.getReader()
  try {
    读取直到 done
  } catch (e) {
    BreakError / FramingError / ParityError / BufferOverrunError → 写一条 warn 系统日志，继续外层循环
    其他错误 → 进入 error 状态，退出循环
  } finally {
    reader.releaseLock()
  }
}
```

关闭顺序：设置 `closing` → `reader.cancel()` → 等待读循环结束 → `writer.releaseLock()` → `port.close()`。

**写队列**：打开时获取一个 writer，所有发送通过 Promise 链串行执行。写入失败时：

1. 写一条 error 系统日志；
2. 停止 repeat 和 macro 任务；
3. reject 调用方；
4. 会话保持 open，除非随后发生断开。

**日志（`log/buffer.ts`）**：

```ts
interface LogEntry {
  seq: number                     // 会话内单调递增，从 1 开始
  at: number                      // Date.now()
  dir: 'rx' | 'tx' | 'system'
  level: 'info' | 'warn' | 'error'
  bytes: Uint8Array               // system 条目为空
  text: string                    // rx/tx 为按显示编码流式解码后的文本；system 为消息文本
  origin?: Origin
  decoded?: { protocolId: string; protocolName: string; results: DecodeResult[]; error?: string; unframed?: boolean }
}
interface LogBuffer {
  maxEntries: number; maxBytes: number
  append(entries: LogEntry[]): void
  range(fromSeq: number, limit: number): LogEntry[]     // 按 seq 升序
  tail(limit: number): LogEntry[]
  search(pred: (e: LogEntry) => boolean, limit: number): LogEntry[]   // 从新到旧扫描
  snapshot(): LogEntry[]
  clear(): void
  readonly size: number; readonly bytes: number; readonly firstSeq: number; readonly lastSeq: number
}
```

- 每条记录占用的字节数按 `bytes.length + text.length * 2 + 128` 估算；条数或字节数超出上限时，从最旧的记录开始淘汰。
- 会话的 `entries` 事件每 50ms 合并发出一次，参数为新增的条目数组。
- 有协议时：
  - Worker 返回的每一帧生成一条 rx（或 tx）条目，`decoded.results` 为解析结果；
  - `discard` 事件的数据在 100ms 内合并成一条 rx 条目，`decoded = { unframed: true, error: '未成帧数据', results: [] }`。
- 无协议时，TX 条目没有 `decoded`。有协议时，TX 条目在写入成功后先追加，`decodeTx` 返回结果后，按 `seq` 回填 `decoded`，并触发一次 `entries` 更新事件（事件参数带 `updated: seq[]`）。

**组包（`send/compose.ts`）**：

```ts
interface ComposeOptions {
  mode: 'text' | 'hex'
  encoding: TextEncodingName
  eol: 'none' | 'cr' | 'lf' | 'crlf'
  checksum: 'none' | ChecksumKind
  checksumEndian: 'le' | 'be'      // 只对 16 位校验有效；默认：crc16-modbus 用 le，crc16-ccitt 用 be
  checksumSkip: number             // 计算校验时跳过的前导字节数（如帧头），默认 0
}
compose(input: string, opts: ComposeOptions): { ok: true; bytes: Uint8Array } | { ok: false; error: string }
// 顺序：内容字节 → 对 content[skip..] 计算校验并追加在末尾 → 追加行尾
```

**重复发送（`send/repeat.ts`）**：

- `RepeatOptions = { bytes: Uint8Array; intervalMs: 10–60000; count: number | null }`，`count` 为 `null` 表示无限次。
- 启动时对 `bytes` 做快照。用 `setTimeout` 链调度：上一次写入完成后，再等待 `intervalMs`。
- `RepeatStatus = { sent: number; count: number | null; intervalMs: number }`。
- 停止条件：用户停止、达到次数、写入失败、会话离开 open 状态、协议编码失败。

**宏（`send/macro.ts`）**：

```ts
interface Macro { id: string; name: string; loop: boolean; steps: MacroStep[] }   // steps 最多 100 个
type MacroStep =
  | { type: 'send'; input: string; options: ComposeOptions }
  | { type: 'delay'; ms: number }                           // 10–600000
  | { type: 'signal'; dtr?: boolean; rts?: boolean; brk?: boolean }
```

- 开始运行时，先对所有 `send` 步骤组包；任一步骤组包失败就拒绝启动，并提示是第几步出错。
- 运行开始、结束、被停止时各写一条系统日志；循环运行时，每轮不重复写开始日志。
- 发送失败、会话断开、`signal` 步骤遇到不支持的能力时，停止运行并写系统日志。
- `MacroStatus = { macroId: string; name: string; step: number; loopCount: number }`。

**转发（`bridge/service.ts`）**：

```ts
interface BridgeRule { id: string; a: string; b: string; mode: 'oneway' | 'duplex'; paused: boolean; stats: { aToB: number; bToA: number; dropped: number } }
// oneway：a 的 RX 原始字节写入 b
// duplex：在 oneway 基础上，b 的 RX 原始字节也写入 a
interface BridgeService {
  list(): BridgeRule[]
  add(a: string, b: string, mode: 'oneway' | 'duplex'): { ok: true; rule: BridgeRule } | { ok: false; error: string }
  setPaused(id: string, paused: boolean): void
  remove(id: string): void
  on(ev: 'change', cb): () => void
}
```

- 拒绝以下规则：
  - a === b：「不能转发到自身」；
  - 与已有规则重复（同一对会话、同一方向）：「已存在相同的转发规则」；
  - 加入后，规则图中出现长度 ≥ 3 的有向环：「该规则会形成转发环路」。
- 已有 `a→b` 时再添加 `b→a`，自动合并为一条 duplex 规则。
- 转发数据取自读循环中原始的 RX 块，在分帧之前取得，不经过协议。写入目标时，`origin` 为 `bridge`。
- 每个转发方向有一个独立的待写队列，上限 256KB。超过上限时丢弃最旧的块，并累加 `dropped`。
- 任一端离开 open 状态时，规则自动 `paused = true`，并写系统日志「转发已暂停：<会话名> 已断开」。重新连接后不会自动恢复。
- 会话被 dispose 时，删除相关的规则。
- 转发规则不持久化。

**预设与设备记忆（`presets/`）**：

```ts
interface Preset {
  id: string; name: string; providerKind: string
  settings: Record<string, unknown>
  protocolId: string | null
  rxOptions: RxOptions
  displayMode: DisplayMode
  compose: ComposeOptions
  quickGroupId: string | null
  logPolicy: LogPolicy
  extras: Record<string, unknown>       // 工具自有的附加项，link 领域不解释其内容；串口工具用 extras.dashboardId 记录要打开的仪表盘
}
interface DeviceMemory { deviceKey: string; settings: Record<string, unknown>; protocolId: string | null; rxOptions: RxOptions; displayMode: DisplayMode; updatedAt: number }
type DisplayMode = 'raw' | 'decoded' | 'both'
```

- 预设只能套用到 `providerKind` 相同的会话。会话处于 open 状态时，只套用协议、`rxOptions`、显示模式、组包选项，并提示「连接参数将在断开后生效」，同时把参数写入会话，等下次 `open()` 时使用。
- 设备记忆：会话成功打开时，以及协议、显示模式改变时，按 `deviceKey` 保存一条记录；最多保留 50 条（按 LRU 淘汰）。用同一 `deviceKey` 创建会话时，自动填入这些值，但不自动打开。
- 存储位置：`createDomainStorage('link')` 中的 `presets` 和 `devices`。
- 预设可以导出为 JSON 文件 `toolset-presets.json`，导入时按 `id` 合并。

### 6.7 领域公共接口

- `domains/link/public.ts` 只导出：
  - `getLinkManager()`（单例，惰性创建）
  - `getBridgeService()`
  - `getPresetStore()`、`getDeviceMemory()`
  - `compose`
  - `exportLog`
  - 上述相关类型
- `domains/protocol/public.ts` 只导出：
  - `getProtocolRepository()`
  - `createProtocolRuntime`
  - `validateDefinition`
  - `TEMPLATES`
  - `BUILTIN_PROTOCOLS`
  - 相关类型
- `domains/bytes/public.ts` 导出 6.4 节列出的全部内容。
- `domains/series/public.ts` 只导出：
  - `getSeriesHub()`
  - `spectrum`、`minMaxDecimate`、`exportSeriesCsv`
  - 相关类型
- `domains/dashboard/public.ts` 只导出：
  - 6.9 节和 6.10 节中的类型；
  - `validateDashboard`、`migrateDashboard`、`createEmptyDashboard`；
  - 布局函数、`renderCommand`、`createHistory`、`generateDashboard`；
  - `compileCustomWidget`、`createCallGuard`、`safeMode`、`CUSTOM_WIDGET_TEMPLATES`。

### 6.8 变量时间序列（`domains/series`）

```ts
interface SeriesHub {
  configure(opts: { capacity: number; maxVariablesPerSource: number }): void   // 默认 100000 和 64；只影响之后新建的变量
  source(sessionId: string): SeriesSource | undefined
  sources(): SeriesSource[]
  on(ev: 'sources', cb: () => void): () => void
}

interface VariableInfo {
  key: string
  label?: string; unit?: string                 // 来自 DecodeResult.variableMeta，后到的值覆盖先到的
  computed: boolean
  error?: string                                // 计算变量出错时的错误信息
  count: number; last: number; lastAt: number
  min: number; max: number; mean: number        // 自上次 resetStats 以来的统计
  rate: number                                  // 最近 1 秒的样本数
}

interface SeriesSlice { idx: Float64Array; t: Float64Array; v: Float64Array }   // 按 idx 升序；每次返回新数组

interface SeriesSource {
  readonly sessionId: string
  readonly frameIdx: number                     // 已处理的、含变量的帧数（从 1 开始计数）
  readonly invalidSamples: number               // 非有限数值等无效样本的数量
  readonly ignoredVariables: string[]           // 超出上限而被忽略的变量名（最多记录 32 个）
  variables(): VariableInfo[]                   // 按首次出现的顺序
  latest(key: string): number | undefined
  read(key: string, q?: { last?: number; sinceIdx?: number; fromT?: number; toT?: number; limit?: number }): SeriesSlice
  // limit 默认 100000，取满足条件的最新 limit 个点
  setComputed(defs: ComputedVariable[]): Array<{ key: string; error: string }>   // 返回编译错误；整体替换原有定义
  resetStats(): void
  clear(): void                                 // 清空所有样本和统计，保留变量列表和计算变量定义
  on(ev: 'variables', cb: () => void): () => void            // 变量增减、元信息变化、计算变量出错
  on(ev: 'data', cb: (e: { frameIdx: number }) => void): () => void   // 每批帧处理完后发出一次
}

interface ComputedVariable { key: string; expr: string; unit?: string; label?: string }
```

**挂接**：

- `SeriesHub` 在首次调用 `getSeriesHub()` 时创建，并订阅 `LinkManager` 的 `sessions` 事件：
  - 对每个会话订阅 `frames` 事件，惰性创建 `SeriesSource`（收到第一个带变量的帧时才创建）；
  - 会话 dispose 时，删除对应的 `SeriesSource` 并发出 `sources` 事件。
- 只处理 `direction === 'rx'` 的帧。

**样本写入**：

- 对每一帧，按 6.5 节的提取规则得到 `{ key: value }`。该帧含有至少一个变量时，`frameIdx += 1`，帧内所有变量的样本都使用这个 idx。
- **时间戳插值**（`timestamps.ts`）：同一批 `frames` 中 `at` 相同的 n 个帧，设该源上一个样本的时间为 `lastT`：
  - 若 `lastT` 存在且 `0 < at - lastT ≤ 1000`，第 i 帧（从 0 开始）的时间 = `lastT + (at - lastT) × (i + 1) / n`；
  - 否则 n 帧都使用 `at`。
  - 保证时间单调不减。
- **新变量**：
  - 变量数达到 `maxVariablesPerSource` 时，忽略新的变量名，记入 `ignoredVariables`，并通过 `variables` 事件通知（界面显示警告）。
  - 全部源的变量总数上限为 256，处理方式相同。

**环形缓冲**（`ring.ts`）：

- 每个变量有三个数组：`idx`（Float64Array）、`t`（Float64Array）、`v`（Float64Array）。
- 初始容量 1024；写满后翻倍扩容，直到 `capacity`；之后覆盖最旧的样本。
- 计算变量也使用同样的缓冲。

**计算变量**（`computed.ts`）：

- `key` 必须符合变量名规则，存储时自动加上前缀 `fx.`（`ComputedVariable.key` 中不写前缀）。`expr` 是一个 JS 表达式，长度不超过 1000 个字符。
- 编译方式：`new Function('v', 't', 'dt', 'prev', 'lib', '"use strict"; const { abs, sqrt, pow, exp, log, log10, sin, cos, tan, asin, acos, atan, atan2, min, max, floor, ceil, round, sign, hypot, PI, E, clamp } = lib; return (' + expr + ');')`。`clamp(x, lo, hi)` 由 lib 提供。
  - `v`：该源所有变量的最新值，可写作 `v.temp` 或 `v['ch0']`；前面已求出的计算变量可以通过 `v['fx.<key>']` 引用。
  - `t`：帧时间（ms）。
  - `dt`：与该计算变量上一次求值的时间差（秒），首次为 0。
  - `prev`：该计算变量上一次的输出，首次为 `NaN`。可用于积分、滤波，例如 `isNaN(prev) ? v.x : prev * 0.9 + v.x * 0.1`。
- **求值时机**：每个含变量的帧写入后，按定义顺序依次求值。结果是有限数才写入（使用同一个 idx 和 t），否则计入 `invalidSamples`。
- **出错**：表达式抛出异常时，该计算变量停止求值，`VariableInfo.error` 设为错误消息，并发出 `variables` 事件。重新调用 `setComputed` 时恢复求值。
- 计算变量在主线程中执行，属于用户可信代码，安全说明与第 6.10 节相同。

**频谱**（`fft.ts`）：

```ts
spectrum(samples: Float64Array, opts: { size: number /* 2 的幂，256–16384 */; window: 'none' | 'hann' | 'hamming' | 'blackman'; sampleRate: number; scale: 'linear' | 'db'; removeDc: boolean }): { freq: Float64Array; mag: Float64Array }
```

- 取最后 `size` 个样本，不足时在前面补 0。
- 计算单边幅度谱：`mag[k] = 2·|X[k]| / (N·cg)`，其中 `cg` 为窗函数的相干增益；DC 和 Nyquist 分量不乘 2。
- `scale` 为 `'db'` 时取 `20·log10(max(mag, 1e-12))`。
- 输出 `size/2 + 1` 个点。

**抽取**（`decimate.ts`）：`minMaxDecimate(x, y, buckets)` 把数据分成 `buckets` 段，每段保留最小值和最大值两个点（按 x 顺序），输出最多 `2·buckets` 个点。数据点数不超过 `4·buckets` 时，原样返回。

**导出**（`export.ts`）：

- `exportSeriesCsv(source, keys, range?: { fromIdx?: number; toIdx?: number }): string`。
- 格式：UTF-8 带 BOM；列为 `frame,time_iso,time_ms,<key1>,<key2>,…`。
- 按 idx 合并：每个 idx 一行，该帧中没有出现的变量留空。
- 数值用 `String(v)` 输出，不做舍入。

### 6.9 仪表盘模型与命令（`domains/dashboard`）

```ts
interface Dashboard {
  schema: 1
  id: string; name: string; createdAt: number; updatedAt: number
  rowHeight: number                               // 网格行高，16–64 px，默认 28
  sources: DashboardSource[]                      // 至少 1 个，第一个为默认数据源
  variableMeta: Record<string, VariableMetaOverride>   // 键为 '<alias>/<key>'
  computed: Record<string, ComputedVariable[]>    // 键为 alias
  widgets: WidgetInstance[]
}
interface DashboardSource {
  alias: string                                   // /^[a-z][a-z0-9_]{0,15}$/，在仪表盘内唯一；默认数据源为 'main'
  label: string                                   // 如 '主设备'
  match?: { deviceKey?: string; providerKind?: string }   // 自动匹配会话的依据
}
interface VariableMetaOverride { label?: string; unit?: string; color?: string; scale?: number; offset?: number; decimals?: number }
// 显示值 = 原始值 × scale + offset（默认 1 和 0），只影响仪表盘的显示和控件的反馈值，不改变 series 中的数据和 CSV 导出
// 显示名、单位的优先级：variableMeta > DecodeResult.variableMeta > 变量 key

interface VarRef { source: string; key: string }  // source 为 alias

interface WidgetInstance {
  id: string
  type: string                                    // 内置类型（如 'chart.line'）或 'custom:<customWidgetId>'
  version: number                                 // 组件定义的 props 版本，用于迁移
  x: number; y: number; w: number; h: number      // 网格单位：0 ≤ x，x + w ≤ 24，1 ≤ w ≤ 24，1 ≤ h ≤ 64，y ≥ 0
  common: CommonProps
  props: Record<string, unknown>
  state?: Record<string, unknown>                 // 只供自定义控件使用；JSON 可序列化，不超过 64KB
}
interface CommonProps {
  title: string                                   // 默认为组件类型名
  showTitle: boolean                              // 默认 true
  titleAlign: 'left' | 'center'                   // 默认 'left'
  background: 'default' | 'transparent' | string  // string 为颜色值；默认 'default'（--bg-elev）
  border: boolean                                 // 默认 true
  padding: 0 | 4 | 8 | 12                         // 默认 8
  fontScale: number                               // 0.75–2，默认 1
}
```

**属性描述**（内置组件和自定义控件共用，驱动属性面板）：

```ts
type WidgetPropField = PropBase & (
  | { type: 'number'; min?: number; max?: number; step?: number; unit?: string; default?: number }
  | { type: 'text'; maxLength?: number; placeholder?: string; default?: string }
  | { type: 'textarea'; rows?: number; default?: string }
  | { type: 'select'; options: Array<{ label: string; value: string | number }>; default?: string | number }
  | { type: 'checkbox'; default?: boolean }
  | { type: 'color'; default?: string }                                // 支持 'auto'（按变量颜色或主题色）
  | { type: 'range'; default?: { min: number | null; max: number | null } }   // null 表示自动
  | { type: 'variable'; default?: VarRef | null }
  | { type: 'variables'; min?: number; max?: number; itemFields?: WidgetPropField[] }   // 值：Array<VarRef & 其他字段>
  | { type: 'thresholds'; default?: Threshold[] }
  | { type: 'zones'; default?: Zone[] }
  | { type: 'options'; default?: Array<{ label: string; value: string | number }> }
  | { type: 'command'; default?: CommandSpec | null }
  | { type: 'expression'; default?: string }                           // 单行 JS 表达式
)
interface PropBase {
  key: string; label: string
  tab: 'data' | 'style' | 'behavior'                                   // 属性面板标签页：数据 / 外观 / 行为
  help?: string
  visibleWhen?: { key: string; equals: unknown | unknown[] }           // 条件显示，用来保持面板简洁
}
interface Threshold { op: '>' | '>=' | '<' | '<=' | '==' | '!='; value: number; color: string; label?: string }
interface Zone { from: number; to: number; color: string }
```

**`validateDashboard(input: unknown)`**：

- 返回 `{ ok: true; dashboard } | { ok: false; errors: string[] }`。
- 校验所有字段的类型和范围、alias 唯一、`variableMeta` 键的格式、组件 id 唯一。
- 越界的布局交给 `normalize` 修正，不视为错误。
- `migrateDashboard` 负责 schema 升级；v1 只需能识别 `schema: 1`。

**网格布局**（`layout.ts`，全部是不可变的纯函数）：

```ts
const COLS = 24
type Rect = { id: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number }
collides(a: Rect, b: Rect): boolean
compact(items: Rect[]): Rect[]            // 按 (y, x) 排序后，逐个尽量上移，直到碰到其他组件或顶部
moveItem(items, id, x, y): Rect[]         // x 夹在 [0, 24 - w]，y ≥ 0；与之重叠的组件依次下推到它下方（递归），最后 compact
resizeItem(items, id, w, h): Rect[]       // 夹在 [minW/minH, 24 - x / 64]；重叠的组件下推，最后 compact
placeNew(items, w, h, at?: { x: number; y: number }): { items: Rect[]; placed: Rect }   // 有 at 时等同于 moveItem；否则从上到下、从左到右找第一个放得下的位置
normalize(items): Rect[]                  // 修正越界和重叠（加载时使用）
```

- 像素换算：列宽 = `(窗格宽 - 6 × 25) / 24`，间距 6px；行高为 `rowHeight`。
- 拖动过程中显示目标占位框，实时计算布局预览；松开鼠标后提交一次。

**撤销/重做**（`history.ts`）：

- `createHistory(initial, { limit: 100 })`，提供 `push(next, mergeKey?)`、`undo()`、`redo()`、`canUndo`、`canRedo`。
- 500ms 内带相同 `mergeKey` 的连续 `push` 合并为一步，用于连续修改同一属性、拖动滑块等场景。
- 一次拖动或缩放只记录一步。

**命令**（`commands.ts`）：

```ts
type CommandSpec =
  | { kind: 'template'; source: string; mode: 'text' | 'hex'; template: string; options: Omit<ComposeOptions, 'mode'> }
  | { kind: 'protocol'; source: string; values: Record<string, string | number | boolean> }   // 调用 sendForm
  | { kind: 'signal'; source: string; dtr?: boolean; rts?: boolean; brk?: boolean }
  | { kind: 'quick'; source: string; quickItemId: string }                                    // 执行一个快捷发送项

renderCommand(spec: CommandSpec, value: number | boolean | string | undefined, lookup: (ref: VarRef) => number | undefined):
  | { ok: true; action: { kind: 'bytes'; source: string; bytes: Uint8Array }
                     | { kind: 'form'; source: string; values: Record<string, SendValue> }
                     | { kind: 'signal'; source: string; dtr?: boolean; rts?: boolean; brk?: boolean }
                     | { kind: 'quick'; source: string; quickItemId: string } }
  | { ok: false; error: string }
```

- **占位符语法**：`{name}` 或 `{name:fmt}`；`{{` 和 `}}` 表示字面量花括号。
  - `name` 可以是 `value`（控件当前值），也可以是 `var.<key>`（同一数据源中该变量最新的显示值）。
- **text 模式**的 `fmt`：
  - 不写：数字用 `String()`，布尔值为 `1`/`0`，字符串原样输出；
  - `.Nf`：保留 N 位小数（N 为 0–10）；
  - `d`：四舍五入为整数；
  - `0Nd`：四舍五入后补零到 N 位；
  - `x` / `X`：四舍五入后输出小写/大写十六进制。
  - 替换完成后，用 `compose`（text 模式和 `options`）生成字节。
- **hex 模式**：模板是 HEX 字符串，每个占位符必须带字节类型 `fmt`：`u8 i8 u16le u16be i16le i16be u32le u32be i32le i32be f32le f32be f64le f64be`。
  - 整数类型先四舍五入，再检查范围。越界时返回错误，例如「值 300 超出 u8 范围（0–255）」。
  - 占位符替换为对应字节后，用 `compose`（hex 模式和 `options`）追加校验和行尾。
- **protocol**：`values` 中的字符串值如果正好等于 `'{value}'` 或 `'{var.<key>}'`，替换为原始类型的值；其他字符串按 text 规则做格式化替换。
- **错误情况**：数据源没有绑定到会话、变量缺失、值缺失时返回错误，例如「数据源 main 未连接」「变量 temp 暂无数据」「控件没有当前值」。

**一键生成**（`generate.ts`）：`generateDashboard(variables: VariableInfo[], opts: { alias: string; name: string }): Dashboard`。

- 变量不超过 8 个：
  - 第一行是一个波形图（w 24，h 10），包含全部变量；
  - 第二行为每个变量各放一个数值组件，`w = max(3, floor(24 / n))`，h 3，排满一行后换行。
- 变量超过 8 个：
  - 每 8 个变量放一个波形图（w 12，h 9），两两并排；
  - 最后放一个变量表（w 24，h = min(2 + n, 16)），包含全部变量。
- 变量颜色按调色板依次分配，写入 `variableMeta`。调色板定义在 `tokens.css` 中，`--series-1` 至 `--series-12`，需要在深色和浅色两种主题下都清晰可辨。

### 6.10 自定义控件（`domains/dashboard/custom` + 工具层宿主）

用户在站内编写一段 JS 函数体，运行时通过 `new Function('sdk', code)` 编译后调用，必须 `return` 一个 `CustomWidgetDefinition`。代码在主页面中直接运行，可以使用 DOM、Canvas、SVG。

```ts
interface CustomWidgetDefinition {
  apiVersion: 1
  meta: { name: string; description?: string; version?: string; group?: 'chart' | 'value' | 'control' }   // group 默认 'value'
  size?: { default?: { w: number; h: number }; min?: { w: number; h: number } }   // 默认 6×6，最小 2×2
  props?: WidgetPropField[]                        // 自动生成属性面板，key 不得与 'variables' 冲突
  variables?: { min: number; max: number }         // 声明后，属性面板「数据」页自动加入变量选择（值保存在 props.variables 中）
  mount(el: HTMLElement, ctx: CustomWidgetContext): CustomWidgetInstance | void
}

interface CustomWidgetInstance {
  update?(data: WidgetFrameData): void             // 刷新周期内有新数据或 requestUpdate 时调用
  propsChanged?(props: Record<string, unknown>): void   // 未实现时，属性变化会触发 destroy 后重新 mount
  resize?(size: { width: number; height: number }): void
  destroy?(): void
}

interface WidgetFrameData {
  now: number
  latest: Array<number | undefined>                // 与 ctx.variables 顺序一致，已应用 scale/offset
  appended: Array<{ idx: Float64Array; t: Float64Array; v: Float64Array }>   // 自上次 update 以来的新样本，每个变量最多 10000 个，已应用 scale/offset
}

interface CustomWidgetContext {
  readonly props: Readonly<Record<string, unknown>>    // 已合并默认值
  readonly variables: ReadonlyArray<{ source: string; key: string; label: string; unit: string; color: string }>
  readonly size: { width: number; height: number }
  readonly mode: 'edit' | 'run'
  latest(i: number): number | undefined
  history(i: number, q?: { last?: number; fromT?: number }): { idx: Float64Array; t: Float64Array; v: Float64Array }   // 最多 100000 个点
  send(cmd: CommandSpec | string, value?: number | boolean | string): Promise<void>
  // cmd 为字符串时，视为 text 模板，发往默认数据源，组包选项使用该会话手动发送区的当前设置
  sendBytes(bytes: Uint8Array | number[], source?: string): Promise<void>
  sourceState(source?: string): 'open' | 'closed' | 'unbound'
  readonly state: Record<string, unknown>          // 实例的持久状态，随仪表盘保存
  saveState(): void                                // 1 秒内把 state 写入仪表盘（通过 JSON 往返检查，超过 64KB 时抛错）
  theme(cssVar: string): string                    // 读取 CSS 变量，如 theme('--accent')
  onThemeChange(cb: () => void): () => void
  requestUpdate(): void
  log(...args: unknown[]): void                    // 输出到编辑器的调试面板（最近 100 行），同时调用 console.debug
  readonly sdk: PluginSdk                          // 与协议插件相同的 SDK（6.5 节）
}
```

**宿主**（`tools/serial/dashboard/custom/CustomWidgetHost.vue`）：

- 在组件内容区创建一个 `div`，执行 `attachShadow({ mode: 'open' })`，把 shadow root 内的容器 `div`（宽高 100%）作为 `el` 传给 `mount`。
  - 自定义样式不会泄漏到页面；CSS 变量可以继承进 shadow DOM。
- 用 `ResizeObserver` 监听尺寸变化，调用 `resize`，并在 rAF 中节流。
- 数据通过统一的刷新调度（8.10 节）按帧下发；没有新数据且没有 `requestUpdate` 时，不调用 `update`。

**调用保护**（`custom/guard.ts`，内置组件不受此限制）：

- `mount`、`update`、`propsChanged`、`resize`、`destroy` 每次调用都用 try/catch 包裹，并用 `performance.now()` 计时。
- **抛出异常**：组件区域显示错误浮层（错误消息 +「重试」按钮）。10 秒内出现 3 次异常时，停用该实例，显示「已停用：多次出错」。
- **单次调用超过 200ms**：立即停用，显示「执行时间过长（N ms），已停用」。
- **最近 2 秒内 `update` 的平均耗时超过 16ms**：停用，显示「平均执行时间过长，已停用」。
- 停用后的实例提供「重新启用」按钮（重新 mount，计数清零）和「编辑代码」按钮。
- **发送限速**：每个实例的 `send` 和 `sendBytes` 每秒最多 50 次，超出的调用 reject，错误为「发送过于频繁」。
- 实例停用或卸载时，宿主调用 `destroy`（同样受保护），然后清空 shadow root 的内容。

**安全模式**（`custom/safe-mode.ts`）：

- **调用标记**：每次调用自定义控件代码之前，同步写入 `localStorage['toolset/safe-mode/pending'] = JSON.stringify({ customId, name, at })`；调用返回或抛出后，同步删除该键。`pagehide` 时也删除。
- **启动检查**：仪表盘模块加载时检查该键。如果存在，说明上次页面在执行自定义控件时失去了响应：
  1. 把其中的 `customId` 加入 `toolset/safe-mode/blocked`（JSON 数组）；
  2. 删除 pending 键；
  3. 仪表盘顶部显示横幅：「上次运行自定义控件「<name>」时页面可能失去响应，已暂停该控件。」，提供「重新启用」（从 blocked 中移除）和「编辑代码」两个按钮。
- 被暂停的控件显示占位框：「已暂停（安全模式）」。
- **全局安全模式**：URL 为 `#/tools/serial?safe=1` 时，不执行任何自定义控件代码，并显示横幅「安全模式：自定义控件未加载」。帮助面板和第 9 节的错误文案中要说明这个入口。
- `toolset/safe-mode/*` 是 6.3 节「禁止直接访问 localStorage」规则的例外，不进入备份。

**自定义控件仓库**（工具存储）：

- 索引：local `widgets`，内容为 `Array<{ id, name, updatedAt }>`。
- 代码：kv `widgets/<id>`，内容为 `CustomWidgetRecord = { id: string; name: string; code: string; createdAt: number; updatedAt: number }`。
- 代码不超过 256KB。
- 可以导出为 `<name>.widget.js`，也可以导入。

**编译校验**（`custom/compile.ts`，`compileCustomWidget(code)`）：

- 返回 `{ ok: true; definition } | { ok: false; error: string; line?: number }`。
- 校验项：
  - `apiVersion === 1`；
  - `meta.name` 非空；
  - `mount` 是函数；
  - `props` 符合 `WidgetPropField`，key 唯一，类型合法；
  - `variables` 的 min/max 满足 `0 ≤ min ≤ max ≤ 16`；
  - `size` 在网格范围内。

**模板**（`CUSTOM_WIDGET_TEMPLATES`，每个都要带注释）：

1. 最小数值显示：显示 1 个变量，并用属性设置字号和颜色。
2. Canvas 曲线：使用 `history` 和 `appended` 绘制滚动曲线。
3. 命令按钮组：属性中的 `options` 列表生成一组按钮，点击后用 `ctx.send` 发送模板命令。
4. 姿态指示器：绑定 roll 和 pitch 两个变量，用 Canvas 绘制人工地平线。

**安全说明**：自定义控件拥有与页面相同的权限（可以访问 DOM、本地存储、已打开的串口），只应运行自己编写或信任的代码。这段说明必须写入 `docs/custom-widget.md`，并显示在编辑器顶部，在首次新建或导入时显示一次。

### 6.11 本机配置备份（`shared/lib/storage/backup.ts`）

```ts
interface BackupFile {
  format: 'toolset-backup'
  formatVersion: 1
  appName: string
  createdAt: string                          // ISO 8601
  userAgent: string
  sections: BackupSection[]
}
interface BackupSection {
  namespace: string                          // 'toolset/app/'、'toolset/protocol/'、'toolset/link/'、'toolset/tool/<id>/' 等
  local: Record<string, string>              // 完整键 → localStorage 中的原始字符串
  kv: Record<string, unknown>                // 完整键 → IndexedDB 中的值
}

listBackupItems(): Promise<Array<{ namespace: string; items: Array<{ key: string; store: 'local' | 'kv'; name: string; bytes: number }> }>>
exportBackup(select?: { namespaces?: string[]; keys?: string[] }): Promise<BackupFile>
parseBackup(text: string): { ok: true; file: BackupFile; summary: Array<{ namespace: string; localCount: number; kvCount: number; bytes: number }> } | { ok: false; error: string }
importBackup(file: BackupFile, opts: { namespaces: string[]; mode: 'merge' | 'replace' }): Promise<{ written: number; deleted: number; failed: Array<{ key: string; error: string }> }>
clearAllLocalData(): Promise<void>
```

**命名空间规则**：

- 键以 `toolset/tool/<id>/` 开头时，命名空间就是这个前缀。
- 否则取 `toolset/<第一段>/`。
- `name` 是去掉命名空间和 `.v<n>` 后缀之后的部分。

**枚举时排除**：

- 不以 `toolset/` 开头的键；
- 包含 `.corrupt.` 的键；
- 以 `toolset/safe-mode/` 开头的键。

**`parseBackup` 校验**：

- 文本是合法的 JSON；
- `format` 正确，`formatVersion` 为 1；
- 每个键都以 `toolset/` 开头，并以所在 section 的 `namespace` 开头；
- `local` 中的值都是字符串；
- 文件总大小不超过 50MB。

失败时的错误文案示例：「不是有效的 Toolset 配置文件」「配置文件版本过新（formatVersion 2），请升级后再导入」。

**`importBackup`**：

- `merge`：逐个写入，同名键覆盖，其他键保留。
- `replace`：先删除所选命名空间下所有现有的 local 键和 kv 键，再写入。
- 单个键写入失败（如配额不足）时记入 `failed`，继续处理其余键。
- 导入完成后，由调用方刷新页面，让各 store 重新读取数据。数据版本的兼容性由各 store 自身的 `migrate` 处理：遇到更高的版本时，按 6.3 节作为损坏数据备份并恢复默认值。

**`clearAllLocalData`**：删除所有以 `toolset/` 开头的 localStorage 键，并清空 IndexedDB 的 `kv` 仓库。

**显示名称**：

- 命名空间：
  - `app/config/backup-labels.ts` 提供 `toolset/app/` → 外观设置、`toolset/protocol/` → 协议插件、`toolset/link/` → 连接预设与设备记忆；
  - 工具命名空间使用 manifest 的 `title`；
  - 未知命名空间显示原始前缀。
- 条目：使用 `manifest.backupLabels`，或 `backup-labels.ts` 中同结构的映射。支持 `prefix/*` 通配符，匹配 kv 键；未匹配时显示 `name`。

------

## 7. 应用外壳

### 7.1 路由

| 路径 | 内容 |
|------|------|
| `/` | HomeView |
| `/tools/<id>/…` | 由注册表生成 |
| `/:pathMatch(.*)*` | NotFoundView（显示「页面不存在」和返回首页的按钮） |

- 每次路由切换后，设置 `document.title`：工具页为 `<工具标题> · Toolset`，首页为 `Toolset · 嵌入式工具箱`。
- `ToolRouteView.vue`：
  - `layout` 为 `workspace` 时，根元素高度为 `calc(100vh - 头部高度)`，`overflow: hidden`；为 `page` 时，最大宽度 1200px，居中，有内边距，可滚动。
  - 渲染 `<RouterView v-slot="{ Component }">`。manifest 中 `keepAlive` 为 true 的工具，组件包在 `<KeepAlive>` 中，以工具 id 作为 key。
  - 用 `onErrorCaptured` 捕获渲染错误，切换到 `ToolErrorView`，显示：「该工具出现错误」、错误消息、「重新加载工具」按钮（递增 key 重新挂载）、「返回首页」按钮。
  - `router.onError` 捕获动态导入失败，显示同一个错误页，消息为「工具加载失败，请检查网络或刷新页面」。
  - 加载期间显示居中的加载指示器（延迟 200ms 后才出现）。

### 7.2 页面结构

- **AppHeader**：高 44px。
  - 左侧：站点名，点击回到首页。
  - 中间：「工具」下拉菜单，按分类分组列出工具。
  - 右侧：主题切换按钮（深色 → 浅色 → 跟随系统，循环切换）、设置按钮、帮助按钮。
- **HomeView**：
  - 按分类分组的工具卡片，内容为图标、标题、摘要，点击进入工具。
  - 卡片上方有一个搜索框，按标题、摘要、关键词过滤。
  - 底部「后续规划」：用纯文本列出 `roadmap.ts` 中的条目（数据格式转换、阻抗计算、网络/BLE 通道），不可点击。
- **SettingsDrawer**：右侧抽屉，宽 420px。
  - 第一组「外观」：主题、字号（12–18px，默认 13）、界面密度（紧凑/标准，默认紧凑）、「重置外观」。
  - 之后为每个提供了 `settings` 的工具各一组，组标题是工具名。组件在抽屉打开时懒加载。
  - 最后一组「数据」（`DataSettings.vue`），按 6.11 节实现：
    - **导出本机配置**：
      1. 打开对话框，以树形列表显示「命名空间 → 条目」，带中文名称和大小，默认全选；
      2. 点击「导出」后下载 `toolset-backup-YYYYMMDD-HHmmss.json`。
    - **导入本机配置**：
      1. 选择文件后，调用 `parseBackup` 校验；失败时显示错误。
      2. 校验成功后，对话框显示备份时间和各命名空间的条目数、大小，可以勾选要导入的命名空间。
      3. 导入方式：「合并（同名项覆盖，保留其他）」或「替换（先清空所选分区）」，默认合并。
      4. 「导入前下载当前配置备份」复选框，默认勾选。
      5. 确认对话框文案：「导入后页面将刷新，所有已打开的通道会断开。是否继续？」。
      6. 完成后弹出 Toast「导入完成（N 项），页面即将刷新」，1 秒后执行 `location.reload()`。有 `failed` 项时，先列出失败项，由用户点击「刷新页面」。
    - **清除全部本地数据**：危险确认，文案为「将删除所有设置、协议、预设、快捷发送、宏、仪表盘和自定义控件，且无法恢复。建议先导出配置。」；确认后清除并刷新页面。
- **HelpPanel**：右侧抽屉。
  - 外壳章节：浏览器要求、安全上下文说明、全局快捷键、如何新增工具（链接到仓库中的 `docs/tool-module.md`，只显示路径文本）。
  - 之后为各工具提供的帮助组件。
- **全局错误处理**：`main.ts` 中注册 `app.config.errorHandler`、`window.onerror`、`unhandledrejection` 三个处理器，统一执行 `console.error` 并弹出 Toast「发生未处理的错误：<消息>」。同一消息在 5 秒内只弹出一次。

### 7.3 共享 UI 服务

- `toast.show({ type: 'info' | 'success' | 'warn' | 'error'; message: string; duration?: number })`：默认显示 4 秒，error 类型显示 8 秒；最多同时显示 5 条。
- `confirm({ title, message, confirmText?, danger? }): Promise<boolean>`。
- `useExternalStore(subscribe, getSnapshot)`：返回 `shallowRef`；组件卸载时自动取消订阅。

### 7.4 视觉

- CSS 变量全部定义在 `tokens.css` 中，通过 `:root[data-theme='dark' | 'light']` 区分。必须包含以下变量：
  - `--bg`、`--bg-elev`、`--bg-hover`、`--border`
  - `--text`、`--text-dim`
  - `--accent`（青色）、`--danger`、`--warn`、`--ok`
  - `--log-rx`、`--log-tx`、`--log-sys`、`--log-err`、`--log-ts`、`--log-decoded`
  - `--font-ui`、`--font-mono`
  - `--radius`（4px）、`--row-h`
- 深色主题参考值：`--bg #12161c`、`--bg-elev #1a2029`、`--border #2a3340`、`--text #d6dde6`、`--accent #22b8cf`、`--log-rx #6cb6ff`、`--log-tx #f0b429`、`--log-sys #8b949e`、`--log-err #f85149`、`--log-ts #6e7681`、`--log-decoded #56d364`。
- 浅色主题要保证文字与背景的对比度 ≥ 4.5:1。
- 字体只使用系统字体栈：
  - UI：`system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif`
  - 等宽：`ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace`
- `index.html` 中放一段内联脚本：读取 `localStorage['toolset/app/settings.v1']` 中的主题；如果是 `system`，按 `prefers-color-scheme` 确定；然后在首屏渲染前设置 `document.documentElement.dataset.theme`。
- 窗口宽度小于 900px 时：串口工具的侧栏改为抽屉，并强制关闭分屏。

------

## 8. 串口上位机（`tools/serial`）

### 8.1 布局

```
┌ AppHeader ─────────────────────────────────────────────────────────────┐
├ Sidebar 280px ─┬ SessionTabs ── [分屏 ▣] ───────────────────────────────┤
│ 通道           │ ┌ Pane ─────────────────────────────────────────────┐ │
│  [新增串口]    │ │ LogToolbar                                         │ │
│  [新增演示端口]│ │ LogList                                            │ │
│  已授权端口…   │ │ ───────────────（可拖动分隔条）──────────────────── │ │
│ 当前会话       │ │ SendPanel：[手动] [快捷] [宏] [协议]               │ │
│  参数表单      │ │ StatusBar                                          │ │
│  [连接][断开]  │ └────────────────────────────────────────────────────┘ │
│  预设 ▾ [另存] │ （分屏开启时显示第二个 Pane）                         │
│  协议 ▾ [管理] │                                                        │
│  控制线 DTR RTS Break                                                   │
│ 转发规则…      │                                                        │
│ 支持状态       │                                                        │
└────────────────┴────────────────────────────────────────────────────────┘
```

- 侧栏中「当前会话」部分作用于最后获得焦点的 Pane 所显示的会话。仪表盘 Pane 的「当前会话」是其默认数据源绑定的会话。
- 没有会话时，主区域显示空状态：「还没有打开的通道」，以及每个可用提供者的「新增」按钮。仪表盘仍然可以打开和编辑，未绑定的数据源显示「未连接」。
- **Pane 视图切换**：每个 Pane 顶部右侧有一个分段控件「终端 | 仪表盘」。
  - 终端视图：即上图中的日志 + 发送区。
  - 仪表盘视图：见 8.10 节。
  - 典型用法：开启分屏后，左侧显示终端、右侧显示仪表盘，两者可以使用同一个会话。
- 仪表盘视图的全部代码，从 `DashboardPane.vue` 开始，都用 `defineAsyncComponent(() => import(...))` 加载。只使用终端时，不加载 uPlot 和仪表盘代码。

### 8.2 组件清单（`tools/serial/components/`）

| 组件 | 职责 |
|------|------|
| `ChannelSidebar.vue` | 提供者入口、已授权端口列表（显示名称、deviceKey；有会话时显示为「已打开」）、各提供者的支持状态 |
| `SessionSettings.vue` | 用 `SettingForm` 按 `settingsSchema` 渲染参数表单；连接/断开按钮；状态灯；重命名 |
| `PresetPicker.vue` | 选择预设、另存为预设、导入/导出预设 |
| `ProtocolPicker.vue` | 协议下拉（无协议 / 内置 / 自定义）+「管理」按钮 |
| `SignalControls.vue` | DTR、RTS 三态开关（未设置/高/低），Break 按钮（按下后发送 250ms 的 break） |
| `BridgePanel.vue` | 规则列表（a、b、方向、字节数、丢弃数、暂停/删除）+ 新建规则表单 |
| `SessionTabs.vue` | 标签显示状态灯、名称、未读数、转发图标；右键或「⋯」菜单提供：重命名、断开、关闭 |
| `SessionPane.vue` | 绑定一个 sessionId；组合以下四个组件 |
| `LogToolbar.vue` | 见 8.4 |
| `LogList.vue` | 见 8.4 |
| `SendPanel.vue` | 包含 `ManualSend`、`QuickSend`、`MacroPanel`、`ProtocolSendForm` 四个子组件 |
| `StatusBar.vue` | 状态、参数摘要（如 `115200 8N1`）、协议名和状态、RX/TX 字节数、日志条数及缓冲占用百分比、丢弃字节数、任务状态、转发状态 |
| `ProtocolManager.vue` | 全屏对话框，见 8.6 |
| `CodeEditor.vue` | 封装 CodeMirror，必须用动态 `import()` 加载 |

### 8.3 会话与界面状态

- `stores/sessions.ts`：
  - 订阅 `LinkManager` 和每个会话的事件，维护 `SessionView[]`。字段包括：id、name、state、lastError、stats、protocol、signals、tasks、unread、providerKind、settings。
  - 没有在任何 Pane 中显示的会话收到 rx 条目时，`unread` 加上新增的条数；会话被显示时清零。
- `stores/layout.ts`（持久化到工具存储 `layout`）：
  - `split: 'off' | 'horizontal' | 'vertical'`、`ratio: 0.2–0.8`、`sendPanelHeight`；
  - 每个 Pane 的显示设置：`displayMode`、`showTimestamp`、`showTx`、`showSystem`、`showBridge`、`viewAs: 'text' | 'hex'`、`wrap`、`autoScroll`。
  - 每个 Pane 的 `view: 'terminal' | 'dashboard'`（默认 terminal）、`dashboardId: string | null`、`dashboardSidebar: boolean`（运行模式下是否显示变量列表，默认 false）。
  - Pane 与会话的绑定关系、仪表盘数据源与会话的映射都不持久化，因为会话不会跨页面保留。
- 同一会话在两个 Pane 中显示时，两者共享会话的任务状态；发送按钮和任务按钮的状态都来自会话。
- **关闭标签**：
  - 日志条数大于 0 时，先确认：「关闭后该通道的日志将丢失，是否继续？」；
  - 确认后调用 `session.dispose()`。

### 8.4 日志显示

**工具栏按钮**（每个 Pane 独立设置）：

- 显示模式：分段控件「原始 / 解析 / 原始+解析」，没有协议时禁用；
- 时间戳、TX、系统、转发记录：开关；
- 文本/HEX 切换；
- 自动换行；
- 暂停刷新：暂停期间日志照常记录，只是不更新界面；
- 日志策略：下拉选择「全部记录 / 抽样记录（每秒 N 条）/ 不记录数据帧」，对应会话的 `logPolicy`。处于抽样或不记录状态时，按钮高亮，并在悬停提示中显示已省略的帧数；
- 搜索框：普通文本匹配；以 `/` 开头时按正则匹配；匹配范围是 text、HEX 和解析摘要；
- 清空：清空会话的 LogBuffer，两个 Pane 同步清空；
- 导出：下拉选择 TXT、CSV、BIN；
- 字号：A−/A+，范围 10–20px。

**渲染**：

- 最多渲染最近 2000 条（`tail(2000)`）；更早的记录通过顶部「加载更早的 2000 条」按钮，用 `range()` 追加。
- 每一行使用 `content-visibility: auto; contain-intrinsic-size: auto var(--row-h)`。不引入虚拟滚动库。
- 搜索时改为显示 `search()` 的结果（最多 2000 条），顶部显示「找到 N 条（最多显示 2000）」。

**行格式**：

```
[时间戳] 方向标签 内容
```

- 时间戳格式 `HH:mm:ss.SSS`，颜色 `--log-ts`。
- 方向标签：`RX` / `TX` / `SYS`，TX 后面附加来源标记，如 `TX·宏`、`TX·转发`。
- 内容的颜色按方向取值；`level: 'error'` 的行使用 `--log-err`。
- 文本模式下，控制字符显示为 `\r`、`\n`、`\t`、`\xNN`，颜色比正文暗。
- 单条记录的内容超过 1024 字节时截断，并在行尾显示「…（共 N 字节）」。

**三种显示模式**：

- `raw`：只显示原始行。
- `decoded`：有 `decoded.results` 的帧只显示解析行（`摘要  标签=值单位  …`），点击一行可以展开或收起原始数据；有 `decoded.error` 的帧显示原始行和红色错误标记。
- `both`：先显示原始行，下一行缩进 2 个字符显示 `└ 摘要  字段…`，颜色为 `--log-decoded`；一帧有多条解析结果时，每条一行。

**自动滚动**：只在距离底部 32px 以内时保持滚动到底；用户向上滚动后自动关闭，并在右下角显示「回到底部」按钮。

**导出**（`domains/link/log/export.ts`，对 `snapshot()` 的结果按当前过滤条件处理）：

- 文件名：`<会话名>_<YYYYMMDD-HHmmss>.<ext>`，非法字符替换为 `_`。
- TXT：`YYYY-MM-DD HH:mm:ss.SSS DIR 内容`；按当前的显示模式和文本/HEX 设置输出。
- CSV：UTF-8 带 BOM，列为 `time,dir,origin,level,hex,text,summary,fields`；`fields` 为 JSON 字符串。
- BIN：把所有 RX 条目的原始字节按顺序拼接。

### 8.5 发送区

**手动发送标签页**：

- 多行输入框；模式选择 文本/HEX；编码；行尾；校验（含大小端和「跳过前 N 字节」，放在折叠的「高级」中）。
- 下方实时显示「将发送 N 字节：HEX 预览」，或红色的行内错误。
- 「发送」按钮。快捷键 Ctrl/Cmd+Enter；可在设置中开启「Enter 发送」，开启后 Shift+Enter 换行；`isComposing` 为 true 时不触发发送。
- 历史：每个会话在内存中保留最近 50 条（与上一条相同时不重复记录），通过输入框旁的「历史 ▾」选择回填，不持久化。
- 重复发送：勾选「定时发送」后填写间隔和次数（留空表示无限），点击「开始」后显示「已发送 n / N」和「停止」按钮。间隔小于 50ms 时显示黄色警告「间隔过小可能导致设备或页面过载」。
- 发送失败时保留输入框内容。

**快捷标签页**：

- 分组下拉 + 按钮网格。点击按钮立即发送，`origin` 为 `quick`。
- 编辑模式下可以：新增、编辑、删除、上移、下移，管理分组。
- 快捷项结构：`{ id; name; kind: 'data'; input; options: ComposeOptions } | { id; name; kind: 'signal'; steps: Array<{ dtr?; rts?; brk?; delayMs? }> }`。
- 默认提供一个「示例」分组，包含：`AT` 文本 + CRLF、`HEX 读取` = `01 03 00 00 00 01` + crc16-modbus、`ESP32 下载模式` 控制线序列（DTR=低 RTS=高 → 等待 100ms → DTR=高 RTS=低 → 等待 50ms → DTR=低）。

**宏标签页**：

- 宏列表，每个宏有「运行 / 停止」「编辑」「复制」「删除」操作。
- 编辑器：名称、循环开关、步骤列表。步骤类型为发送/延时/控制线，支持上移、下移、复制、删除；显示一轮的预计总时长（不计发送耗时）。
- 运行中显示当前步骤和轮次。

**协议标签页**：只在当前协议有 `sendForm` 时显示。

- 按字段生成表单（`SettingForm` 风格），并实时调用 `encode` 显示预览（输入停止 300ms 后调用）。
- 预览出错时显示错误，并禁用发送按钮。

### 8.6 协议管理器

- 全屏对话框，分三栏：
  - 左栏 240px：搜索框；「内置」「自定义」两个分组；按钮：新建（选择 4 个模板之一）、导入（`.js` 文件）、复制、删除（需确认）、导出。
  - 中栏：CodeMirror，JS 语法高亮；对 `sdk.` 提供补全，列出 6.5 节中的 SDK 成员。内置协议只读。
  - 右栏 360px：三个标签页。
    - 「说明」：显示 `meta` 和分帧摘要。
    - 「预览」：输入示例 HEX 并选择方向 rx/tx，点击「运行」。用当前编辑器中的代码（无论是否已保存）创建一个临时 runtime，显示分帧结果、解析结果、丢弃的字节；有 `sendForm` 时同时显示表单和编码结果。
    - 「调试输出」：最近 100 行 console 输出，带「清空」按钮。
- 保存时：
  - 先在临时 Worker 中编译并校验。失败时显示错误，不保存；能拿到错误行号时，在编辑器中标出该行。
  - 成功后写入仓库。所有使用该协议的会话自动调用 `setProtocol(id)` 重建 runtime，并写系统日志「协议已更新：<名称>」。
- 有未保存的修改时关闭对话框，需要确认。
- 删除正在使用的协议时，这些会话回退到「无协议」，并写系统日志。
- 四个模板的内容：
  - `minimal`：line 分帧，`decode` 返回文本摘要；
  - `line`：解析 `KEY=VALUE,KEY=VALUE` 格式的行；
  - `length-crc`：与内置传感器协议的结构相同，带注释；
  - `idle`：Modbus RTU 响应的空闲分帧（gapMs 5），带 CRC 校验。

**内置协议「传感器帧（A5 5A）」（与演示设备一致）**：

```
帧格式：A5 5A | LEN(1) | CMD(1) | DATA(LEN-1) | CRC16-MODBUS(2, 低字节在前)
LEN = CMD 与 DATA 的字节数之和；CRC 覆盖从 A5 到 DATA 末尾的全部字节
framing: { type: 'length', header: 'A5 5A', length: { offset: 2, size: 1, includes: 'after', adjust: 2 } }

CMD 0x01 上报：  DATA = 温度 i16le ×0.01 °C | 湿度 u16le ×0.01 %RH | 电压 u16le mV | 计数 u32le   （LEN = 11）
  summary：「上报 #计数 温度 25.31°C 湿度 48.20% 电压 3301mV」
  variables：{ temp, hum, volt, count }；variableMeta：temp °C/温度、hum %RH/湿度、volt mV/电压、count 无单位/计数
CMD 0x10 设置间隔（主机→设备）：DATA = 间隔 u16le ms（100–10000）   （LEN = 3）
  sendForm：[{ key: 'interval', label: '上报间隔', type: 'number', min: 100, max: 10000, default: 1000, unit: 'ms' }]
CMD 0x90 应答：  DATA = 状态 u8（0 = 成功，1 = 超出范围）| 间隔 u16le   （LEN = 4）
CRC 错误：返回 { summary: 'CRC 错误', level: 'error', fields: [期望值, 实际值] }
```

### 8.7 演示设备（`transports/virtual/device.ts`）

**定时与生成**

- 设备内部维护一个样本序号 n（从 0 开始）。样本时间按虚拟时间计算：`τ = n × interval / 1000`（秒），与墙钟无关，这样波形整齐，便于测试。
- 用 `setInterval(10ms)` 驱动：每次触发时，按「打开后经过的墙钟时间 / interval」算出应发送的帧数，补发全部欠发的帧，每次最多 1000 帧。多帧合并为一个块写入 readable。

**`format = 'sensor-a5'`**（默认）

- 每帧发送一个 CMD 0x01。数值缓慢变化：温度 20–30°C 正弦波动，湿度 40–60%，电压 3250–3350mV；计数从 0 开始递增。
- 收到合法的 0x10 帧时：间隔在范围内，则生效并回复 0x90 状态 0；否则回复 0x90 状态 1。

**`format = 'firewater' | 'justfloat' | 'kv-text'`**

- 变量定义：前 8 个变量如下；`channels` 超过 8 时，第 k 个变量（k ≥ 8）取第 `k mod 8` 个的公式，相位偏移 `k × π/8`。

| 变量 | 公式 |
|------|------|
| ch0 | `amp·sin(2π·1·τ)` |
| ch1 | `amp·cos(2π·1·τ)` |
| ch2 | `amp·sign(sin(2π·0.5·τ))`（方波） |
| ch3 | `amp·((0.2·τ) mod 1)`（锯齿波） |
| ch4 | `0.5 + 0.1·(随机数·2 − 1)`（噪声） |
| ch5 | `amp·(0.5·sin(2π·50·τ) + 0.2·sin(2π·120·τ))`（用于验证频谱） |
| ch6 | `25 + 5·sin(2π·0.05·τ)`（慢变温度） |
| ch7 | `n`（计数，用于检测丢帧） |

- `amp` 默认 1。
- 各格式的输出：
  - firewater：每帧 `v0,v1,…\n`，数值保留 6 位小数，ch7 为整数；
  - justfloat：每帧为各变量的 f32le 字节，后接 `00 00 80 7F`；
  - kv-text：每帧 `ch0:…,ch1:…,…\n`。
- **文本命令**（所有格式都支持）：按行接收（LF，去掉 CR），可识别以下两种：
  - `interval=<ms>`：在范围内时生效；
  - `amp=<0–10 的数>`：设置幅度。
  - 在 firewater、kv-text 格式下，执行成功回复 `OK <命令>\n`，失败回复 `ERR <命令>\n`；justfloat 格式下不回复，以免破坏帧结构。

**通用行为**

- 回显：收到的数据既不是 `A5 5A` 帧，也不是可识别的命令，且全部是可打印 ASCII 或 CR/LF 时，原样回显。justfloat 格式下不回显。
- 控制线：DTR 从高变低时，把 n 和计数清零；除 justfloat 外的格式还会发送文本 `[demo] reset\r\n`。
- 打开状态下修改参数：按 6.6 节的 `updateSettings` 规则，参数只在断开时可以修改，因此演示设备不需要支持运行中修改参数。运行中调整只能通过文本命令。
- 可以创建多个演示端口，标签依次为「演示端口 1」「演示端口 2」……，`deviceKey` 均为 `virtual`。

### 8.8 工具设置面板（`panels/Settings.vue`，存储键 `settings`）

| 项 | 默认值 | 范围 |
|----|--------|------|
| 日志条数上限 | 5000 | 1000–50000 |
| 日志字节预算 | 32 MB | 8–256 MB |
| 默认显示模式 | 原始+解析 | raw/decoded/both |
| 默认显示时间戳 / TX / 系统 / 转发 | 开 / 开 / 开 / 开 | — |
| 颜色：RX、TX、系统、错误、时间戳、解析 | 取主题变量 | 颜色选择器，另有「恢复默认」按钮 |
| 默认文本编码 | UTF-8 | 4 种 |
| 默认行尾 | 无 | 4 种 |
| Enter 发送 | 关 | — |
| 显示演示端口入口 | 开 | — |
| 每个变量保留的样本数 | 100000 | 10000–1000000 |
| 每个数据源的变量上限 | 64 | 8–128 |
| 仪表盘刷新率 | 30 fps | 15 / 30 / 60 |
| 日志自动抽样 | 开 | 对应 `LogPolicy.auto` 的默认值 |

- 颜色修改后，通过设置在串口工具根元素上的 CSS 变量立即生效。
- 样本数和变量上限修改后，调用 `getSeriesHub().configure()`，只对之后新建的变量生效。设置项旁边显示内存估算：每个样本 24 字节，例如「100000 样本 × 64 变量 ≈ 154 MB（最大）」。
- 修改上限后，只对新建的会话生效；当前会话在下次清空日志时套用新上限。

### 8.9 帮助面板（`panels/Help.vue`）

内容包括：

- 快捷键：
  - Ctrl/Cmd+Enter 发送、Alt+1…9 切换标签、Esc 关闭对话框；
  - 仪表盘编辑模式下：Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 或 Ctrl+Y 重做、Delete 删除选中组件、Ctrl/Cmd+C/V 复制/粘贴组件、Ctrl/Cmd+D 复制组件、方向键移动 1 格、Shift+方向键调整大小 1 格、Esc 取消选中；
- 显示模式说明；
- 仪表盘快速入门：
  1. 选择数据格式（FireWater、JustFloat、键值文本，或自定义协议）；
  2. 打开仪表盘；
  3. 点击「一键生成」，或把变量拖到画布上；
  4. 切换到编辑模式调整组件。
  - 同时附上 FireWater 和 JustFloat 的下位机代码示例；
- 自定义控件入门、安全说明和安全模式入口（`#/tools/serial?safe=1`）；
- 协议插件入门（最小示例代码，以及 `docs/protocol-plugin.md` 的路径）；
- 转发说明；
- 控制线说明；
- 常见错误及处理方法（见第 9 节）。

### 8.10 仪表盘界面（`tools/serial/dashboard/`）

**布局**

```
┌ DashboardToolbar ────────────────────────────────────────────────────────────────┐
│ [仪表盘 ▾] [新建][复制][重命名][删除][导入][导出] │ 数据源 main→[会话 ▾] (+) │      │
│ [一键生成] [暂停全部] [导出数据 CSV] │ [编辑 ⇄ 运行] [撤销][重做] [变量列表]       │
├ 左栏 240px（编辑模式）─┬ GridCanvas ──────────────────────────┬ 右栏 300px ──────┤
│ 组件库                 │                                       │ 属性面板          │
│  图表 / 数值 / 控件 /   │   24 列网格，组件卡片                 │ [数据][外观][行为]│
│  自定义                 │                                       │ （选中组件时）    │
│ 变量列表               │                                       │ 仪表盘设置        │
│  ● ch0  1.234  ～～    │                                       │ （未选中时）      │
└────────────────────────┴───────────────────────────────────────┴───────────────────┘
```

- **运行模式**：隐藏左右栏，只显示画布（工具栏中的「变量列表」按钮可以单独显示左栏的变量列表），组件可以交互，不能拖动。
- **编辑模式**：
  - 显示网格线和左右栏；
  - 组件可以拖动（拖标题栏或整个卡片）、可以缩放（右下角和右边、下边的手柄）；
  - 控件不响应点击发送，改为选中。
- 默认模式：新建或一键生成后进入编辑模式；打开已有仪表盘时进入运行模式。
- 没有仪表盘时显示空状态，提供「新建空白仪表盘」「一键生成（需要已有变量）」「导入仪表盘」三个入口。

**数据源绑定**

- 工具栏为每个数据源显示「alias → 会话下拉」，`(+)` 用来新增数据源（alias 和名称）。
- 自动绑定规则：打开仪表盘或会话列表变化时，对每个还没有绑定的数据源：
  - 设置了 `match.deviceKey` 的，绑定到第一个 deviceKey 相同的会话（`virtual` 也按此匹配）；
  - 第一个数据源如果仍未绑定，绑定到该 Pane 最近显示过的终端会话；如果没有，就绑定到第一个会话。
- 用户手动选择会话后，把该会话的 `deviceKey` 和 `providerKind` 写入 `match`（作为仪表盘的修改，可以撤销）。
- 绑定的会话被 dispose 后，数据源变为未绑定；会话断开（未 dispose）时保持绑定。
- 组件右上角的数据源状态点：绿色表示 open，灰色表示 closed，红色虚线表示未绑定。

**变量列表**（`VariableList.vue`）

- 显示所选数据源（下拉，默认第一个）的全部变量：颜色点、显示名、最新值（按 decimals 格式化）、单位、迷你曲线（最近 100 个点，宽 60px，Canvas 绘制）、速率（Hz）。
- 计算变量用 `fx` 徽标标出；出错时显示红色感叹号，悬停显示错误。
- 超出变量上限时，顶部显示警告「已忽略 N 个变量（超出上限）」。
- 点击变量名可以编辑 `variableMeta`：显示名、单位、颜色、缩放、偏移、小数位。
- 「+ 计算变量」：打开对话框，输入名称、表达式、单位；提供表达式说明和实时预览（显示当前计算结果或错误）。
- **拖放**：
  - 拖到画布空白处：在落点创建波形图（w 12，h 8），绑定该变量；
  - 拖到可以接受多个变量的组件上（如波形图、柱状图、变量表）：追加到变量列表；超过 max 时提示「该组件最多绑定 N 个变量」；
  - 拖到单变量组件上：替换原来绑定的变量；
  - 拖动经过时，目标组件高亮。
- 在运行模式下也可以拖放：拖放后自动切换到编辑模式。

**组件库**（`WidgetLibrary.vue`）

- 按「图表 / 数值 / 控件 / 自定义」四组列出组件：图标、名称；悬停显示说明。
- 拖到画布上：在落点按 `placeNew` 放置；点击：放在第一个空位。新组件立即选中。
- 「自定义」组列出所有自定义控件，末尾提供「+ 新建自定义控件」和「管理…」两个入口，打开 8.12 节的编辑器。

**属性面板**（`PropertyPanel.vue`）

- 选中一个组件时，显示三个标签页：
  - 「数据」：`tab = 'data'` 的字段；
  - 「外观」：`CommonProps` 加上 `tab = 'style'` 的字段；
  - 「行为」：`tab = 'behavior'` 的字段。
- 字段按 `visibleWhen` 条件显示。修改后立即生效，并记入撤销历史（按字段 key 合并）。
- 每种属性类型都有对应的编辑器（`prop-editors/`）：

| 类型 | 编辑器 |
|------|--------|
| number / text / textarea / select / checkbox | 标准控件 |
| color | 色块 + 输入框，支持 `auto` |
| range | 最小值、最大值两个输入框，各带「自动」复选框 |
| variable | 数据源下拉 + 变量下拉（显示变量最新值）；也可以接受从变量列表拖入的变量 |
| variables | 变量列表，可以拖动排序、删除；每项可以展开编辑 `itemFields` |
| thresholds / zones / options | 可增删、可排序的行编辑器 |
| command | 见下方「命令编辑器」 |
| expression | 单行代码输入框，失焦时校验语法 |

- **命令编辑器**：
  - 选择类型：模板 / 协议表单 / 控制线 / 快捷发送；选择数据源。
  - 模板类型：选择 text 或 hex、输入模板、设置行尾、校验等组包选项。下方实时显示「示例：value = <示例值> → <HEX 预览>」或错误信息；示例值取控件的当前值或默认值。
  - 协议表单类型：按当前绑定会话所用协议的 `sendForm` 生成字段，每个字段可以填固定值或 `{value}`。
- 多选组件（Shift+点击，或在空白处拖出框选）时，只显示「外观」中的公共字段，修改会同时作用于所有选中的组件。
- 没有选中组件时，显示仪表盘设置：名称、行高、数据源列表（alias、名称、match，可删除，但至少保留 1 个）、计算变量列表。

**右键菜单**（编辑模式）：复制、粘贴、创建副本、删除、置于顶部行、「另存为自定义控件模板」（仅自定义控件）。

**刷新调度**（`runtime/frame-loop.ts`）

- 一个 Pane 一个调度器，用 `requestAnimationFrame` 驱动，按设置的 fps 节流。页面隐藏时停止，恢复后立即刷新一次。
- 每一帧中：
  1. 对每个可见组件绑定的数据源，检查 `SeriesSource.frameIdx` 是否有变化；
  2. 只通知「绑定的数据有更新」的组件。
- 内置组件通过 composable `useWidgetData(refs: VarRef[], opts: { history?: { last?: number; seconds?: number } })` 获取 `latest` 和 `slices`。只在调度帧中读取数据，组件内部不得自行订阅 `data` 事件。
- 「暂停全部」：调度器停止向组件推送数据；数据仍在 series 中继续记录；工具栏显示「已暂停」。
- 组件被 `KeepAlive` 缓存（离开工具）或 Pane 切换到终端视图时，调度器停止。

**错误隔离**：

- `WidgetFrame.vue` 用 `onErrorCaptured` 捕获内置组件的渲染错误，在组件内显示「组件出错：<消息>」和「重新加载」按钮，不影响其他组件。
- 自定义控件按 6.10 节处理。

**持久化**：

- 仪表盘的每次修改都在 800ms 防抖后保存到 kv `dashboards/<id>`，同时更新 local 索引 `dashboards`（`Array<{ id, name, updatedAt }>`）。
- 保存失败时弹出 Toast，并在工具栏显示「未保存」标记。
- 多标签页：仪表盘内容不做跨标签页同步。保存前比较 kv 中的 `updatedAt`，如果比本地加载时的新，提示「该仪表盘已在其他标签页修改」，让用户选择「覆盖」或「重新加载」。

**仪表盘导入/导出**：

- 导出文件：`<名称>.dashboard.json`，格式为 `{ format: 'toolset-dashboard', formatVersion: 1, dashboard: Dashboard, customWidgets: CustomWidgetRecord[] }`，其中 `customWidgets` 包含该仪表盘用到的全部自定义控件。
- 导入时先用 `validateDashboard` 校验：
  - 仪表盘 id 已存在时，询问「覆盖」或「另存为副本」（副本使用新 id，名称后加「（导入）」）；
  - 自定义控件 id 已存在且代码相同时，跳过；代码不同时，询问「覆盖」或「保留两者」（新 id，并改写仪表盘中的引用）。
- 导入包含自定义控件的仪表盘时，必须先显示 6.10 节的安全说明并经用户确认。

**导出数据 CSV**：

- 打开对话框，选择数据源和变量（默认为该仪表盘用到的全部变量），以及范围：全部缓冲，或最近 N 秒。
- 调用 `exportSeriesCsv`，文件名为 `<仪表盘名>_<数据源>_<YYYYMMDD-HHmmss>.csv`。

**窄窗格**：Pane 宽度小于 600px 时，组件按 (y, x) 顺序单列排列，高度保持不变，不能编辑，顶部提示「窗格过窄，已切换为单列只读布局」。

### 8.11 内置组件（`dashboard/widgets/<type>/`）

**目录与定义**

- 每个组件目录包含 `definition.ts` 和 `Widget.vue`。
- `definition.ts` 默认导出：

```ts
interface WidgetDefinition {
  type: string; version: number
  title: string; description: string
  group: 'chart' | 'value' | 'control'
  icon: Component
  defaultSize: { w: number; h: number }; minSize: { w: number; h: number }
  props: WidgetPropField[]
  migrate?(props: Record<string, unknown>, fromVersion: number): Record<string, unknown>
  component: () => Promise<{ default: Component }>
}
```

- `Widget.vue` 接收的 props：`instance`、`props`（已合并默认值）、`size`（像素）、`mode`、`ctx`（与 `CustomWidgetContext` 相同的子集：`send`、`sourceState`、`theme`、变量元信息解析）。
- 新增一种内置组件只需新增一个目录，组件库会自动出现。这一点需要写入 `docs/dashboard.md`。

**公共约定**：

- 所有数值的显示都先应用 `variableMeta` 中的 scale、offset、decimals、单位。
- 颜色为 `auto` 时，使用变量颜色；没有设置变量颜色时，按顺序使用 `--series-n`。
- 组件中出现以下情况时，显示统一的空状态文字：
  - 没有绑定变量：「未绑定变量」；
  - 变量还没有数据：「等待数据…」；
  - 数据源未绑定：「数据源未连接」。
- 控件在数据源不处于 open 状态时禁用，悬停提示「数据源未连接」。
- 发送成功时，控件边框闪烁一次 `--ok` 色；失败时闪烁 `--danger` 色，并弹出 Toast 显示错误。

**14 种组件及其属性**（未写默认值的字段，默认为空或关闭）：

| 类型 | 名称 | 默认/最小尺寸 | 属性（tab：字段 = 默认值） |
|------|------|---------------|----------------------------|
| `chart.line` | 波形图 | 12×8 / 4×4 | **数据**：`variables`（1–16，itemFields：颜色 = auto、线宽 = 1.5（0.5–4）、Y 轴 = 左/右、显示 = 是）；`xMode` = 样本序号/时间；`window` = 1000 个点（10–100000，xMode 为样本时生效）；`windowSeconds` = 10（0.1–3600，xMode 为时间时生效）<br>**外观**：`yLeft`、`yRight` 范围 = 自动；`lineStyle` = 线/阶梯/点；`showGrid` = 是；`showLegend` = 是；`legendPos` = 上/下/右；`showPoints` = 否<br>**行为**：`cursor` = 是（悬停显示各变量的值）；`triggerLevel`（可选，配合 `triggerVar` 实现上升沿触发冻结） |
| `chart.xy` | XY 图 | 8×8 / 4×4 | **数据**：`xVar`；`yVars`（1–4，带颜色）；`points` = 500（10–20000）<br>**外观**：`style` = 点/线；`xRange`、`yRange` = 自动；`equalAspect` = 否；`fade` = 是（旧点逐渐变淡） |
| `chart.fft` | 频谱 | 12×8 / 4×4 | **数据**：`variable`；`size` = 1024（256–16384，2 的幂）；`window` = hann；`sampleRate` = 自动（根据最近样本的时间间隔中位数估算；也可以手动填 Hz）；`removeDc` = 是；`average` = 1（1–16，指数平均）<br>**外观**：`scale` = dB/线性；`logX` = 否；`showPeak` = 是（标出最高峰的频率和幅值）；`yRange` = 自动 |
| `value.number` | 数值 | 4×3 / 2×2 | **数据**：`variable`；`decimals` = 继承变量设置<br>**外观**：`fontSize` = 自动（随尺寸缩放）/固定像素；`showUnit` = 是；`showLabel` = 是；`color` = auto；`thresholds`（满足条件时改变数值颜色，按顺序取第一个匹配项）；`sparkline` = 否；`sparkPoints` = 100；`showMinMax` = 否 |
| `value.gauge` | 仪表 | 6×6 / 3×3 | **数据**：`variable`；`min` = 0；`max` = 100<br>**外观**：`arc` = 270°/180°；`zones`；`showTicks` = 是；`ticks` = 5；`decimals`；`needleColor` = auto |
| `value.bar` | 柱状图 | 6×6 / 3×3 | **数据**：`variables`（1–16，带颜色）；`min` = 0；`max` = 100（或勾选自动）<br>**外观**：`orientation` = 垂直/水平；`showValues` = 是；`thresholds` |
| `value.led` | 指示灯 | 3×3 / 2×2 | **数据**：`variable`；`conditions`（thresholds 类型，按顺序取第一个匹配项，label 显示在灯下）<br>**外观**：`offColor` = `--border`；`shape` = 圆/方；`blink` = 否（匹配时闪烁）；`showLabel` = 是 |
| `value.table` | 变量表 | 8×6 / 4×3 | **数据**：`variables`（0–64，0 表示该数据源的全部变量）；`source` = 默认数据源<br>**外观**：列开关 `colValue` = 是、`colMin`、`colMax`、`colMean`、`colRate`、`colCount`；`compact` = 否<br>**行为**：表头提供「重置统计」按钮（调用 `resetStats`） |
| `value.text` | 文本 | 6×2 / 2×1 | **数据**：`template` = '温度 {var.temp:.1f} °C'（textarea；占位符语法与命令模板的 text 模式相同，变量取默认数据源；缺失时显示 `--`）<br>**外观**：`align` = 左/中/右；`fontSize` = 16；`color` = `--text`；`bold` = 否 |
| `ctrl.button` | 按钮 | 3×2 / 2×1 | **外观**：`label` = '发送'；`color` = `--accent`<br>**行为**：`command`；`value` = 1；`momentary` = 否（开启时，按下发送 `command`，松开发送 `releaseCommand`）；`releaseCommand`；`confirm` = 否（发送前确认） |
| `ctrl.switch` | 开关 | 3×2 / 2×1 | **外观**：`labelOn` = '开'；`labelOff` = '关'<br>**行为**：`onCommand`、`offCommand`（`{value}` 分别为 1 和 0）；`feedbackVar`（可选；设置后，开关状态跟随「该变量的显示值 > 0」，用户操作后 2 秒内不被反馈覆盖） |
| `ctrl.slider` | 滑块 | 6×2 / 3×1 | **数据**：`min` = 0；`max` = 100；`step` = 1；`feedbackVar`（同上）<br>**外观**：`orientation` = 水平/垂直；`showValue` = 是；`decimals` = 0<br>**行为**：`command`；`sendMode` = 松开时发送/拖动时节流发送；`throttleMs` = 100（20–2000） |
| `ctrl.input` | 数值输入 | 4×2 / 3×1 | **数据**：`min`、`max`、`step` = 1、`decimals` = 2<br>**行为**：`command`；`sendOn` = 回车或按钮/仅按钮；越界时显示行内错误，不发送 |
| `ctrl.select` | 下拉选择 | 4×2 / 3×1 | **数据**：`options`（默认 2 个示例选项）<br>**行为**：`command`（`{value}` 为选中项的 value）；`feedbackVar` |

**图表实现要求**（`chart.line`、`chart.xy`、`chart.fft`）：

- uPlot 在组件的 `onMounted` 中通过 `await import('uplot')` 加载（样式文件也一并导入）。数据更新使用 `setData`，不重建实例；尺寸变化使用 `setSize`。
- 波形图在数据点数超过绘图区宽度（像素）× 4 时，先用 `minMaxDecimate` 抽取到绘图区宽度那么多段，再交给 uPlot。
- 多个变量使用同一条 x 轴：
  - 样本序号模式下，以 idx 为 x，各变量按 idx 对齐，缺失的位置为 `null`；
  - 时间模式下，以秒为单位的相对时间为 x，0 表示最新时刻，向左为负。
- 波形图的交互：
  - 运行模式下，悬停显示光标和数值；
  - 右上角的小工具栏：冻结/继续、重置缩放、导出 PNG（`canvas.toBlob`）、导出可见数据 CSV；
  - 冻结后，可以用滚轮缩放、拖动平移。
- 颜色、网格、文字从 CSS 变量读取；主题切换时重建 uPlot 的 series 样式。

### 8.12 自定义控件编辑器（`custom/CustomWidgetEditor.vue`）

- 全屏对话框，布局与协议管理器一致：
  - 左栏：自定义控件列表，提供新建（选择 4 个模板之一）、导入（`.widget.js`）、复制、删除、导出。删除被仪表盘使用的控件时，提示「N 个仪表盘正在使用」，确认后这些实例显示「找不到自定义控件」。
  - 中栏：`CodeEditor`，对 `ctx.` 和 `sdk.` 提供补全。
  - 右栏：三个标签页。
    - 「预览」：一个可以调整大小的预览框（默认 6×6 网格单位的像素尺寸），由宿主按当前代码 mount 一个实例。
      - 数据源可选「模拟数据」（与演示设备公式相同的 8 个变量，在页面内生成，30fps），或任一已打开的会话。
      - 预览中的发送默认是「模拟发送」，只把将要发送的字节显示在调试输出中；勾选「真实发送」后才写入所选会话。
    - 「属性」：按 `props` 生成的属性面板，修改后调用 `propsChanged`，或重新 mount。
    - 「调试输出」：最近 100 行，包括 `ctx.log` 的输出、未捕获的异常、保护机制的停用原因。
- 「运行预览」按钮（Ctrl/Cmd+S 保存并运行）：先 `compileCustomWidget`，失败时在编辑器中标出出错行；成功后重建预览实例。预览实例同样受 6.10 节的调用保护和安全模式约束。
- 保存后，所有仪表盘中该控件的实例都重新 mount。
- 首次新建或导入时，显示 6.10 节的安全说明（勾选「不再提示」后不再显示，该设置保存在工具设置中）。

### 8.13 预设与仪表盘联动

- 另存连接预设时，如果当前 Pane 是仪表盘视图，可以勾选「同时记住当前仪表盘」，即写入 `preset.extras.dashboardId`。
- 套用含 `dashboardId` 的预设时，如果当前焦点 Pane 是仪表盘视图，切换到该仪表盘，并把默认数据源绑定到该会话；如果是终端视图，就在另一个 Pane（没有分屏时自动开启分屏）中打开该仪表盘。

------

## 9. 错误文案（必须使用以下文案，或在此基础上细化）

| 场景 | 文案 |
|------|------|
| 非安全上下文 | 「当前页面不是安全上下文（需要 HTTPS 或 localhost），无法使用串口。演示端口仍可使用。」 |
| 浏览器不支持 | 「当前浏览器不支持 Web Serial。请使用 Chrome、Edge 89+ 或 Firefox 151+ 桌面版。演示端口仍可使用。」 |
| `requestPort` 取消 | 不提示 |
| 打开失败：`InvalidStateError` | 「端口已被打开，可能正在其他标签页或程序中使用。请关闭占用后重试。」 |
| 打开失败：`NetworkError` | 「无法打开端口，可能被其他程序占用或设备已断开。请检查连接后重试。」 |
| 打开失败：其他错误 | 「打开端口失败：<原始消息>」 |
| 设备断开 | 系统日志「设备已断开」，状态变为 error，会话保留，可以点击「连接」重试 |
| 设备重新插入 | 如果 `navigator.serial` 的 `connect` 事件对应的设备有处于 error 状态的会话，在会话上显示提示「设备已重新插入，可重新连接」，不自动连接 |
| 写入失败 | 「发送失败：<原始消息>。已停止自动发送任务。」 |
| 参数在连接状态下修改 | 表单禁用，提示「断开后可修改连接参数」 |
| 协议初始化失败 | 「协议加载失败：<错误>。已切换为无协议模式。」 |
| 协议超时 | 「协议执行超时（可能存在死循环），已禁用该会话的协议。」 |
| 解码错误（每秒最多 1 条） | 「协议解码出错：<错误>」；在此期间被抑制的条数附在下一条后面：「（另有 N 条同类错误）」 |
| Worker 输入溢出 | 状态栏告警「协议处理跟不上，已丢弃 N 字节」 |
| GBK 无法映射 | 「字符 'X'（第 N 个字符）无法用 GBK 编码」 |
| 控制线不支持 | 按钮禁用，悬停提示「该通道不支持控制线」 |
| 日志自动抽样 | 「数据帧速率过高（约 N 帧/秒），日志已切换为抽样记录，可在日志工具栏中修改」 |
| 变量超出上限 | 变量列表顶部：「已忽略 N 个变量（超出每个数据源 M 个的上限），可在工具设置中调整」 |
| 计算变量出错 | 变量旁边显示红色感叹号，悬停：「计算出错：<错误>。修改表达式后恢复」 |
| 命令渲染失败 | Toast：「<控件标题>：<renderCommand 的错误>」 |
| 数据源未连接 | 控件禁用，悬停：「数据源 <alias> 未连接」 |
| 自定义控件异常 | 组件内：「出错：<消息>」+「重试」；10 秒内 3 次后：「已停用：多次出错」 |
| 自定义控件过慢 | 「执行时间过长（N ms），已停用」/「平均执行时间过长，已停用」 |
| 安全模式（疑似卡死） | 横幅：「上次运行自定义控件「<名称>」时页面可能失去响应，已暂停该控件。」[重新启用] [编辑代码] |
| 安全模式（URL） | 横幅：「安全模式：自定义控件未加载。」[退出安全模式] |
| 找不到自定义控件 | 组件内：「找不到自定义控件（<id>），可能已被删除」 |
| 仪表盘导入失败 | 「不是有效的仪表盘文件：<第一条校验错误>」 |
| 仪表盘并发修改 | 「该仪表盘已在其他标签页修改」[覆盖] [重新加载] |
| 配置导入失败 | 「不是有效的 Toolset 配置文件」/「配置文件版本过新（formatVersion N），请升级后再导入」 |
| 配置导入部分失败 | 「导入完成，N 项失败：」+ 失败键列表 + [刷新页面] |

------

## 10. 持久化汇总

| 数据 | 归属 | 键 |
|------|------|----|
| 外观设置 | app | `toolset/app/settings.v1` |
| 协议索引 / 代码 | protocol | `toolset/protocol/index.v1` / IndexedDB `toolset/protocol/plugins/<id>` |
| 预设 / 设备记忆 | link | `toolset/link/presets.v1` / `toolset/link/devices.v1` |
| 串口工具设置 / 布局 / 快捷发送 / 宏 | tools/serial | `toolset/tool/serial/settings.v1` / `layout.v1` / `quick.v1` / `macros.v1` |
| 仪表盘索引 / 内容 | tools/serial | `toolset/tool/serial/dashboards.v1` / IndexedDB `toolset/tool/serial/dashboards/<id>` |
| 自定义控件索引 / 代码 | tools/serial | `toolset/tool/serial/widgets.v1` / IndexedDB `toolset/tool/serial/widgets/<id>` |
| 安全模式标记 | tools/serial（直接访问 localStorage，不备份） | `toolset/safe-mode/pending`、`toolset/safe-mode/blocked` |
| 日志、发送历史、转发规则、会话、变量样本、数据源绑定 | — | 不持久化 |

除安全模式标记外，上表中所有数据都可以通过 6.11 节导出和导入。

------

## 11. 测试

### 11.1 单元测试（`tests/unit/`，Vitest）

| 文件 | 必须覆盖的内容 |
|------|----------------|
| `bytes/checksum.test.ts` | 6.4 节的标准值；sum8、xor8、lrc 的手算样例 |
| `bytes/hex.test.ts` | 合法格式、0x 前缀、逗号分隔、奇数位、非法字符的位置 |
| `bytes/text.test.ts` | 4 种编码的往返；GBK 不可映射字符；UTF-8 和 GBK 多字节字符跨块的流式解码 |
| `bytes/numeric.test.ts` | 全部读函数的大小端；ByteWriter 往返 |
| `protocol/framing.test.ts` | 5 种模式 × {跨块、粘包、垃圾数据重同步、超长、半帧保留}；idle 的 flush 与时间间隔；length 两种 `includes` 语义和 `adjust` |
| `protocol/validate.test.ts` | 每条校验规则至少 1 个失败样例 |
| `protocol/runtime.test.ts` | 在 Worker 外直接调用编译与执行逻辑：结果规范化、编码校验、console 收集、`direction` 传递、`state` 持久 |
| `protocol/watchdog.test.ts` | 使用一个永不回复的假 Worker：init 超时被 reject；请求超时后 `fatal` 被触发并调用 `terminate` |
| `protocol/builtin.test.ts` | 内置协议能解析演示设备生成的帧；坏 CRC 产生 error 结果 |
| `link/session.test.ts` | 用假 transport 测试：状态机全部转换和非法转换、读循环的非致命/致命错误、写队列串行、写入失败时停止任务、断开时的处理 |
| `link/log-buffer.test.ts` | 按条数和字节淘汰、seq 连续、range/tail/search、clear |
| `link/compose.test.ts` | 组包顺序、校验的大小端、跳过前 N 字节、各种错误 |
| `link/repeat-macro.test.ts` | 使用假定时器：次数、停止、断开时中止、循环、signal 步骤、组包失败时拒绝启动 |
| `link/bridge.test.ts` | oneway、duplex、自身转发拒绝、重复拒绝、3 节点环拒绝、反向规则自动合并、背压丢弃、断开时暂停、dispose 时删除规则 |
| `link/presets.test.ts` | 套用规则（类型不同时拒绝；open 状态时延后生效）、设备记忆的 LRU |
| `shared/storage.test.ts` | 版本迁移、损坏时备份并恢复默认、配额错误、`storage` 事件同步、IndexedDB 降级为内存 |
| `app/registry.test.ts` | 用 `buildRegistry` 测试：成对检查、id 与目录名一致、重复 id、非法 layout、未知分类回退、排序 |
| `protocol/builtin-formats.test.ts` | FireWater：纯数值、带前缀、CRLF、非数值行变为文本、超过 256 项。JustFloat：多帧粘包、跨块、长度不是 4 的倍数、NaN 被丢弃。键值文本：`:` 与 `=` 混用、三种分隔符、非法 key、非数值项变为文本字段。演示设备在每种 format 下生成的数据都能被对应的内置协议完整解析 |
| `link/log-policy.test.ts` | all、sampled、none 三种模式；「已省略 N 帧」日志；auto 切换（使用假时钟，连续 2 秒超过 200 帧/秒）；手动修改后 auto 变为 false；错误帧始终写入 |
| `series/extract.test.ts` | `variables` 优先；从 fields 自动提取（number、boolean、非法 label 的改写）；`noVariables`；error 级别的结果被跳过；非有限数计入 `invalidSamples` |
| `series/source.test.ts` | frameIdx 递增；同一帧内的变量共享 idx；时间戳插值的三种情况；只处理 rx；变量上限和总数上限；`read` 的 last、sinceIdx、fromT/toT、limit；扩容后覆盖最旧样本；resetStats、clear；会话 dispose 后源被删除 |
| `series/computed.test.ts` | 基本表达式；lib 函数；`prev` 和 `dt` 的积分与滤波；引用前面的计算变量；非有限结果被跳过；抛异常后停用，重新 `setComputed` 后恢复；语法错误在 `setComputed` 的返回值中报告 |
| `series/fft.test.ts` | 已知频率和幅度的正弦波（如 50Hz、幅度 1、采样率 1000、size 1024，加 hann 窗）：峰值所在的频点正确，幅度误差小于 5%；DC 去除；dB 换算；size 校验 |
| `series/decimate.test.ts` | 点数不超过 4×buckets 时原样返回；每段的极值都被保留；输出点数上限 |
| `series/export.test.ts` | 按 idx 合并、缺失变量留空、BOM、范围筛选 |
| `dashboard/layout.test.ts` | collides；compact；moveItem 推开重叠的组件（含连锁下推）；越界钳制；resizeItem 的最小/最大尺寸；placeNew 找到第一个空位；normalize 修正重叠和越界；所有操作之后都不重叠（用随机操作序列做性质测试，200 轮） |
| `dashboard/commands.test.ts` | text 模式的全部 fmt；hex 模式全部字节类型的大小端；整数越界报错；`{{`、`}}` 转义；`{var.key}`；protocol 值的类型保留；signal、quick 透传；未绑定、无数据时的错误 |
| `dashboard/schema.test.ts` | 合法仪表盘通过；每类字段非法时都能给出错误；alias 重复；组件 id 重复；越界布局由 normalize 修正 |
| `dashboard/history.test.ts` | push、undo、redo；超过上限时丢弃最早的记录；mergeKey 在 500ms 内合并；undo 之后 push 会清空 redo |
| `dashboard/generate.test.ts` | 变量为 1、8、9、20 个时的组件数量、尺寸和不重叠；颜色分配 |
| `dashboard/custom.test.ts` | `compileCustomWidget` 的每条校验规则；guard 的异常计数和停用（使用假时钟）、单次超时停用、平均耗时停用、发送限速；safe-mode 的 pending 写入与清除、启动时转入 blocked、URL `safe=1` |
| `shared/backup.test.ts` | 使用 fake-indexeddb 和内存 localStorage：枚举与命名空间划分、排除规则、导出指定命名空间或键、parseBackup 的每条校验规则、merge 与 replace 的语义、部分失败、clearAllLocalData；KvStore 在开发模式下拒绝不可序列化的值 |

### 11.2 架构测试（`tests/architecture/`）

- `depcruise.test.ts`：每个违规样例都被对应规则拦截（见 3.2）。
- `check-chunks` 由 `pnpm check:chunks` 执行，不放进单元测试。

### 11.3 组件测试（`tests/components/`，happy-dom）

- `HomeView`：按分类分组，搜索过滤，规划工具不可点击。
- `SettingsDrawer`：自动挂载工具的设置分组。
- `LogList`：时间戳和 TX 开关、文本/HEX、三种显示模式、`unframed` 和 error 帧的显示、截断提示。
- `ManualSend`：HEX 错误提示、预览字节、Enter 与 `isComposing` 的处理。
- `SignalControls`：能力为 false 时按钮禁用。
- `ProtocolSendForm`：按字段生成表单；编码错误时禁用发送。
- `BridgePanel`：显示拒绝原因。
- `PropertyPanel`：按 `WidgetPropField` 生成全部 14 种编辑器；`visibleWhen` 条件显示；多选时只显示公共字段。
- `value.number`：阈值变色、decimals、scale/offset、单位、空状态文字。
- `value.led`：按条件匹配第一个；闪烁的类名。
- `value.gauge`：指针角度随数值变化，超出范围时被钳制。
- `ctrl.slider`：松开时发送；节流发送（使用假定时器）；`feedbackVar` 同步，以及用户操作后 2 秒的保护期。
- `ctrl.button`：momentary 模式下按下和松开分别发送；需要确认时先弹出确认框。
- `VariableList`：变量增减、迷你曲线、超限警告、计算变量的错误标记。
- `DataSettings`：导出树默认全选、导入摘要、合并/替换选项、清除前确认。

### 11.4 端到端测试（`tests/e2e/`，Playwright Chromium）

**假串口**（`fixtures/fake-serial.ts`）：通过 `page.addInitScript` 注入，实现 `navigator.serial` 和 `SerialPort` 的最小子集（`requestPort`、`getPorts`、`open`、`close`、`readable`、`writable`、`setSignals`、`getInfo`、`connect`/`disconnect` 事件），并暴露 `window.__fakeSerial` 供测试控制：

```ts
addPort(info: { usbVendorId: number; usbProductId: number }): number
setRequestBehavior(b: { select: number } | 'cancel'): void
emit(index: number, bytes: number[]): void
written(index: number): number[][]
signals(index: number): Array<{ dataTerminalReady?: boolean; requestToSend?: boolean; break?: boolean }>
failNextOpen(index: number, name: 'InvalidStateError' | 'NetworkError'): void
unplug(index: number): void
remove(): void                 // 删除 navigator.serial，模拟不支持的浏览器
```

**`data-testid` 约定**（至少包含以下这些）：

`tool-card-<id>`、`add-provider-<kind>`、`session-tab-<sessionId>`、`session-connect`、`session-disconnect`、`setting-<key>`、`protocol-select`、`protocol-manager-open`、`display-mode`、`toggle-timestamp`、`toggle-tx`、`toggle-system`、`view-hex`、`log-row`（属性 `data-dir`、`data-seq`）、`log-row-decoded`、`send-input`、`send-mode`、`send-button`、`repeat-start`、`repeat-stop`、`quick-item-<id>`、`macro-run-<id>`、`signal-dtr`、`signal-rts`、`bridge-add`、`split-toggle`、`settings-open`、`export-menu`、`log-policy`

仪表盘相关：`pane-view-terminal`、`pane-view-dashboard`、`dashboard-select`、`dashboard-new`、`dashboard-generate`、`dashboard-mode`（属性 `data-mode`）、`dashboard-undo`、`dashboard-redo`、`dashboard-export`、`dashboard-import`、`dashboard-source-<alias>`、`variable-item-<key>`（属性 `data-value`）、`library-item-<type>`、`grid-canvas`、`widget-<instanceId>`（属性 `data-type`）、`widget-resize-<instanceId>`、`prop-<key>`、`custom-widget-editor-open`、`custom-widget-run`、`safe-mode-banner`、`data-export`、`data-import`、`data-clear`

组件内部的测试钩子：
- 数值类组件在根元素上设置 `data-display-value`（格式化后的文本）；
- 图表组件设置 `data-point-count`（最近一次交给 uPlot 的点数）和 `data-last-idx`；
- 控件设置 `data-sent-count`。

**用例**（每条一个 `test`）：

1. 首页 → 串口助手 → 新增串口（假端口）→ 连接 → 发送文本和 HEX，用 `written` 断言写入的内容 → `emit` 数据后断言出现 RX 行 → 切换时间戳/TX 开关后断言 DOM 变化。
2. 修改颜色、字号、日志上限 → 刷新页面 → 断言设置被保留。
3. 打开两个假端口 → 向后台会话 `emit` 数据，断言该标签的未读数增加 → 开启分屏，两个窗格分别发送，断言写入各自的端口。
4. 选择内置协议 → `emit` 完整帧、半帧（分两次）、坏 CRC 帧、垃圾数据 → 断言解析行、错误行、未成帧行 → 切换三种显示模式后断言行数和内容。
5. 协议管理器：新建一个包含语法错误的协议，断言不能保存 → 修正后用预览得到解析结果 → 保存 → 当前会话立即生效。
6. 快捷发送（数据项和控制线项，用 `signals` 断言）、重复发送（3 次后自动停止）、宏（运行中 `unplug`，断言宏停止并出现系统日志）。
7. 演示端口 A 与假端口 B 建立双向转发：`emit` 到 B 后断言出现在 A 的 TX 记录中；向演示端口写入文本，断言 B 收到回显 → `unplug` B 后断言规则显示为已暂停。
8. 另存预设（波特率 9600 + 内置协议）→ 套用到另一个端口 → 断言参数和协议都生效。
9. 导出 TXT、CSV、BIN，通过 `page.waitForEvent('download')` 读取文件内容并断言。
10. 调用 `remove()` 后刷新页面 → 断言显示不支持提示 → 演示端口仍可连接并收到上报帧。
11. 加载一个 `decode` 中含 `while (true) {}` 的插件，绑定到会话 1，同时会话 2 正常运行 → 断言 3 秒内出现超时提示、页面可以点击、会话 2 继续接收。
12. 在串口助手中输入草稿并开启分屏 → 返回首页再回来 → 断言会话、草稿、分屏都还在；直接访问 `#/tools/serial` 可用；访问 `#/nope` 显示 404。
13. 打开失败：`failNextOpen(InvalidStateError)` → 断言出现第 9 节规定的文案。
14. **一键仪表盘**：
    1. 新增演示端口，format 选 justfloat，interval 10，channels 8，连接；选择 JustFloat 协议；
    2. Pane 切换到仪表盘 → 新建 → 一键生成；
    3. 断言：生成 1 个波形图和 8 个数值组件；1 秒后波形图的 `data-point-count` 大于 0；ch7 数值组件的 `data-display-value` 持续增加。
15. **编辑与持久化**：
    1. 切换到编辑模式，从组件库拖入「仪表」，在属性面板中绑定 ch6，设置 min 20、max 30，以及一个区间颜色；
    2. 拖动和缩放该组件，断言其他组件被推开且没有重叠；
    3. 撤销 2 次后断言恢复到原位置，再重做；
    4. 刷新页面，断言仪表盘及组件的属性都被保留。
16. **变量拖放**：从变量列表把 ch0 拖到空白处，断言新建了波形图；再把 ch1 拖到这个波形图上，断言它绑定了 2 个变量。
17. **控件发送**（使用假端口和 kv-text 协议）：
    1. 添加滑块，命令为 text 模板 `amp={value:.1f}`、行尾 LF，节流 100ms；
    2. 拖动滑块后断言 `written` 中出现 `amp=` 开头的字节，且发送次数受节流限制；
    3. 添加按钮，命令为 hex 模板 `AA {value:u16le} 55`、value 为 300，点击后断言写入 `AA 2C 01 55`；
    4. 把 value 改为 70000 并选 u16le，断言出现越界提示，并且没有写入。
18. **反馈与计算变量**：
    1. 演示端口使用 kv-text 格式；添加计算变量 `ch0_sq = v.ch0 * v.ch0`，断言变量列表中出现 `fx.ch0_sq`，且值在 0–1 之间；
    2. 把开关组件的 `feedbackVar` 设为 ch2，断言开关状态随方波翻转。
19. **自定义控件**：
    1. 打开编辑器，用模板 1 新建控件，预览中显示模拟数据的值；保存后放到仪表盘，断言显示变量值；
    2. 新建一个在 `update` 中 `throw` 的控件，断言出错浮层出现，3 次后显示「已停用」，其他组件继续更新；
    3. 新建一个在 `update` 中忙等 300ms 的控件，断言被停用，提示「执行时间过长」。
20. **安全模式**：
    1. 通过 `page.evaluate` 写入 `toolset/safe-mode/pending`，模拟上次卡死，然后刷新页面；
    2. 断言出现安全模式横幅，对应控件显示「已暂停（安全模式）」；
    3. 点击「重新启用」后恢复；
    4. 访问 `#/tools/serial?safe=1`，断言所有自定义控件都没有执行，并显示 URL 安全模式横幅。
21. **仪表盘导入/导出**：导出一个包含自定义控件的仪表盘 → 删除该仪表盘和控件 → 导入（确认安全说明）→ 断言恢复；再次导入同一文件，选择「另存为副本」，断言出现 2 个仪表盘。
22. **本机配置**：
    1. 新建协议、预设、快捷发送、宏、仪表盘、自定义控件，修改主题；
    2. 导出全部配置，断言下载的文件通过 `parseBackup` 且包含全部命名空间；
    3. 清除全部本地数据，刷新后断言数据都已清空；
    4. 用「替换」方式导入，刷新后断言全部数据恢复；
    5. 再用「合并」方式只导入 `toolset/app/`，断言其他命名空间不受影响。
23. **终端与仪表盘分屏**：左 Pane 为终端，右 Pane 为仪表盘，两者使用同一个会话；日志自动切换为抽样时，断言出现系统日志，且仪表盘的 ch7 没有丢帧（ch7 的 count 与演示设备发送的帧数一致）。

### 11.5 手工与性能验证（结果写入最终报告）

- 用 `pnpm dev --host 127.0.0.1 --port 5173` 启动，在 Chromium 中逐项操作验收清单 A1–A7、A12–A15，主要用演示端口。
- 性能：在 e2e 中添加一个标记为 `@perf` 的用例，以每 10ms 发送 128 字节（约 12.8KB/s，相当于 115200 波特率的满速）的速度向 2 个会话注入数据，持续 60 秒，同时开启转发。断言以下几点：
  - 页面点击的响应时间小于 200ms；
  - 日志条数稳定在上限；
  - `performance.memory.usedJSHeapSize` 在第 30 秒和第 60 秒之间的增长小于 20%（仅 Chromium）。
- 仪表盘性能（`@perf` 用例）：
  - 设置：演示端口，justfloat 格式，interval 1（1kHz），channels 8，持续 60 秒；分屏，左侧终端（日志策略为自动），右侧一键生成的仪表盘，另加一个 size 为 4096 的频谱和一个变量表，刷新率 30fps。
  - 断言：
    - 页面点击的响应时间小于 200ms；
    - ch7 的样本数等于 ch7 的最新值加 1（没有丢帧）；
    - 通过 `PerformanceObserver` 统计 long task（超过 50ms）：60 秒内不超过 10 个；
    - 第 30 秒和第 60 秒之间的堆内存增长小于 30%。
  - 由于 1kHz 下每个变量 60 秒会产生 60000 个样本，这个用例中样本上限保持默认的 100000。
- 用 Playwright 分别以深色、浅色主题，在 1440×900 下截图首页、串口助手终端视图、仪表盘运行模式、仪表盘编辑模式，保存到 `docs/screenshots/`。
- 有 Firefox 151+ 时，手工检查页面加载和支持状态检测；没有时在报告中注明「Firefox 未实测」。
- 真实串口设备的验收由项目所有者完成，实施 Agent 不需要也无法执行。

------

## 12. 实施阶段与完成判据

| 阶段 | 内容 | 完成判据（全部通过才能进入下一阶段） |
|------|------|--------------------------------------|
| 0 基线 | 4.1–4.4 节：脚手架、依赖、配置、脚本、`.dependency-cruiser.cjs`、chunk-report 插件、`check-chunks.mjs` | `pnpm typecheck && pnpm lint && pnpm build && pnpm check:arch && pnpm check:chunks` 全部通过 |
| 1 外壳 | 第 7 节全部内容（含设置抽屉的「数据」分组）；`shared/*`（含 6.11 节的备份服务）；注册表；架构违规样例。用临时工具 `tools/_probe`（id 为 `probe`，带 settings、help 面板和 `backupLabels`）验证自动注册、分包和备份条目名称，验证后删除 | 单元测试（registry、storage、backup）、组件测试（HomeView、SettingsDrawer、DataSettings）、`check:arch`（含违规样例）、`check:chunks` 通过；临时工具已删除，并在 `docs/decisions.md` 中记录验证结果 |
| 2 通道 | `domains/bytes`、`domains/link`（不含 bridge 和 presets）、web-serial 与 virtual 两个提供者、会话、日志、组包；串口工具的侧栏、标签页、Pane、LogList（原始模式）、手动发送、StatusBar、SignalControls | 第 11.1 节中 bytes、session、log-buffer、compose 的测试通过；e2e 用例 1、10、12、13 通过；在浏览器中手测演示端口 |
| 3 协议 | `domains/protocol` 全部，包括 4 个内置协议（含 3 种数据格式）、5 个模板、`DecodeResult.variables`；演示设备的 4 种 format；会话的 `frames` 事件和 `LogPolicy`；ProtocolPicker、ProtocolManager、CodeEditor、三种显示模式、ProtocolSendForm、日志策略下拉 | protocol 相关单元测试（含 builtin-formats）和 log-policy 测试通过；e2e 用例 4、5、11 通过；`check:chunks` 确认 CodeMirror 和 Worker 都是独立产物 |
| 4 发送与复用 | 重复发送、宏、快捷发送、发送历史、GBK；分屏、未读数；预设、设备记忆；转发；搜索、导出；工具设置面板和帮助面板 | link 领域剩余的单元测试和对应组件测试通过；e2e 用例 2、3、6、7、8、9 通过 |
| 5 仪表盘 | `domains/series` 全部；`domains/dashboard`（不含 custom）；Pane 视图切换；DashboardPane、工具栏、GridCanvas（拖拽、缩放、吸附、框选）、组件库、变量列表（含拖放和计算变量）、属性面板及全部属性编辑器、刷新调度、14 种内置组件（uPlot 懒加载）、命令执行、一键生成、撤销/重做、仪表盘的持久化和导入/导出、变量 CSV 导出、窄窗格单列布局 | series 和 dashboard 的单元测试（custom 除外）通过；仪表盘相关组件测试通过；e2e 用例 14–18、23 通过；`check:chunks` 确认 uPlot 和仪表盘代码不在入口中，也不在终端视图的静态闭包中；在浏览器中手测演示端口的 4 种格式 |
| 6 自定义控件与联动 | `domains/dashboard/custom`（compile、guard、safe-mode、templates）；CustomWidgetHost（shadow DOM）、CustomWidgetEditor（预览、模拟数据、模拟发送、调试输出）；自定义控件仓库和导入/导出；仪表盘导出时打包自定义控件；8.13 节的预设与仪表盘联动 | dashboard/custom 的单元测试通过；e2e 用例 19、20、21、22 通过 |
| 7 加固与文档 | 第 9 节的文案核对；两个性能用例；截图；README 和 9 份文档 | `pnpm verify` 全部通过；两个 `@perf` 用例通过或在报告中说明原因；提交最终报告 |

文档要求：

- `README.md`：项目简介、环境与依赖版本、命令说明、目录说明、浏览器要求、部署方式（把 `dist/` 上传到任意静态主机）。
- `docs/architecture.md`：分层图、依赖规则表、分包规则、运行时数据流。
- `docs/tool-module.md`：从空目录开始新增一个工具的完整步骤，包括 manifest 示例、routes 示例、存储命名、settings/help 面板、需要通过的检查。
- `docs/transport-provider.md`：如何实现 `TransportProvider` 和 `ByteTransport`、`capabilities` 的含义、需要编写的测试。
- `docs/protocol-plugin.md`：完整 API（6.5 节）、分帧语义表、SDK、5 个模板的说明、如何输出变量供仪表盘使用、内置传感器协议的逐行解读、执行模型与安全说明（「Worker 隔离只用于防止卡死，不是安全沙箱；只加载可信代码」）。
- `docs/data-formats.md`：FireWater、JustFloat、键值文本三种格式的精确定义；下位机示例代码（C 语言，包括 `printf` 版和 `float` 数组 + 尾帧版）；与 VOFA+ 的兼容说明及差异；如何选择格式（文本格式便于调试，JustFloat 适合高速率）。
- `docs/dashboard.md`：仪表盘的使用方法（数据源、变量、计算变量、一键生成、编辑模式、快捷键）；14 种组件的属性说明；命令模板语法（6.9 节）；新增内置组件的开发步骤（`definition.ts` + `Widget.vue`、`WidgetPropField`、`useWidgetData`、需要编写的测试）。
- `docs/custom-widget.md`：完整 API（6.10 节）；4 个模板的逐段解读；调用保护和安全模式；性能建议（只在 `update` 中增量绘制、避免每帧创建 DOM、使用 `appended`）；安全说明。
- `docs/backup.md`：备份文件格式（6.11 节）；导出、导入、合并与替换的语义；哪些数据不包含在备份中；跨版本导入的行为。

------

## 13. 非目标（v1 不实现）

- TCP/UDP、BLE、WebUSB 等传输（只要求接口能够容纳）。
- 数据格式转换、阻抗计算等其他工具（只在路线图中以文字列出）。
- 本地桥接程序、桌面封装、PWA、账号、云同步、使用数据上报、i18n 框架。
- 插件和自定义控件的安全沙箱；自定义状态机分帧；宏中的协议表单步骤；自动重连；把日志或变量数据持续录制到文件；转发时的协议过滤或改写。
- 仪表盘的以下能力：
  - 3D 图形、图片/视频组件；
  - 组件的自由（重叠）布局；
  - 多个仪表盘同时以浮动窗口显示（最多两个 Pane）；
  - 变量数据的跨刷新保留；
  - 在仪表盘中回放历史文件；
  - 设备端时间戳对齐（可以通过 XY 图把设备的时间变量作为 x 轴间接实现）。
- 自定义控件使用 Vue SFC 或 npm 包（只支持纯 JS + DOM/Canvas/SVG）。
- 备份文件加密或云端同步。
- 移动端适配（只保证页面能打开）。

------

## 14. 风险与预案

| 风险 | 预案 |
|------|------|
| create-vue 的标志名称或版本有变化 | 以 `--help` 为准；在 README 中记录实际版本 |
| Playwright 浏览器无法下载 | 报告错误输出；用组件测试和手工浏览器检查完成可以验证的部分；不得报告为通过 |
| `fake-serial` 与真实 Web Serial 的行为有差异 | 只依赖 6.6 节列出的 API；真实设备的差异由项目所有者验收时反馈 |
| 入口 gzip 体积超过 120KB | 检查是否有领域代码或图标被静态引入；修复后重新检查，不得调高阈值 |
| Worker 中的 `new Function` 受 CSP 限制 | v1 不设置 CSP；在文档中说明 |
| 高数据率下界面卡顿 | 50ms 批量刷新、渲染上限 2000 条、`content-visibility`、Worker 解析；在 `@perf` 用例中验证 |
| 转发引发数据风暴 | 拒绝环路和自身转发；每个方向独立的 256KB 队列，满后丢弃最旧数据 |
| 1kHz 数据时日志拖慢页面 | `LogPolicy` 自动抽样；series 与日志解耦（`frames` 事件不抽样） |
| 图表刷新占满主线程 | 统一的 rAF 调度并限制帧率；只刷新数据有变化的组件；min/max 抽取；uPlot `setData` 增量更新；在 `@perf` 用例中统计 long task |
| 变量缓冲占用内存过多 | 缓冲按需翻倍扩容；每个源和全局都有变量数上限；设置项旁显示内存估算 |
| 自定义控件死循环冻结页面 | 无法在主线程中强制中断：用调用标记 + 启动检查自动暂停可疑控件，提供 URL 安全模式，加上编辑器和文档中的明确警告。这是选择「主页面直接运行」所接受的取舍 |
| 自定义控件污染页面样式 | shadow DOM 隔离样式 |
| JustFloat 尾帧与数据碰撞（浮点数据恰好包含 `00 00 80 7F`，即 +Inf） | 与 VOFA+ 的行为一致；帧长度不是 4 的倍数时报错并重新同步；在 `docs/data-formats.md` 中说明 |
| 网格拖拽的手感和性能 | 拖动时只更新占位框和 CSS transform，松开后才提交布局；布局算法是纯函数，有性质测试覆盖 |
| uPlot 版本的 API 差异 | 只使用 `new uPlot(opts, data, el)`、`setData`、`setSize`、`destroy`、`hooks`，并记录实际版本 |
| 备份导入覆盖了用户数据 | 默认「合并」，并默认勾选「导入前下载当前配置备份」；「替换」需要二次确认 |
