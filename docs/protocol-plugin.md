# 协议插件

协议插件负责两件事：把字节流按规则切成帧（声明式分帧），以及把帧解析成人类可读的结果、把表单值编码成字节（`decode` / `encode` 钩子）。`decode` 还可以通过 `variables` 输出变量样本，供 `domains/series` 与仪表盘绘图。

内置提供 4 个只读的数据格式（FireWater、JustFloat、键值文本、传感器帧 A5 5A）与 5 个新建模板。内置协议的实现方式与用户插件完全相同，都是一段插件代码字符串。

插件在**每个会话独立的 Web Worker** 中运行，通过 `new Function('sdk', 'console', code)` 编译。Worker 隔离只用于防止死循环卡死页面，**不是安全沙箱**：插件代码拥有 Worker 内的完整 JS 权限，只应加载可信代码。v1 不设置 CSP，部署环境不能禁止 `unsafe-eval`。

## 1. 插件代码格式

插件是一段 JS 函数体（不是模块，不能使用 `import`/`export`）。运行时以 `sdk` 与 `console` 两个参数注入，函数体必须 `return` 一个 `ProtocolDefinition`：

```js
// 最小示例：按行分帧，解码为文本摘要
return {
  apiVersion: 1,
  meta: { name: '最小示例', description: '按行分帧', version: '1.0.0' },
  framing: { type: 'line', eol: 'lf' },
  decode(frame, ctx) {
    return {
      summary: sdk.text(frame),
      fields: [{ label: '方向', value: ctx.direction }],
    }
  },
}
```

也可以在函数体内定义辅助函数、常量与状态（函数体是闭包）。代码大小上限为 256KB。

## 2. 类型定义

```ts
interface ProtocolDefinition {
  apiVersion: 1
  meta: { name: string; description?: string; version?: string }
  framing: FramingSpec
  decode?(frame: Uint8Array, ctx: DecodeContext): DecodeResult | DecodeResult[] | null
  sendForm?: { fields: SendField[] }
  encode?(values: Record<string, SendValue>, ctx: EncodeContext): Uint8Array | number[]
}

interface DecodeContext {
  direction: 'rx' | 'tx'
  timestamp: number
  state: Record<string, unknown>
}
interface EncodeContext {
  state: Record<string, unknown>
}
// state 是该会话内持久的可写对象，用于跨帧保存状态；切换或重载协议时清空

interface DecodeResult {
  type?: string
  summary: string
  fields?: DecodeField[]
  level?: 'info' | 'warn' | 'error' // 默认 'info'
  variables?: Record<string, number> // 供仪表盘使用的变量样本
  variableMeta?: Record<string, { unit?: string; label?: string }> // 可选，帮助仪表盘显示单位和名称
  noVariables?: boolean // true 时不从 fields 自动提取变量
}
interface DecodeField {
  label: string
  value: string | number | boolean
  unit?: string
  format?: 'text' | 'hex' | 'dec'
  key?: string // 可选变量名；没有 variables 时用于从数字字段自动提取变量
}

type SendField =
  | {
      key: string
      label: string
      type: 'number'
      min?: number
      max?: number
      step?: number
      default?: number
      unit?: string
    }
  | { key: string; label: string; type: 'text'; maxLength?: number; default?: string }
  | {
      key: string
      label: string
      type: 'select'
      options: Array<{ label: string; value: string | number }>
      default?: string | number
    }
  | { key: string; label: string; type: 'checkbox'; default?: boolean }
  | { key: string; label: string; type: 'hex'; default?: string }

type SendValue = number | string | boolean | Uint8Array // hex 字段传入解析后的 Uint8Array
```

## 3. 输出变量供仪表盘使用

`decode` 返回的 `variables` 是仪表盘的数据来源。规则（实现位于 `domains/series/extract.ts`，协议结果规范化位于 `domains/protocol/runtime/compile.ts`）：

1. 变量名必须匹配 `/^[A-Za-z_][A-Za-z0-9_.]{0,63}$/`，即字母或下划线开头，后面可跟字母、数字、下划线和点，最长 64 个字符。`variables` 中出现不合法的键会让**整个解码结果**变成解码错误（该帧 `results` 为空并带 `error`），而不是只丢弃这个键。
2. `variables` 的值必须是 `number`（非数字值会被静默丢弃）；`NaN`/`Infinity` 在协议层原样保留，由 `domains/series` 丢弃并计入 `invalidSamples`。
3. 单个结果最多保留 256 个变量，超出的变量会被截断，并通过插件告警通道提示「变量数量超过 256 个，已截断（丢弃 N 个）」。
4. `variableMeta` 用同一套变量名规则；非法键被忽略，`unit`/`label` 至少有一个才会保留。后到的 `variableMeta` 会覆盖先到的元信息。
5. 有 `variables` 时**只**使用 `variables`，不会再看 `fields`。
6. 没有 `variables` 且 `noVariables !== true` 时，从 `fields` 自动提取：
   - `value` 为 `number` 的字段以 `key ?? label` 作为变量名；
   - `value` 为 `boolean` 的字段记为 0/1；
   - 名称不符合变量名规则时，把非法字符替换为 `_`，开头不是字母或下划线时加前缀 `v_`；
   - `level === 'error'` 的结果不提取变量。
7. 同一帧内出现重复变量名时，以后到的值为准。

示例：

```js
decode(frame) {
  const temperature = sdk.read.i16le(frame, 0) * 0.01
  const humidity = sdk.read.u16le(frame, 2) * 0.01
  return {
    summary: `温度 ${temperature.toFixed(2)}°C 湿度 ${humidity.toFixed(2)}%`,
    variables: { temp: temperature, hum: humidity },
    variableMeta: {
      temp: { unit: '°C', label: '温度' },
      hum: { unit: '%RH', label: '湿度' },
    },
  }
}
```

如果某个结果的正文已经包含数字字段、但不想让仪表盘自动提取（例如状态码、寄存器地址），设置 `noVariables: true`。`Error` 级别的结果本身也不会提取变量。

### 3.1 变量如何进入仪表盘

```
decode → DecodeResult.variables / variableMeta
  → LinkSession 'frames' 事件（全部 rx 帧，不抽样、不受 LogPolicy 影响）
  → domains/series：SeriesSource 环形缓冲；计算变量在主线程求值
  → 仪表盘运行时：alias → 绑定会话 → SeriesSource
  → useWidgetData → 内置组件 / 自定义控件
```

- 仪表盘数据源按会话绑定，变量名就是 `variables` 中的键；同一个会话可同时供终端与仪表盘使用。
- 显示名与单位的优先级为：仪表盘 `variableMeta` > `DecodeResult.variableMeta` > 变量 key。缩放 / 偏移 / 小数位只覆盖仪表盘显示，不改变 series 与 CSV。
- 日志策略只决定解码帧是否写入终端日志，不影响变量数据与仪表盘刷新；这意味着把日志策略切到「抽样 / 关闭」不会让图表丢帧。
- 数据源绑定、变量列表、计算变量与显示覆盖见 [dashboard.md](dashboard.md) 第 2、3 节；自定义控件读取变量的 API 见 [custom-widget.md](custom-widget.md) 第 3 节。

## 4. 分帧语义

所有 `FramingSpec` 中的十六进制字符串都是空格分隔的字节，例如 `"A5 5A"`。

公共选项 `maxFrameLength` 默认 4096，范围 1–65536。缓冲区超过上限仍未成帧时，丢弃缓冲区全部字节（计入丢弃统计）并重新开始；所有被丢弃的字节都会以 `discard` 事件上报（日志中以「未成帧数据」合并显示）。

| 模式        | 字段                                                                     | 语义                                                                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `line`      | `eol?: 'lf' \| 'crlf' \| 'cr'`（默认 `lf`）、`includeEol?`（默认 false） | `lf` 以 `0x0A` 结尾并去掉前导 `0x0D`；`crlf` 只以 `0x0D 0x0A` 结尾；`cr` 以 `0x0D` 结尾。忽略空行。                                                                                                                                                                    |
| `delimiter` | `start?`、`end`、`include?: 'content' \| 'both'`（默认 `content`）       | 有 `start` 时，`start` 之前的字节作为垃圾丢弃；帧在 `end` 处结束；`both` 保留起止符。空内容仍输出 0 长度帧。                                                                                                                                                           |
| `fixed`     | `length`、`header?`、`trailer?`                                          | 帧长恒为 `length`；有 `header` 时先按 header 同步、帧从 header 开始；有 `trailer` 但帧尾不匹配时丢弃当前帧第一个字节并重新同步。                                                                                                                                       |
| `length`    | `header?`、`length: LengthField`                                         | 帧从 `header` 开始（无 header 时从缓冲区开头）；长度字段位于帧起点偏移 `offset` 处。`includes:'frame'`：总帧长 = 值 + `adjust`；`includes:'after'`：总帧长 = `offset + size + 值 + adjust`。总帧长小于 `offset + size` 或大于 `maxFrameLength` 时丢起点 1 字节重同步。 |
| `idle`      | `gapMs`（1–1000）                                                        | 自上一个字节起静默超过 `gapMs` 后，把缓冲区作为一帧输出。主线程在每块数据到达后启动/重置定时器并发送 `flush`；Worker 同时检查块时间戳，相邻块间隔大于 `gapMs` 时先结束上一帧。                                                                                         |

`LengthField`：

```ts
interface LengthField {
  offset: number
  size: 1 | 2 | 4
  endian?: 'le' | 'be' // 默认 'le'
  includes: 'frame' | 'after'
  adjust?: number // 默认 0
}
```

内置的「传感器帧（A5 5A）」使用：

```js
framing: {
  type: 'length',
  header: 'A5 5A',
  length: { offset: 2, size: 1, includes: 'after', adjust: 2 },
}
```

含义：长度字段在帧起点（`A5`）偏移 2 字节处，占 1 字节；`includes:'after'` 表示总帧长 = 2 + 1 + LEN + 2（CRC），而 `LEN` 是 CMD+DATA 的字节数；`adjust: 2` 把 CRC 两个字节计入。

## 5. SDK 参考

`decode`/`encode` 内可直接使用注入的 `sdk`，其类型名为 `PluginSdk`（`domains/protocol/sdk.ts`；旧名 `ProtocolSdk` 保留为别名，已标记废弃）。

| 成员                                                                                                    | 说明                                                                    |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `sdk.hex(bytes, sep?)`                                                                                  | 字节转十六进制字符串（默认空格分隔、大写）                              |
| `sdk.fromHex(str)`                                                                                      | 十六进制字符串转 `Uint8Array`；非法输入抛错                             |
| `sdk.bytes(...items)`                                                                                   | 由数字和数组拼接为 `Uint8Array`                                         |
| `sdk.read.u8/i8/u16le/u16be/i16le/i16be/u32le/u32be/i32le/i32be/f32le/f32be/f64le/f64be(bytes, offset)` | 数值读取（越界抛 `RangeError`）                                         |
| `sdk.bits(value, start, len)`                                                                           | 取位段                                                                  |
| `sdk.writer()`                                                                                          | `ByteWriter`，带与 read 对应的写方法、`bytes()`、`ascii()`、`toBytes()` |
| `sdk.checksum.sum8/xor8/lrc/crc8/crc16modbus/crc16ccitt(bytes)`                                         | 校验值（1 或 2 字节，取低位字节用 `& 0xFF`）                            |
| `sdk.text(bytes, encoding?)`                                                                            | 字节解码为文本，默认 `utf-8`，另支持 `ascii`、`latin1`、`gbk`           |
| `sdk.assert(cond, message)`                                                                             | 条件不成立时抛出 `Error(message)`；默认消息「断言失败」                 |

校验算法：

- `sum8`：全部字节和 `& 0xFF`
- `xor8`：全部字节异或
- `lrc`：`(-sum) & 0xFF`（Modbus ASCII LRC）
- `crc8`：CRC-8/SMBUS（poly `0x07`，init `0x00`，不反射）
- `crc16modbus`：CRC-16/MODBUS（反射 poly `0xA001`，init `0xFFFF`）
- `crc16ccitt`：CRC-16/CCITT-FALSE（poly `0x1021`，init `0xFFFF`，不反射）

标准校验值（ASCII `"123456789"`）：`crc8 = 0xF4`，`crc16-modbus = 0x4B37`，`crc16-ccitt = 0x29B1`。

## 6. 定义校验与结果规范化

保存/预览前会执行 `validateDefinition`，以下任一不满足都会得到中文错误（尽量带字段路径，如 `framing.length.offset`）：

- `apiVersion === 1`；`meta.name` 是非空字符串。
- `framing` 符合第 4 节：字段类型正确、十六进制字符串可解析、数值在范围内。
- `decode`、`encode` 若存在必须是函数；有 `sendForm` 时必须有 `encode`。
- `sendForm.fields` 的 `key` 唯一且非空；`select` 至少 1 个选项。
- 代码不超过 256KB。

运行时还会对每个 `DecodeResult` 做规范化：

- 返回非对象或缺少 `summary` 时，整帧视为解码错误（该帧照常输出原始数据并带 `error`，不会终止 Worker）。
- `summary` 截断到 200 字；`fields` 最多 64 个，字段结构不合法的项被忽略。
- `variables`、`variableMeta`、`noVariables` 按第 3 节校验并保留。
- `encode` 必须返回 `Uint8Array` 或 0–255 的整数数组，长度 1–65536，否则视为编码错误。

## 7. 五个模板

新建插件时可从 `TEMPLATES`（`domains/protocol/public.ts`）选择模板，模板内容就是可直接运行的函数体：

| 模板         | 分帧                 | 内容                                                                         |
| ------------ | -------------------- | ---------------------------------------------------------------------------- |
| `minimal`    | `line`               | 最小可用插件，`decode` 返回文本摘要                                          |
| `line`       | `line`               | 解析 `KEY=VALUE,KEY=VALUE` 格式的行                                          |
| `length-crc` | `length`             | 与内置传感器协议结构相同（带注释）：header + LEN + CMD + DATA + CRC16        |
| `idle`       | `idle`（`gapMs: 5`） | Modbus RTU 响应：从站地址 + 功能码 + 字节数 + 数据 + CRC16，带 CRC 校验      |
| `variables`  | `line`               | 演示返回 `variables` 与 `variableMeta`（把 `temp=23.5,hum=48.2` 交给仪表盘） |

模板文件在 `src/domains/protocol/templates/`。最小模板：

```js
return {
  apiVersion: 1,
  meta: { name: '最小示例', description: '按行分帧的文本插件', version: '1.0.0' },
  framing: { type: 'line', eol: 'lf', includeEol: false },
  decode(frame) {
    const text = sdk.text(frame)
    return { summary: text || '（空行）' }
  },
}
```

`variables` 模板的关键写法：

```js
return {
  type: 'variables',
  summary: summaryParts.join(' '),
  variables: variables,
  variableMeta: variableMeta,
}
```

## 8. 内置数据格式（4 个）

内置协议 id 以 `builtin:` 开头，只读，不进入插件仓库。列表顺序与 `BUILTIN_PROTOCOLS` 一致：

| id                  | 名称                    | 分帧                                                               | 变量                                              |
| ------------------- | ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| `builtin:firewater` | FireWater（VOFA+ 兼容） | `line`，LF（自动去掉 CR），`maxFrameLength: 4096`                  | `ch0`…`chN-1`，最多 256 个                        |
| `builtin:justfloat` | JustFloat（VOFA+ 兼容） | `delimiter`，`end: '00 00 80 7F'`，`include: 'content'`，上限 1024 | `ch0`…`chN-1`，最多 256 个                        |
| `builtin:kv-text`   | 键值文本                | `line`，LF（自动去掉 CR），`maxFrameLength: 4096`                  | 各 key；非数值项成为文本字段                      |
| `builtin:sensor-a5` | 传感器帧（A5 5A）       | `length`：`A5 5A` 头 + LEN + CMD/DATA + CRC16-MODBUS               | `temp`（°C）、`hum`（%RH）、`volt`（mV）、`count` |

前三种格式的摘要都最多显示 8 项，超出部分用 `…(+N)` 表示；FireWater/JustFloat 使用 `ch0`… 作为键，键值文本使用各自的 key。数字优先原样显示整数，其余保留最多 6 位小数并去掉多余的 0。

### 8.1 FireWater

- 每帧一行 `v0,v1,…`，行尾 LF；LF 模式会去掉行尾前的一个 CR，因此 CRLF 也可用。空行被忽略。
- 解析规则：
  1. 行内若有 `:`，且冒号前的部分（去掉首尾空白后）不是有限数（空字符串也算），则取冒号后的内容参与解析；冒号前非空时同时作为摘要标签。否则整行参与解析。
  2. 剩余部分按 `,` 分割，每段去掉首尾空白后用 `Number()` 解析。
  3. 全部段都是有限数时生成变量 `ch0`…`chN-1`（最多 256 个）；否则把整行作为文本消息（`summary` 为原文，不生成变量）。
- 摘要：有标签时为 `标签: ch0=1.5 ch1=2.5`，否则为 `ch0=1.5 ch1=2.5`。
- 注意：`Number('')` 为 0，因此空段（如 `1,,2`）会被当成 0；行尾多余逗号会产生一个额外的 0 通道。冒号前是数字（如 `1:2,3`）时不当作标签，整行因无法全部解析为有限数而按文本消息处理。
- 下位机示例（C）：`printf("%f,%f\n", a, b);`。也可以加标签：`printf("TEMP:%f,%f\n", a, b);`。

### 8.2 JustFloat

- 每帧由若干小端 float32（`f32le`）组成，帧尾固定为 `00 00 80 7F`（即小端 float 的 `+Infinity`）；帧内容不含尾帧。
- 内容长度必须是 4 的正整数倍。长度为 0 或不是 4 的倍数时返回 `level: 'error'`、`summary: '帧长度不是 4 的倍数'`，不生成变量。
- 按 `f32le` 依次读取，变量名为 `ch0`…`chN-1`，最多 256 个。
- 下位机示例（C）：把 float 数组的字节原样发出，再追加尾帧：

```c
#include <stdint.h>

static const unsigned char JUSTFLOAT_TAIL[4] = {0x00, 0x00, 0x80, 0x7F};

void send_justfloat(const float *values, unsigned count) {
  uart_write((const unsigned char *)values, count * sizeof(float));
  uart_write(JUSTFLOAT_TAIL, sizeof(JUSTFLOAT_TAIL));
}
```

（`uart_write` 是占位写法，替换为实际串口/UART 发送函数；要求 MCU 为小端，或用 `memcpy` 把 float 转成小端字节。）

- 与 +Inf 的碰撞：帧尾 `00 00 80 7F` 与 `+Infinity` 的 f32le 字节完全相同。如果数据中出现 `+Infinity`，接收端会把它当成帧尾从而提前结束帧，后续数据错位。**不要在 JustFloat 数据中发送 `+Inf`**；`NaN` 与 `-Infinity` 的字节与尾帧不同，可以发送，但会被变量提取层丢弃并计入无效样本。
- `maxFrameLength` 为 1024；一帧内容理论上限 256 个 float。若在尾帧到达前缓冲区已超过 1024 字节，会按公共分帧规则丢弃，因此通道数不要超过 256。

### 8.3 键值文本

- 每帧一行，例如 `temp:25.5,hum=48.2,volt:3301`；行尾 LF（自动去掉 CR），`maxFrameLength: 4096`。
- 一行用 `,`、`;` 或空白（空格/制表符）分隔若干项；每项格式为 `key:value` 或 `key=value`（取两者中最先出现的分隔符）。
- `key` 必须匹配变量名规则 `/^[A-Za-z_][A-Za-z0-9_.]{0,63}$/`，首尾空白会被去掉。
- 值能用 `Number()` 解析为有限数时成为变量；其余作为文本字段（`label` 与 `key` 都是该 key，`value` 为原文本）。
- 一项都不匹配时，把整行作为文本消息（`summary` 为原文）。
- 变量最多 256 个；摘要按项用空格连接，数字按第 8 节规则格式化，文本原样显示，最多 8 项并附 `…(+N)`。
- 同一 key 在数字项中重复出现时，以后到的数值为准；文本项会作为独立字段保留。
- 值本身不能包含空格、逗号或分号（会被当作项分隔符）。
- 下位机示例（C）：`printf("temp:%.2f,hum:%.2f,volt=%d\n", temp, hum, volt);`。

### 8.4 传感器帧（A5 5A）逐行解读

帧格式：

```
A5 5A | LEN(1) | CMD(1) | DATA(LEN-1) | CRC16-MODBUS(2, 低字节在前)
LEN = CMD 与 DATA 的字节数之和
CRC 覆盖从 A5 到 DATA 末尾的全部字节
```

源码：`src/domains/protocol/builtin/sensor-a5.ts`。要点：

1. `framing`：`{ type:'length', header:'A5 5A', length:{ offset:2, size:1, includes:'after', adjust:2 } }`。总帧长 = `2 + 1 + LEN + 2`。长度字段不合法时自动丢字节重同步，坏帧不会卡死解析。
2. CRC 校验：用 `sdk.checksum.crc16modbus(frame.subarray(0, frame.length - 2))` 与帧尾小端 CRC 比较；不匹配时返回 `{ summary: 'CRC 错误', level: 'error', fields: [期望值, 实际值], noVariables: true }`，实测值用 `format: 'hex'`。
3. `CMD 0x01` 上报（每帧 LEN = 11）：`DATA = 温度 i16le ×0.01°C | 湿度 u16le ×0.01%RH | 电压 u16le mV | 计数 u32le`。`summary` 形如「上报 #计数 温度 25.31°C 湿度 48.20% 电压 3301mV」；`fields` 包含计数、温度、湿度、电压。
   - `variables`：`temp`（温度）、`hum`（湿度）、`volt`（电压）、`count`（计数）。
   - `variableMeta`：`temp { unit: '°C', label: '温度' }`、`hum { unit: '%RH', label: '湿度' }`、`volt { unit: 'mV', label: '电压' }`、`count { label: '计数' }`。
   - 长度不对时返回 error 结果，不生成变量。
4. `CMD 0x10` 设置间隔（主机→设备，LEN = 3）：`DATA = 间隔 u16le ms（100–10000）`。`sendForm` 只有一个 `number` 字段 `interval`，`encode` 组出 `A5 5A 03 10 <interval le> <crc>`；间隔非法时 `sdk.assert` 抛错，发送表单显示编码错误。
5. `CMD 0x90` 应答（LEN = 4）：`DATA = 状态 u8（0 成功，1 超出范围）| 间隔 u16le`；状态 0 时 `level: 'info'`，否则 `'warn'`，不生成变量。
6. 未知命令返回 `{ summary: '未知命令 0xNN', level: 'warn', noVariables: true }`。

演示端口（`domains/link/transports/virtual`）在 `format = 'sensor-a5'` 时按同一格式上报数据，并响应 0x10 设置间隔命令，因此可以直接用内置协议验证解析与发送。

## 9. 插件仓库与导入导出

`getProtocolRepository()`（`domains/protocol/public.ts`）提供：

```ts
list(): Promise<ProtocolSummary[]>
get(id): Promise<ProtocolRecord | undefined>
save({ id?, name, code }): Promise<ProtocolRecord>
remove(id): Promise<boolean>
importFile(text, fileName): Promise<ProtocolRecord>
exportFile(id): Promise<{ fileName, code }>
subscribe(cb): () => void
```

- 记录结构：`{ id, name, code, createdAt, updatedAt }`。
- 代码存 `createDomainStorage('protocol').kv` 的 `plugins/<id>`；索引存 local store `index`（`[{ id, name, updatedAt }]`）。
- 内置协议共 4 个，id 以 `builtin:` 开头，只读，不进入存储。
- 导入时 `meta.name` 取自编译结果；编译失败则用文件名。导出文件名为 `<name>.protocol.js`。
- 管理器中保存插件时，先在临时 Worker 中编译并校验；成功后写入仓库，并通知所有使用该协议的会话重建 runtime（会话收到后写系统日志「协议已更新：<名称>」）。删除正在使用的协议会让这些会话回退到「无协议」。

## 10. 执行模型与安全

- **执行位置**：每个会话一个独立 Worker。Worker 内先分帧，再对每帧调用 `decode`，最后把整批结果通过 `frames` 消息发回主线程。协议管理器保存前用临时 Worker 编译/校验；预览用编辑器当前代码创建临时 runtime。
- **批量与流控**：主线程 `feed` 先累积数据，距上次发送满 16ms 或累积满 16KB 时发一条 `feed`；已发出未完成的请求加待发送数据超过 2MB 时丢弃最旧的待发送数据，并通过 `discard` 事件上报（`reason: 'overflow'`）。
- **看门狗**：`init` 超过 2000ms 没有回复 `ready`/`initError` 时终止 Worker 并 reject；任一带 `id` 的请求超过 500ms 没有回复 `done`/`encoded`/`encodeError` 时终止 Worker 并触发 `fatal`（原因「协议执行超时（可能存在死循环）」），该会话协议被禁用。单个 `decode` 抛错只影响该帧（`results` 为空 + `error`），不会终止 Worker。
- **`frames` 事件与日志策略**：`LinkSession` 的 `frames` 事件包含 Worker 返回的全部解码帧，不抽样、不合并，帧序号 `seq` 与会话日志的 `seq` 相互独立；日志是否记录受 `LogPolicy` 控制，错误帧始终记录。`decode` 抛错/解码错误的提示每秒最多 1 条。
- **`console`**：插件内的 `console.log/info/debug`、`warn`、`error` 会收集为单行文本（每行最多 500 字）。协议管理器的「调试输出」显示全部三种；会话运行中只有 `warn`/`error` 会以「协议：」前缀写入系统日志，`log` 不写会话日志。
- **`ctx.state`**：会话内持久、跨帧可写（Rx/Tx 共用），切换或重载协议时清空；页面刷新后不保留。插件代码与索引会持久化。
- **安全边界**：`new Function` 依赖 `unsafe-eval`，部署环境不能设置禁止它的 CSP。Worker 不是安全沙箱：插件可访问 Worker 内的 `self`、`fetch` 等全局对象。只应加载可信代码；自定义控件同样属于可信代码（见 [custom-widget.md](custom-widget.md) 第 9 节）。
