<script setup lang="ts">
/**
 * 组件库（plan §8.10「组件库」/ §8.11）。
 *
 * 按「图表 / 数值 / 控件 / 自定义」四组列出组件：点击放在第一个空位，拖到画布上
 * 在落点放置。自定义组列出仓库中的所有控件，并提供「+ 新建」「管理…」入口；
 * 两项都打开 §8.12 的自定义控件编辑器。
 */

import { computed } from 'vue'
import { Boxes, Plus, SlidersHorizontal } from 'lucide-vue-next'

import UiButton from '@/shared/ui/components/UiButton.vue'

import {
  WIDGET_GROUP_LABELS,
  iconOf,
  listWidgetDefinitions,
  type WidgetLibraryGroup,
} from './widget-registry'
import type { WidgetDefinition } from '@/domains/dashboard/public'
import { serialCustomWidgets, type CustomWidgetIndexEntry } from './custom/custom-widget-registry'
import { openCustomWidgetEditor } from './custom/editor-state'

const emit = defineEmits<{
  create: [type: string]
}>()

const groups = computed<WidgetLibraryGroup[]>(() => {
  const definitions = listWidgetDefinitions()
  const groupOrder = ['chart', 'value', 'control'] as const
  return groupOrder.map((group) => ({
    group,
    label: WIDGET_GROUP_LABELS[group],
    items: definitions.filter((definition) => definition.group === group),
  }))
})

/** 自定义控件列表（随仓库 revision 刷新）。 */
const customItems = computed<CustomWidgetIndexEntry[]>(() => {
  void serialCustomWidgets.revision
  return [...serialCustomWidgets.index].sort((left, right) => {
    if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt
    return left.name.localeCompare(right.name, 'zh-Hans-CN')
  })
})

function descriptionOf(definition: WidgetDefinition): string {
  return definition.description.length > 0 ? definition.description : definition.title
}

function onDragStart(event: DragEvent, type: string): void {
  if (!event.dataTransfer) return
  const payload = JSON.stringify({ kind: 'widget', type })
  event.dataTransfer.setData('application/x-toolset-widget', payload)
  event.dataTransfer.setData('text/plain', payload)
  event.dataTransfer.effectAllowed = 'copy'
}

function onClick(type: string): void {
  emit('create', type)
}

function onCreateCustom(): void {
  openCustomWidgetEditor(null, { new: true })
}

function onManageCustom(): void {
  openCustomWidgetEditor()
}
</script>

<template>
  <div class="widget-library" data-testid="widget-library">
    <section v-for="group in groups" :key="group.group" class="widget-library__group">
      <h3 class="widget-library__heading">{{ group.label }}</h3>

      <p v-if="group.items.length === 0" class="widget-library__hint">该分组暂无内置组件。</p>
      <div v-else class="widget-library__grid">
        <button
          v-for="definition in group.items"
          :key="definition.type"
          class="widget-library__item"
          type="button"
          draggable="true"
          :title="descriptionOf(definition)"
          :data-testid="`library-item-${definition.type}`"
          @click="onClick(definition.type)"
          @dragstart="onDragStart($event, definition.type)"
        >
          <span class="widget-library__icon" aria-hidden="true">
            <component :is="iconOf(definition) ?? undefined" v-if="iconOf(definition)" :size="15" />
            <span v-else class="widget-library__icon-fallback" />
          </span>
          <span class="widget-library__label">{{ definition.title }}</span>
        </button>
      </div>
    </section>

    <section class="widget-library__group">
      <h3 class="widget-library__heading">{{ WIDGET_GROUP_LABELS.custom }}</h3>

      <p v-if="customItems.length === 0" class="widget-library__hint">
        还没有自定义控件，可新建或管理已有控件。
      </p>
      <div v-else class="widget-library__grid">
        <button
          v-for="item in customItems"
          :key="item.id"
          class="widget-library__item"
          type="button"
          draggable="true"
          :title="item.name"
          :data-testid="`library-item-custom:${item.id}`"
          @click="onClick(`custom:${item.id}`)"
          @dragstart="onDragStart($event, `custom:${item.id}`)"
        >
          <span class="widget-library__icon" aria-hidden="true">
            <Boxes :size="15" />
          </span>
          <span class="widget-library__label">{{ item.name }}</span>
        </button>
      </div>

      <div class="widget-library__custom-actions">
        <UiButton
          size="sm"
          variant="ghost"
          data-testid="custom-widget-library-new"
          @click="onCreateCustom"
        >
          <Plus :size="12" aria-hidden="true" />
          新建自定义控件
        </UiButton>
        <UiButton
          size="sm"
          variant="ghost"
          data-testid="custom-widget-editor-open"
          @click="onManageCustom"
        >
          <SlidersHorizontal :size="12" aria-hidden="true" />
          管理…
        </UiButton>
      </div>
    </section>
  </div>
</template>

<style scoped>
.widget-library {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.widget-library__group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.widget-library__heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
}

.widget-library__heading::after {
  content: '';
  flex: 1 1 auto;
  height: 1px;
  background: var(--border);
}

.widget-library__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  min-width: 0;
}

.widget-library__item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: var(--control-h);
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elev-2);
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: grab;
  transition:
    border-color 120ms ease,
    background-color 120ms ease;
}

.widget-library__item:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.widget-library__item:active {
  cursor: grabbing;
}

.widget-library__item:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.widget-library__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--accent);
}

.widget-library__icon-fallback {
  width: 8px;
  height: 8px;
  border: 1px solid var(--accent);
  border-radius: 1px;
}

.widget-library__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.widget-library__hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.5;
}

.widget-library__custom-actions {
  display: flex;
  flex-direction: row;
  gap: 4px;
  flex-wrap: wrap;
}
</style>
