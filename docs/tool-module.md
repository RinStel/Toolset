# 新增一个工具

本项目的工具是 `src/tools/<id>/` 下的自包含目录。首页卡片、顶部「工具」菜单、路由、设置抽屉分组与帮助面板章节都由 `src/app/registry` 自动发现，**新增工具不需要修改 `src/app/`**。

以下以新增 `resistor`（电阻计算）为例。示例中的文件路径都要真实创建，提交前用文末的检查清单验证。当前 `src/tools/` 中只有 `serial`（串口上位机）。

## 1. 目录与命名

```
src/tools/resistor/
  manifest.ts              必需，默认导出 ToolManifest
  routes.ts                必需，默认导出 ToolRoutes
  views/ResistorView.vue   工具页面（必须动态 import）
  components/…             可选，工具内部组件
  panels/Settings.vue      可选，工具设置面板（动态 import）
  panels/Help.vue          可选，工具帮助面板（动态 import）
  stores/…                 可选，工具级 Pinia store
  dashboard/               可选，仪表盘宿主界面（串口上位机已提供完整实现，可参考）
    widgets/<type>/
      definition.ts        组件定义，必须保持轻量
      Widget.vue           组件渲染，必须位于非入口 chunk
```

规则（`src/app/registry/validate.ts` 强制）：

- 目录名就是工具 `id`，必须匹配 `/^[a-z][a-z0-9-]*$/`，且 `manifest.id === 目录名`。
- `manifest.ts` 与 `routes.ts` 必须成对出现。
- 工具之间不能互相导入（`tool-isolation`）；工具只能经 `domains/<name>/public.ts` 使用领域能力（`tool-domain-public`）。
- `manifest.ts` / `routes.ts` 必须保持轻量：不能导入领域、不能静态导入 `.vue`、CodeMirror 或 `uplot`；页面/面板/编辑器一律用动态 `import()`（`manifest-light`）。这保证入口包不含工具代码。
- 若工具提供仪表盘组件，`dashboard/widgets/<type>/definition.ts` 也不得静态导入 `.vue`、`uplot`、CodeMirror 或领域代码（`widget-definition-light`），`Widget.vue` 只能用动态 `import()` 引用。

## 2. manifest.ts

```ts
import { type ToolManifest } from '@/shared/contracts/tool'
import { Zap } from 'lucide-vue-next'

const manifest: ToolManifest = {
  id: 'resistor',
  title: '电阻计算',
  summary: '按色环或阻值计算电阻',
  category: 'calc',
  icon: Zap,
  order: 100,
  layout: 'page', // 或 'workspace'（占满头部以下区域、不滚动）
  keepAlive: false,
  keywords: ['电阻', '色环'],
  settings: () => import('./panels/Settings.vue'),
  help: () => import('./panels/Help.vue'),
  backupLabels: {
    settings: '工具设置',
    cache: '本地缓存',
    'records/*': '历史记录',
  },
}

export default manifest
```

字段含义见 `src/shared/contracts/tool.ts`：

| 字段                | 说明                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `category`          | `categories.ts` 中的 key（`comm`/`convert`/`calc`/`other`）；未知值会归入 `other` 并告警                                   |
| `order`             | 同分类内升序，默认 100                                                                                                     |
| `layout`            | `workspace` 占满 `calc(100vh - 44px)` 且不滚动；`page` 最大宽 1200px、居中、可滚动                                         |
| `keepAlive`         | 路由切换时保留工具页面状态；跨首页仍会卸载，跨页面状态应放工具 store                                                       |
| `settings` / `help` | 返回组件模块的动态 import；设置抽屉/帮助面板打开时才加载                                                                   |
| `backupLabels`      | 本机配置导出界面的中文名；键为存储项 name（不含命名空间与 `.v<n>` 后缀），支持 `prefix/*` 通配 kv 键；未匹配时显示原始名称 |

`backupLabels` 与第 5 节的存储命名一一对应：local 键去掉 `toolset/tool/<id>/` 前缀与 `.v<n>` 后缀后剩下的就是 `name`；kv 键去掉前缀后剩余部分也按同一规则匹配（支持 `records/*` 这样的通配符）。

## 3. routes.ts

```ts
import { type ToolRoutes } from '@/shared/contracts/tool'

const routes: ToolRoutes = [
  {
    path: '', // 工具首页；所有 path 都是相对路径且不以 / 开头
    name: 'resistor-home',
    component: () => import('./views/ResistorView.vue'),
    meta: { title: '电阻计算' },
  },
]

export default routes
```

注册表会把它挂到 `/tools/resistor` 下；`path: ''` 表示工具首页。`meta.title` 可被页面用于更细的标题，但 `document.title` 默认由注册表按 `<工具标题> · Toolset` 设置。

## 4. 工具页面

```vue
<script setup lang="ts">
import { ref } from 'vue'

const value = ref('')
</script>

<template>
  <section class="resistor-tool">
    <h1>电阻计算</h1>
    <input v-model="value" />
  </section>
</template>
```

- 样式优先复用 `src/shared/ui/styles/tokens.css` 的 CSS 变量与 `src/shared/ui/components/` 的组件，不要引入组件库或 CSS 框架。
- 全局 UI 服务：`import { toast } from '@/shared/ui/services/toast'`、`import { confirm } from '@/shared/ui/services/confirm'`；`ServiceHost.vue` 已由 AppShell 挂载，无需在工具里重复挂载。
- 订阅非 Vue 状态（领域事件、store）用 `useExternalStore(subscribe, getSnapshot)`，组件卸载会自动取消订阅。
- 图表/编辑器等重依赖（例如 `uplot`、CodeMirror）只能在真正渲染的组件里动态 `import()`，不能静态进入工具页面；入口闭包与工具视图的静态闭包会被分包检查拦截。

## 5. 存储命名

工具只能通过共享存储层访问持久化数据：

```ts
import { createToolStorage } from '@/shared/lib/storage/namespace'

const storage = createToolStorage('resistor')
const settings = storage.local('settings', {
  version: 1,
  defaults: () => ({ precision: 2 }),
})
const cache = storage.kv // 前缀 toolset/tool/resistor/ 的 IndexedDB 键值存储
```

- 落盘键为 `toolset/tool/<id>/<name>.v<version>`，值格式 `{ version, data }`。
- 版本迁移用 `migrate`；损坏数据会备份为 `<key>.corrupt.<时间戳>` 并恢复默认值。
- 不要直接使用 `localStorage` / `indexedDB`，否则多标签页同步与降级（内存）会失效。
- 新增存储项时同步更新 `manifest.backupLabels`，否则本机配置导出界面会显示原始 `name`。kv 项用 `prefix/*` 通配符命名，例如 `'records/*': '历史记录'` 可覆盖 `records/<id>`。

## 6. 设置面板与帮助章节

`panels/Settings.vue` 会被 SettingsDrawer 包进「<工具标题>」分组，`panels/Help.vue` 会被 HelpPanel 追加到外壳章节之后。二者都是普通 Vue 组件，建议用 `SettingForm` + `SettingField` 描述表单：

```ts
import { type SettingField } from '@/shared/contracts/settings'

const fields: SettingField[] = [
  { key: 'precision', label: '小数位', type: 'number', min: 0, max: 6, default: 2 },
]
```

`SettingForm` 会为每个字段输出 `data-testid="setting-<key>"`，便于 e2e 定位；`advanced: true` 的字段收进可折叠的「高级」区。`SettingField` 支持 `number`、`text`、`select`、`checkbox` 四种类型，`select` 可配合 `allowCustom` 输入自定义数值，所有字段都支持 `hint`。

## 7. 仪表盘与自定义控件的扩展点

`domains/dashboard` 是通用领域层（模型、24 列布局、命令模板、撤销/重做、一键生成、自定义控件编译与调用保护），工具只能经 `domains/dashboard/public.ts` 使用它。但**没有工具级的仪表盘注册扩展点**：

- `ToolManifest` 没有仪表盘相关字段；`tools/serial/dashboard/` 是串口上位机自己的界面层。
- 工具之间不能互相导入（`tool-isolation`），因此其他工具不能直接复用 `tools/serial/dashboard/`；若需要仪表盘，应新建自己的 `dashboard/` 目录，复用 `domains/dashboard` 与 `domains/series` 的公开 API，界面、宿主、刷新调度与 `useWidgetData` 等价的数据读取层都需自行实现。
- 串口上位机独占的配套能力（`dashboardFps`、`seriesCapacity`、`maxVariablesPerSource` 等工具设置，仪表盘/控件仓库的 local + kv 键）不属于通用契约。

如果要实现同样的仪表盘，可沿用以下约定：

- **新增一种内置组件**：在 `dashboard/widgets/<type>/` 下新增 `definition.ts` 与 `Widget.vue`。`definition.ts` 默认导出 `WidgetDefinition`（类型、标题、分组、图标、默认/最小尺寸、`WidgetPropField[]`、可选的 `migrate`、动态 `component`）；必须保持轻量（`widget-definition-light`），不得静态导入 `.vue`、`uplot`、CodeMirror 或领域代码。`Widget.vue` 只能被动态 `import()`，`check-chunks` 要求它落在非入口 chunk。
- **组件注册**：串口上位机用 `widget-registry.ts` 的 `import.meta.glob('./widgets/*/definition.ts', { eager: true, import: 'default' })` 自动发现，新增目录即出现在组件库，不需修改注册表；新工具可照此实现。
- **组件数据读取**：组件只通过 `useWidgetData`（或等价实现）在刷新调度帧内读取数据，不得自行订阅 `SeriesSource` 的 `data` 事件；图表重依赖在组件挂载后动态 `import()`。完整步骤见 `docs/dashboard.md` 第 13 节。
- **自定义控件**：属于工具级功能，不是新领域。串口上位机的实现把索引存 local `widgets`，代码存工具 kv `widgets/<id>`，代码上限 256KB；若在别的工具中实现类似功能，必须使用自己的存储键，并在 manifest 的 `backupLabels` 中声明（如 `widgets`、`widgets/*`），否则本机配置备份界面会显示原始名称。
- **备份**：一旦新增仪表盘 / 控件等 local 或 kv 存储项，必须同步更新 `manifest.backupLabels`（索引与内容分别命名），并确认安全模式等排除键没有进入备份。详见 `docs/backup.md`。
- **文档**：串口上位机的完整实现与 API 见 `docs/dashboard.md` 与 `docs/custom-widget.md`；这些路径是串口上位机的公开说明，不是跨工具代码依赖。

## 8. 需要通过的检查

新增工具后，以下命令必须通过：

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:unit
pnpm check:arch
pnpm build
pnpm check:chunks
```

`check:arch` 会自动为新的工具目录生成 `tool-isolation` 规则；`check:chunks` 要求：

- 入口 chunk 的静态闭包中不出现 `src/tools/<id>/(views|components|panels|stores|composables)/`，也不出现 `src/tools/<id>/dashboard/`；
- 工具的 `views/*.vue`、`panels/*.vue` 以及 `dashboard/widgets/*/Widget.vue` 必须出现在非入口 chunk 中；
- 入口 JS gzip 合计不超过 120KB。

若新增了公共 UI 组件，放在 `src/shared/ui/components/`；若需要新的领域能力，先建 `src/domains/<name>/public.ts`，再让工具只从 `public.ts` 导入（架构规则会在 `pnpm check:arch` 中强制）。

## 9. 测试

- 工具级纯逻辑放 `tests/unit/` 或领域测试；工具 store 用 Vitest 直接测。
- 组件测试放 `tests/components/<Tool>.test.ts`，文件首行声明 `// @vitest-environment happy-dom`。
- 关键用户路径加到 `tests/e2e/`，为交互元素提供稳定的 `data-testid`（命名约定见 plan.md §11.4）。
