# 自定义控件

自定义控件是一段在**页面主线程**中运行的 JavaScript 函数体。它必须 `return` 一个 `CustomWidgetDefinition`，运行时由宿主创建 shadow DOM 容器并调用 `mount`；控件可以用 DOM、Canvas、SVG 绘制任意界面，也可以通过 `ctx` 读取仪表盘变量、发送串口命令、保存实例状态。

> **安全说明（与界面中的原文一致）**
>
> 自定义控件拥有与页面相同的权限（可以访问 DOM、本地存储和已打开的串口），只应运行自己编写或信任的代码。
>
> 该说明显示在自定义控件编辑器顶部；首次新建或导入时显示一次，勾选「不再提示」后不再出现。导入包含自定义控件的仪表盘时会再次显示并需要用户确认。想临时禁用全部自定义控件，使用全局安全模式入口 `#/tools/serial?safe=1`（见第 6 节）。

文档结构：

- 第 1–2 节：编辑器与仓库。
- 第 3–4 节：完整 API 与生命周期。
- 第 5 节：调用保护。
- 第 6 节：安全模式。
- 第 7 节：4 个模板的逐段解读。
- 第 8–9 节：性能建议与安全边界。
- 第 10 节：常见错误。

实现位置：

- 领域层：`src/domains/dashboard/custom/`（`compile.ts`、`guard.ts`、`safe-mode.ts`、`templates.ts`）。
- 界面与宿主：`src/tools/serial/dashboard/custom/`（`CustomWidgetHost.vue`、`CustomWidgetEditor.vue`、`custom-widget-registry.ts`、`preview-runtime.ts`、`safe-mode-state.ts`）。
- 公共类型：`src/domains/dashboard/types.ts`，经 `src/domains/dashboard/public.ts` 导出。

## 1. 编辑器

打开方式：仪表盘编辑模式左栏「自定义」组的「新建自定义控件」或「管理…」；仪表盘顶部安全模式横幅的「编辑代码」也会直接打开对应控件。

全屏对话框分三栏：

- **左栏**：搜索、新建、导入、复制、导出、删除，以及自定义控件列表。
  - 新建：选择 4 个模板之一，代码进入中栏并立即编译预览。
  - 导入：读取 `.widget.js` 文件；先编译校验，失败时在编辑器中显示错误与行号。
  - 复制：已保存控件创建「副本」，名称加「 副本」。
  - 删除：先统计使用该控件的仪表盘数量。被使用时提示「「名称」正在被 N 个仪表盘使用。删除后这些实例将显示「找不到自定义控件」」。
- **中栏**：JavaScript 编辑器（CodeMirror，对 `sdk.` 与 `ctx.` 提供补全），错误行会标出；顶部显示当前控件名称与「未保存」标记。
- **右栏**三个标签页：
  - **预览**：可调整宽高（单位：网格格数，宽 1–24、高 1–64）。数据源可选「模拟数据」或任一已打开的会话；勾选「真实发送」后，控件发送的命令才写入所选会话，否则只显示在调试输出中（模拟数据始终为模拟发送）。
  - **属性**：按定义的 `props` 自动生成属性面板（`variables` 声明会自动补一行变量选择），修改后调用 `propsChanged` 或重新 mount。
  - **调试输出**：最近 100 行，包括 `ctx.log` 输出、未捕获异常、停用原因与编译/保存信息；提供「清空」。

底部按钮：**运行预览**（`Ctrl/Cmd+S`，编译 → 保存 → 重建预览）、**保存**（只保存，不重建预览）、**关闭**（`Esc`；有未保存修改时先确认放弃）。

保存成功后，仓库版本号递增，所有仪表盘中使用该控件的实例重新 mount；删除后实例显示「找不到自定义控件」。

键位：`Ctrl/Cmd+S` 运行预览，`Esc` 关闭对话框。

## 2. 仓库与导入导出

- 索引：localStorage `toolset/tool/serial/widgets.v1`，内容 `Array<{ id, name, updatedAt }>`，按更新时间倒序显示。
- 代码：IndexedDB `toolset`/`kv` 键 `widgets/<id>`，记录为 `{ id, name, code, createdAt, updatedAt }`。
- 代码上限 256KB；保存前必须通过编译校验，失败不会写入。
- 导出文件 `<名称>.widget.js`（名称中的 `\\ / : * ? " < > |` 替换为 `_`）；导入接受 `.js` / `.widget.js` 文本。
- 导出仪表盘时，该仪表盘用到的全部控件记录写入 `.dashboard.json` 的 `customWidgets` 字段；导入规则见 [dashboard.md](dashboard.md) 第 11 节。
- 「不再提示」安全说明的状态保存在 `toolset/tool/serial/custom-widget-safety.v1`（工具设置，进入本机配置备份）。

## 3. 定义与 API

### 3.1 编译格式

代码是一个**函数体字符串**，运行时等价于：

```js
new Function('sdk', code)
```

它必须 `return` 一个定义对象；函数体在编译时立即执行一次，`mount` 在之后按需调用。函数体里可以定义辅助函数、常量与闭包状态。`sdk` 参数与协议插件使用的 `PluginSdk` 相同（见 [protocol-plugin.md](protocol-plugin.md) 第 5 节），`ctx.sdk` 也提供同一实例。

```ts
interface CustomWidgetDefinition {
  apiVersion: 1
  meta: {
    name: string
    description?: string
    version?: string
    group?: 'chart' | 'value' | 'control'
  }
  size?: { default?: { w: number; h: number }; min?: { w: number; h: number } }
  props?: WidgetPropField[]
  variables?: { min: number; max: number }
  mount(el: HTMLElement, ctx: CustomWidgetContext): CustomWidgetInstance | void
}

interface CustomWidgetInstance {
  update?(data: WidgetFrameData): void
  propsChanged?(props: Record<string, unknown>): void
  resize?(size: { width: number; height: number }): void
  destroy?(): void
}
```

- `meta.group` 默认 `'value'`；`size.default` 默认 `6×6`，`size.min` 默认 `2×2`，且 `min` 不得大于 `default`。
- `props` 使用与内置组件相同的 `WidgetPropField`（`number` / `text` / `textarea` / `select` / `checkbox` / `color` / `range` / `variable` / `variables` / `thresholds` / `zones` / `options` / `command` / `expression`）。key 唯一，且不能使用保留名 `variables`；`itemFields` 最多嵌套 5 层。
- `variables` 声明后，属性面板「数据」页自动加入变量选择，值保存在 `props.variables`（`Array<VarRef>`）。范围必须满足 `0 ≤ min ≤ max ≤ 16`。
- 放入仪表盘时，若声明了 `variables`，会默认绑定默认数据源的前 `max` 个变量（可用变量不足时取实际数量），保证控件立即有数据。
- `mount` 返回的实例对象可以只实现部分方法；不实现 `propsChanged` 时，属性变化会 destroy 后重新 mount。
- `version`（`meta.version`）只是元信息，不参与属性迁移；属性结构变化请新增字段并自行兼容旧值。

### 3.2 `WidgetFrameData`

```ts
interface WidgetSeriesData {
  idx: Float64Array
  t: Float64Array
  v: Float64Array
}

interface WidgetFrameData {
  now: number
  latest: Array<number | undefined> // 与 ctx.variables 顺序一致，已应用 scale/offset
  appended: WidgetSeriesData[] // 自上次 update 以来的新样本，每变量最多 10000 个
}
```

- `now` 为宿主调用 `update` 时的时间（`performance.now()` 或 `Date.now()`）。
- `latest` 与 `ctx.variables` 顺序一致；变量还没有数据时为 `undefined`。
- `appended` 用于增量绘制：只包含上次 `update` 之后新增的样本。第一次 `update` 时包含自控件挂载以来的样本；每个变量最多 10000 个。
- 所有值都已应用仪表盘 `variableMeta` 的 `scale` 与 `offset`。`latest` 与 `appended` 一致。

### 3.3 `CustomWidgetContext`

```ts
interface CustomWidgetContext {
  readonly props: Readonly<Record<string, unknown>> // 已合并定义中的默认值
  readonly variables: ReadonlyArray<{
    source: string
    key: string
    label: string
    unit: string
    color: string
  }>
  readonly size: { width: number; height: number } // 内容区像素尺寸
  readonly mode: 'edit' | 'run'
  latest(i: number): number | undefined
  history(
    i: number,
    q?: { last?: number; fromT?: number },
  ): { idx: Float64Array; t: Float64Array; v: Float64Array }
  send(cmd: CommandSpec | string, value?: number | boolean | string): Promise<void>
  sendBytes(bytes: Uint8Array | number[], source?: string): Promise<void>
  sourceState(source?: string): 'open' | 'closed' | 'unbound'
  readonly state: Record<string, unknown>
  saveState(): void
  theme(cssVar: string): string
  onThemeChange(cb: () => void): () => void
  requestUpdate(): void
  log(...args: unknown[]): void
  readonly sdk: PluginSdk
}
```

逐个说明：

- `props`：定义的默认值与仪表盘实例 `props` 合并后的只读对象；不要原地修改，属性面板负责更新。
- `variables[i]` 的 `label` 已应用显示名优先级（仪表盘 `variableMeta` > 协议 `variableMeta` > 变量 key）；`unit` 同理；`color` 是解析后的 CSS 颜色值（`variableMeta` 或 `--series-n`），可直接用于 Canvas。
- `size` 是内容区（shadow 容器）的像素尺寸；宿主用 `ResizeObserver` 监听并在 rAF 中节流调用 `resize`。
- `mode`：编辑模式下仍在运行，但控件应自行判断是否允许交互与发送；内置控件在编辑模式下不发送。
- `latest(i)`：与 `data.latest[i]` 相同的显示值；索引越界返回 `undefined`。
- `history(i, q)`：读取该变量最近的样本，**最多 100000 个点**；`last` 会被夹到 `1–100000`，`fromT` 为毫秒时间戳（只保留 `t >= fromT`）。没有绑定变量或运行时不可用时返回空数组。
- `send(cmd, value)`：
  - `cmd` 为 `CommandSpec` 时按 [dashboard.md](dashboard.md) 第 9 节渲染并执行。`value` 用作模板中的 `{value}`。
  - `cmd` 为字符串时视为 **text 模板**，发往默认数据源；编码、行尾、校验等组包选项使用该会话手动发送区的当前设置。
  - 失败时 reject；宿主已负责弹 Toast 与边框闪烁，控件通常只需 `catch` 后记录或忽略。
- `sendBytes(bytes, source?)`：直接发送字节；`source` 省略时发往默认数据源。
- `sourceState(source?)`：`open` / `closed` / `unbound`，省略时查默认数据源。
- `state` / `saveState()`：
  - `state` 是随仪表盘实例保存的 JSON 对象；宿主 mount 时从 `instance.state` 恢复。
  - `saveState()` 先做 JSON 往返与 64KB 检查（超限立即抛错），随后 1 秒内合并写回仪表盘；仪表盘卸载时会冲刷未写的状态。
  - 循环引用或不可序列化的值会在 JSON 往返时被丢弃或抛错；不要把大数组放进 `state`。
- `theme(cssVar)`：读取 `document.documentElement` 上的 CSS 变量，如 `theme('--accent')`；取不到时返回空字符串。
- `onThemeChange(cb)`：订阅主题切换并返回取消订阅函数。**一个宿主只保留最后一个回调**；重复调用会替换之前的回调，需要多个监听时请在控件内部合并处理。
- `requestUpdate()`：请求下一帧调用 `update`（即使没有新数据）。它要求仪表盘刷新调度正在运行；「暂停全部」或页面隐藏时不会触发。
- `log(...args)`：写入编辑器的调试输出（最近 100 行），同时调用 `console.debug`。参数会按字符串/JSON 序列化拼接。
- `sdk`：与协议插件相同的 SDK（`hex`、`fromHex`、`bytes`、`read.*`、`bits`、`writer`、`checksum`、`text`、`assert`）。

## 4. 宿主与生命周期

`CustomWidgetHost.vue` 负责执行自定义代码：

- 在组件内容区创建一个 `div`，执行 `attachShadow({ mode: 'open' })`，在 shadow root 内加入 `:host { display:block; width/height:100% }` 的样式和一个 100% 尺寸的容器，把容器作为 `el` 传给 `mount`。
  - 自定义样式不会泄漏到页面；页面 CSS 变量会继承进 shadow DOM。
- 数据通过仪表盘刷新调度或编辑器预览的外部帧适配器按帧下发；只有帧号变化（有新数据）且控件实现了 `update` 时才调用 `update`。
- props 合并对象变化时：有 `propsChanged` 就调用它，否则 destroy 后重新 mount。
- `ResizeObserver` 监听尺寸变化，在 rAF 中节流后调用 `resize`。
- 实例 `id`、`type`、源码或仓库版本变化时重新加载并 mount；控件源码编译失败时显示「自定义控件代码无法编译」浮层与「编辑代码」按钮。
- 控件被删除或找不到时显示「找不到自定义控件（id），可能已被删除」。
- 卸载时先受保护地调用 `destroy`，再清空 shadow root。

## 5. 调用保护

内置组件不受调用保护限制；自定义控件每次调用 `mount` / `update` / `propsChanged` / `resize` / `destroy` 都经过 `guard.ts`（`createCallGuard`）：

- 每次调用用 `try/catch` 包裹并用 `performance.now()` 计时。
- **异常**：组件区域显示错误浮层（错误消息 +「重试」+「编辑代码」）；10 秒内出现 3 次异常时停用实例，显示「已停用：多次出错」。
- **单次调用超过 200ms**：立即停用，显示「执行时间过长（N ms），已停用」。
- **最近 2 秒内 `update` 的平均耗时超过 16ms**：停用，显示「平均执行时间过长，已停用」。
- 停用后提供「重新启用」（清除停用状态、异常计数与耗时统计，然后重新 mount）与「编辑代码」。
- **发送限速**：每个实例的 `send` 与 `sendBytes` 共享每秒最多 50 次；超出的调用 reject，错误为「发送过于频繁」。
- 停用或卸载时，宿主受保护地调用 `destroy`，然后清空 shadow root；`destroy` 内抛错只记录，不再触发停用。

`destroy` 中的异常不会改变停用原因，但会通过 `onError` 显示错误浮层；`reset()` 会清空异常计数、耗时统计与发送窗口。

## 6. 安全模式

安全模式用于「上次页面疑似被自定义控件卡死」的恢复场景。

### 6.1 调用标记与启动检查

- 每次生命周期调用（`mount` / `update` / `propsChanged` / `resize` / `destroy`）之前，宿主同步写入 `localStorage['toolset/safe-mode/pending'] = JSON.stringify({ customId, name, at })`；调用返回或抛出后同步删除；`pagehide` 时也删除。编译阶段执行函数体顶层代码发生在保存 / 加载时，不属于这个标记的覆盖范围。
- 仪表盘模块加载时检查该键。若存在：
  1. 把其中的 `customId` 加入 `toolset/safe-mode/blocked`（JSON 数组）；
  2. 删除 pending 键；
  3. 仪表盘顶部显示横幅：「上次运行自定义控件「<name>」时页面可能失去响应，已暂停该控件。」，并提供「重新启用」与「编辑代码」。
- 被暂停的控件显示占位框「已暂停（安全模式）」；重新启用后从 blocked 移除并重新 mount。
- 无法写入 localStorage（隐私模式、配额不足）时无法记录 pending / blocked，安全模式检测退化（下次启动不会自动暂停），但不阻塞控件运行。

### 6.2 全局安全模式

- URL 带 `safe=1`（也接受 `safe=true`）时处于全局安全模式：不执行任何自定义控件代码。支持查询串与 hash 路由两种形式：

```text
#/tools/serial?safe=1
http://127.0.0.1:5173/?safe=1#/tools/serial
```

- 仪表盘顶部横幅显示「安全模式：自定义控件未加载」，提供「退出安全模式」按钮；点击后从 URL 去掉 `safe` 参数并重新加载。
- 该模式下所有自定义控件显示「已暂停（安全模式）」占位框，内置组件照常运行。

`toolset/safe-mode/*` 是「禁止直接访问 localStorage」规则的例外，也是唯一有意不进入本机配置备份的命名空间；详见 [backup.md](backup.md)。

## 7. 4 个模板

模板定义在 `src/domains/dashboard/custom/templates.ts`，`id` 分别为 `minimal-value`、`canvas-curve`、`command-buttons`、`attitude-indicator`。每个模板都是带注释的完整函数体。

### 7.1 最小数值显示（`minimal-value`）

- `meta`：名称「最小数值显示」，`group: 'value'`。
- `size.default` 4×3、`size.min` 2×2。
- `props`：`fontSize`（数字 10–96，默认 28）、`decimals`（数字 0–6，默认 2）、`color`（颜色，默认 `auto`）、`showUnit`（复选框，默认 true）。
- `variables`：`{ min: 1, max: 1 }`。
- `mount`：创建一个 flex 行容器，包含数值 `span` 与单位 `span`；`render()` 从 `ctx.props` 取字号、颜色、小数位，从 `ctx.theme('--accent')` 解析 `auto`，用 `ctx.latest(0)` 取值，无数据时显示「等待数据…」。
- 返回实例：`update`、`propsChanged`、`resize` 都调用 `render()`；`destroy` 调用 `el.replaceChildren()`。
- 这是验证「定义 → 属性面板 → 变量绑定 → 数据刷新」整条链路的最小示例。

### 7.2 Canvas 曲线（`canvas-curve`）

- `meta`：名称「Canvas 曲线」，`group: 'chart'`。
- `size.default` 8×6、`size.min` 3×3。
- `props`：`points`（绘制点数 10–5000，默认 400）、`lineWidth`（0.5–6，默认 1.5）、`color`（默认 auto）、`fill`（默认 false）。
- `variables`：`{ min: 1, max: 1 }`。
- `mount`：创建填满容器的 `canvas` 并取 2D 上下文。
- `draw()`：
  1. 按 `devicePixelRatio` 设置位图尺寸，`setTransform(dpr, …)` 后清空并按 CSS 尺寸绘制；
  2. 用 `ctx.history(0, { last: points })` 取最近样本，计算最小/最大值；相等时扩大 1 的区间避免除零；
  3. 按样本序号线性映射到绘图区，`beginPath` / `moveTo` / `lineTo` 一次画完；
  4. `fill` 为 true 时补一条闭合到底边的路径，用 `globalAlpha = 0.15` 填充。
- `update` / `propsChanged` / `resize` 都调用 `draw()`；`destroy` 清空容器。
- 模板没有使用 `appended`，每次按 `history` 全量重绘；点数多时应按第 8 节改为增量绘制。

### 7.3 命令按钮组（`command-buttons`）

- `meta`：名称「命令按钮组」，`group: 'control'`。
- `size.default` 6×3、`size.min` 3×2。
- `props`：`options`（options 类型，默认「启动」=1、「停止」=0）、`command`（command 类型，默认 null）、`columns`（列数 1–6，默认 2）、`color`（默认 auto）。
- `mount`：创建 CSS Grid 容器，`render()` 按 `columns` 设置列数，遍历 `ctx.props.options` 生成按钮并绑定点击。
- 点击时：有 `command` 就把按钮的 `value` 作为 `{value}` 调用 `ctx.send(command, value)`；没有 `command` 时调用 `ctx.send(String(value))`（text 模板发往默认数据源）。
- 发送 Promise 的 `catch` 用 `ctx.log` 记录错误。
- 返回实例只有 `propsChanged`、`resize`（重新生成按钮）与 `destroy`，没有 `update`（该控件不随数据刷新）。
- 模板每次 `render()` 都 `replaceChildren` 重建按钮；属性变化不频繁时可以接受，但不要在 `update` 中照搬这种写法。

### 7.4 姿态指示器（`attitude-indicator`）

- `meta`：名称「姿态指示器」，`group: 'value'`。
- `size.default` 6×6、`size.min` 3×3。
- `props`：`skyColor`（默认 `#2b6cb0`）、`groundColor`（默认 `#8b5a2b`）、`pixelsPerDegree`（1–30，默认 8）。
- `variables`：`{ min: 2, max: 2 }`，第 1 个为 roll（度），第 2 个为 pitch（度）。
- `mount`：创建 `canvas` 与 2D 上下文；`draw()` 按 DPR 设置尺寸，然后：
  1. 以中心为圆心裁剪圆形区域；
  2. 平移到中心，按 roll 旋转，按 `pitch × pixelsPerDegree` 计算地平线偏移；
  3. 用天空色与地面色各画一个超出画布的大矩形，形成人工地平线；
  4. 画一条白色地平线，恢复变换后画中心固定的白色机翼符号。
- `update`、`propsChanged`、`resize` 都调用 `draw()`；roll / pitch 缺失时按 0 处理。
- 该模板演示「同一次 update 读取多个变量」与「固定仪表符号不随 roll 旋转」的画法。

## 8. 性能建议

调用保护会在单次调用超过 200ms、或 2 秒内 `update` 平均超过 16ms 时停用控件。按以下方式编写可以稳定留在预算内：

- **只在 `update` 中增量绘制**：用 `data.appended` 追加新点，不要把 `ctx.history()` 的全量数据每帧重画。`history` 适合初始化（填充背景、恢复状态）或低频全量重绘。
- **避免每帧创建 DOM**：在 `mount` 中一次性创建元素与缓存引用（`const ctx2d = canvas.getContext('2d')`、`const labelEl = …`），`update` 中只改 `textContent` / `style` / Canvas 像素。
- **优先使用 `appended`**：每个变量最多 10000 个新样本；点数很多时自行做等间隔抽样或 min/max 抽样，再绘制。
- **控制状态规模**：`ctx.state` 随仪表盘保存，`saveState()` 有 64KB 上限与 1 秒防抖；不要存储历史样本。只在用户操作后调用 `saveState()`，不要每帧调用。
- **主题读取一次**：在 `mount` 中用 `ctx.theme()` 读取颜色，用 `onThemeChange` 在主题切换时更新；不要在 `update` 中反复 `getComputedStyle`。
- **canvas 尺寸只在需要时改**：重复设置 `canvas.width/height` 会清空画布；按 DPR 在 mount 与 `resize` 中设置，`update` 只清空并重绘。
- **发送不要放进 `update`**：`update` 每次数据刷新都会调用，容易触发每秒 50 次的发送限速。发送由用户操作或状态变化驱动。
- **避免同步阻塞**：不要在大循环里做字符串拼接、`JSON.stringify` 大对象或同步 XHR；需要等待时用 Promise 并在 `destroy` 中清理定时器。
- **测试真实尺寸**：预览框按网格比例绘制，但实际仪表盘尺寸取决于布局；在预览中调整宽高并检查 `resize` 分支。

## 9. 安全边界

- 自定义控件在**主页面主线程**中执行，不是 Worker，也没有沙箱：可以访问页面 DOM、`localStorage`、IndexedDB、已打开的串口会话与网络。
- shadow DOM 只隔离 CSS，不是安全边界；调用保护只限制异常次数、单次耗时与发送频率，不能阻止恶意代码。
- 安全模式只是恢复入口：它通过 pending / blocked 标记避免再次执行「上次卡死」的控件，并不审查代码。
- 因此只应运行自己编写或信任的代码。导入他人仪表盘或 `.widget.js` 前先阅读代码；编辑器与导入确认都会显示安全说明。
- 部署环境不能设置禁止 `unsafe-eval` 的 CSP：`new Function` 是自定义控件与协议插件的编译方式。
- 协议 Worker 的「Worker 隔离只用于防止卡死，不是安全沙箱」同样适用于本功能；详见 [protocol-plugin.md](protocol-plugin.md) 第 10 节。

## 10. 常见错误

| 现象                                          | 原因与处理                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 「自定义控件代码无法编译：…」                 | 语法错误、未 `return` 定义、`apiVersion` / `meta.name` / `mount` 不合法。按提示修代码。          |
| 「代码执行出错：…」                           | 函数体顶层抛错（例如访问不存在的变量）。编译阶段就会执行一次函数体。                             |
| 「已停用：多次出错」                          | 10 秒内 3 次异常。修复代码后点「重新启用」。                                                     |
| 「执行时间过长（N ms），已停用」              | 某次 `mount`/`update`/`propsChanged`/`resize`/`destroy` 超过 200ms。拆小同步工作或改用增量绘制。 |
| 「平均执行时间过长，已停用」                  | 最近 2 秒 `update` 平均超过 16ms。减少绘制点数、缓存 DOM 与上下文。                              |
| 「发送过于频繁」                              | 同一实例每秒超过 50 次 `send` / `sendBytes`。合并发送或降低频率。                                |
| 「已暂停（安全模式）」                        | 该控件在 blocked 列表中，或 URL 处于全局安全模式。点「重新启用」或退出安全模式。                 |
| 「找不到自定义控件（id）」                    | 控件被删除或仪表盘来自其他设备。重新导入控件或替换组件。                                         |
| 「变量 temp 暂无数据」/「数据源 main 未连接」 | 命令模板引用的变量没有样本，或数据源未绑定到 open 的会话。                                       |
| 「控件状态超过 64KB（当前 …KB）」             | `saveState()` 的 JSON 超过 64KB。只保存必要的 UI 状态。                                          |
