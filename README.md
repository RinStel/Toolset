# Toolset · RinStel的工具箱

纯静态部署的嵌入式开发工具集。v1 包含「串口上位机」工具，但架构按多工具、多通道、可视化数据通路设计：

- **多工具**：新增工具只需添加 `src/tools/<id>/`，首页卡片、导航、路由、设置分组与帮助章节自动出现，无需修改 `src/app/`。
- **多通道**：字节流领域 `domains/link` 抽象了传输提供者；v1 实现 `web-serial`（Web Serial）与 `virtual`（演示端口），后续加入 TCP/UDP、BLE UART、WebUSB 只需新增 `domains/link/transports/<kind>/provider.ts`。
- **变量与图表**：协议插件可通过 `DecodeResult.variables` 输出变量，`domains/series` 提供变量时间序列、计算变量、FFT 与 CSV 导出；`domains/dashboard` 提供仪表盘模型、24 列网格、命令模板、一键生成与自定义控件运行保护；仪表盘界面位于 `tools/serial/dashboard/`，使用说明见 `docs/dashboard.md`，自定义控件 API 见 `docs/custom-widget.md`。

## 功能概览

- 串口上位机：多端口、多会话、标签页与最多两个分屏窗格；文本/HEX 收发、4 种编码、4 种行尾、7 种校验（含无校验）；时间戳/发送/系统/转发记录开关与颜色自定义；日志搜索、三种显示模式（原始/解析/原始+解析）、日志策略（全部/抽样/关闭，支持自动抽样）、导出 TXT/CSV/BIN。
- 协议插件：站内新建/编辑/校验/预览/保存/导入/导出/删除；5 个模板；声明式分帧（`line`/`delimiter`/`fixed`/`length`/`idle`）+ `decode`/`encode` 钩子；每个会话独立 Worker，含超时看门狗；内置 4 个数据格式（FireWater、JustFloat、键值文本、传感器帧 A5 5A），演示设备可按 4 种格式生成数据。
- 变量输出：`decode` 可返回 `variables` 与 `variableMeta`，供仪表盘绘图；不返回 `variables` 时也可从 `fields` 自动提取数字字段。
- 发送：快捷发送、定时重复发送、宏序列、协议结构化表单、DTR/RTS/Break。
- 复用：连接预设、设备记忆、会话间单向/双向转发。
- 本机配置备份：设置抽屉「数据」组提供导出、导入（合并/替换）、清除全部本地数据（见 `docs/backup.md`）。
- 仪表盘：与终端视图共用 Pane，可在运行 / 编辑模式间切换；数据源自动绑定与手动切换、变量显示覆盖（`variableMeta`）、计算变量、24 列网格拖拽 / 缩放 / 框选 / 多选 / 快捷键、一键生成、撤销重做、导入导出、数据 CSV 导出、窄窗格单列只读布局（见 `docs/dashboard.md`）。
- 内置组件（14 种）：波形图、XY 图、频谱、数值、仪表、柱状图、指示灯、变量表、文本，以及按钮、开关、滑块、数值输入、下拉选择；图表使用 uPlot，按需动态加载。
- 自定义控件：站内编写 JavaScript 函数体，宿主以 shadow DOM 挂载，可读取变量 / 历史数据、发送命令、保存实例状态；提供 4 个模板、预览（模拟数据或真实会话、模拟或真实发送）、调试输出、仓库导入导出，并带调用保护（异常 / 超时 / 平均耗时 / 发送限速）与安全模式（见 `docs/custom-widget.md`）。
- 自定义控件安全模式：`#/tools/serial?safe=1` 不执行任何自定义控件代码；上次运行疑似卡死的控件会在下次打开时暂停并提示。

## 环境

| 项                         | 版本                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js                    | v24.19.0（要求 `^22.18.0 \|\| >=24.12.0`）                                                                                              |
| pnpm                       | 10.13.1（只使用 pnpm；仓库 `.npmrc` 指定了工作区内 store/cache 与 `node-linker=hoisted`）                                               |
| Vue                        | 3.5.45                                                                                                                                  |
| Vue Router                 | 5.5.1                                                                                                                                   |
| Pinia                      | 4.1.0                                                                                                                                   |
| Vite                       | 8.3.8                                                                                                                                   |
| TypeScript                 | 6.0.3                                                                                                                                   |
| Vitest                     | 4.1.12                                                                                                                                  |
| Playwright                 | 1.65.1（仅 Chromium）                                                                                                                   |
| CodeMirror                 | codemirror 6.0.2、@codemirror/lang-javascript 6.2.5、@codemirror/autocomplete 6.20.4、@codemirror/state 6.7.6、@codemirror/view 6.43.15 |
| uplot                      | ^1.6.32（实际安装 1.6.32；仅在仪表盘图表组件中动态加载）                                                                                |
| lucide-vue-next            | 0.553.0                                                                                                                                 |
| dependency-cruiser         | 17.4.3                                                                                                                                  |
| ESLint / Prettier          | 10.15.0 / 3.9.6                                                                                                                         |
| happy-dom / fake-indexeddb | 20.14.6 / 6.2.8                                                                                                                         |

开发环境：Windows 10 + Git Bash 语义（命令脚本同时兼容 PowerShell）。

## 命令

```bash
pnpm dev          # 开发服务器（http://127.0.0.1:5173）
pnpm build        # 生产构建到 dist/
pnpm preview      # 预览构建产物
pnpm typecheck    # vue-tsc --build --force
pnpm lint         # eslint .
pnpm format       # prettier --write src tests scripts docs
pnpm format:check # prettier --check src tests scripts docs
pnpm test:unit    # vitest run（单元测试 + 架构样例测试 + 组件测试）
pnpm test:e2e     # playwright test（Chromium，构建后跑静态产物）
pnpm check:arch   # dependency-cruiser 依赖规则检查
pnpm check:chunks # 分包与入口体积检查（需先 build）
pnpm verify       # 依次跑上述全部检查
```

首次运行 e2e 前需要安装 Playwright 浏览器：`pnpm exec playwright install chromium`（需网络）。e2e 共 25 条用例（含 2 条 `@perf` 性能用例）。

## 目录结构

```
src/
  app/          应用外壳：路由、首页、导航、设置抽屉（含「数据」备份组）、帮助面板、工具注册表、外观 store
  shared/       contracts（纯类型）、lib（存储/备份/事件/格式化等纯 TS）、ui（自研组件与样式）
  domains/      纯 TS 业务逻辑：bytes ← protocol ← link ← series ← dashboard
  tools/        具体工具；v1 只有 serial（串口上位机）
    serial/dashboard/  仪表盘 Pane、网格画布、组件库、变量列表、属性面板、14 种内置组件与自定义控件宿主
tests/
  unit/         领域、存储、注册表等单元测试
  components/   组件测试（happy-dom）
  architecture/ 依赖规则违规样例与检查
  e2e/          Playwright 端到端测试与假 Web Serial
scripts/        Vite 分包报告插件与分包检查脚本
docs/           架构、工具模块、传输提供者、协议插件、数据格式、本机配置备份、仪表盘、自定义控件、决策记录
```

`domains/series` 负责变量时间序列、计算变量、FFT、抽取与 CSV；`domains/dashboard` 负责仪表盘模型、布局、命令、历史、一键生成与自定义控件编译/保护。工具层只经各自的 `public.ts` 使用领域能力。

## 浏览器要求

- 完整支持：Chrome / Edge 89+、Firefox 桌面版 151+。
- 必须是安全上下文（HTTPS 或 `localhost` / `127.0.0.1`）。
- Safari、移动端浏览器：页面可打开，串口不可用并显示提示；演示端口仍可使用。
- 不支持 Web Serial 或非安全上下文时，串口入口显示明确提示，演示端口始终可用。

## 部署

`pnpm build` 产出 `dist/`，`vite.config.ts` 使用 `base: './'`，可直接上传到任意静态主机/子路径部署。运行时无后端、无外部请求；协议插件代码随站点静态分发。

注意：

- 协议插件在 Worker 内通过 `new Function` 编译，部署环境不能设置禁止 `unsafe-eval` 的 CSP。
- 协议 Worker 隔离只用于防止死循环卡顿，不是安全沙箱，只应加载可信插件代码。

## 文档

- `docs/architecture.md`：分层、依赖规则、分包规则、运行时数据流、持久化与备份边界
- `docs/tool-module.md`：新增工具的完整步骤（含 `backupLabels` 与仪表盘扩展点）
- `docs/transport-provider.md`：实现传输提供者与字节传输
- `docs/protocol-plugin.md`：协议插件 API、分帧语义、SDK、模板、内置数据格式与变量输出
- `docs/data-formats.md`：FireWater、JustFloat、键值文本三种下位机数据格式的精确定义与 C 示例
- `docs/backup.md`：本机配置备份文件格式、命名空间规则与导入导出语义
- `docs/dashboard.md`：仪表盘使用说明、14 种内置组件属性、命令模板语法与新增内置组件步骤
- `docs/custom-widget.md`：自定义控件 API、调用保护、安全模式、4 个模板解读与安全说明
- `docs/decisions.md`：实施中的决策与偏差记录
- `docs/progress.md`：当前开发进度、验证状态、遗留问题与交接说明
