# 交付与验证报告（初版）

日期：2026-11-16
项目：Toolset · RinStel的工具箱（串口上位机）
规格：仓库根目录 `plan.md`（完整实施规格，覆盖 v1 串口终端 + v2 仪表盘 / 自定义控件 / 本机配置备份 / UI 调优）

## 1. `pnpm verify` 8 项命令验证结果

以下为全部源码与文档收敛后实测结果（最终完整命令在交付收口时再次全量跑通）：

| 命令                | 结果                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`    | 通过（`vue-tsc --build --force`，0 错误）                                                                                                                          |
| `pnpm lint`         | 通过（`eslint .`，0 错误）                                                                                                                                         |
| `pnpm format:check` | 通过（`prettier --check src tests scripts docs`）                                                                                                                  |
| `pnpm test:unit`    | 通过：**53 个测试文件 / 633 个测试**（单元测试 35 文件 + 组件测试 17 文件 + 架构测试 1 文件）                                                                      |
| `pnpm check:arch`   | 通过：`no dependency violations found (253 modules, 883 dependencies cruised)`                                                                                     |
| `pnpm build`        | 通过：2093 个模块；入口 `index-*.js` 83.85 kB（gzip 30.68 kB）；`protocol.worker-*.js` 24.07 kB；`DashboardPane-*.js` 168.08 kB（gzip 48.96 kB）；`uPlot` 50.99 kB |
| `pnpm check:chunks` | 通过：入口闭包 3 个 chunk，JS gzip 合计 **56.5KB**（限值 120KB）；入口闭包不含领域/工具视图/CodeMirror/uPlot                                                       |
| `pnpm test:e2e`     | 通过：**25/25**（11 个 `.spec.ts`，覆盖全部业务验收用例与 2 条 `@perf` 性能用例）                                                                                  |

### Playwright E2E 明细（Chromium，针对 `pnpm build` 静态产物）

- **业务验收用例（23 条全部通过）**：
  - `serial-core.spec.ts`（用例 1–3、12）：新增串口与文本/HEX 收发、日志开关、外观字号/颜色/上限持久化、双会话未读与分屏独立发送、返回首页保留会话及直接 hash 路由与 404。
  - `serial-support.spec.ts`（用例 10、13）：移除 Web Serial 后的不支持降级提示与演示端口可用、`InvalidStateError` 打开失败提示文案。
  - `protocol.spec.ts`（用例 4、5、11）：内置协议完整/半帧/坏 CRC/垃圾数据及三种显示模式、语法校验/预览/保存生效、死循环插件 3 秒内超时降级不阻塞其他会话。
  - `automation.spec.ts`（用例 6、9）：快捷发送/重复发送 3 次自动停止/宏运行拔线停止、TXT/CSV/BIN 导出与 BOM/字段断言。
  - `bridge-presets.spec.ts`（用例 7、8）：双向转发与拔线暂停、连接预设保存套用与设备记忆。
  - `dashboard-core.spec.ts`（用例 14–16）：一键生成波形图与 8 个数值组件并实时刷新、拖拽缩放与撤销重做刷新保留、变量拖拽新建/叠加波形。
  - `dashboard-data.spec.ts`（用例 17、18、23）：滑块/按钮模板节流发送与越界提示、计算变量 `ch0_sq` 与开关 `feedbackVar` 反馈、分屏共用会话日志自动抽样且通道数据不丢帧。
  - `dashboard-custom.spec.ts`（用例 19–21）：自定义控件预览与异常/忙等停用、pending 安全模式横幅与 `?safe=1` 恢复、含自定义控件仪表盘导出/删除恢复与另存副本。
  - `config-backup.spec.ts`（用例 22）：导出全部本机配置、清除、替换恢复与合并模式隔离。
- **`@perf` 性能用例（2 条全部通过；代码定稿前实测样本）**：
  - `perf.spec.ts`（双会话 60 秒高吞吐）：点击响应 **22.8 / 5.6 / 16.2 ms**（要求 < 200ms）、日志条数稳定在 5000 上限、30s–60s 堆增长 **0.0%**（要求 < 20%）。
  - `dashboard-perf.spec.ts`（仪表盘 1kHz 8 通道 60 秒）：点击响应 **18.8 / 9.4 / 21.0 ms**（要求 < 200ms）、30s–60s 堆增长 **0.0%**（要求 < 20%）、`ch7` CSV 连续无丢帧（63790 行，最新值 63789）、`long task（>50ms）`：**0 个**（要求 <= 10）。

## 2. 验收清单 A1–A15 证据

| 编号 | 要求摘要                                                                                                 | 证据                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A1   | 授权/打开/关闭串口、收发文本与 HEX、多端口                                                               | e2e 用例 1、3、13；`web-serial` 与 `virtual` 传输提供者                             |
| A2   | 日志开关、颜色自定义、刷新保留                                                                           | e2e 用例 1、2；`toolset/tool/serial/settings.v1` 持久化；浅色高对比度日志配色       |
| A3   | 协议插件创建/编辑/校验/预览/保存/导入/导出/删除、三种显示模式                                            | e2e 用例 4、5；`domains/protocol` + `ProtocolManager`/`CodeEditor` 独立 chunk       |
| A4   | 插件异常/死循环/超大帧不冻结、只禁用该会话协议                                                           | e2e 用例 11；Worker 看门狗与 `protocol/watchdog.test.ts`                            |
| A5   | 发送：文本/HEX、4 编码、4 行尾、7 校验、历史、快捷、定时、宏、协议结构化、DTR/RTS/Break                  | e2e 用例 1、4、5、6；`compose` / `repeat-macro` 单元测试                            |
| A6   | 复用：分屏同屏、连接预设、设备记忆、单/双向转发                                                          | e2e 用例 3、7、8；`SessionTabs` 单层顶栏与 `同屏：终端+仪表盘`                      |
| A7   | 持久化范围与日志导出 TXT/CSV/BIN                                                                         | e2e 用例 2、9；`LogList` 换行与非换行均启用虚拟滚动                                 |
| A8   | 新增工具只需 `src/tools/<id>/`                                                                           | `registry/index.ts` 自动扫描注册，`app/registry.test.ts` 验证                       |
| A9   | 新增通道只需 `transports/<kind>/provider.ts`                                                             | `transport/registry.ts` 基于 `import.meta.glob` 自动发现                            |
| A10  | 入口包不含领域/工具/CodeMirror/uPlot，入口 JS gzip ≤ 120KB                                               | `pnpm check:chunks`：入口闭包 JS gzip **56.5KB**                                    |
| A11  | 8 条 `pnpm verify` 命令全部通过                                                                          | 见第 1 节                                                                           |
| A12  | 不支持 Web Serial 时提示，演示端口可用                                                                   | e2e 用例 10                                                                         |
| A13  | 仪表盘：FireWater/JustFloat/KV 文本、14 种内置组件、24 列网格、撤销重做、一键生成、多仪表盘、1kHz 不丢帧 | e2e 用例 14–18、23、`dashboard-perf.spec.ts`；`domains/dashboard`、`domains/series` |
| A14  | 自定义控件：编写/预览/保存/导入/导出、动态属性面板、读写变量与发指令、异常与慢执行隔离、安全模式         | e2e 用例 19–21；`CustomWidgetEditor`、`CustomWidgetHost`、`?safe=1`                 |
| A15  | 本机配置：全选/分项导出 JSON、合并/替换导入、清除全部本地数据                                            | e2e 用例 22；`backup.ts`、`DataSettings.vue`                                        |

## 3. 环境与边界说明

1. **Firefox 未实测**：本机 Playwright 仅运行 Chromium；Firefox 151+ 的行为未实测（不支持提示与演示端口降级逻辑已由移除 `navigator.serial` 的用例 10 覆盖）。
2. **真实串口硬件验收**：真实硬件设备连接由项目所有者在实际串口设备上最终验收；自动化测试使用假 Web Serial 与内置演示端口。
3. **本机环境适配**：
   - `.pnpm-cache/pw-deps/root` 存放用户态 Chromium 运行依赖库及中文字体（`libnss3`、`libnspr4`、`libasound2t64`、`fonts-wqy-zenhei` 等），由 `playwright.config.ts` 按需挂载。
   - `vitest.config.ts` 配置 `execArgv: ['--no-experimental-webstorage']` 以兼容 Node 26 下的 `happy-dom` `localStorage`。
   - `.npmrc` 使用工作区内 store/cache 与 `node-linker=hoisted`。
4. **文档截图已移除**：按项目所有者最新要求，文档与 E2E 套件中已移除截图与 `screenshots.spec.ts` 用例。
5. **CodeMirror 分包说明**：`CodeEditor-*.js`（507.05 kB / gzip 170.39 kB）为按需动态 chunk，不进入首页入口闭包。

## 4. 开发与预览地址

- 开发服务器（后台运行中）：**http://127.0.0.1:5173/**
- 生产构建静态产物：`dist/`（`base: './'`，可直接静态托管或 `pnpm preview` 访问）

## 5. 交付物清单

- 源码：`src/`（**241** 个 `.ts/.vue/.css` 文件）
- 测试：`tests/`（**35** 个单元测试文件、**17** 个组件测试文件、**12** 个架构违规样例项目、**11** 个 E2E `.spec.ts` 共 **25** 条用例）
- 文档：`docs/`（11 份文档：`architecture.md`、`backup.md`、`custom-widget.md`、`dashboard.md`、`data-formats.md`、`decisions.md`、`progress.md`、`protocol-plugin.md`、`tool-module.md`、`transport-provider.md`、`verification-report.md`）与 `README.md`
- 构建产物：`dist/`
