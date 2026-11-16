# 下位机数据格式

Toolset 内置 4 个只读协议。本文讲其中 3 个通用可视化数据格式，它们都输出变量供仪表盘使用；第 4 个是带 CRC 的二进制传感器协议，单独在 `docs/protocol-plugin.md` 中说明。

| id                  | 格式           | 线上形态                                  | 适合场景                     |
| ------------------- | -------------- | ----------------------------------------- | ---------------------------- |
| `builtin:firewater` | FireWater      | 一行逗号分隔的十进制浮点数 + LF           | 调试、低速到中速、VOFA+ 兼容 |
| `builtin:justfloat` | JustFloat      | 若干小端 float32 + 固定尾帧 `00 00 80 7F` | 高速、固定通道数             |
| `builtin:kv-text`   | 键值文本       | 一行 `key:value` / `key=value` 项 + LF    | 自描述数据、通道数易变       |
| `builtin:sensor-a5` | 传感器帧 A5 5A | 二进制帧 + LEN + CRC16                    | 带校验的二进制设备协议       |

本文讲前三种文本/浮点格式的精确定义、下位机 C 示例、与 VOFA+ 的兼容性与差异；`sensor-a5` 的逐字节解读见 `docs/protocol-plugin.md`。这三个格式都由内置协议解析，`variables` 会交给 `domains/series`（仪表盘界面实现中）。

## 1. 共同规则

- **分帧**：
  - FireWater、键值文本使用 `line` 分帧，`eol: 'lf'`，行尾 LF（`0x0A`）；LF 模式会自动去掉 LF 前的一个 CR（`0x0D`），因此 CRLF 也可用。空行被忽略。
  - JustFloat 使用 `delimiter` 分帧，结束符为 `00 00 80 7F`，`include: 'content'`（帧内容不含尾帧）。
  - FireWater、键值文本的 `maxFrameLength` 为 4096；JustFloat 为 1024。缓冲区在未成帧时超过上限，整段缓冲会被丢弃并计入丢弃统计。
- **变量名**：必须匹配 `/^[A-Za-z_][A-Za-z0-9_.]{0,63}$/`，即字母或下划线开头，后跟字母、数字、下划线或点，最长 64 字符。
- **变量上限**：每个解码结果最多 256 个变量，超出的部分被截断。
- **数值类型**：FireWater 用 `Number()` 解析文本；键值文本也用 `Number()`；JustFloat 按 IEEE 754 小端 float32 读取。文本格式的精度取决于下位机打印的小数位，JustFloat 固定为 f32 精度（约 7 位有效数字）。
- **无效样本**：`NaN`/`Infinity` 在协议层保留，随后由 `domains/series` 丢弃并计入 `invalidSamples`；`level: 'error'` 的结果不提取变量。
- **摘要**：前三种格式统一为 `ch0=1.23 ch1=4.56 …`（键值文本使用各自的 key），最多显示 8 项，超出部分用 `…(+N)` 表示。数字的显示规则：整数原样；非整数取 `value.toFixed(6)` 再转回数字字符串（去掉多余的 0）。摘要只影响日志显示，不改变写入变量的原始值。
- **非数值行**：整行作为普通文本消息显示，不生成变量。

## 2. FireWater（VOFA+ 兼容）

### 2.1 线上格式

每帧一行，逗号分隔的十进制数，行尾 LF：

```
1.000000,2.500000,-3.000000
```

也可以带一个可选的标签前缀：

```
TEMP:25.31,48.20
```

标签只用于日志摘要，不参与变量解析。

### 2.2 解析规则

1. 若行内包含 `:`，且冒号前的部分（去掉首尾空白后）不是有限数（空字符串也算），则取冒号后的内容参与解析；冒号前非空时同时作为摘要标签。否则整行参与解析。
2. 剩余部分按 `,` 分割，每段去掉首尾空白后用 `Number()` 解析。
3. 全部段都是有限数时，生成变量 `ch0`、`ch1`…（最多 256 个）；否则整行作为文本消息，`summary` 为原文，不生成变量。
4. 空段会被 `Number('')` 解析为 0；行尾多余的逗号会产生一个额外的 0 通道。冒号前是数字时（如 `1:2,3`）不当作标签，整行因无法全部解析为有限数而按文本消息处理。

### 2.3 摘要

- 无标签：`ch0=1 ch1=2.5 ch2=-3`
- 有标签：`TEMP: ch0=25.31 ch1=48.2`
- 超过 8 项：`ch0=0 ch1=1 … ch7=7 …(+292)`

### 2.4 下位机 C 示例

PC 端串口打印：

```c
#include <stdio.h>

void send_firewater(float a, float b) {
  printf("%f,%f\n", a, b);
  fflush(stdout); /* 若 stdout 不是行缓冲/无缓冲，需手动刷新 */
}
```

嵌入式 UART：

```c
#include <stdint.h>
#include <stdio.h>

void send_firewater(float a, float b) {
  char line[64];
  int length = snprintf(line, sizeof line, "%.3f,%.3f\n", a, b);
  if (length > 0) uart_write((const uint8_t *)line, (unsigned)length);
}
```

`uart_write` 是占位写法，替换为实际的串口/UART 发送函数。`%f` 默认打印 6 位小数；用 `%.3f` 等可减少带宽，但精度也随之降低。

## 3. JustFloat（VOFA+ 兼容）

### 3.1 线上格式

每帧由 n 个小端 float32 组成，后接固定 4 字节尾帧：

```
[ch0 f32le][ch1 f32le]…[ch(n-1) f32le] 00 00 80 7F
```

尾帧 `00 00 80 7F` 正好是 float32 `+Infinity` 的小端字节。帧内容不含尾帧，长度必须是 4 的正整数倍。

### 3.2 解析规则

1. 分帧器以 `00 00 80 7F` 作为结束符，取结束符之前的字节作为帧内容。
2. 内容长度为 0 或不是 4 的倍数时返回 `level: 'error'`、`summary: '帧长度不是 4 的倍数'`，不生成变量。
3. 按 `f32le` 依次读取，变量名为 `ch0`…`chN-1`，最多 256 个。
4. 摘要为 `ch0=1.5 ch1=2 ch2=NaN`（整数原样，其余最多 6 位小数去尾 0；`NaN`/`-Infinity` 原样显示）。

### 3.3 下位机 C 示例

```c
#include <stdint.h>
#include <string.h>

static const uint8_t JUSTFLOAT_TAIL[4] = {0x00, 0x00, 0x80, 0x7F};

/* 要求 MCU 为小端；大端 MCU 需要先做字节序转换。 */
void send_justfloat(const float *values, unsigned count) {
  uint8_t buffer[4];
  for (unsigned i = 0; i < count; i++) {
    memcpy(buffer, &values[i], sizeof buffer);
    uart_write(buffer, sizeof buffer);
  }
  uart_write(JUSTFLOAT_TAIL, sizeof JUSTFLOAT_TAIL);
}
```

例如发送两个值：

```c
float data[2] = {1.0f, 2.0f};
send_justfloat(data, 2); /* 线上：00 00 80 3F 00 00 00 40 00 00 80 7F */
```

### 3.4 +Inf 碰撞

尾帧与 `+Infinity` 的字节完全相同，因此：

- 数据中**不能发送 `+Inf`**，否则接收端会把它当作帧结束，导致后续字节错位。
- `NaN`（如 `00 00 C0 7F`）和 `-Infinity`（`00 00 80 FF`）与尾帧不同，可以发送，但会被变量提取层当作无效样本丢弃。
- 不要把尾帧误写进数据内容；尾帧只出现在每帧末尾。

### 3.5 与 VOFA+ 的差异与限制

- 尾帧约定与 VOFA+ JustFloat 相同，VOFA+ 可以直接识别按本格式发送的数据。
- 本项目的内置解析器把单帧内容上限设为 1024 字节（最多 256 个 float），并只保留前 256 个变量；VOFA+ 软件本身的通道数与其它协议能力不在本项目兼容范围内。
- JustFloat 没有帧头、通道名或元数据；通道语义完全由发送顺序决定，收发双方必须约定固定通道数。改变通道数会让接收端的 `ch` 编号错位。
- f32 只有约 7 位有效数字；需要精确十进制显示时用文本格式。

## 4. 键值文本

### 4.1 线上格式

每帧一行，由若干 `key:value` 或 `key=value` 项组成，项之间用逗号、分号或空白分隔：

```
temp:25.5,hum=48.2;volt:3301
```

也可以使用带点的变量名：

```
motor.rpm:1500,_flag=1
```

### 4.2 解析规则

1. 行尾 LF（自动去掉 CR），`maxFrameLength: 4096`。
2. 一行用 `,`、`;` 或空白（空格/制表符）分隔成若干项；每项取最先出现的 `:` 或 `=` 作为键值分隔符。
3. `key` 必须符合变量名规则；非法 key 的项被忽略。
4. 值能用 `Number()` 解析为有限数时成为变量；其余成为文本字段（`label` 与 `key` 都是该 key，`value` 为原文本）。
5. 一项都不匹配时，整行作为文本消息显示。
6. 变量最多 256 个；摘要按项用空格连接，最多 8 项并附 `…(+N)`。
7. 同一 key 在数字项中重复时以后到的数值为准；值本身不能包含空格、逗号或分号（会被当作分隔符）。

### 4.3 摘要

```
temp=25.5 hum=48.2 volt=3301
```

文本项原样显示，例如 `temp=25.5 label=hello`。

### 4.4 下位机 C 示例

```c
#include <stdint.h>
#include <stdio.h>

void send_kv_text(float temp, float hum, int volt) {
  char line[96];
  int length = snprintf(line, sizeof line, "temp:%.2f,hum:%.2f,volt=%d\n", temp, hum, volt);
  if (length > 0) uart_write((const uint8_t *)line, (unsigned)length);
}
```

## 5. 与 VOFA+ 的兼容性与差异

| 项         | FireWater                                                                                    | JustFloat                                                                           |
| ---------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 兼容点     | 行式逗号分隔浮点文本；可选 `标签:` 前缀；CRLF 可用                                           | 小端 f32 数组 + 尾帧 `00 00 80 7F`；尾帧约定与 VOFA+ 相同                           |
| 本项目差异 | 只有整行全部为有限数才生成变量，否则按文本消息；上限 4096 字节、256 变量；不支持通道名元数据 | 单帧内容上限 1024 字节、最多 256 变量；内容为空或非 4 倍数时报错；`+Inf` 与尾帧冲突 |
| 未覆盖范围 | VOFA+ 软件的其它协议、RawData 模式、控件与配置导入不在本项目范围内                           | 同上                                                                                |

键值文本是本项目为“自描述变量”增加的文本格式（不依赖 VOFA+）；语法简单，便于下位机按业务字段直接打印。

## 6. 如何选择格式

| 需求                             | 推荐格式       | 原因                                                        |
| -------------------------------- | -------------- | ----------------------------------------------------------- |
| 人工调试、抓包可读、低速/中速    | FireWater      | 纯文本，日志中直接可读；与 VOFA+ 兼容                       |
| 变量名固定、需要自描述、字段易变 | 键值文本       | 每个样本自带 key，接收端不需要按顺序猜通道                  |
| 高速率、带宽敏感、固定通道数     | JustFloat      | 每值固定 4 字节，无文本解析开销；适合 100 Hz 以上的连续波形 |
| 需要 CRC 与二进制命令            | 传感器帧 A5 5A | 有帧头、长度、CRC16 与应答机制，适合带校验的设备协议        |

粗略带宽对比：8 通道、每值 6 位小数时，FireWater 一行约 60–80 字节；JustFloat 固定 `8 × 4 + 4 = 36` 字节。通道越多、采样率越高，JustFloat 的带宽优势越明显。

## 7. 用演示端口体验这三种格式

演示端口不需要硬件，可按任一格式生成数据：

1. 在串口上位机侧栏点击「新增演示端口」。
2. 断开状态下在连接参数中设置 `format`（`FireWater` / `JustFloat` / `键值文本`）、`interval`（1–10000 ms）与 `channels`（1–16，只对 FireWater/JustFloat 生效；键值文本固定 8 通道）。
3. 连接后选择对应的内置协议（`builtin:firewater` / `builtin:justfloat` / `builtin:kv-text`），即可在解析视图中看到变量摘要。
4. 演示设备的前 8 个通道按固定公式生成：正弦、余弦、方波、锯齿、噪声、双频正弦、慢变温度、计数；`channels > 8` 时第 k 个通道复用第 `k mod 8` 个公式并加相位偏移 `k × π/8`，默认幅度 `amp = 1`。
5. 运行中可发送文本命令调整设备：`interval=<ms>`、`amp=<0–10>`。FireWater 与键值文本会回复 `OK <命令>` 或 `ERR <命令>`；JustFloat 为保持帧结构不回复。
6. JustFloat 格式下演示设备不回显文本、不回复命令；DTR 由高变低时所有格式都会清零计数，除 JustFloat 外的格式还会输出 `[demo] reset\r\n`。

`format = 'sensor-a5'`（默认）使用另一套二进制设备协议，见 `docs/protocol-plugin.md` 与 `docs/transport-provider.md`。
