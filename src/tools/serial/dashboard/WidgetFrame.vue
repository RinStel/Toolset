<script setup lang="ts">
/**
 * 组件外框（plan §8.10 / §8.11）。
 *
 * 负责：标题栏、`CommonProps` 的样式应用、数据源状态点、选中态、渲染错误隔离，
 * 以及把运行时上下文提供给内置组件（`useWidgetData`）。
 *
 * 自定义控件（`custom:<id>`）由 `CustomWidgetHost` 在内容区接管：宿主创建 shadow DOM，
 * 通过调用保护 / 安全模式执行控件代码（plan §6.10）。
 */

import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onErrorCaptured,
  provide,
  ref,
  shallowRef,
  watch,
  type Component,
} from 'vue'

import { createDefaultWidgetProps, customWidgetIdOf, getWidgetDefinition } from './widget-registry'
import CustomWidgetHost from './custom/CustomWidgetHost.vue'
import { DASHBOARD_RUNTIME_KEY } from './runtime/injection-keys'
import type { DashboardRuntime, DashboardSourceState } from './runtime/context'
import { dashboardSessionVersion } from './pane-state'
import type {
  CommonProps,
  VarRef,
  WidgetDefinition,
  WidgetInstance,
} from '@/domains/dashboard/public'
import UiButton from '@/shared/ui/components/UiButton.vue'
import { toast } from '@/shared/ui/services/toast'

const props = defineProps<{
  instance: WidgetInstance
  runtime: DashboardRuntime
  mode: 'edit' | 'run'
  selected?: boolean
  /** 组件定义的覆盖值（测试 / 自定义控件的宿主可以传入）。 */
  definition?: WidgetDefinition | null
}>()

const emit = defineEmits<{ 'request-update': [] }>()

/* ------------------------------------------------------------------------- */
/* 组件定义与异步加载                                                          */
/* ------------------------------------------------------------------------- */

const asyncComponents = new Map<string, Component>()

const customId = computed(() => customWidgetIdOf(props.instance.type))

const definition = computed<WidgetDefinition | null>(() => {
  if (props.definition !== undefined) return props.definition
  return getWidgetDefinition(props.instance.type) ?? null
})

const mergedProps = computed<Record<string, unknown>>(() => {
  const def = definition.value
  const base = def ? createDefaultWidgetProps(def) : {}
  let current = { ...base, ...props.instance.props }
  if (def?.migrate && props.instance.version < def.version) {
    try {
      current = { ...base, ...def.migrate(current, props.instance.version) }
    } catch (error) {
      console.error('[dashboard] 组件属性迁移失败', error)
    }
  }
  return current
})

const widgetComponent = computed<Component | null>(() => {
  const def = definition.value
  if (!def) return null
  const existing = asyncComponents.get(def.type)
  if (existing) return existing
  const component = defineAsyncComponent(def.component)
  asyncComponents.set(def.type, component)
  return component
})

const reloadKey = ref(0)

const title = computed(() => {
  const common = props.instance.common
  if (common.title.trim().length > 0) return common.title
  return definition.value?.title ?? props.instance.type
})

/* ------------------------------------------------------------------------- */
/* 样式                                                                        */
/* ------------------------------------------------------------------------- */

const frameStyle = computed(() => {
  const common: CommonProps = props.instance.common
  const style: Record<string, string> = {
    padding: `${common.padding}px`,
    fontSize: `${common.fontScale}rem`,
  }
  if (common.background === 'default') style.background = 'var(--bg-elev)'
  else if (common.background === 'transparent') style.background = 'transparent'
  else style.background = common.background
  if (common.border) {
    style.border = '1px solid var(--border)'
  } else {
    style.border = '1px solid transparent'
  }
  return style
})

/* ------------------------------------------------------------------------- */
/* 数据源状态点                                                                */
/* ------------------------------------------------------------------------- */

function collectAliases(value: unknown, result: Set<string>, depth = 0): void {
  if (depth > 6 || value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (const item of value) collectAliases(item, result, depth + 1)
    return
  }
  if (typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (typeof record.source === 'string' && typeof record.key === 'string') {
    result.add(record.source)
    return
  }
  for (const item of Object.values(record)) collectAliases(item, result, depth + 1)
}

const sourceAliases = computed(() => {
  const aliases = new Set<string>()
  collectAliases(mergedProps.value, aliases)
  return [...aliases]
})

/** 数据源状态点：会话新增 / 断开时随 {@link dashboardSessionVersion} 刷新。 */
const sourceState = computed<DashboardSourceState | null>(() => {
  void dashboardSessionVersion.value
  if (sourceAliases.value.length === 0) return null
  let state: DashboardSourceState = 'open'
  for (const alias of sourceAliases.value) {
    const current = props.runtime.sourceState(alias)
    if (current === 'unbound') return 'unbound'
    if (current === 'closed') state = 'closed'
  }
  return state
})

const sourceStateLabel = computed(() => {
  switch (sourceState.value) {
    case 'open':
      return '数据源已连接'
    case 'closed':
      return '数据源已断开'
    case 'unbound':
      return '数据源未连接'
    default:
      return ''
  }
})

/* ------------------------------------------------------------------------- */
/* 运行时上下文                                                                */
/* ------------------------------------------------------------------------- */

provide(DASHBOARD_RUNTIME_KEY, props.runtime)

const runtime = props.runtime

const widgetCtx = {
  send: async (
    cmd: Parameters<DashboardRuntime['send']>[0],
    value?: Parameters<DashboardRuntime['send']>[1],
  ) => {
    try {
      const result = await runtime.send(cmd, value)
      flash('ok')
      return result
    } catch (error) {
      flash('danger')
      toast.show({ type: 'error', message: `${title.value}：${errorMessage(error)}` })
      throw error
    }
  },
  sendBytes: async (bytes: Uint8Array | number[], source?: string) => {
    try {
      const result = await runtime.sendBytes(bytes, source)
      flash('ok')
      return result
    } catch (error) {
      flash('danger')
      toast.show({ type: 'error', message: `${title.value}：${errorMessage(error)}` })
      throw error
    }
  },
  sourceState: (source?: string) => runtime.sourceState(source ?? runtime.defaultAlias()),
  theme: (cssVar: string) => runtime.theme(cssVar),
  resolveMeta: (ref: VarRef) => runtime.meta(ref),
  requestUpdate: () => {
    runtime.requestUpdate()
    emit('request-update')
  },
}

/* 发送反馈：控件边框闪烁一次 --ok / --danger（plan §8.11）。 */
const flashState = ref<'ok' | 'danger' | ''>('')
let flashTimer: ReturnType<typeof setTimeout> | null = null

function flash(kind: 'ok' | 'danger'): void {
  flashState.value = kind
  if (flashTimer !== null) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    flashState.value = ''
    flashTimer = null
  }, 260)
}

watch(
  () => mergedProps.value,
  () => {
    runtime.requestUpdate()
  },
  { deep: true },
)

/* ------------------------------------------------------------------------- */
/* 尺寸                                                                        */
/* ------------------------------------------------------------------------- */

const contentRef = ref<HTMLElement | null>(null)
const contentSize = shallowRef({ width: 0, height: 0 })
let resizeObserver: ResizeObserver | null = null

function measure(): void {
  const element = contentRef.value
  if (!element) return
  contentSize.value = { width: element.clientWidth, height: element.clientHeight }
}

watch(contentRef, (element) => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (!element || typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(() => {
    measure()
  })
  resizeObserver.observe(element)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (flashTimer !== null) clearTimeout(flashTimer)
})

/* ------------------------------------------------------------------------- */
/* 错误隔离（plan §8.10）                                                      */
/* ------------------------------------------------------------------------- */

const renderError = ref<string | null>(null)

onErrorCaptured((error) => {
  renderError.value = error instanceof Error ? error.message : String(error)
  console.error('[dashboard] 组件渲染出错', error)
  return false
})

watch(
  () => props.instance.id,
  () => {
    renderError.value = null
    reloadKey.value = 0
  },
)

function reload(): void {
  renderError.value = null
  reloadKey.value += 1
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}
</script>

<template>
  <div
    class="widget-frame"
    :class="{
      'is-selected': selected,
      'is-custom': customId !== null,
      'flash-ok': flashState === 'ok',
      'flash-danger': flashState === 'danger',
    }"
    :style="frameStyle"
    :data-type="instance.type"
  >
    <div
      v-if="instance.common.showTitle"
      class="widget-frame__title"
      :style="{ textAlign: instance.common.titleAlign, fontSize: `${instance.common.fontScale}em` }"
    >
      <span class="widget-frame__title-text">{{ title }}</span>
    </div>

    <span
      v-if="sourceState !== null"
      class="widget-frame__source"
      :class="`is-${sourceState}`"
      :data-testid="`widget-source-status-${instance.id}`"
      :data-state="sourceState"
      :title="sourceStateLabel"
      aria-hidden="true"
    />

    <div ref="contentRef" class="widget-frame__content">
      <div v-if="renderError" class="widget-frame__error" role="alert">
        <span class="widget-frame__error-text">组件出错：{{ renderError }}</span>
        <UiButton size="sm" @click="reload">重新加载</UiButton>
      </div>

      <CustomWidgetHost
        v-else-if="customId !== null"
        :instance="instance"
        :runtime="runtime"
        :mode="mode"
        :title="title"
      />

      <div v-else-if="!definition" class="widget-frame__placeholder">
        未知组件类型：<code>{{ instance.type }}</code>
      </div>

      <component
        :is="widgetComponent ?? undefined"
        v-else
        :key="reloadKey"
        :instance="instance"
        :props="mergedProps"
        :size="contentSize"
        :mode="mode"
        :ctx="widgetCtx"
        @request-update="runtime.requestUpdate()"
      />
    </div>

    <slot name="overlay" />
  </div>
</template>

<style scoped>
.widget-frame {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-radius: var(--radius-sm);
  color: var(--text);
  /* 拖拽时不要因为内部控件而选中文本 */
  user-select: none;
}

.widget-frame.is-selected {
  box-shadow: inset 0 0 0 1px var(--accent);
}

.widget-frame.is-custom {
  --widget-custom: 1;
}

.widget-frame.flash-ok {
  box-shadow: inset 0 0 0 1px var(--ok);
}

.widget-frame.flash-danger {
  box-shadow: inset 0 0 0 1px var(--danger);
}

.widget-frame__title {
  flex: none;
  min-height: 22px;
  overflow: hidden;
  color: var(--text-dim);
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.widget-frame__title-text {
  pointer-events: none;
}

.widget-frame__source {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 7px;
  height: 7px;
  border-radius: 1px;
  background: var(--text-faint);
  box-shadow: 0 0 0 1px var(--bg-elev);
}

.widget-frame__source.is-open {
  background: var(--ok);
}

.widget-frame__source.is-closed {
  background: var(--text-faint);
}

.widget-frame__source.is-unbound {
  background: transparent;
  border: 1px dashed var(--danger);
}

.widget-frame__content {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.widget-frame__error,
.widget-frame__placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  padding: 8px;
  color: var(--text-faint);
  font-size: 12px;
  text-align: center;
}

.widget-frame__error {
  color: var(--danger);
}

.widget-frame__error-text {
  max-width: 100%;
  overflow-wrap: anywhere;
}

.widget-frame__placeholder code {
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 10px;
}
</style>
