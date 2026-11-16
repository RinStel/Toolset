<script setup lang="ts">
/**
 * 属性面板（plan §8.10「属性面板」）。
 *
 * - 选中一个组件：三个标签页「数据 / 外观 / 行为」；外观页包含 `CommonProps`；
 * - 字段按 `visibleWhen` 条件显示；修改立即生效，由父组件按字段 key 合并撤销历史；
 * - 多选组件时只显示公共外观字段并批量修改；
 * - 未选中时显示仪表盘设置（名称、行高、数据源列表、计算变量列表）。
 */

import { computed, ref, watch } from 'vue'

import type {
  CommonProps,
  Dashboard,
  WidgetDefinition,
  WidgetInstance,
  WidgetPropField,
} from '@/domains/dashboard/public'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiCheckbox from '@/shared/ui/components/UiCheckbox.vue'
import UiColorInput from '@/shared/ui/components/UiColorInput.vue'
import UiFormField from '@/shared/ui/components/UiFormField.vue'
import UiInput from '@/shared/ui/components/UiInput.vue'
import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'
import UiSelect from '@/shared/ui/components/UiSelect.vue'
import UiTabs from '@/shared/ui/components/UiTabs.vue'

import PropEditor from './prop-editors/PropEditor.vue'
import type { PropEditorContext } from './prop-editors/types'
import type { DashboardRuntime } from './runtime/context'
import { getWidgetDefinition } from './widget-registry'

const props = defineProps<{
  dashboard: Dashboard
  selected: WidgetInstance[]
  mode: 'edit' | 'run'
  runtime: DashboardRuntime
  /** 覆盖组件定义（自定义控件宿主 / 测试用）。 */
  definition?: WidgetDefinition | null
}>()

const emit = defineEmits<{
  'update-props': [payload: { ids: string[]; patch: Record<string, unknown>; mergeKey: string }]
  'update-common': [payload: { ids: string[]; patch: Partial<CommonProps>; mergeKey: string }]
  'update-dashboard': [payload: { patch: Partial<Dashboard>; mergeKey: string }]
}>()

interface PanelTab {
  key: string
  label: string
}

const TABS: PanelTab[] = [
  { key: 'data', label: '数据' },
  { key: 'style', label: '外观' },
  { key: 'behavior', label: '行为' },
]

const activeTab = ref('style')

const single = computed(() => (props.selected.length === 1 ? props.selected[0] : undefined))
const multi = computed(() => props.selected.length > 1)
const instanceIds = computed(() => props.selected.map((instance) => instance.id))

const definition = computed<WidgetDefinition | null>(() => {
  if (props.definition !== undefined) return props.definition
  const instance = single.value
  if (!instance) return null
  return getWidgetDefinition(instance.type) ?? null
})

const currentProps = computed<Record<string, unknown>>(() => ({
  ...(single.value?.props ?? {}),
}))

const propDefaults = computed<Record<string, unknown>>(() => {
  const result: Record<string, unknown> = {}
  for (const field of definition.value?.props ?? []) {
    result[field.key] = defaultValueOf(field)
  }
  return result
})

const tabs = computed<PanelTab[]>(() => (multi.value ? [TABS[1] as PanelTab] : TABS))

watch(
  () => props.selected,
  () => {
    if (multi.value && activeTab.value !== 'style') activeTab.value = 'style'
  },
)

const editorContext = computed<PropEditorContext>(() => ({
  dashboard: props.dashboard,
  runtime: props.runtime,
  instanceIds: instanceIds.value,
  props: currentProps.value,
  defaults: propDefaults.value,
}))

/* ------------------------------------------------------------------------- */
/* 字段可见性                                                                  */
/* ------------------------------------------------------------------------- */

function isVisible(field: WidgetPropField): boolean {
  const condition = field.visibleWhen
  if (!condition) return true
  const value = currentProps.value[condition.key]
  const expected = condition.equals
  if (Array.isArray(expected)) return expected.some((item) => item === value)
  return expected === value
}

function fieldsOf(tab: string): WidgetPropField[] {
  const def = definition.value
  if (!def) return []
  return def.props.filter((field) => field.tab === tab && isVisible(field))
}

function fieldValue(field: WidgetPropField): unknown {
  const value = currentProps.value[field.key]
  return value === undefined ? defaultValueOf(field) : value
}

function defaultValueOf(field: WidgetPropField): unknown {
  switch (field.type) {
    case 'number':
      return field.default
    case 'text':
    case 'textarea':
    case 'expression':
      return field.default ?? ''
    case 'select':
      return field.default ?? field.options[0]?.value
    case 'checkbox':
      return field.default ?? false
    case 'color':
      return field.default ?? 'auto'
    case 'range':
      return field.default ?? { min: null, max: null }
    case 'variable':
      return field.default ?? null
    case 'variables':
      return []
    case 'thresholds':
    case 'zones':
    case 'options':
      return field.default ?? []
    case 'command':
      return field.default ?? null
    default:
      return undefined
  }
}

function onFieldUpdate(field: WidgetPropField, value: unknown): void {
  emit('update-props', {
    ids: instanceIds.value,
    patch: { [field.key]: value },
    mergeKey: `prop:${field.key}`,
  })
}

/* ------------------------------------------------------------------------- */
/* 公共外观字段（CommonProps）                                                 */
/* ------------------------------------------------------------------------- */

interface CommonField {
  key: keyof CommonProps
  label: string
}

const COMMON_FIELDS: CommonField[] = [
  { key: 'title', label: '标题' },
  { key: 'showTitle', label: '显示标题' },
  { key: 'titleAlign', label: '标题对齐' },
  { key: 'background', label: '背景' },
  { key: 'border', label: '边框' },
  { key: 'padding', label: '内边距' },
  { key: 'fontScale', label: '字号缩放' },
]

const visibleCommonFields = computed(() =>
  multi.value ? COMMON_FIELDS.filter((field) => field.key !== 'title') : COMMON_FIELDS,
)

const common = computed<CommonProps>(() => props.selected[0]?.common ?? defaultCommon())

function defaultCommon(): CommonProps {
  return {
    title: '',
    showTitle: true,
    titleAlign: 'left',
    background: 'default',
    border: true,
    padding: 8,
    fontScale: 1,
  }
}

const BACKGROUND_OPTIONS = [
  { label: '默认', value: 'default' },
  { label: '透明', value: 'transparent' },
  { label: '自定义颜色', value: '__color__' },
]

const backgroundMode = computed(() => {
  const value = common.value.background
  return value === 'default' || value === 'transparent' ? value : '__color__'
})

const backgroundCustom = computed(() => {
  const value = common.value.background
  return value === 'default' || value === 'transparent' ? '#3b82f6' : value
})

function updateCommon(patch: Partial<CommonProps>): void {
  emit('update-common', {
    ids: instanceIds.value,
    patch,
    mergeKey: `common:${Object.keys(patch).join(',')}`,
  })
}

function onBackgroundMode(value: string | number | null): void {
  if (typeof value !== 'string') return
  updateCommon({ background: value === '__color__' ? backgroundCustom.value : value })
}

/* ------------------------------------------------------------------------- */
/* 仪表盘设置（未选中）                                                        */
/* ------------------------------------------------------------------------- */

const dashboardName = ref(props.dashboard.name)

watch(
  () => props.dashboard.name,
  (value) => {
    if (value !== dashboardName.value) dashboardName.value = value
  },
)

function onRenameDashboard(): void {
  const name = dashboardName.value.trim()
  if (name.length === 0 || name === props.dashboard.name) return
  emit('update-dashboard', { patch: { name }, mergeKey: 'dashboard:name' })
}

function updateSources(sources: Dashboard['sources']): void {
  emit('update-dashboard', { patch: { sources }, mergeKey: 'dashboard:sources' })
}

function updateSource(
  index: number,
  patch: { alias?: string; label?: string; match?: { deviceKey?: string; providerKind?: string } },
): void {
  const sources = props.dashboard.sources.map((source, position) =>
    position === index ? { ...source, ...patch } : source,
  )
  updateSources(sources)
}

function updateSourceMatch(index: number, key: 'deviceKey' | 'providerKind', value: string): void {
  const source = props.dashboard.sources[index]
  if (!source) return
  const match = { ...(source.match ?? {}) }
  if (value.trim().length === 0) delete match[key]
  else match[key] = value.trim()
  updateSource(index, { match: Object.keys(match).length > 0 ? match : undefined })
}

function removeSource(index: number): void {
  if (props.dashboard.sources.length <= 1) return
  updateSources(props.dashboard.sources.filter((_, position) => position !== index))
}

function addSource(): void {
  const used = new Set(props.dashboard.sources.map((source) => source.alias))
  let index = props.dashboard.sources.length + 1
  while (used.has(`source${index}`)) index += 1
  const alias = `source${index}`
  updateSources([...props.dashboard.sources, { alias, label: `数据源 ${index}` }])
}

function computedEntries(): Array<{ alias: string; key: string; expr: string }> {
  return Object.entries(props.dashboard.computed).flatMap(([alias, list]) =>
    list.map((item) => ({ alias, key: item.key, expr: item.expr })),
  )
}

function removeComputed(alias: string, key: string): void {
  const computed: Dashboard['computed'] = {}
  for (const [sourceAlias, list] of Object.entries(props.dashboard.computed)) {
    computed[sourceAlias] = list.filter((item) => !(sourceAlias === alias && item.key === key))
  }
  emit('update-dashboard', { patch: { computed }, mergeKey: 'dashboard:computed' })
}
</script>

<template>
  <div
    class="property-panel"
    :data-multi="multi ? 'true' : 'false'"
    data-testid="dashboard-properties"
  >
    <template v-if="selected.length === 0">
      <div class="property-panel__dashboard" data-testid="dashboard-settings-fields">
        <h3 class="property-panel__heading">仪表盘设置</h3>

        <UiFormField label="名称">
          <UiInput
            v-model="dashboardName"
            size="sm"
            aria-label="仪表盘名称"
            data-testid="dashboard-setting-name"
            @enter="onRenameDashboard"
            @blur="onRenameDashboard"
          />
        </UiFormField>

        <UiFormField label="行高">
          <UiNumberInput
            :model-value="dashboard.rowHeight"
            :min="16"
            :max="64"
            size="sm"
            unit="px"
            aria-label="行高"
            data-testid="dashboard-setting-row-height"
            @update:model-value="
              emit('update-dashboard', {
                patch: { rowHeight: $event ?? 28 },
                mergeKey: 'dashboard:rowHeight',
              })
            "
          />
        </UiFormField>

        <div class="property-panel__section">
          <div class="property-panel__section-head">
            <span>数据源</span>
            <UiButton
              size="sm"
              variant="ghost"
              data-testid="dashboard-settings-source-add"
              @click="addSource"
            >
              + 新增
            </UiButton>
          </div>
          <div
            v-for="(source, index) in dashboard.sources"
            :key="source.alias"
            class="property-panel__source"
            :data-testid="`dashboard-source-row-${source.alias}`"
          >
            <div class="property-panel__source-line">
              <code class="property-panel__alias">{{ source.alias }}</code>
              <UiInput
                :model-value="source.label"
                size="sm"
                aria-label="数据源名称"
                @update:model-value="updateSource(index, { label: $event })"
              />
              <UiButton
                size="sm"
                variant="danger"
                :disabled="dashboard.sources.length <= 1"
                :data-testid="`dashboard-source-remove-${source.alias}`"
                @click="removeSource(index)"
              >
                删除
              </UiButton>
            </div>
            <div class="property-panel__source-line">
              <span class="property-panel__match-label">match.deviceKey</span>
              <UiInput
                :model-value="source.match?.deviceKey ?? ''"
                size="sm"
                placeholder="留空表示自动匹配第一个会话"
                aria-label="匹配 deviceKey"
                @update:model-value="updateSourceMatch(index, 'deviceKey', $event)"
              />
            </div>
            <div class="property-panel__source-line">
              <span class="property-panel__match-label">match.providerKind</span>
              <UiInput
                :model-value="source.match?.providerKind ?? ''"
                size="sm"
                placeholder="例如 virtual"
                aria-label="匹配 providerKind"
                @update:model-value="updateSourceMatch(index, 'providerKind', $event)"
              />
            </div>
          </div>
        </div>

        <div class="property-panel__section">
          <div class="property-panel__section-head">
            <span>计算变量</span>
          </div>
          <p v-if="computedEntries().length === 0" class="property-panel__hint">
            还没有计算变量，可在变量列表中新增。
          </p>
          <div
            v-for="entry in computedEntries()"
            :key="`${entry.alias}/${entry.key}`"
            class="property-panel__computed"
            :data-testid="`dashboard-computed-row-${entry.key}`"
          >
            <code>{{ entry.alias }}/fx.{{ entry.key }}</code>
            <span class="property-panel__computed-expr">{{ entry.expr }}</span>
            <UiButton
              size="sm"
              variant="ghost"
              title="删除计算变量"
              @click="removeComputed(entry.alias, entry.key)"
            >
              ×
            </UiButton>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <UiTabs v-model="activeTab" :tabs="tabs" size="sm" aria-label="属性面板标签" />

      <div class="property-panel__body">
        <template v-if="activeTab === 'style'">
          <div
            v-for="field in visibleCommonFields"
            :key="field.key"
            class="property-panel__field"
            :data-testid="`prop-${field.key}`"
            :data-editor-type="field.key === 'title' ? 'text' : field.key"
          >
            <UiFormField :label="field.label">
              <UiInput
                v-if="field.key === 'title'"
                :model-value="common.title"
                size="sm"
                :aria-label="field.label"
                @update:model-value="updateCommon({ title: $event })"
              />
              <UiCheckbox
                v-else-if="field.key === 'showTitle' || field.key === 'border'"
                :model-value="Boolean(common[field.key])"
                size="sm"
                :aria-label="field.label"
                @update:model-value="updateCommon({ [field.key]: $event })"
              />
              <UiSelect
                v-else-if="field.key === 'titleAlign'"
                :model-value="common.titleAlign"
                :options="[
                  { label: '左', value: 'left' },
                  { label: '居中', value: 'center' },
                ]"
                size="sm"
                :aria-label="field.label"
                @update:model-value="
                  updateCommon({ titleAlign: $event === 'center' ? 'center' : 'left' })
                "
              />
              <UiSelect
                v-else-if="field.key === 'padding'"
                :model-value="common.padding"
                :options="[
                  { label: '0', value: 0 },
                  { label: '4', value: 4 },
                  { label: '8', value: 8 },
                  { label: '12', value: 12 },
                ]"
                size="sm"
                :aria-label="field.label"
                @update:model-value="
                  updateCommon({ padding: ($event as CommonProps['padding']) ?? 8 })
                "
              />
              <UiNumberInput
                v-else-if="field.key === 'fontScale'"
                :model-value="common.fontScale"
                :min="0.75"
                :max="2"
                :step="0.05"
                size="sm"
                :aria-label="field.label"
                @update:model-value="updateCommon({ fontScale: $event ?? 1 })"
              />
              <div v-else-if="field.key === 'background'" class="property-panel__background">
                <UiSelect
                  :model-value="backgroundMode"
                  :options="BACKGROUND_OPTIONS"
                  size="sm"
                  :aria-label="field.label"
                  @update:model-value="onBackgroundMode"
                />
                <UiColorInput
                  v-if="backgroundMode === '__color__'"
                  :model-value="backgroundCustom"
                  aria-label="背景颜色"
                  @update:model-value="updateCommon({ background: $event })"
                />
              </div>
            </UiFormField>
          </div>

          <div
            v-for="field in fieldsOf('style')"
            :key="field.key"
            class="property-panel__field"
            :data-testid="`prop-${field.key}`"
            :data-editor-type="field.type"
          >
            <UiFormField :label="field.label" :hint="field.help">
              <PropEditor
                :field="field"
                :value="fieldValue(field)"
                :context="editorContext"
                @update="onFieldUpdate(field, $event)"
              />
            </UiFormField>
          </div>
        </template>

        <template v-else-if="activeTab === 'data' && single">
          <p v-if="!definition" class="property-panel__hint">
            该组件没有属性描述（自定义控件由 D1c 的编辑器提供）。
          </p>
          <div
            v-for="field in fieldsOf('data')"
            :key="field.key"
            class="property-panel__field"
            :data-testid="`prop-${field.key}`"
            :data-editor-type="field.type"
          >
            <UiFormField :label="field.label" :hint="field.help">
              <PropEditor
                :field="field"
                :value="fieldValue(field)"
                :context="editorContext"
                @update="onFieldUpdate(field, $event)"
              />
            </UiFormField>
          </div>
          <p v-if="definition && fieldsOf('data').length === 0" class="property-panel__hint">
            该组件没有数据属性。
          </p>
        </template>

        <template v-else-if="activeTab === 'behavior' && single">
          <p v-if="!definition" class="property-panel__hint">该组件没有行为属性。</p>
          <div
            v-for="field in fieldsOf('behavior')"
            :key="field.key"
            class="property-panel__field"
            :data-testid="`prop-${field.key}`"
            :data-editor-type="field.type"
          >
            <UiFormField :label="field.label" :hint="field.help">
              <PropEditor
                :field="field"
                :value="fieldValue(field)"
                :context="editorContext"
                @update="onFieldUpdate(field, $event)"
              />
            </UiFormField>
          </div>
          <p v-if="definition && fieldsOf('behavior').length === 0" class="property-panel__hint">
            该组件没有行为属性。
          </p>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.property-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.property-panel__body,
.property-panel__dashboard {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.property-panel__heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
}

.property-panel__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.property-panel__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-faint);
  font-size: 11px;
}

.property-panel__source {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
}

.property-panel__source-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.property-panel__source-line :deep(.ui-input) {
  flex: 1 1 auto;
  min-width: 0;
}

.property-panel__alias {
  flex: none;
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 11px;
}

.property-panel__match-label {
  flex: none;
  width: 118px;
  color: var(--text-faint);
  font-size: 10px;
}

.property-panel__background {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.property-panel__hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.5;
}

.property-panel__field {
  min-width: 0;
}

.property-panel__computed {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
}

.property-panel__computed code {
  color: var(--accent);
  font-family: var(--font-mono);
}

.property-panel__computed-expr {
  min-width: 0;
  overflow: hidden;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
