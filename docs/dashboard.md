# 仪表盘

仪表盘把协议插件输出的变量显示为波形、数值、仪表与控件，并把控件操作发送回串口会话。它是串口上位机的一个 Pane 视图，不单独占一个工具。

实现分两层：

- `src/domains/dashboard/`：纯 TypeScript 领域层。负责仪表盘模型与校验、24 列网格布局、命令模板渲染、撤销/重做、一键生成，以及自定义控件的编译、调用保护、安全模式与模板。
- `src/tools/serial/dashboard/`：界面层。负责 Pane、工具栏、网格画布、组件库、变量列表、属性面板、刷新调度、14 种内置组件和自定义控件宿主。

## 1. 打开与界面

在串口 Pane 顶部把视图切到「仪表盘」。没有仪表盘时显示空状态，提供三个入口：

- **新建空白仪表盘**：立即创建一个空仪表盘并进入编辑模式。
- **一键生成（需要已有变量）**：用当前会话（或第一个有变量的已绑定会话）的变量生成完整布局。
- **导入仪表盘**：读取 `.dashboard.json` 文件；文件包含自定义控件时先显示安全说明。

工具栏分三行：

1. 仪表盘下拉框、新建、复制、重命名、删除、导入、导出；右侧显示保存状态（`保存中…` / `未保存`）。
2. 数据源绑定：`alias → 会话下拉`、`(+)` 新增数据源。
3. 一键生成、暂停全部、导出数据 CSV、编辑 ⇄ 运行、撤销、重做、变量列表开关。

模式规则：

- **运行模式**：隐藏左右栏，只显示画布；组件可交互，不能拖动。
- **编辑模式**：显示网格线与左右栏；组件可拖动、缩放、选中，控件不响应点击发送。
- 新建、一键生成、导入新仪表盘后进入编辑模式；打开已有仪表盘时进入运行模式。工具栏按钮可以随时切换。
- 运行模式下仍可用「变量列表」按钮单独显示左栏的变量列表。

## 2. 数据源与绑定

每个仪表盘至少有一个数据源。第一个数据源是默认数据源，命令模板中省略 `source` 时发给它。

```ts
interface DashboardSource {
  alias: string // /^[a-z][a-z0-9_]{0,15}$/，仪表盘内唯一
  label: string // 如「主设备」
  match?: { deviceKey?: string; providerKind?: string }
}
```

- 新增数据源时填写 alias 与名称。alias 只能包含小写字母、数字、下划线，以字母开头，最长 16 个字符；重复时输入框下方给出错误。
- 自动绑定规则（打开仪表盘或会话列表变化时执行）：
  1. 已绑定的会话仍然存在时保持不变；
  2. 设置了 `match` 的数据源绑定到第一个 `deviceKey` 与 `providerKind` 都匹配的会话（演示端口也按 `deviceKey` 匹配）；
  3. 第一个数据源仍未绑定时，绑定到该 Pane 最近显示过的终端会话，再回退到第一个可用会话。
- 手动选择会话后，把该会话的 `deviceKey` 与 `providerKind` 写入 `match`。这是一次可撤销的仪表盘修改。
- 会话 dispose 后数据源改为未绑定；会话只是断开（未 dispose）时保持绑定，状态为 closed。
- 组件右上角的状态点：绿色 `open`、灰色 `closed`、红色虚线 `unbound`。
- 删除数据源要求至少保留 1 个。引用已删除 alias 的组件不会自动改写；它的旧绑定要等到下一次自动绑定刷新（会话列表变化或重新打开仪表盘）才清除。建议先把相关组件改绑到保留的数据源再删除。

仪表盘设置（未选中组件时右栏）可修改名称、行高（16–64px）以及每个数据源的名称与 `match`。alias 不在界面中修改。

## 3. 变量列表

变量列表（编辑模式左栏；运行模式可用工具栏按钮显示）按所选数据源列出全部变量：

- 颜色点、显示名、最新值（按 `decimals` 格式化）、单位、最近 100 点的迷你曲线（Canvas，宽 60px）、速率（Hz）。
- 计算变量带 `fx` 徽标；计算出错时显示红色感叹号，悬停显示错误。
- 超出该数据源变量上限时，顶部显示「已忽略 N 个变量（超出每个数据源 X 个的上限），可在工具设置中调整」。样本数与变量上限在工具设置中调整。
- 点击变量名打开**变量显示设置**：显示名、单位、颜色、缩放、偏移、小数位。
  - 显示值 = `原始值 × scale + offset`。只影响仪表盘显示与控件反馈值，不改变 series 中的数据与 CSV 导出。
  - 显示名与单位的优先级：`variableMeta` > `DecodeResult.variableMeta` > 变量 key。
  - 颜色留空时按变量在列表中的顺序使用 `--series-1` 至 `--series-12`。
- **+ 计算变量**：输入名称、表达式、单位；对话框实时显示当前计算结果或错误。
  - 表达式可用 `v.<变量名>`、`t`、`dt`、`prev`，以及 `abs/sqrt/pow/exp/log/log10/sin/cos/tan/asin/acos/atan/atan2/min/max/floor/ceil/round/sign/hypot/PI/E/clamp`。
  - 名称必须匹配 `/^[A-Za-z_][A-Za-z0-9_.]{0,63}$/`；保存后以 `fx.<名称>` 出现，与已有 `fx.<名称>` 重名时添加失败。
  - 计算变量以 `fx.<名称>` 进入变量列表，按定义顺序在主线程求值。修改定义后，运行时把新的定义同步到数据源并让组件下一次刷新。
- **拖放**（HTML5 拖放，MIME 为 `application/x-toolset-variable`）：
  - 拖到画布空白处：在落点创建波形图（`12×8`，受最小尺寸约束），绑定该变量；
  - 拖到支持多变量的组件（`variables` 属性）上：追加到变量列表；达到 `max` 时提示「该组件最多绑定 N 个变量」；
  - 拖到单变量组件（`variable` 属性）上：替换原变量；
  - 拖动经过时目标组件高亮；运行模式下拖放会自动切换到编辑模式。

## 4. 一键生成

工具栏「一键生成」调用 `generateDashboard(variables, { alias, name })`。仪表盘名称默认 `<会话名> 仪表盘`。

- 变量不超过 8 个：
  - 第一行是包含全部变量的波形图（`24×10`）；
  - 之后每个变量一个数值组件，宽 `max(3, floor(24 / n))`、高 3，排满一行后换行。
- 变量超过 8 个：
  - 每 8 个变量一个波形图（`12×9`，两两并排）；
  - 最后是包含全部变量的变量表（`24×min(2 + n, 16)`）。
- 变量颜色按 `--series-1` 至 `--series-12` 依次分配到 `variableMeta`。
- 没有变量时按钮禁用；提示需要当前数据源已有变量。

## 5. 编辑：布局与快捷键

网格为 24 列，行高由仪表盘设置控制。列宽 = `(窗格宽 - 6 × 25) / 24`，间距 6px。

- **拖动与吸附**：按住组件任意位置拖动；移动量按「列宽 + 间距」「行高 + 间距」取整吸附到网格。拖动过程中显示目标占位框并实时预览布局，松开后提交一次。重叠的组件被依次下推，最后压紧。
- **缩放**：编辑模式下显示右下角、右边、下边三个手柄；缩放量同样吸附到整格。尺寸夹在组件的最小尺寸与网格范围之间（`w 1–24`、`h 1–64`）。
- **多选**：Shift+点击切换选中；空白处拖出框选（拖框小于 4×4px 视为点击空白，清除选择）。多选时属性面板只显示公共外观字段。
- **右键菜单**（编辑模式）：复制、粘贴、创建副本、删除、置于顶部行。自定义控件额外显示「另存为自定义控件模板」。
- **快捷键**（编辑模式且焦点在画布上时生效）：
  - `Ctrl/Cmd+Z` 撤销，`Ctrl/Cmd+Shift+Z` 或 `Ctrl+Y` 重做；
  - `Ctrl/Cmd+C` / `V` 复制 / 粘贴，`Ctrl/Cmd+D` 创建副本；
  - `Delete` / `Backspace` 删除选中组件；
  - 方向键移动 1 格，`Shift+方向键` 调整大小 1 格；
  - `Esc` 关闭右键菜单并取消选中。
- **撤销/重做**：最多 100 步。500ms 内对同一字段的连续修改合并为一步；一次拖动或缩放只记一步。

## 6. 组件库

左栏按「图表 / 数值 / 控件 / 自定义」四组列出组件：图标、名称，悬停显示说明。

- 点击：用 `placeNew` 放在第一个能放下的空位，并立即选中。
- 拖到画布：在落点按 `placeNew` 放置（MIME 为 `application/x-toolset-widget`）。
- 新组件使用定义中的 `defaultSize`；自定义控件使用其 `size.default`（默认 `6×6`）。
- 「自定义」组列出仓库中的全部自定义控件；末尾的「新建自定义控件」与「管理…」都打开自定义控件编辑器。
- 组件库由 `import.meta.glob('./widgets/*/definition.ts', { eager: true })` 自动生成：新增一个目录即出现在组件库，不需要修改注册表。类型重复或定义无效时只在控制台警告并忽略该项。

## 7. 属性面板

选中一个组件时显示三个标签页：

- **数据**：`tab = 'data'` 的字段；
- **外观**：`CommonProps` 加上 `tab = 'style'` 的字段；
- **行为**：`tab = 'behavior'` 的字段。

字段按 `visibleWhen` 条件显示；修改立即生效并进入撤销历史（按 `prop:<key>` 合并）。

公共外观字段（`CommonProps`，所有组件与自定义控件共用）：

| 字段         | 类型                             | 默认值     |
| ------------ | -------------------------------- | ---------- |
| `title`      | 文本                             | 组件类型名 |
| `showTitle`  | 复选框                           | `true`     |
| `titleAlign` | 左 / 居中                        | `left`     |
| `background` | `default` / `transparent` / 颜色 | `default`  |
| `border`     | 复选框                           | `true`     |
| `padding`    | 0 / 4 / 8 / 12 px                | `8`        |
| `fontScale`  | 0.75–2                           | `1`        |

属性类型与编辑器：

| 类型                                                   | 编辑器                                                    |
| ------------------------------------------------------ | --------------------------------------------------------- |
| `number` / `text` / `textarea` / `select` / `checkbox` | 标准输入控件                                              |
| `color`                                                | 色块 + 文本输入，支持 `auto`（使用变量颜色或主题色）      |
| `range`                                                | 最小值、最大值两个输入框，各带「自动」复选框              |
| `variable`                                             | 数据源下拉 + 变量下拉（显示最新值）；接受变量列表拖入     |
| `variables`                                            | 变量行列表，可拖动排序、删除；每项可展开编辑 `itemFields` |
| `thresholds` / `zones` / `options`                     | 可增删、可排序的行编辑器                                  |
| `command`                                              | 命令编辑器（见第 9 节）                                   |
| `expression`                                           | 单行代码输入框，失焦时校验语法                            |

**命令编辑器**：

- 选择类型：模板 / 协议表单 / 控制线 / 快捷发送；选择数据源。
- 模板类型：选择文本或 HEX、输入模板、设置编码（UTF-8 / ASCII / Latin-1 / GBK）、行尾、校验（无 / sum8 / xor8 / lrc / crc8 / crc16-modbus / crc16-ccitt）。下方实时显示「示例：value = 1 → <HEX 预览>」或错误；预览固定用 `value = 1` 且不查变量，因此引用 `{var.<key>}` 的模板在编辑器中会显示「变量 <key> 暂无数据」，运行时仍能正常解析。`checksumEndian` 与 `checksumSkip` 不在面板中暴露，沿用运行时默认值（小端、0）。
- 协议表单类型：按所选数据源当前绑定会话的 `sendForm` 生成字段；每个字段可以填固定值或 `{value}`。
- 控制线类型：DTR / RTS / BRK 三态（未设置 / 低 / 高）。
- 快捷发送类型：从快捷发送分组中选择一项。

未选中组件时显示仪表盘设置：名称、行高、数据源列表（名称、`match.deviceKey`、`match.providerKind`，可删除但至少保留 1 个）、计算变量列表。

## 8. 内置组件与属性

14 种内置组件位于 `src/tools/serial/dashboard/widgets/<type>/`，每个目录有 `definition.ts` 与 `Widget.vue`。下表列出实现中的类型、分组、默认/最小尺寸与属性键（`tab`：字段 = 默认值）。

| 类型           | 名称     | 分组 | 默认/最小  | 属性                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------- | -------- | ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chart.line`   | 波形图   | 图表 | 12×8 / 4×4 | **数据**：`variables`（1–16；itemFields：`color`=auto、`lineWidth`=1.5（0.5–4）、`axis`=left/right、`visible`=true）；`xMode`=idx/time；`window`=1000（10–100000）；`windowSeconds`=10（0.1–3600）。**外观**：`yLeft`、`yRight`=自动；`lineStyle`=line/step/scatter；`showGrid`=true；`showLegend`=true；`legendPos`=top；`showPoints`=false。**行为**：`cursor`=true；`triggerVar`；`triggerLevel` |
| `chart.xy`     | XY 图    | 图表 | 8×8 / 4×4  | **数据**：`xVar`；`yVars`（1–4，itemFields：`color`=auto）；`points`=500（10–20000）。**外观**：`style`=points/line；`xRange`、`yRange`=自动；`equalAspect`=false；`fade`=true                                                                                                                                                                                                                      |
| `chart.fft`    | 频谱     | 图表 | 12×8 / 4×4 | **数据**：`variable`；`size`=1024（256–16384，实际取最近的 2 的幂）；`window`=hann（none/hann/hamming/blackman）；`sampleRate`（留空按时序估算）；`removeDc`=true；`average`=1（1–16）。**外观**：`scale`=db/linear；`logX`=false；`showPeak`=true；`yRange`=自动                                                                                                                                   |
| `value.number` | 数值     | 数值 | 4×3 / 2×2  | **数据**：`variable`；`decimals`（留空继承变量）。**外观**：`fontSize`（留空随尺寸缩放）；`showUnit`=true；`showLabel`=true；`color`=auto；`thresholds`=[]；`sparkline`=false；`sparkPoints`=100（10–1000）；`showMinMax`=false                                                                                                                                                                     |
| `value.gauge`  | 仪表     | 数值 | 6×6 / 3×3  | **数据**：`variable`；`min`=0；`max`=100。**外观**：`arc`='270'/'180'；`zones`=[]；`showTicks`=true；`ticks`=5（2–20）；`decimals`（留空继承变量）；`needleColor`=auto                                                                                                                                                                                                                              |
| `value.bar`    | 柱状图   | 数值 | 6×6 / 3×3  | **数据**：`variables`（1–16，itemFields：`color`=auto）；`min`=0；`max`=100；`autoRange`=false。**外观**：`orientation`=vertical/horizontal；`showValues`=true；`thresholds`=[]                                                                                                                                                                                                                     |
| `value.led`    | 指示灯   | 数值 | 3×3 / 2×2  | **数据**：`variable`；`conditions`（thresholds，按顺序取第一个匹配项，`label` 显示在灯下）。**外观**：`offColor`=`var(--border)`；`shape`=circle/square；`blink`=false；`showLabel`=true                                                                                                                                                                                                            |
| `value.table`  | 变量表   | 数值 | 8×6 / 4×3  | **数据**：`variables`（0–64，0 表示该数据源全部变量）；`source`（文本，留空 = 默认数据源）。**外观**：`colValue`=true、`colMin`、`colMax`、`colMean`、`colRate`、`colCount`=false；`compact`=false                                                                                                                                                                                                  |
| `value.text`   | 文本     | 数值 | 6×2 / 2×1  | **数据**：`template` = `温度 {var.temp:.1f} °C`（textarea；语法同命令模板的文本模式，变量取默认数据源，缺失时显示 `--`）。**外观**：`align`=left/center/right；`fontSize`=16（8–200）；`color`=`var(--text)`；`bold`=false                                                                                                                                                                          |
| `ctrl.button`  | 按钮     | 控件 | 3×2 / 2×1  | **外观**：`label`='发送'（≤40 字）；`color`=`var(--accent)`。**行为**：`command`；`value`=1；`momentary`=false；`releaseCommand`（仅在 `momentary` 时显示）；`confirm`=false                                                                                                                                                                                                                        |
| `ctrl.switch`  | 开关     | 控件 | 3×2 / 2×1  | **外观**：`labelOn`='开'；`labelOff`='关'。**行为**：`onCommand`、`offCommand`（`{value}` 分别为 1 和 0）；`feedbackVar`（设置后状态跟随「显示值 > 0」，用户操作后 2 秒内不被反馈覆盖）                                                                                                                                                                                                             |
| `ctrl.slider`  | 滑块     | 控件 | 6×2 / 3×1  | **数据**：`min`=0；`max`=100；`step`=1；`feedbackVar`。**外观**：`orientation`=horizontal/vertical；`showValue`=true；`decimals`=0。**行为**：`command`；`sendMode`=release/throttle；`throttleMs`=100（20–2000，仅节流模式显示）                                                                                                                                                                   |
| `ctrl.input`   | 数值输入 | 控件 | 4×2 / 3×1  | **数据**：`min`（留空不限）；`max`（留空不限）；`step`=1；`decimals`=2。**行为**：`command`；`sendOn`=enter/button；越界或非数字时行内报错且不发送                                                                                                                                                                                                                                                  |
| `ctrl.select`  | 下拉选择 | 控件 | 4×2 / 3×1  | **数据**：`options`（默认「选项 1」=1、「选项 2」=2）。**行为**：`command`（`{value}` 为选中项的 value）；`feedbackVar`                                                                                                                                                                                                                                                                             |

公共约定：

- 所有数值先应用 `variableMeta` 的 scale / offset / decimals / 单位。
- 颜色为 `auto` 时使用变量颜色；没有变量颜色时按变量顺序使用 `--series-n`。
- 统一空状态：未绑定变量显示「未绑定变量」，无数据显示「等待数据…」，数据源未绑定显示「数据源未连接」。
- 控件在数据源不处于 `open` 状态时禁用，悬停提示「数据源 <alias> 未连接」。内置控件在编辑模式下不发送（`mode !== 'run'` 时直接返回）；自定义控件需自行检查 `ctx.mode`。
- 发送成功时外框与控件边框闪烁 `--ok`；失败时闪烁 `--danger` 并弹出 Toast。控件根元素带 `data-sent-count`；数值类组件带 `data-display-value`；图表带 `data-point-count`（e2e 依赖这些属性）。

图表组件（`chart.line`、`chart.xy`、`chart.fft`）：

- uPlot 在 `onMounted` 之后通过 `await import('uplot')` 与 `await import('uplot/dist/uPlot.min.css')` 加载；模块级缓存，重复挂载不重复下载。
- 数据更新用 `setData`，不重建实例；尺寸变化用 `setSize`；主题或 series 配置变化时 `rebuild()`。
- 波形图的数据点数超过「绘图区宽度 × 4」时先用 `minMaxDecimate` 抽取；多变量共用一条 x 轴：样本序号模式以 `idx` 对齐（缺失为 `null`），时间模式以相对最新样本的秒数对齐（0 = 最新，向左为负）。
- 波形图运行模式下悬停显示光标与数值；右上角工具条提供冻结/继续、重置缩放、导出 PNG、导出可见数据 CSV。冻结后可用滚轮缩放、拖动平移。
- 颜色、网格、文字从 CSS 变量读取；主题切换后重建 uPlot 的 series 样式。

## 9. 命令模板语法

`CommandSpec` 有四种类型：

```ts
type CommandSpec =
  | {
      kind: 'template'
      source: string
      mode: 'text' | 'hex'
      template: string
      options: Omit<ComposeOptions, 'mode'>
    }
  | { kind: 'protocol'; source: string; values: Record<string, string | number | boolean> }
  | { kind: 'signal'; source: string; dtr?: boolean; rts?: boolean; brk?: boolean }
  | { kind: 'quick'; source: string; quickItemId: string }
```

`renderCommand(spec, value, lookup, context?)` 只渲染出动作（bytes / form / signal / quick），不直接访问会话。界面层随后执行：bytes 用 `session.send(bytes, 'widget')`，form 用 `session.sendForm(values)`，signal 用 `session.setSignals(...)`，quick 执行对应快捷发送项（控制线序列会按 `delayMs` 依次执行）。

### 9.1 占位符

- `{name}` 或 `{name:fmt}`；`{{` 与 `}}` 表示字面量花括号。
- `name` 可以是 `value`（控件当前值）或 `var.<key>`（同一数据源中该变量的最新**显示值**）。
- 占位符前后空白会被去掉；名称为空时报「占位符「{…}」缺少名称」；未闭合时报「模板占位符未闭合（缺少 }）」；未知名称报「不支持的占位符：{…}」。
- `value` 缺失时报「控件没有当前值」；变量没有数据时报「变量 temp 暂无数据」；数据源没有绑定会话时报「数据源 main 未连接」。会话已绑定但未 open 时，渲染阶段不报错，实际发送会失败并由控件显示错误。

文本模式的 `fmt`：

| `fmt`     | 结果                                                     |
| --------- | -------------------------------------------------------- |
| 不写      | 数字用 `String()`；布尔值为 `1`/`0`；字符串原样输出      |
| `.Nf`     | 保留 N 位小数，N 为 0–10                                 |
| `d`       | 四舍五入为整数                                           |
| `0Nd`     | 四舍五入后补零到 N 位，N 为 1–20；负号单独保留           |
| `x` / `X` | 四舍五入后输出小写 / 大写十六进制（负数得到 `-ff` 形式） |

格式化前会先把值转成数字：字符串必须是有限数，布尔值按 1/0。其他 `fmt` 报「无效的格式化：「…」」；`.Nf` 的小数位必须为 0–10，`0Nd` 的补零位数必须为 1–20。替换完成后用 `compose` 与组包选项（编码、行尾、校验、`checksumSkip`）生成字节。

HEX 模式的模板是空格分隔的 HEX 字节；每个占位符**必须**指定字节类型：

| 类别   | `fmt`                                    |
| ------ | ---------------------------------------- |
| 无符号 | `u8`、`u16le`、`u16be`、`u32le`、`u32be` |
| 有符号 | `i8`、`i16le`、`i16be`、`i32le`、`i32be` |
| 浮点   | `f32le`、`f32be`、`f64le`、`f64be`       |

整数类型先四舍五入再检查范围；越界返回「值 300 超出 u8 范围（0–255）」。缺少字节类型返回「HEX 模板中的占位符必须指定字节类型：{…}」；未知类型返回「不支持的字节类型：「…」（占位符 {…}）」。替换后的字节与模板字节一起交给 `compose`（HEX 模式与组包选项）追加校验和行尾。

### 9.2 protocol / signal / quick

- **protocol**：`values` 中字符串正好等于 `'{value}'` 时替换为控件的原始类型值；正好等于 `'{var.<key>}'` 时替换为该变量最新的显示值。其他包含 `{` 的字符串按文本模板规则渲染；不含 `{` 的字符串原样传递；数字与布尔值原样传递。
- **signal**：`dtr` / `rts` / `brk` 为布尔值；未设置的项不改变当前控制线状态。
- **quick**：按 `quickItemId` 执行一个快捷发送项。数据项按自身组包选项发送；控制线项按步骤顺序执行，步骤间可用 `delayMs` 延时。找不到该项时报「找不到快捷发送项：<id>」。

## 10. 刷新调度与暂停

一个 Pane 一个调度器（`runtime/frame-loop.ts`）：

- 用 `requestAnimationFrame` 驱动，按工具设置中的仪表盘刷新率（15/30/60 fps，默认 30）节流；
- 页面隐藏时停止，恢复可见时立即刷新一次；
- 每一帧检查每个已绑定数据源的 `SeriesSource.frameIdx`，只通知「绑定的数据有更新」的组件；
- 「暂停全部」不调用帧回调，数据仍继续写入 series；工具栏显示「已暂停」；
- Pane 切换到终端视图或离开工具（`KeepAlive` 缓存）时调度器停止。

内置组件通过 `useWidgetData(refs, { history?, maxAppended? })` 读取数据；**只在调度帧内读取**，不得自行订阅 series 的 `data` 事件。返回值包括 `latest`、`variables`、`slices`、`appended`、`sourceStates`、`errors`、`frameIndex`、`now`、`send`、`sendBytes`、`theme`、`resolveMeta`、`requestUpdate`。

## 11. 保存、导入导出与数据 CSV

- 每次修改在 800ms 防抖后写入 kv `dashboards/<id>`，同时更新 local 索引 `dashboards`（`[{ id, name, updatedAt }]`）。切换仪表盘、离开工具、`pagehide` 时立即冲刷待保存内容。
- 保存失败时弹出 Toast，工具栏显示「未保存」。
- 多标签页不做实时同步：保存前比较 kv 中的 `updatedAt`；发现其他标签页更新时提示「该仪表盘已在其他标签页修改」，可选择「覆盖」或「重新加载」。
- **导出**：文件名 `<名称>.dashboard.json`，内容：

  ```json
  {
    "format": "toolset-dashboard",
    "formatVersion": 1,
    "dashboard": { "...": "Dashboard" },
    "customWidgets": [{ "id": "…", "name": "…", "code": "…", "createdAt": 0, "updatedAt": 0 }]
  }
  ```

  `customWidgets` 包含该仪表盘用到的全部自定义控件记录。

- **导入**：先校验 `format`、`formatVersion`（高于 1 时提示升级）、`dashboard`（`migrateDashboard` → `validateDashboard`）并用 `normalize` 修正越界布局。
  - 仪表盘 id 已存在时询问「覆盖」或「另存为副本」（新 id，名称后加「（导入）」）；
  - 自定义控件 id 已存在且代码相同：跳过；代码不同：询问「覆盖」或「保留两者」（新 id，并改写仪表盘中的 `custom:<id>` 引用）；
  - 文件包含自定义控件时，先显示安全说明并经用户确认。确认按钮文案为「我已了解风险，继续导入」。
- **导出数据 CSV**：选择数据源、变量（默认为该仪表盘用到且该数据源当前存在的变量；没有用到变量时选全部）与范围（全部缓冲 / 最近 N 秒）。
  - 文件名 `<仪表盘名>_<数据源>_<YYYYMMDD-HHmmss>.csv`，由 `exportSeriesCsv` 生成；
  - 与「变量显示设置」无关：CSV 使用原始值，不应用 scale/offset；
  - 数据源未连接或没有数据时给出 Toast。

## 12. 窄窗格

Pane 宽度小于 600px 时：

- 组件按 `(y, x)` 顺序单列排列，高度保持不变；
- 不能拖动、缩放、框选，也不能从组件库或变量列表拖入；
- 顶部提示「窗格过窄，已切换为单列只读布局」。

## 13. 新增内置组件

新增一种内置组件只需在 `src/tools/serial/dashboard/widgets/` 下新增一个目录，不需要修改组件库或注册表。

### 13.1 `definition.ts`

```ts
import { MyIcon } from 'lucide-vue-next'
import type { WidgetDefinition } from '@/domains/dashboard/public'

const definition: WidgetDefinition = {
  type: 'value.example',
  version: 1,
  title: '示例',
  description: '一句话说明',
  group: 'value', // 'chart' | 'value' | 'control'
  icon: MyIcon,
  defaultSize: { w: 4, h: 3 },
  minSize: { w: 2, h: 2 },
  props: [
    { key: 'variable', label: '变量', type: 'variable', tab: 'data' },
    { key: 'showX', label: '显示 X', type: 'checkbox', tab: 'style', default: true },
  ],
  component: () => import('./Widget.vue'),
}

export default definition
```

要求：

- `type` 全局唯一；重复时注册表警告并忽略后出现的定义。
- 必须静态导出 `type` / `title` / `group` / `component`，否则 `isWidgetDefinition` 判定无效。
- `definition.ts` 受 `widget-definition-light` 约束：不得静态导入 `.vue`、`uplot`、CodeMirror 或领域代码；只允许类型导入与动态 `import()`。
- 属性字段使用 `WidgetPropField`。默认值决定新组件的初始 `props`；`visibleWhen` 控制条件显示；`help` 显示为提示。
- 需要迁移旧属性时提高 `version` 并提供 `migrate(props, fromVersion)`；`WidgetFrame` 会在加载旧实例时补默认值并调用它。
- 新增选项、改变字段含义都属于属性版本变化，应同时提高 `version`。

### 13.2 `Widget.vue`

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { VarRef } from '@/domains/dashboard/public'
import { useWidgetData } from '../../runtime/useWidgetData'
import type { WidgetComponentProps } from '../shared/types'

const props = defineProps<WidgetComponentProps>()

const ref = computed<VarRef | null>(() => {
  const value = props.props.variable
  return value && typeof value === 'object' ? (value as VarRef) : null
})
const data = useWidgetData(() => (ref.value ? [ref.value] : []), { history: { last: 500 } })
</script>

<template>
  <div>{{ data.latest.value[0] ?? '--' }}</div>
</template>
```

约定：

- `Widget.vue` 只接收 `instance`、`props`（已合并默认值）、`size`（像素）、`mode`、`ctx` 五个 props，类型为 `WidgetComponentProps`。
- 数据一律通过 `useWidgetData` 读取；不得自行订阅 `SeriesSource` 的 `data` 事件，否则会绕过 fps 节流。
- 用 `props.mode === 'run'` 判断是否允许交互/发送；编辑模式下所有控件都不发送。
- 用 `props.ctx.send` / `sendBytes` / `sourceState` / `theme` / `resolveMeta`；`send` 失败已由 `WidgetFrame` 弹 Toast，不需要组件重复处理。
- 空状态使用共享文案常量 `EMPTY_NO_VARIABLE`、`EMPTY_WAITING_DATA`、`EMPTY_SOURCE_DISCONNECTED`（或 `WidgetEmpty.vue`）。
- 数值格式化、颜色解析、发送反馈、单变量读取等工具放在 `widgets/shared/`（`format.ts`、`use-send-state.ts`、`use-single-variable.ts`、`chart-data.ts`）。新增通用逻辑优先加入 shared，而不是复制到多个组件。
- 为 e2e 提供稳定的测试钩子：控件根元素带 `data-sent-count`；数值类带 `data-display-value`；图表带 `data-point-count`。
- 图表类组件必须用 `widgets/shared/use-uplot.ts`：`await import('uplot')` 与样式只在挂载后加载，`setData` 更新、`setSize` 调尺寸、`rebuild` 换主题，卸载时 `destroy`。

### 13.3 注册、分包与测试

- 注册：`widget-registry.ts` 的 `import.meta.glob('./widgets/*/definition.ts', { eager: true, import: 'default' })` 自动收集；组件库、属性面板与 `WidgetFrame` 共用该注册表。
- 分包：`check:chunks` 要求每个 `dashboard/widgets/*/Widget.vue` 出现在非入口 chunk；`uplot` 不得进入入口闭包，也不得进入 `SerialToolView.vue` 的静态闭包。`definition.ts` 保持轻量才能满足 `widget-definition-light` 与 `check:chunks`。
- 单元/组件测试：
  - 纯逻辑（窗口裁剪、对齐、格式化、阈值选择等）放到共享模块并在 `tests/unit/` 覆盖；
  - 组件测试放 `tests/components/`，文件首行声明 `// @vitest-environment happy-dom`，用假的 `WidgetContext` 与 `DashboardRuntime`（参考 `value-number.test.ts`、`ctrl-button.test.ts`、`ctrl-slider.test.ts`）；
  - 需要真实数据的路径放到 `tests/e2e/`；已有的 `data-*` 钩子便于断言；
- 检查命令：`pnpm typecheck && pnpm lint && pnpm format:check && pnpm test:unit && pnpm check:arch && pnpm build && pnpm check:chunks`。

## 14. 已知限制

- 右键菜单的「另存为自定义控件模板」当前只提示「将在后续版本提供」，不会生成模板。
- 变量表的 `source` 是文本字段（填 alias，留空表示默认数据源），因为属性面板的 `select` 不支持按仪表盘数据源动态生成选项。
- 数据源 alias 不能在界面中重命名；需要换 alias 时请新建数据源并重新绑定组件。
- 仪表盘不保留变量数据的跨刷新内容；页面刷新后图表从新样本重新开始累积。
- 自定义控件的完整 API、调用保护与安全模式见 [custom-widget.md](custom-widget.md)。
