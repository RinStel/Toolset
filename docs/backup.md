# 本机配置备份

Toolset 的所有持久化数据都保存在当前浏览器中（localStorage + 共享 IndexedDB `toolset`/`kv`）。设置抽屉的「数据」组提供三件事：把本机配置导出为 JSON 文件、从备份文件导入、清除全部本地数据。实现位于 `shared/lib/storage/backup.ts` 与 `app/layout/DataSettings.vue`。

备份不包含日志、会话、发送历史、转发规则与变量时间序列（它们只在内存中），也不包含损坏数据备份与安全模式标记。

## 1. 入口与操作流程

打开「设置」抽屉，最后一组「数据」：

- **导出本机配置**：打开对话框，以「命名空间 → 条目」树形列表显示所有可备份项，带中文名称、完整键与估算大小，默认全选。点击「导出」后下载 `toolset-backup-YYYYMMDD-HHmmss.json`；未选择任何项时提示「请至少选择一项配置」。
- **导入本机配置**：选择 `.json` 文件后调用 `parseBackup` 校验；失败时对话框显示错误。校验成功后显示备份文件、备份时间、条目总数、总大小，以及按命名空间分组的条目数与大小，可勾选要导入的分区。导入方式默认「合并」，可选「替换」；「导入前下载当前配置备份」默认勾选（文件名形如 `toolset-backup-before-import-YYYYMMDD-HHmmss.json`）。确认文案为「导入后页面将刷新，所有已打开的通道会断开。是否继续？」。
- **清除全部本地数据**：危险确认，文案为「将删除所有设置、协议、预设、快捷发送、宏、仪表盘和自定义控件，且无法恢复。建议先导出配置。」；确认后删除并刷新页面。

导入成功时弹出 Toast「导入完成（N 项），页面即将刷新」，1 秒后执行 `location.reload()`。如果有失败项，对话框先列出「键：错误」，由用户点击「刷新页面」手动刷新；已成功写入的项仍会保留。

## 2. 备份文件格式

备份文件是一个 JSON 文本，结构如下：

```json
{
  "format": "toolset-backup",
  "formatVersion": 1,
  "appName": "Toolset · 嵌入式工具箱",
  "createdAt": "2026-11-15T04:00:00.000Z",
  "userAgent": "Mozilla/5.0 …",
  "sections": [
    {
      "namespace": "toolset/app/",
      "local": {
        "toolset/app/settings.v1": "{\"version\":1,\"data\":{\"theme\":\"system\",\"fontSize\":13,\"density\":\"compact\"}}"
      },
      "kv": {}
    },
    {
      "namespace": "toolset/protocol/",
      "local": {
        "toolset/protocol/index.v1": "{\"version\":1,\"data\":[{\"id\":\"p1\",\"name\":\"示例\",\"updatedAt\":0}]}"
      },
      "kv": {
        "toolset/protocol/plugins/p1": {
          "id": "p1",
          "name": "示例",
          "code": "…",
          "createdAt": 0,
          "updatedAt": 0
        }
      }
    }
  ]
}
```

- `format` 固定为 `toolset-backup`；`formatVersion` 当前为 1。
- `appName`、`createdAt`、`userAgent` 是导出时的元信息：`appName` 当前产品名，`createdAt` 为 ISO 8601 时间，`userAgent` 为浏览器标识。导入时只按字符串读取，缺失或类型不对时按空字符串处理，不用于兼容性判断。
- `sections` 按命名空间分组，每个 section 包含：
  - `local`：完整 localStorage 键 → 原始字符串（已经带有 `{ "version": n, "data": ... }` 包装）；
  - `kv`：完整 IndexedDB 键 → 原始 JSON 可序列化值。
- localStorage 中的值按原样保存，不在导出/导入时解析或迁移；迁移由各 store 在下次读取时完成。
- 文件为 UTF-8 文本，不做压缩或加密。

## 3. 命名空间规则

- 键以 `toolset/tool/<id>/` 开头时，命名空间就是 `toolset/tool/<id>/`。
- 否则取 `toolset/<第一段>/` 作为命名空间。
- 条目 `name` 是去掉命名空间前缀与末尾 `.v<n>` 后缀后的部分。只有末尾的版本后缀会被去掉。

| 完整键                                        | 命名空间               | name                   |
| --------------------------------------------- | ---------------------- | ---------------------- |
| `toolset/app/settings.v1`                     | `toolset/app/`         | `settings`             |
| `toolset/protocol/index.v1`                   | `toolset/protocol/`    | `index`                |
| `toolset/protocol/plugins/p1`                 | `toolset/protocol/`    | `plugins/p1`           |
| `toolset/link/presets.v1`                     | `toolset/link/`        | `presets`              |
| `toolset/tool/serial/settings.v1`             | `toolset/tool/serial/` | `settings`             |
| `toolset/tool/serial/dashboards/<id>`         | `toolset/tool/serial/` | `dashboards/<id>`      |
| `toolset/tool/serial/widgets.v1`              | `toolset/tool/serial/` | `widgets`              |
| `toolset/tool/serial/widgets/<id>`            | `toolset/tool/serial/` | `widgets/<id>`         |
| `toolset/tool/serial/custom-widget-safety.v1` | `toolset/tool/serial/` | `custom-widget-safety` |

显示名称：

- 命名空间：`toolset/app/` →「外观设置」，`toolset/protocol/` →「协议插件」，`toolset/link/` →「连接预设与设备记忆」（`app/config/backup-labels.ts`）；工具命名空间使用 manifest 的 `title`；未知命名空间显示原始前缀。
- 条目：优先使用 manifest 的 `backupLabels`，其次使用 `backup-labels.ts` 中同结构的映射；两者都支持 `prefix/*` 通配符匹配 kv 键（例如 `plugins/*`、`dashboards/*`、`widgets/*`），未匹配时显示 `name`。
- 串口上位机在 manifest 中声明了 `settings`、`layout`、`quick`、`macros`、`dashboards`、`dashboards/*`、`widgets`、`widgets/*` 的中文名；`custom-widget-safety` 没有单独的 `backupLabels` 项，备份界面显示原始 name `custom-widget-safety`。

## 4. 枚举与排除规则

枚举 localStorage 与 IndexedDB `kv` 仓库时，只收集同时满足以下条件的键：

- 以 `toolset/` 开头（非 Toolset 的浏览器存储键不导出）；
- 不包含 `.corrupt.`（损坏数据的本地备份不迁移到其他设备）；
- 不以 `toolset/safe-mode/` 开头（安全模式标记不备份，避免把“疑似卡死”状态带到另一台设备）。

`toolset/safe-mode/pending`、`toolset/safe-mode/blocked` 是安全模式专用键，属于 storage 层「禁止直接访问 localStorage」规则的例外之一（另一个是 `index.html` 的首屏主题读取），也是唯一有意不进入备份的 Toolset 命名空间。导入时 `importBackup` 会再次用同一规则过滤：备份文件中若伪造了 `.corrupt.` 或 safe-mode 键，会被记为失败项「不是有效的备份键」，不会写入。

## 5. 导出的语义

```ts
listBackupItems(): Promise<
  Array<{ namespace: string; items: Array<{ key: string; store: 'local' | 'kv'; name: string; bytes: number }> }>
>
exportBackup(select?: { namespaces?: string[]; keys?: string[] }): Promise<BackupFile>
```

- `listBackupItems()` 返回按命名空间排序、命名空间内按键排序的分组；`bytes` 是值的 UTF-8 估算大小（local 用原始字符串的 UTF-8 字节长度，kv 用 `JSON.stringify` 后的 UTF-8 字节长度）。
- `exportBackup` 可同时按命名空间与完整键筛选（两个条件同时生效）；section、键均按字典序输出。
- 设置抽屉的导出对话框按完整键多选，最终调用 `exportBackup({ keys })`。
- 导出只读当前浏览器中的数据，不修改任何存储。

## 6. 导入、合并与替换

```ts
parseBackup(text): { ok: true; file; summary } | { ok: false; error }
importBackup(file, { namespaces: string[]; mode: 'merge' | 'replace' }): Promise<{
  written: number
  deleted: number
  failed: Array<{ key: string; error: string }>
}>
```

`parseBackup` 的校验项：

1. 文本为合法 JSON（默认按 UTF-8 计算文本字节数）；
2. 顶层是对象，`format === 'toolset-backup'`；
3. `formatVersion` 是大于等于 1 的整数；高于当前版本时拒绝；
4. `sections` 是数组；每个 section 是对象，`namespace` 以 `toolset/` 开头、以 `/` 结尾且长度大于 `toolset/`；
5. section 的 `local`、`kv` 是对象；`local` 的值必须是字符串；
6. 每个键都以 `toolset/` 开头，并以所在 section 的 `namespace` 开头；
7. 文本总大小不超过 50MB。

失败文案：

- 结构性问题：`不是有效的 Toolset 配置文件`；
- 键不属于命名空间：`不是有效的 Toolset 配置文件：键「<key>」不属于命名空间「<namespace>」`；
- local 值类型错误：`不是有效的 Toolset 配置文件：键「<key>」的值必须是字符串`；
- 版本过新：`配置文件版本过新（formatVersion <n>），请升级后再导入`；
- 文件过大：`配置文件过大（超过 50 MB），无法导入`。

导入语义：

- **合并（`merge`）**：逐个写入所选命名空间中的键；完整键相同则覆盖，其他现有键保留。合并不是“按条目 id 合并”：像协议索引、预设这类整个数组存在一个 localStorage 键中的记录，备份会覆盖整个键，而不是把数组元素并集。
- **替换（`replace`）**：先删除所选命名空间下现有的所有 localStorage 键与 kv 键（计入 `deleted`），再写入备份内容。所选命名空间之外的数据不受影响。备份中不存在的条目在替换后也会被删除。
- 只导入用户勾选的命名空间；未勾选的 section 完全跳过。
- 单个键写入失败（例如配额不足、localStorage 不可用、kv 写入失败）时记入 `failed` 并继续处理其余键。`written` 只统计成功写入的键，`deleted` 只统计成功删除的键。
- 导入完成后必须刷新页面，让各 store 重新读取数据；导入前勾选「导入前下载当前配置备份」时会先导出当前全部配置，便于回滚。

## 7. 跨版本行为

- 备份文件格式只有 `formatVersion: 1`。用旧版本应用导入新版本导出的备份会得到「配置文件版本过新」的提示；用新版本导入旧版本备份（formatVersion 1）可以正常校验。
- 备份中的每个存储值保留原始 `{ version, data }` 包装。刷新页面后各 store 的 `migrate` 会按自己的数据版本处理：
  - 数据版本不高于当前版本：正常迁移或直接读取；
  - 数据版本高于当前版本、解析失败或迁移失败：按存储层规则把原值备份为 `<key>.corrupt.<时间戳>`，恢复默认值，并弹出「本地数据已损坏，已恢复默认值（原数据已备份）」。
- 因此把新版本应用的备份导入旧版本应用时，个别数据可能被当作“版本过高”而恢复默认值；备份文件本身不会被修改。
- 在 `formatVersion` 仍为 1 的前提下，备份中来自未来版本、当前应用不认识的命名空间与条目仍会被写入存储（只是界面可能显示原始前缀、标签显示原始名称）；后续版本可以读取它们。
- 元信息 `appName`、`createdAt`、`userAgent` 不参与兼容性判断。

## 8. 备份包含与不包含的数据

- 日志缓冲、发送历史、转发规则、打开的会话：只在内存中，刷新即丢失。
- 变量时间序列：只在内存中，受每个变量样本数与每源变量上限约束。
- `toolset/safe-mode/pending` 与 `toolset/safe-mode/blocked`：安全模式标记不备份，避免把「疑似卡死」状态带到另一台设备。
- 包含 `.corrupt.` 的损坏数据副本：不备份。
- 浏览器中不属于 `toolset/` 的键：不导出、不导入、清除时也不删除。
- 以下数据**会**进入备份（位于 `toolset/tool/serial/`，manifest 已声明中文名）：
  - 仪表盘索引 `toolset/tool/serial/dashboards.v1`（备份名「仪表盘索引」）；
  - 仪表盘内容 `toolset/tool/serial/dashboards/<id>`（备份名「仪表盘」）；
  - 自定义控件索引 `toolset/tool/serial/widgets.v1`（备份名「自定义控件索引」）；
  - 自定义控件代码 `toolset/tool/serial/widgets/<id>`（备份名「自定义控件」）；
  - 自定义控件安全说明「不再提示」`toolset/tool/serial/custom-widget-safety.v1`（工具设置，随备份导出，名称显示为原始 name `custom-widget-safety`）。
- 安全模式标记 `toolset/safe-mode/*` 是唯一有意排除的 Toolset 命名空间。

## 9. 清除全部本地数据

`clearAllLocalData()`：

- 删除所有以 `toolset/` 开头的 localStorage 键（包括损坏数据副本、安全模式标记、仪表盘索引与自定义控件索引）；
- 清空 IndexedDB 的 `kv` 仓库（共享数据库 `toolset` 的全部键）；
- 保留其他站点/应用的 localStorage 键；
- 不单独清理浏览器缓存或已下载的备份文件。

清除不可撤销，操作前应先导出配置。确认清除后页面自动刷新。

## 10. 限制与注意事项

- 备份上限 50MB（按备份文本的 UTF-8 字节估算）；协议插件代码与自定义控件代码（每个不超过 256KB）都会包含在 `kv` 中。
- 备份为明文 JSON，不含压缩与加密；其中可能包含协议插件源码与自定义控件代码，分享前请确认内容。
- 导出/导入依赖当前浏览器的 localStorage 与 IndexedDB。浏览器禁用存储或配额不足时，导出会提示读取失败，导入会把失败键列入 `failed`。
- 合并只在“完整存储键”粒度工作；需要逐条合并协议、预设等数组数据时，应使用各功能自己的导入入口（如预设导入），而不是本机配置备份。
- 导入会刷新页面并断开所有已打开的通道；导入过程中不要同时操作其他标签页。
