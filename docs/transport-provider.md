# 新增一个传输提供者

`domains/link` 把「字节流从哪里来」抽象成 `TransportProvider` + `ByteTransport`。串口上位机侧栏、连接参数表单、会话管理、协议、日志、发送、转发都只面向这两个接口，因此新增通道不需要改协议、日志、发送或转发管线。

当前实现：

| kind         | 标题     | 说明                                               |
| ------------ | -------- | -------------------------------------------------- |
| `web-serial` | 串口     | Web Serial（Chrome/Edge 89+、Firefox 151+ 桌面版） |
| `virtual`    | 演示端口 | 内置演示设备，不依赖浏览器能力；支持 4 种报文格式  |

计划中的 TCP/UDP（WebSocket）、BLE UART、WebUSB 只需按本文新增一个目录。

## 1. 目录与自动发现

```
src/domains/link/transports/<kind>/
  provider.ts   默认导出 TransportProvider（必须）
  transport.ts   ByteTransport 实现（可选，可写在 provider.ts 内）
  device.ts     提供者私有的纯逻辑/设备行为（可选，如演示设备）
```

`src/domains/link/transport/registry.ts` 通过：

```ts
import.meta.glob('../transports/*/provider.ts', { eager: true })
```

自动收集所有提供者，按 `order` 排序供 `LinkManager.listProviders()` 使用。目录名 `<kind>` 必须与 `provider.kind` 一致。**不需要修改 `src/app/` 或串口工具**：侧栏会自动出现对应「新增」入口。

架构约束（`pnpm check:arch` 强制）：`domains/link` 只能依赖 `bytes/public.ts`、`protocol/public.ts`、`shared/lib`、`shared/contracts` 的类型与自身目录，不能依赖 UI、工具或应用外壳。

## 2. 接口

```ts
interface TransportCapabilities {
  lineSettings: boolean // 是否有串口线参数（波特率/数据位等）
  signals: boolean // 是否支持 DTR/RTS
  break: boolean // 是否支持 break 信号
}

interface ByteTransport {
  readonly kind: string
  readonly deviceKey: string // 设备记忆键，如 'serial:1A86:7523'、'serial:unknown'、'virtual'
  readonly label: string // 界面显示名，如 'USB 串口 (1A86:7523)'、'演示端口 1'
  readonly capabilities: TransportCapabilities
  open(settings: Record<string, unknown>): Promise<void>
  close(): Promise<void>
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  setSignals?(signals: { dtr?: boolean; rts?: boolean; brk?: boolean }): Promise<void>
  onDisconnect(cb: () => void): () => void
  isSameDevice(other: ByteTransport): boolean // 避免同一设备创建多个会话
}

interface TransportProvider {
  readonly kind: string
  readonly title: string // '串口' | '演示端口'
  readonly addLabel: string // '新增串口' | '新增演示端口'
  readonly order: number
  isSupported(): { ok: boolean; reason?: string }
  request(): Promise<ByteTransport | null> // 用户取消返回 null，不抛错
  listAuthorized(): Promise<ByteTransport[]> // 无“已授权设备”概念时返回 []
  onAvailabilityChange?(cb: () => void): () => void // 设备插拔时通知侧栏刷新
  readonly settingsSchema: SettingField[]
  defaultSettings(): Record<string, unknown>
}
```

实现约定：

- **`open`/`close` 只负责底层资源**：打开端口、获取/释放读写流，并创建/销毁提供者私有设备逻辑。读循环、写队列、日志、状态机、任务、转发由 `LinkSession` 统一负责，提供者不要自己起读取循环或缓冲日志。
- **`readable`/`writable`**：`open` 成功后返回流，`close`/断开后置 `null`。读循环由 `LinkSession` 调用 `readable.getReader()`；写队列序列化所有发送。
- **`onDisconnect`**：设备被拔出/连接丢失时触发回调；会话会进入 `error` 状态、写系统日志「设备已断开」并保留会话以便重连。返回取消函数。
- **`isSameDevice`**：用于去重。同一设备重复「新增」时 `LinkManager` 返回已有会话而不是创建第二个。比较底层句柄或稳定的设备标识。
- **`deviceKey`**：连接预设按 `providerKind` 匹配；设备记忆按 `deviceKey` 保存/恢复。应包含足够的区分度（如串口的 VID:PID），没有信息时用 `'serial:unknown'`。多个演示端口共享 `'virtual'`，因此共享设备记忆。
- **`settingsSchema`**：用 `SettingField`（`number|select|checkbox|text`，支持 `advanced` 与 `allowCustom`）描述连接参数；串口上位机用 `SettingForm` 自动渲染，并在会话打开时禁用编辑。
- **`isSupported()`**：返回 `{ok:false, reason}` 时侧栏显示原因（如非安全上下文、浏览器不支持）。演示端口始终返回 ok。
- **`request()`**：必须吞掉用户取消（Web Serial 的 `NotFoundError`）并返回 `null`；真正的打开失败在 `transport.open()` 抛出，由会话按 `plan.md` §9 的文案映射。

## 3. 能力与 UI 行为

| 能力           | `false` 时的界面行为                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `lineSettings` | 不渲染线参数；连接参数表单只显示提供者 `settingsSchema` 中的字段（演示端口显示格式/间隔/通道） |
| `signals`      | DTR/RTS 按钮禁用，悬停提示「该通道不支持控制线」                                               |
| `break`        | Break 按钮禁用                                                                                 |

`settingsSchema` 与 `defaultSettings()` 不会因为 `lineSettings=false` 被忽略：它不是线参数，而是提供者自己的连接参数。

## 4. 演示端口（`virtual`）

演示端口是内置的 `ByteTransport`，用于在没有硬件时验证协议、日志、发送与仪表盘数据（仪表盘界面实现中）。能力为 `{ lineSettings: false, signals: true, break: false }`。

连接参数表（`transports/virtual/provider.ts`）：

| key        | 类型   | 取值                                                         | 默认值      |
| ---------- | ------ | ------------------------------------------------------------ | ----------- |
| `format`   | select | `sensor-a5`（传感器帧）、`firewater`、`justfloat`、`kv-text` | `sensor-a5` |
| `interval` | number | 1–10000 ms；`sensor-a5` 格式下最小 100 ms                    | 1000        |
| `channels` | number | 1–16，只对 `firewater` 和 `justfloat` 生效                   | 8           |

实现细节：

- `defaultSettings()` 返回 `{ format: 'sensor-a5', interval: 1000, channels: 8 }`，新建演示端口的表单初始值来自这里。设备侧 `normalizeDemoInterval()` 在 `interval` 缺失或非法时，对 `sensor-a5` 回退到 1000 ms、对其他格式回退到 10 ms；当前界面在切换格式时不会自动改写已填写或已保存的 `interval`。
- `kv-text` 固定上报 8 个通道，`channels` 只影响 `firewater` / `justfloat`。
- 设备用虚拟时间 `τ = n × interval / 1000` 生成样本，`setInterval(10ms)` 按墙钟补齐欠发帧，每次最多 1000 帧合并为一个块写入 `readable`。
- `sensor-a5`：每帧一个 CMD 0x01 上报，温度 20–30 °C、湿度 40–60 %、电压 3250–3350 mV 缓慢变化；收到合法的 0x10 设置间隔帧时回复 0x90 状态。
- 其余三种格式的变量公式与 `plan.md` §8.7 一致，`channels > 8` 时第 k 个变量复用第 `k mod 8` 个公式并加相位偏移 `k × π/8`。
- 文本命令（`interval=<ms>`、`amp=<0–10>`）按行接收；`firewater`/`kv-text` 回复 `OK <命令>` 或 `ERR <命令>`，`justfloat` 不回复。不可识别的可打印文本行在除 `justfloat` 外的格式下原样回显。DTR 由高变低时清零计数，并在除 `justfloat` 外的格式下发送 `[demo] reset\r\n`。
- 多个演示端口共享 `deviceKey = 'virtual'`，`isSameDevice` 按实例同一性判断（允许并存多个演示端口）。
- 打开状态下不能修改连接参数（由 `LinkSession.updateSettings` 的状态规则保证）；运行中只能通过文本命令调整间隔与幅度。

## 5. `frames` 事件与 `LogPolicy` 与提供者无关

- `TransportProvider` / `ByteTransport` 只负责产生原始字节流，不感知协议、变量、日志策略。
- 分帧（有协议时在 Worker，无协议时在主线程）、解码、`LinkSession` 的 `frames` 事件、日志抽样（`LogPolicy`）、变量提取（`domains/series`）都在会话层或以上完成。
- 因此新增提供者不需要实现 `frames` 事件、日志抽样或变量逻辑；也不应把日志写入会话日志。提供者只需保证 `readable` 的字节顺序与块边界合理即可。

## 6. 示例：Web Serial 的关键实现

- `request()`：`navigator.serial.requestPort()`；捕获 `NotFoundError` → `null`。
- `listAuthorized()`：`navigator.serial.getPorts()` → transport 列表。
- `deviceKey`：`serial:<VID>:<PID>`（大写十六进制）或 `serial:unknown`；`label` 形如 `USB 串口 (1A86:7523)`。
- `open(settings)`：`port.open({ baudRate, dataBits, stopBits, parity, flowControl, bufferSize? })`；`bufferSize` 只在设置中存在时传入。
- `setSignals`：映射 `dtr → dataTerminalReady`、`rts → requestToSend`、`brk → break`，只传出现的字段。
- `onDisconnect`：监听 `navigator.serial` 的 `disconnect` 事件并与 `port` 比较。
- `isSameDevice`：比较 `SerialPort` 引用。

完整实现见 `src/domains/link/transports/web-serial/`。演示端口见 `src/domains/link/transports/virtual/`（`device.ts` 包含演示设备行为：周期上报、文本命令、回显、控制线复位；`provider.ts` 提供设置表单）。

## 7. 需要编写的测试

1. **单元测试**（`tests/unit/link/`）：用假 transport（`ReadableStream`/`WritableStream`）覆盖会话行为：状态机、读循环非致命/致命错误、写队列串行、写失败停止任务、断开处理。新的 provider 若含纯逻辑（如演示设备的格式生成、参数校验、文本命令），应为它单独写测试。
   - 提供者设置与纯逻辑参考 `tests/unit/link/virtual-format.test.ts`：覆盖 `settingsSchema`、`defaultSettings()`、格式/间隔/通道归一化与演示设备输出。
   - 会话 `frames` 事件与 `LogPolicy` 参考 `tests/unit/link/session.test.ts`、`tests/unit/link/log-policy.test.ts`；提供者实现不应让这些测试变复杂。
2. **端到端测试**（`tests/e2e/`）：需要浏览器 API 的通道通过 `page.addInitScript` 注入假实现（参考 `tests/e2e/fixtures/fake-serial.ts` 的 `window.__fakeSerial` 设计：`addPort`、`setRequestBehavior`、`emit`、`written`、`signals`、`failNextOpen`、`unplug`、`remove`）。只依赖 `ByteTransport`/`TransportProvider` 契约，不依赖真实设备。演示端口不需要假实现。
3. **契约检查**：`pnpm check:arch` 必须通过（`domains/link` 不得依赖 UI 或工具层）；`pnpm typecheck`、`pnpm lint`、`pnpm format:check` 通过。

## 8. 接入检查清单

- [ ] 新增 `src/domains/link/transports/<kind>/provider.ts`，默认导出 `TransportProvider`，`kind` 与目录名一致。
- [ ] `settingsSchema` / `defaultSettings()` 与 transport 的 `open()` 读取的键一致。
- [ ] `deviceKey`、`label` 合理；`isSameDevice` 能正确去重。
- [ ] `isSupported()` 在能力缺失时返回明确 reason；`request()` 对用户取消返回 `null`。
- [ ] `onDisconnect` 能触发；`close()` 后会释放资源并把 `readable`/`writable` 置空。
- [ ] 串口上位机侧栏自动出现入口（无需改 app / 工具代码）。
- [ ] 单元测试与必要的 e2e 覆盖完成，`pnpm verify` 通过。
- [ ] 在 `docs/decisions.md` 记录与 plan.md 不一致或规格未覆盖的实现决策。
