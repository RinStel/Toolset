# 架构

本文描述 Toolset 的分层、依赖边界、构建分包、运行时数据流与持久化布局。产品当前只有「串口上位机」一个工具，包含终端视图与仪表盘视图；`domains/series` 与 `domains/dashboard` 的纯 TS 领域层，以及 `tools/serial/dashboard/` 界面层均已落地。实现细节与验收条件以仓库根目录的 `plan.md` 为准。

## 1. 分层

```
┌──────────────────────────────────────────────────────────────┐
│ app/                 应用外壳：路由、首页、导航、设置、帮助、注册表 │
│   ↓ 只能经 app/registry 接触 tools/*/manifest.ts 与 routes.ts     │
├──────────────────────────────────────────────────────────────┤
│ tools/<id>/          工具：页面、组件、工具级 store               │
│   ↓ 只能使用领域的 public.ts 与 shared/*                        │
├──────────────────────────────────────────────────────────────┤
│ domains/             纯 TypeScript 业务逻辑，不依赖 Vue           │
│   bytes ← protocol ← link ← series ← dashboard                  │
├──────────────────────────────────────────────────────────────┤
│ shared/              contracts（纯类型）、lib（纯 TS）、ui（Vue）  │
└──────────────────────────────────────────────────────────────┘
```

依赖方向的含义：

- `app/` 不导入 `domains/`，也不导入 `tools/*/` 中除 `manifest.ts`、`routes.ts` 以外的文件。因此新增工具不需要修改 `app/`。
- `tools/` 只经 `domains/<name>/public.ts` 使用领域能力；工具之间互不导入。仪表盘界面位于 `tools/serial/dashboard/`，由工具视图整体动态加载。
- `domains/` 只能是纯 TypeScript：不导入 `vue`、`pinia`、`vue-router`、`.vue`、`shared/ui`、`tools`、`app`。领域之间只允许导入对方的 `public.ts`，且方向固定：
  - `bytes` 不依赖其他领域；
  - `protocol` 只依赖 `bytes`；
  - `link` 依赖 `bytes`、`protocol`；
  - `series` 依赖 `bytes`、`protocol`、`link`（通过订阅 `LinkSession` 的 `frames` 事件接入）；
  - `dashboard` 依赖 `bytes`、`protocol`、`link`、`series`；
  - 以后的 `convert`、`impedance` 只依赖 `bytes`。
- `shared/lib`、`shared/contracts` 保持纯净（无 Vue、无上层依赖）；`shared/ui` 可以依赖 Vue，但不能依赖领域、工具与应用外壳。
- 协议 Worker 入口 `runtime/protocol.worker.ts` 与普通领域文件遵守同一套规则。

## 2. 依赖规则（由 dependency-cruiser 强制）

| 规则                         | 来源                                            | 禁止                                                                                                                      |
| ---------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `shared-pure`                | `src/shared/(lib\|contracts)/`                  | `vue`、`pinia`、`*.vue`、`shared/ui/`、`domains/`、`tools/`、`app/`                                                       |
| `shared-ui`                  | `src/shared/ui/`                                | `domains/`、`tools/`、`app/`                                                                                              |
| `domain-no-ui`               | `src/domains/`                                  | `vue`、`pinia`、`vue-router`、`*.vue`、`shared/ui/`、`tools/`、`app/`                                                     |
| `domain-public-only-<A>-<B>` | `src/domains/<A>/`                              | `src/domains/<B>/` 中除 `public.ts` 以外的文件（A≠B）                                                                     |
| `domain-direction-bytes`     | `src/domains/bytes/`                            | 任何其他领域                                                                                                              |
| `domain-direction-protocol`  | `src/domains/protocol/`                         | 除 `bytes` 以外的领域                                                                                                     |
| `domain-direction-link`      | `src/domains/link/`                             | 除 `bytes`、`protocol` 以外的领域                                                                                         |
| `domain-direction-series`    | `src/domains/series/`                           | 除 `bytes`、`protocol`、`link` 以外的领域                                                                                 |
| `domain-direction-dashboard` | `src/domains/dashboard/`                        | 除 `bytes`、`protocol`、`link`、`series` 以外的领域                                                                       |
| `domain-direction-<name>`    | 其他未来领域                                    | 默认只允许 `bytes`                                                                                                        |
| `tool-isolation-<A>-<B>`     | `src/tools/<A>/`                                | `src/tools/<B>/`（A≠B）                                                                                                   |
| `tool-domain-public`         | `src/tools/`                                    | `src/domains/*/` 中除 `public.ts` 以外的文件                                                                              |
| `app-boundary`               | `src/app/`                                      | `src/domains/`；`src/tools/<id>/` 中除 `manifest.ts`、`routes.ts` 以外的文件                                              |
| `manifest-light`             | `src/tools/*/(manifest\|routes).ts`             | `src/domains/`、静态导入 `*.vue`、`codemirror`/`@codemirror`/`uplot`（只允许动态 `import()` 或类型导入）                  |
| `widget-definition-light`    | `src/tools/*/dashboard/widgets/*/definition.ts` | `*.vue`（只允许动态 `import()`）、`uplot`、`codemirror`/`@codemirror`、`src/domains/`（只允许动态 `import()` 或类型导入） |
| `no-circular`                | 全部                                            | 循环依赖                                                                                                                  |

规则集中在 `.dependency-cruiser.cjs`。`domain-public-only`、`domain-direction`、`tool-isolation` 的规则在配置加载时从 `src/domains`、`src/tools` 的实际目录动态生成，因此新增工具或领域会自动继承边界，无需修改配置。`widget-definition-light` 的路径正则已经写好，仪表盘目录创建后立即生效。

每条规则在 `tests/architecture/fixtures/<规则>/` 都有一个最小“项目”作为故意违规样例；`tests/architecture/depcruise.test.ts` 对每个样例运行 `depcruise` 并断言对应规则被触发。

## 3. 构建与分包

构建产物按“入口闭包”检查：只有静态导入才落入入口闭包，动态 `import()` 会生成独立 chunk。

1. `scripts/vite-chunk-report.ts` 是 Vite 插件，在 `generateBundle` 阶段把每个 chunk 的 `fileName`、`isEntry`、`isDynamicEntry`、`imports`、`dynamicImports`、`moduleIds`（相对项目根的 POSIX 路径）写入 `dist/.vite/chunk-report.json`。
2. `pnpm check:chunks`（`scripts/check-chunks.mjs`）读取该报告并依次检查五条规则：
   1. 从入口 chunk 沿静态 `imports` 递归得到的闭包中，`moduleIds` 不得匹配以下任一项：
      - `src/domains/`（领域代码）；
      - `src/tools/<id>/(views|components|panels|stores|composables)/`；
      - `src/tools/<id>/dashboard/`（仪表盘代码）；
      - `node_modules/.../(codemirror|@codemirror)/`；
      - `node_modules/.../uplot/`。
   2. 以下组件都必须位于非入口 chunk：每个 `src/tools/*/views/*.vue`、`src/tools/*/panels/*.vue`，以及每个 `src/tools/*/dashboard/widgets/*/Widget.vue`。
   3. `dist/assets/` 中必须存在协议 Worker 的独立产物（`protocol.worker-*.js`）。
   4. 从包含 `SerialToolView.vue`（串口工具的终端视图）的 chunk 出发，沿静态 `imports` 得到的闭包中不得出现 `uplot`。
   5. 入口闭包内所有 JS 文件 gzip 后的总大小不超过 120KB。
3. 任一项失败时，输出违规模块列表，并以非零码退出。`pnpm check:chunks` 需要先执行 `pnpm build`，因为它读取的是构建产物。
4. Vite 配置 `base: './'` 使产物可部署到任意子路径；`build.manifest: true` 生成资源清单；`worker.format: 'es'` 让协议 Worker 以 ES module 输出。

工具通过注册表的动态导入接入：`manifest.ts`/`routes.ts` 只静态引入图标与类型，工具页面、设置面板、帮助面板、协议运行时、CodeMirror 编辑器全部动态 `import()`，因此首屏不包含任何工具与领域代码。

### 3.1 uplot 懒加载与终端闭包隔离

- `uplot ^1.6.32` 只用于仪表盘的波形图、XY 图与频谱组件，由 `widgets/shared/use-uplot.ts` 在组件挂载后动态加载（样式文件一并加载）。协议插件、终端、日志、CodeMirror 都不使用它。
- `uplot` 只能由仪表盘组件通过动态 `import()` 加载；入口 chunk 的静态闭包与 `SerialToolView.vue` 的静态闭包都不允许包含 `uplot`。第 3 节的第 1、4 条规则分别从入口与终端视图两侧强制这一点。
- 仪表盘组件的 `definition.ts` 必须保持轻量（`widget-definition-light`）：不得静态导入 `.vue`、`uplot`、CodeMirror 或领域代码，`Widget.vue` 通过动态 `import()` 引用。`check-chunks` 会要求每个 `Widget.vue` 出现在非入口 chunk 中。
- 终端视图是串口工具最大的静态页面，任何新的重型绘图或编辑器依赖都应沿用同一模式：工具级入口只做动态 import，重依赖留在独立 chunk 中。

## 4. 运行时数据流

### 4.1 串口会话（无协议）

```
TransportProvider.request() → ByteTransport → LinkSession.open()
  → provider/transport 打开端口
  → 读循环读取原始块
      ├─→ BridgeService：按规则转发原始字节（origin='bridge'）
      ├─→ RxFramer（line/idle/chunk，主线程）分帧 → tx/rx 日志条目
      └─→ LogBuffer.append（按条数/字节预算淘汰）
  → createBatcher(50ms) 合并 entries 事件 → tools/serial 的 sessions store → 界面
```

发送侧：`ComposeOptions` 组包（内容 → 校验 → 行尾）→ `LinkSession.send(bytes, origin)` → 串行写队列（Promise 链）→ `ByteTransport.writable`。写入失败写系统日志、停止自动任务、reject 调用方。

### 4.2 协议解析、`frames` 事件与日志策略

```
LinkSession（协议激活）
  → ProtocolRuntime.feed(chunk, at)：16ms/16KB 批量 → Worker
  → Worker 内 common runtime：分帧 → decode(frame, ctx) → 结果规范化
      （summary 截断 200 字、fields 最多 64 个、variables 键与数量校验）
  → 主线程 runtime 的 'frames' 事件
      ├─→ LinkSession 'frames' 事件：整批 DecodedFrame（seq/at/direction/results/error）
      │     不抽样、不合并，seq 为会话内帧序号（独立于日志 seq）→ domains/series
      └─→ LogPolicy 决定哪些 RX 解码帧写入日志（见下）
  → discard 事件在 100ms 内合并成一条「未成帧数据」日志
  → 看门狗：init 超时 2s、单请求超时 500ms → terminate + fatal（禁用该会话协议）
```

`LogPolicy` 只影响“解码帧是否写日志”，不影响 `frames` 事件、`stats.rxFrames`、变量数据源或未成帧数据：

- `all`：每个解码帧都写日志。
- `sampled`：每秒按 `maxPerSecond` 分成等长时间片，每个时间片只写第一帧；被省略的帧计数，秒末写一条系统日志「已省略 N 帧」（N 为 0 时不写）。
- `none`：解码帧不写日志；未成帧数据、错误帧、TX 照常写。
- `auto`：连续 2 秒解码帧速率超过 200 帧/秒时自动从 `all` 切换为 `sampled`，并写系统日志；用户手动修改 `mode` 后 `auto` 置为 `false`。
- 错误级别的帧和带 `decoded.error` 的帧在任何模式下都写日志（仍受“每秒最多 1 条”提示的限制）。

每个会话拥有独立 Worker；协议插件在 Worker 内通过 `new Function('sdk','console', code)` 编译执行，`sdk` 只暴露字节、校验、数值读写等纯函数。Worker 隔离只用于防止页面冻结，不是安全沙箱，只应加载可信代码（v1 不设 CSP）。

### 4.3 变量时间序列（`domains/series`）

```
getLinkManager() 'sessions' 事件
  → SeriesHub（首次 getSeriesHub() 时创建）
  → 每个会话订阅 'frames'，只在收到第一个带变量的 rx 帧时惰性创建 SeriesSource
  → extractVariables：variables 优先；否则从 fields 自动提取；level='error' 不提取；
      NaN/Infinity 丢弃并计入 invalidSamples
  → timestamps：同一批 at 相同的帧按 n 等分插值，保证时间单调不减
  → ring：每个变量三组 Float64Array（idx/t/v），初始 1024，按需翻倍到 capacity 后覆盖最旧
  → VariableInfo / latest() / read(query) / minMaxDecimate / spectrum / exportSeriesCsv
  → 计算变量（fx.*）：每帧写入后按定义顺序在主线程求值
  → 仪表盘读取：SeriesSource.frameIdx / read() / latest() → useWidgetData → 组件
```

- 只处理 `direction === 'rx'` 的帧；会话 dispose 时删除对应 `SeriesSource` 并发出 `sources` 事件。
- `SeriesHub.configure({ capacity, maxVariablesPerSource })` 默认 100000 / 64，只影响之后新建的变量；全部数据源的变量总数上限为 256。
- 计算变量表达式在主线程执行，属于用户可信代码；安全说明与协议插件相同。

### 4.4 仪表盘

**领域层**（`domains/dashboard/`）为纯 TypeScript，经 `series/public.ts` 读取数据，不依赖 Vue：

- `types.ts` / `schema.ts`：`Dashboard` 模型、`validateDashboard`、`migrateDashboard`、`createEmptyDashboard`；
- `layout.ts`：24 列网格的不可变纯函数（`compact` / `moveItem` / `resizeItem` / `placeNew` / `normalize`）；
- `commands.ts`：`renderCommand` 把模板 / 协议 / 控制线 / 快捷发送渲染为动作；
- `history.ts`：100 步撤销栈，500ms 内同 key 合并；
- `generate.ts`：一键生成；
- `custom/`：`compile`、`guard`、`safe-mode`、`templates`。

**界面层**（`tools/serial/dashboard/`）由 Pane 的视图切换动态加载：

- `SessionPane.vue` 用 `defineAsyncComponent(() => import('../dashboard/DashboardPane.vue'))`，只在会话 Pane 切到「仪表盘」视图时加载仪表盘代码；`CustomWidgetEditor.vue` 再次懒加载（含 CodeMirror）。
- `GridCanvas`、`WidgetLibrary`、`VariableList`、`PropertyPanel`、`WidgetFrame` 与 `prop-editors/` 负责编辑与渲染；14 个内置组件位于 `widgets/<type>/`，每个 `definition.ts` 用 `component: () => import('./Widget.vue')`，因此每个 `Widget.vue` 都是独立 chunk。
- uPlot 只在 `widgets/shared/use-uplot.ts` 中 `await import('uplot')`（样式一并导入），模块级缓存，产物是独立 chunk；`check:chunks` 从入口与 `SerialToolView.vue` 的静态闭包两侧禁止它，也要求 14 个 `Widget.vue` 都不在入口 chunk。
- 新增组件只需新增 `widgets/<type>/{definition.ts,Widget.vue}`：`widget-registry.ts` 用 `import.meta.glob(..., { eager: true })` 自动收集；`definition.ts` 受 `widget-definition-light` 限制，只能做类型导入与动态 `import()`。

**运行时**（`runtime/`）：

```
DashboardPane（每个 Pane 一份）
  → createDashboardRuntime：alias → 绑定会话 → SeriesHub.source(sessionId)
       ├─ meta(ref)：variableMeta > 协议 variableMeta > key，解析 label/unit/color/decimals/scale/offset
       ├─ displayValue(ref) = rawLatest × scale + offset
       ├─ read(ref, query) / variables(alias) / sourceState(alias)
       ├─ send / sendBytes / sendQuickItem（renderCommand → session.send/sendForm/setSignals）
       └─ tick(now)：比较各数据源 SeriesSource.frameIdx，只回调「有更新」的订阅
  → createFrameLoop：rAF 驱动，按工具设置 dashboardFps（15/30/60）节流；页面隐藏停止
  → useWidgetData(refs, { history, maxAppended })：给组件 latest/slices/appended/sourceStates
  → WidgetFrame → Widget.vue（不得自行订阅 series 的 data 事件）
```

- 数据通路：`LinkSession 'frames'` → `SeriesHub` → `SeriesSource` 环形缓冲 → 运行时读取 / 抽取（`minMaxDecimate`）/ `spectrum` → 组件（图表经 uPlot）。
- 计算变量：仪表盘的 `computed[alias]` 由运行时 `setComputed` 同步到 `SeriesSource`，求值仍在 series 层。
- 暂停全部时帧回调不再通知组件，但 series 继续记录；切换终端视图或 `KeepAlive` 卸载时调度器停止。
- 窄窗格（宽度 < 600px）时 `GridCanvas` 按 `(y, x)` 单列只读渲染，不进入拖拽/框选逻辑。

**持久化与导入导出**（`stores/dashboards.ts`）：

- 内容写 IndexedDB `dashboards/<id>`，索引写 localStorage `dashboards`（`[{ id, name, updatedAt }]`）；每次修改 800ms 防抖保存，切换 / 卸载 / `pagehide` 时冲刷。
- 保存前比较 kv 中 `updatedAt` 与本地基线，发现其他标签页更新时返回 `conflict`，界面提供「覆盖 / 重新加载」。
- 导出 `.dashboard.json`（`format: 'toolset-dashboard'`, `formatVersion: 1`），并打包该仪表盘用到的自定义控件记录；导入时 `migrateDashboard → validateDashboard → normalize`，再处理仪表盘 id 与控件 id 冲突。
- 数据 CSV 通过 `exportSeriesCsv` 导出原始样本（不应用 `variableMeta` 的 scale/offset）。

**自定义控件**：

- 源码在站内编辑，编译为 `new Function('sdk', code)`；定义必须 `return` 一个 `CustomWidgetDefinition`。
- `CustomWidgetHost.vue` 在内容区 `attachShadow({ mode: 'open' })`，把 shadow 内 100% 尺寸的容器交给 `mount`；CSS 变量可继承，样式不泄漏。
- 每次生命周期调用经 `guard.ts`：异常窗口（10 秒 3 次）、单次 200ms、update 2 秒平均 16ms、发送每秒 50 次；超限停用并提供「重新启用 / 编辑代码」。
- 每次受保护的生命周期调用前写 `toolset/safe-mode/pending`、返回后删除；启动时若读到 pending，则把控件加入 `toolset/safe-mode/blocked` 并显示横幅。URL 带 `safe=1` 时全局不执行控件代码。
- 仓库：索引 local `widgets`，代码 kv `widgets/<id>`；保存 / 删除后递增版本号，宿主据此重新 mount 或显示「找不到自定义控件」。

### 4.5 协议编辑与预览

`ProtocolManager` 使用 CodeMirror 6（动态加载）编辑插件代码；保存时先在临时 Worker 中编译与校验，成功后写入插件仓库并通知所有使用该协议的会话重建 runtime。预览使用编辑器中的最新代码（无论是否保存）创建临时 runtime。

### 4.6 转发

`BridgeService` 持有规则图，拒绝自身转发、重复规则与长度 ≥3 的有向环；反向规则自动合并为 `duplex`。数据取自读循环原始块（分帧之前、不经过协议），每个方向独立 256KB 待写队列，超限丢最旧并累加 `dropped`；任一端离开 open 状态时规则自动暂停，重新连接后不自动恢复。

### 4.7 本机配置备份

```
SettingsDrawer（打开抽屉时才懒加载 DataSettings.vue）
  → listBackupItems()：枚举 localStorage 与 IndexedDB kv 中的 toolset/ 键，按命名空间分组
  → exportBackup({ namespaces?, keys? })：生成 BackupFile JSON
       → 下载 toolset-backup-YYYYMMDD-HHmmss.json
  → parseBackup(text)：校验格式、formatVersion、命名空间、键前缀、local 值类型与 50MB 上限
  → importBackup(file, { namespaces, mode })
       mode='merge'：同名键覆盖，其余保留；
       mode='replace'：先删除所选命名空间下现有 local 与 kv 键，再写入
       单键失败记入 failed 并继续
  → 导入/清除后刷新页面，各 store 重新读取数据
  → clearAllLocalData()：删除所有 toolset/ localStorage 键并清空 IndexedDB kv 仓库
```

- 命名空间：`toolset/tool/<id>/` 按工具划分，其余按 `toolset/<第一段>/` 划分。
- 枚举时排除不以 `toolset/` 开头的键、包含 `.corrupt.` 的损坏备份键、以及 `toolset/safe-mode/` 下的安全模式标记。
- 显示名称来自 `app/config/backup-labels.ts` 与各工具 manifest 的 `backupLabels`；未匹配时显示原始存储项名称。
- 详细语义见 `docs/backup.md`。

## 5. 持久化布局

| 数据                                | 存储                     | 键                                                                          |
| ----------------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| 外观设置                            | localStorage             | `toolset/app/settings.v1`                                                   |
| 协议索引                            | localStorage             | `toolset/protocol/index.v1`                                                 |
| 协议代码                            | IndexedDB `toolset`/`kv` | `toolset/protocol/plugins/<id>`                                             |
| 预设 / 设备记忆                     | localStorage             | `toolset/link/presets.v1` / `toolset/link/devices.v1`                       |
| 串口工具设置 / 布局 / 快捷发送 / 宏 | localStorage             | `toolset/tool/serial/{settings,layout,quick,macros}.v1`                     |
| 自定义控件安全说明「不再提示」      | localStorage             | `toolset/tool/serial/custom-widget-safety.v1`                               |
| 仪表盘索引 / 内容                   | localStorage / kv        | `toolset/tool/serial/dashboards.v1` / `toolset/tool/serial/dashboards/<id>` |
| 自定义控件索引 / 代码               | localStorage / kv        | `toolset/tool/serial/widgets.v1` / `toolset/tool/serial/widgets/<id>`       |
| 安全模式标记                        | localStorage（直接访问） | `toolset/safe-mode/pending` / `toolset/safe-mode/blocked`                   |
| 变量时间序列                        | 内存                     | 不持久化（受 capacity 与变量上限约束）                                      |
| 日志、发送历史、转发规则、会话      | 内存                     | 不持久化                                                                    |

localStorage 统一使用 `{ "version": n, "data": ... }` 包装；读取失败、版本过高、迁移失败时备份原值到 `<key>.corrupt.<时间戳>` 并恢复默认值。IndexedDB 打开或写入失败时降级为内存 Map。

除 `index.html` 的主题读取与安全模式的 `pending`/`blocked` 标记外，所有本地数据都必须经 `shared/lib/storage` 的 API 读写。这条约束让备份服务能枚举到全部数据；`toolset/safe-mode/*` 是唯一有意不进入备份的命名空间。

## 6. 应用外壳与视觉

- `SettingsDrawer` 为右侧 420px 抽屉，分组顺序为：外观（主题、字号、密度、重置外观）→ 各工具设置面板（打开抽屉时才懒加载）→「数据」（`DataSettings.vue`，同样懒加载）。「数据」组提供导出本机配置、导入本机配置、清除全部本地数据；导入与清除完成后刷新页面，所有已打开的通道会断开。
- 视觉是石墨色/近黑表面 + 墨绿主强调色的工业风：细边框、小圆角（`--radius: 4px`）、紧凑行高，深浅主题共用 `tokens.css` 中的 CSS 变量（`--bg`、`--bg-elev`、`--border`、`--text`、`--text-dim`、`--accent`、日志颜色令牌、字体与圆角等）。UI 只使用系统字体栈，不引入组件库。
- `index.html` 内联脚本在首屏绘制前读取 `toolset/app/settings.v1` 并设置主题；窗口宽度小于 900px 时串口工具侧栏改为抽屉，并强制关闭分屏（仅影响渲染，不修改持久化布局）。

## 7. 相关文档

- 新增工具：`docs/tool-module.md`
- 新增传输提供者：`docs/transport-provider.md`
- 协议插件 API：`docs/protocol-plugin.md`
- 下位机数据格式：`docs/data-formats.md`
- 本机配置备份：`docs/backup.md`
- 仪表盘与自定义控件：`docs/dashboard.md`、`docs/custom-widget.md`
- 实施决策记录：`docs/decisions.md`
