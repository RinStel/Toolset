# 决策记录

格式：日期、问题、决定、理由。仅记录 plan.md 未明确规定、或实施中与规格有偏差的事项。

## 2026-11-14

- **脚手架生成方式**：`create-vue` 的目录参数不能是 `.scaffold`（不是合法包名，会退回交互模式）。决定：生成到 `scaffold-tmp`，再移动内容到根目录并删除。
- **pnpm 依赖安装位置**：沙箱不允许写用户目录（`pnpm-cache`、Playwright 浏览器缓存均被拒绝）。决定：`.npmrc` 设置 `store-dir=.pnpm-store`、`cache-dir=.pnpm-cache`，并加入 `.gitignore`。
- **pnpm 链接方式**：默认的 isolated 布局在 Windows 上使用目录联接（junction），Node 24 的 ESM 解析器无法解析 junction 内的传递依赖（`vite` 找不到 `rolldown`、`@playwright/test` 找不到 `playwright`）。决定：`.npmrc` 设置 `node-linker=hoisted`。
- **@vue/compiler-sfc**：dependency-cruiser 解析 `.vue` 文件依赖需要 `@vue/compiler-sfc`；pnpm isolated 布局下它不可见。决定：加入 devDependencies（构建工具链，不属于运行依赖）。
- **Vitest 环境选择**：Vitest 4 移除了 `environmentMatchGlobs`。决定：默认 `node` 环境；组件测试文件首行用 `// @vitest-environment happy-dom` 声明（对应 plan.md §4.3 的按目录区分）。
- **架构规则生成**：`domain-public-only`、`domain-direction`、`tool-isolation` 需要按领域/工具名逐对生成正则。决定：`.dependency-cruiser.cjs` 在加载时读取 `src/domains`、`src/tools` 目录动态生成规则；未知新领域默认只允许依赖 `bytes`（与 plan.md §3.1 的「以后的 convert、impedance 只依赖 bytes」一致）。
- **协议 Worker 产物检查（阶段 0）**：plan.md 阶段 0 要求 `check:chunks` 通过，但此时协议 Worker 尚未实现。决定：`check-chunks` 在 `src/domains/protocol/runtime/protocol.worker.ts` 不存在时跳过 Worker 产物检查并打印提示；阶段 3 引入 Worker 后该检查自动强制。
- **Playwright 浏览器**：沙箱内 `playwright install` 因 `spawn EPERM`（禁止命名管道）失败，且 Chromium 需要 1255 版（本机缓存是 1148）。决定：在最终验证阶段申请一次完整权限安装官方 Chromium 并运行 e2e；若无法安装则在最终报告列出命令、错误输出与替代验证方式，不谎报通过。
- **入口 closure 模块路径归一化**：`vite-chunk-report` 插件把绝对模块路径转换为相对项目根的 POSIX 路径；虚拟模块（`\0` 前缀）原样保留。
- **UI 测试钩子**：`SettingForm` 为每个字段容器输出 `data-testid="setting-<key>"`，供 e2e 用例 2 使用；其他 `data-testid` 按 plan.md §11.4 约定。
- **Vitest worker 池**：沙箱禁止 `child_process.fork` 的管道通信（`spawn EPERM`），Vitest 默认 forks 池无法启动。决定：`vitest.config.ts` 设 `pool: 'threads'`；脚本名与值（`vitest run`）仍按 plan.md §4.4。
- **测试文件的 DOM 环境**：组件测试文件首行 `// @vitest-environment happy-dom`；单元测试默认 node。
- **架构违规样例的运行方式**：`tests/architecture/fixtures/<规则名>/` 各是一个最小“项目”（含 `src/...` 样例与 `tsconfig.app.json`）。测试把样例复制到 `.tmp/arch-fixtures/`、复制 `.dependency-cruiser.cjs` 进去（配置以所在目录为项目根，按样例里的 `src/domains`、`src/tools` 生成同名规则），以子进程运行 `depcruise src --output-type json`，断言对应规则被触发。子进程输出写入文件（沙箱禁止管道 stdio）。
- **存储问题回调**：`onStorageIssue(handler)` 为全局单回调注册器（后注册覆盖），`main.ts` 在创建 store 前注册一次；存储层只上报结构化 `{ kind: 'corrupt'|'quota'|'idb', key, reason? }`，文案由 app 层决定。非配额写入失败也归入 `quota`（语义：写不进去、仅内存有效）。损坏（解析失败/版本过高/迁移失败）时备份原始字符串到 `<key>.corrupt.<时间戳>` 后立即回写默认值以避免多标签页反复报损坏。localStorage 不可用时静默降级为内存实现，不上报。
- **IndexedDB 命名空间**：`createKvStore(namespace)` 在共享数据库 `toolset`/仓库 `kv` 内给键加前缀；`createToolStorage('serial').kv` 的键实际为 `toolset/tool/serial/...`，`keys(prefix)` 对外返回去掉前缀的相对键。`createAppStorage()` 只提供 local（首屏主题脚本直接读 localStorage）。
- **appearance 存储契约**：键 `toolset/app/settings.v1`，版本 1，`data = { theme: 'dark'|'light'|'system', fontSize: 13, density: 'compact'|'comfortable' }`；index.html 内联脚本按此格式读取。
- **SettingField 扩展**：`select` 额外支持 `min/max/step/unit`（配合 `allowCustom` 自定义数值），所有字段支持 `hint`。
- **UI 组件补充 token**：在 §7.4 必需变量外增加 `--on-accent`、`--on-danger`、`--bg-sunken/-hover/-active`、`--border-strong`、`--*-soft`、`--control-h(-sm)`、`--space-1..5`、`--shadow-pop`、`--focus-ring`、`--scrollbar-thumb`、`--font-size`、`--radius-sm/lg`。密度用 `data-density`，字号由 appearance store 写 `--font-size`。
- **分屏方向**：`UiSplitPane` 的 `direction='horizontal'` 表示左右分栏（分隔条竖直），`'vertical'` 表示上下分栏（与 plan.md 布局图一致）。只暴露 `ratio`（`v-model:ratio`，限 0.2–0.8）。
- **UiMenu 定位**：下拉面板绝对定位在触发器下方、未 Teleport；放在 `overflow:hidden` 容器内可能被裁剪，工具侧栏/工具栏需注意。
- **UiDialog/Drawer 不自动关闭**：`confirm` 只发事件，由调用方置 `v-model=false`；不做 body 滚动锁，避免抽屉叠加确认框时互相抢占。
- **GBK 编码表**：按 §6.4 枚举双字节构建，另收录 CP936 单字节 `0x80`→`€`，使编码与 `TextDecoder('gbk')` 严格互逆（规格未覆盖，属兼容性增强）。
- **latin1 解码**：按规格使用 `TextDecoder('latin1')`；WHATWG 中该标签等价 windows-1252，故 0x80–0x9F 的解码结果与 ISO-8859-1 有差异，常见西欧字符往返一致。
- **ByteWriter.ascii**：按 Latin-1 写码点；遇到 >0xFF 字符抛 `RangeError`，不静默截断。`read.*` 越界、`bits` 非法参数同样抛 `RangeError`。
- **protocol Worker 注入点**：`createProtocolRuntime(code, opts)` 支持 `opts.workerFactory` 注入（看门狗测试需要永不回复的假 Worker）；生产路径用 `new Worker(new URL('./protocol.worker.ts', import.meta.url), { type: 'module' })`。
- **临时 probe 工具的目录名**：plan.md §12 写作 `tools/_probe`（id 为 `probe`），但注册表要求 `id === 目录名`。决定：使用 `src/tools/probe/`。阶段 1 验证结果：
  - registry 自动发现 manifest/routes，生成 `/tools/probe` 路由，`document.title` 为「探针工具 · Toolset」；
  - 首页卡片、顶部工具菜单、设置抽屉「探针工具」分组（SettingForm 输出 `setting-probe-rate` 等）、帮助面板章节均自动出现；
  - chunk 报告显示入口 `dynamicImports` 指向 `ProbeToolView`/`Settings`/`Help` 三个独立 chunk，入口闭包无工具视图代码；
  - 验证后已删除 `src/tools/probe/`，重新构建只剩单一入口 chunk（142.09 kB / gzip 53.03 kB），产物中无 probe 字符串。
- **阶段 1 的 `check:chunks` 例外**：协议 Worker 源文件已存在，但串口工具尚未接入协议 runtime，Vite 不会产出 `protocol.worker-*.js`，因此阶段 1 末 `check:chunks` 报告该项失败（其余分包检查通过）。计划在阶段 3 串口工具接入 `createProtocolRuntime` 后自动恢复；不为绕过检查而放宽规则。
- **appearance store 实现**：不用 Pinia，使用普通 Vue 响应式单例（`src/app/stores/appearance.ts`），存储读取延迟到 `initAppearance()`，保证 `main.ts` 先注册 `onStorageIssue` 再读数据。导出 `appearance`、`resolvedTheme`、`initAppearance`、`setTheme/cycleTheme/setFontSize/setDensity/resetAppearance`。
- **KeepAlive 位置**：按 §7.1 放在 `ToolRouteView.vue` 内，key 为 `${toolId}-${reloadKey}`；返回首页会卸载 ToolRouteView，跨首页的状态保持依赖工具级 store（e2e 用例 12 依赖此语义）。
- **全局错误边界已知限制**：首次直接访问某工具且动态 import 失败时，ToolRouteView 尚未挂载，`onErrorCaptured` 无法接管；`router.onError` 作为兜底（当前由 ToolRouteView 注册）。作为 v1 已知限制记录。
- **probe 工具**：临时工具 `src/tools/probe/` 已于阶段 1 验证后删除；最终 `src/tools/` 只保留 `serial`。
- **协议 SDK/执行模型决策**：
  - 分帧基类 `ByteQueue`/`BufferedFramer` 放在 `types.ts`，避免 `framing/` 与 `types.ts` 循环依赖；
  - `line` 模式忽略空行；`delimiter` 模式对起止符之间的空内容仍输出 0 长度帧；
  - Worker 的 `discard` 消息附加可选 `reason`（`sync`/`resync`/`overflow`）；
  - `repository` 的 API 全部 async（kv 异步），导出文件名 `<name>.protocol.js` 且非法字符替换为 `_`；
  - 编译/执行核心放在 `runtime/compile.ts`（`compileProtocol` + `createProtocolExecutor`），Worker 只是消息外壳，便于在 Worker 外做单元测试；
  - 结果规范化：decode 返回非对象/缺 summary 视为该帧解码错误（results 为空 + error），返回 `null`/`[]` 视为无结果且不算错误；encode 仅接受 Uint8Array 或 0–255 整数数组、长度 1–65536。
- **link 事件与日志载荷**：`entries` 事件统一为 `{ added: LogEntry[]; updated?: number[] }`；`stats` 变化 100ms 节流；协议 `console.log` 不写入会话日志，仅 `warn`/`error` 以「协议：」前缀写系统日志。
- **LogBuffer 的 seq**：由 buffer 分配（会话内从 1 单调递增），`clear()` 后重新从 1 开始；`append` 忽略调用方传入的 seq，另提供 `get`/`update` 以支持 TX 解码结果回填。
- **discard 合并条目**：`unframed` 条目的 level 固定 `warn`，text 使用独立流式解码器。
- **转发暂停日志**：规则任一端离开 open 时向**两端**会话各写一条「转发已暂停：<名称> 已断开」；反向 oneway 合并为 duplex 在环检测之前处理。
- **演示端口的设备标识**：多个演示端口共享 `deviceKey='virtual'`（因此共享设备记忆），`isSameDevice` 按实例同一性判断（允许并存多个演示端口）。
- **会话关闭语义**：`LinkSession.close()` 只在 open/closing 状态下允许，idle/closed/error 时抛 `IllegalStateError`，这类状态由 `dispose()` 收尾；`send` 未打开时 reject `IllegalStateError`。
- **link 对外扩展成员**（plan 接口未列，UI/转发/预设需要）：`displayMode`、`compose`、`protocolOverflowBytes`、`deviceAvailable`、`onRawRx`、`onDispose`、`writeSystemLog`、`clearLog`、`markDeviceAvailable`、`stageSettings`；`LinkManager` 额外提供 `disposeAll`、`refreshDeviceAvailability`。
- **repeat 的“协议编码失败”停止条件**：当前 repeat 对原始字节快照发送，不经过协议编码，因此该条件不适用；macro 的 send 步骤在启动前统一 `compose`，失败即拒绝启动并提示第几步。
- **日志导出**：`exportLog(snapshot, options)` 为纯函数，返回 `{ fileName, mimeType, data: Uint8Array }`，由工具层负责下载；TXT 默认带时间戳（`showTimestamp:false` 可关闭），CSV 总带时间，BIN 只拼接 RX 原始字节。
- **串口工具的日志上限**：`LinkManager`/`LinkSession` 在 plan 中没有日志上限构造参数，manager 单例按 5000 条/32MB 构造。工具层在创建会话后、`open()` 之前直接写 `session.log.maxEntries/maxBytes`，并在清空日志时对当前会话重新套用设置；行为满足「新上限只对新建会话生效，当前会话下次清空时生效」。
- **串口工具的显示模式归属**：Pane 级显示设置存 `layout` store 并持久化；切换显示模式时同时写 `session.displayMode`，供设备记忆与预设使用。
- **发送参数默认值**：link 不提供 compose 默认值构造参数。工具在 `session.compose` 仍为领域默认值时才套用工具设置里的默认编码/行尾；用户修改后写回 `session.compose`。若阶段 4 从设备记忆恢复 compose，需保留该来源判断（阶段 4 代理负责）。
- **窄屏强制关闭分屏**：`<900px` 时只影响渲染（`effectiveSplit='off'`），不覆盖持久化的 `split`；宽度恢复后分屏恢复。
- **搜索语法**：以 `/` 开头按正则；支持 `/pattern/flags`，未写 flags 默认 `i`；非法正则显示行内错误；普通文本不区分大小写；匹配 text、HEX、解析摘要与字段。
- **日志文本转义**：控制字符显示为 `\r`、`\n`、`\t`、`\xNN`（大写，与 `log/export.ts` 一致）；单条超过 1024 字节时按 UTF-8 字节近似截断并追加「…（共 N 字节）」。
- **数字设置输入**：`maxLogEntries`/`maxLogBytesMb` 在输入过程中允许中间值，实际使用与页面重载时再钳制到合法范围，避免输入被逐字符回写打断。
- **面板文件名与 eslint**：`panels/Settings.vue`、`panels/Help.vue` 文件名由 plan 固定为单个单词，文件顶部加 `<!-- eslint-disable vue/multi-word-component-names -->`，不放宽全局规则。
- **草稿持久化**：发送区草稿按会话保存在模块级 store（不随组件卸载丢失），保证返回首页再进入工具后仍在；会话本身由 link 单例持有。

## 2026-11-15（阶段 5 收尾）

- **Playwright 预览服务器监听地址**：Windows 上 `vite preview` 默认绑定 `localhost`（可能只解析为 IPv6），与 `webServer.url='http://127.0.0.1:4173'` 不匹配导致 180 秒超时。`playwright.config.ts` 的 webServer 命令追加 `--host 127.0.0.1`（比 plan.md §4.3 的命令多一个参数，属必要的环境适配）。
- **e2e 运行权限**：Chromium 依赖命名管道通信，DSH 沙箱内启动会 `spawn EPERM`；Playwright 浏览器在一次性授权下安装到用户缓存，最终 e2e 在会话的完整权限（danger-full-access）下执行。报告中如实说明该前提。
- **UiMenu 下拉修复（影响所有菜单，非仅 e2e）**：
  1. 支持非受控用法：父组件未绑定 `v-model` 时用内部 `isOpen` 状态，原先多数调用点（日志导出、协议新建、宏/历史菜单等）根本没绑定 `v-model`，菜单永远打不开；
  2. 触发点击改为捕获阶段监听（`@click.capture`），因为 `UiButton` 会 `stopPropagation()`；
  3. 面板 Teleport 到 `body` 并 `position: fixed` 跟随触发器定位，避免被工具栏/Pane 的 `overflow:hidden` 裁剪；
  4. 面板 `z-index: 2000`，高于 Dialog/Drawer（1000），否则全屏对话框会拦截菜单点击。
- **Toast 位置**：通知容器原先固定在右上角，会遮住顶栏主题/设置/帮助按钮并拦截点击（e2e「页面可点击」用例暴露）。改为 `top: calc(var(--app-header-height,44px) + var(--space-3))`，保留容器 `pointer-events:none`、单条 toast 可交互。
- **e2e 导出文件名**：实现按 §8.4 把非法字符替换为 `_`，会话名中的 `:` 会变成 `_`；e2e 断言按实际文件名（`USB 串口 (1A86_7523)_...`）修正，不是放宽实现。
- **e2e「直接访问路由」用例**：仅 hash 变化的 `page.goto` 属同文档导航，不会重新加载页面；改用 `about:blank` → 目标 hash URL 强制整页加载，才能验证「刷新后会话不保留」。
- **最终 e2e 结果**：16/16 通过（13 条验收用例 + `@perf` + 2 条截图用例）；`@perf` 60 秒双会话高吞吐下点击响应 3–23ms，堆增长 0%，日志条数稳定在上限；截图已生成 `docs/screenshots/{home,serial}-{dark,light}.png`。

## 2026-11-15（视觉重设计）

- **用户方向**：现有配色/UI 被评价为「一言难尽」，明确要求「工业硬朗 + 适度现代化，不要过度使用诡异的青色」，随后追加「也可以使用深色/墨绿色配色」。最终视觉系统：石墨/暖灰表面 + **墨绿（哑光苔绿）主强调色**，细线、方角、仪器面板质感；琥珀仅保留给警告与 TX 日志。`plan.md §7.4` 中的深色参考值（含青色 `--accent #22b8cf`）视为参考而非强制值，`--accent` 的青色被墨绿替换；深色 `--accent #4f9d7a`、浅色 `--accent #1f5c47`。深色与浅色主题同时重做，浅色正文对比度 ≥ 4.5:1。
- **保留项**：`tokens.css` 的必需变量名、`--radius: 4px`、系统字体栈、头部 44px、侧栏 280px、设置抽屉 420px、字号 12–18（默认 13）、密度 compact/comfortable，以及全部 `data-testid`、可见文案与 e2e 依赖的 class。
- **范围**：仅视觉层（tokens/base/组件 scoped CSS + 必要的模板分组/装饰标签），不改业务逻辑、store、领域代码、路由与测试语义；重做后重新生成 `docs/screenshots/` 并跑完整 e2e。

## 2026-11-16（v2 仪表盘 / 自定义控件 / 配置备份与 1kHz 性能收口）

- **协议层数据与格式支持**：新增内置协议 `src/domains/protocol/{builtin/firewater,justfloat,kv-text,sensor-a5}.ts` 与模板 `templates/variables.ts`，扩展 `DecodeResult.variables` / `variableMeta` / `noVariables`。遇非法变量键直接判为整帧解码错误；非有限数（`NaN` / `Infinity`）保留在结果中供序列层统计无效点数。
- **通道帧流、日志策略与演示设备**：`LinkSession.on('frames')` 直接派发不抽样帧流（`seq` 从 1 递增）；新增 `LogPolicy`（`all` / `sampled` / `none` 及 `auto` 降级）并将省略计数暴露为 `logOmittedFrames`。演示设备支持 4 种数据格式、虚拟时间、10ms 周期补帧、文本控制命令与可打印未成行数据即时回显。
- **时序数据层（`domains/series`）**：`SeriesHub` 自动挂接已打开会话并基于时间戳线性插值；`SeriesRing.read({ last })` 采用二分定位（`lowerBound` / `upperBound`）+ `Float64Array.subarray` 分段拷贝，将区间读取从 `O(N)` 降为 `O(log N + matched)`；同层实现计算变量（四则/函数表达式）、FFT 频谱、Min-Max 抽取与 CSV 导出。
- **仪表盘与自定义控件**：纯函数网格布局、命令模板、撤销/重做与一键生成控件集中在 `src/domains/dashboard`；自定义控件（`compile` / `guard` / 安全模式降级 / 4 套预设模板）与内置 Widget UI 位于 `src/tools/serial/dashboard/**`。高频图表与列表限频刷新：`chart.line` 历史窗口上限 `last: 20000`、`historyRefreshMs: 100`；`chart.fft` `SPECTRUM_REFRESH_MS: 250`；`VariableList` 500ms 刷新；`value.table` 通过 `lastAutoKeys` 避免无新增变量时重复触发全局引用失效；`LogList.vue` 复用模块级 `TextEncoder`、引入 `WeakMap` 行缓存 + `markRaw`、`v-memo` 行级记忆化与单次 `requestAnimationFrame` 合并滚动，使 1kHz 压测下 `long task（>50ms）` 降至 0 个。
- **配置备份与数据管理**：在 `src/shared/lib/storage/backup.ts` 与 `src/app/layout/DataSettings.vue` 实现导出/导入（按 `toolset.*` 命名空间规则过滤、支持 `merge` / `replace` 模式、50MB 文件体积校验，并排除安全模式标记键防止导入锁定状态）。
- **分包、架构门禁与 UI 层级**：`scripts/check-chunks.mjs` 新增仪表盘 / `uPlot` / 终端核心闭包规则；`scripts/check-arch.mjs` 新增 `widget-definition-light` 规则；`ServiceHost` 全局确认弹窗使用 `:z-index="3000"`，高于全屏编辑器（`1100`）与 `UiMenu`（`2000`）；`DashboardToolbar` 低频操作收拢至更多菜单（`dashboard-more`），`ProtocolManager` 与 `CustomWidgetEditor` 补充视口溢出裁剪及 `1120px` / `900px` 响应式断点，确保 `1440×900`、`1280×720`、`1024×640` 无横向/纵向溢出。

## 2026-11-16（UI 重整、浅色可读性调优与初版收口）

- **色彩系统与扁平化（Carbon-Slate + Cobalt Blue）**：放弃早期墨绿方案与装饰性渐变，采用纯粹的工业碳灰表面搭配工程钴蓝主强调色（深色 `--accent: #3b82f6`、浅色 `--accent: #2563eb`）；移除背景径向渐变与边框发光叠加。调优浅色模式终端可读性：`--bg-log: #ffffff`、RX `#0f3d91`、TX `#8a3b00`、解析 `#0f5132`，并在 `[data-theme='light']` 下为日志正文提升字重（`500`）与控制字符高亮边框对比度。
- **单层会话顶栏与视图切换重构**：将原本分散于 `SessionTabs` 与 `SessionPane` 的端口/仪表盘/分屏入口统一收敛到 `SessionTabs.vue` 单层顶栏（`终端 | 仪表盘` 分段切换、`同屏：终端+仪表盘` 一键预设、`左右分屏 / 上下分屏`），单窗格模式隐藏冗余 `.session-pane__viewbar`；移除状态栏重复伪标签与 `ManualSend` 独立 `INPUT` 工具条，将发送历史收拢至选项栏，全工具栏控件高度统一为 `26px`。
- **副标题、首页与帮助精简、无截图文档**：按项目所有者要求将网页副标题更新为 `RinStel的工具箱`（保留 `BACKUP_APP_NAME` 原值以维持已有配置备份兼容性）；移除首页 `.home__eyebrow` 与 `.home__intro` 说明性文字并收紧为标题 + 搜索框单栏；帮助抽屉收窄至 `380px` 并精简为「环境与快捷键 / 快速上手 / 常用快捷键 / 常见问题」；移除 `docs/screenshots/`、`tests/e2e/screenshots.spec.ts` 及文档截图嵌入。
- **1kHz 长时压测与运行环境适配**：修复 `LogList.vue` 中 `wrap === true` 时绕过可视区虚拟滚动的漏洞，改为超过 `120` 行统一启用虚拟窗口并受 `session.log.maxEntries` 限制，消除 45–60 秒期全量 DOM 造成的 `styleLayout` 长任务（`long task` 降至 `0`）；`playwright.config.ts` 将 `trace` 从全程采样的 `retain-on-failure` 改为 `on-first-retry` 并接入工作区内 `.pnpm-cache/pw-deps/root` 原生库路径；`vitest.config.ts` 为 `happy-dom` 环境补充 `--no-experimental-webstorage` 以适配 Node 26。
