<script setup lang="ts">
/**
 * 24 列网格画布（plan §8.10「GridCanvas」）。
 *
 * 编辑模式：网格线、拖动（标题栏或卡片）、缩放（右下 / 右 / 下手柄）、Shift+点击
 * 多选、空白拖框选、右键菜单、键盘快捷键；拖动 / 缩放过程中只更新预览（CSS transform
 * 与占位框），松开鼠标后提交一次布局。运行模式：不能拖动，组件可交互。
 *
 * 外部拖放：组件库（`application/x-toolset-widget`）与变量列表
 * （`application/x-toolset-variable`）。Pane 宽度 < 600px 时按 (y, x) 单列只读排列。
 */

import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

import {
  GRID_GAP,
  calcColumnWidth,
  gridPixelHeight,
  moveItem,
  rectToPixels,
  resizeItem,
  type Rect,
} from '@/domains/dashboard/public'
import type { Dashboard, VarRef, WidgetInstance } from '@/domains/dashboard/public'

import WidgetFrame from './WidgetFrame.vue'
import type { DashboardRuntime } from './runtime/context'
import { getWidgetDefinition } from './widget-registry'

const props = defineProps<{
  dashboard: Dashboard
  mode: 'edit' | 'run'
  selectedIds: string[]
  runtime: DashboardRuntime
}>()

const emit = defineEmits<{
  'update:selectedIds': [ids: string[]]
  'commit-layout': [rects: Rect[]]
  'create-widget': [payload: { type: string; x: number; y: number }]
  'drop-variable': [payload: { ref: VarRef; instanceId: string | null; x: number; y: number }]
  'context-action': [payload: { action: string; instanceId: string | null }]
}>()

/** 窄窗格断点（plan §8.10）。 */
const NARROW_WIDTH = 600

const WIDGET_MIME = 'application/x-toolset-widget'
const VARIABLE_MIME = 'application/x-toolset-variable'

const rootRef = ref<HTMLElement | null>(null)
const canvasWidth = ref(0)
const paneWidth = ref(0)
const narrow = computed(() => paneWidth.value > 0 && paneWidth.value < NARROW_WIDTH)

const rowHeight = computed(() => props.dashboard.rowHeight)
const columnWidth = computed(() => calcColumnWidth(Math.max(canvasWidth.value, 0)))

const baseRects = computed<Rect[]>(() =>
  props.dashboard.widgets.map((widget) => {
    const definition = getWidgetDefinition(widget.type)
    const rect: Rect = {
      id: widget.id,
      x: widget.x,
      y: widget.y,
      w: widget.w,
      h: widget.h,
    }
    // 组件定义的最小尺寸交给 resizeItem 使用（plan §6.9 / §8.11）。
    if (definition) {
      rect.minW = definition.minSize.w
      rect.minH = definition.minSize.h
    }
    return rect
  }),
)

const previewRects = shallowRef<Rect[]>(baseRects.value.map((rect) => ({ ...rect })))

const sortedWidgets = computed(() => {
  return [...props.dashboard.widgets].sort((left, right) => {
    if (left.y !== right.y) return left.y - right.y
    if (left.x !== right.x) return left.x - right.x
    return left.id < right.id ? -1 : 1
  })
})

/* ------------------------------------------------------------------------- */
/* 像素换算                                                                    */
/* ------------------------------------------------------------------------- */

const grid = computed(() => ({
  columnWidth: columnWidth.value,
  rowHeight: rowHeight.value,
}))

function pixelsOf(rect: Rect): { left: number; top: number; width: number; height: number } {
  return rectToPixels(rect, grid.value)
}

const gridRows = computed(() => {
  let rows = 0
  for (const rect of previewRects.value) rows = Math.max(rows, rect.y + rect.h)
  return Math.max(rows + 2, 8)
})

const gridHeight = computed(() => gridPixelHeight(gridRows.value, rowHeight.value))

const gridStyle = computed(() => {
  const stepX = columnWidth.value + GRID_GAP
  const stepY = rowHeight.value + GRID_GAP
  if (props.mode !== 'edit' && !narrow.value) {
    return { minHeight: `${gridHeight.value}px`, backgroundImage: 'none' }
  }
  return {
    minHeight: `${gridHeight.value}px`,
    backgroundSize: `${stepX}px ${stepY}px`,
    backgroundImage:
      'linear-gradient(to right, var(--grid-line) 1px, transparent 1px), linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px)',
  }
})

interface DisplayItem {
  instance: WidgetInstance
  style: Record<string, string>
  dragging: boolean
}

const displayItems = computed<DisplayItem[]>(() => {
  const previewById = new Map(previewRects.value.map((rect) => [rect.id, rect]))
  return sortedWidgets.value.map((widget) => {
    const rect = previewById.get(widget.id) ?? {
      id: widget.id,
      x: widget.x,
      y: widget.y,
      w: widget.w,
      h: widget.h,
    }
    const currentDrag = drag.value
    const isDragging =
      currentDrag !== null &&
      currentDrag.moved &&
      currentDrag.kind === 'move' &&
      currentDrag.id === widget.id
    const pixelRect = isDragging ? pixelsOf(currentDrag.originRect) : pixelsOf(rect)
    const style: Record<string, string> = {
      left: `${pixelRect.left}px`,
      top: `${pixelRect.top}px`,
      width: `${pixelRect.width}px`,
      height: `${pixelRect.height}px`,
    }
    if (isDragging) {
      style.transform = `translate(${currentDrag.offsetX}px, ${currentDrag.offsetY}px)`
      style.zIndex = '30'
    }
    return { instance: widget, style, dragging: isDragging }
  })
})

/* ------------------------------------------------------------------------- */
/* 拖动 / 缩放                                                                 */
/* ------------------------------------------------------------------------- */

interface DragState {
  kind: 'move' | 'resize'
  id: string
  edge: 'se' | 'e' | 's'
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  moved: boolean
  originRect: Rect
  baseRects: Rect[]
}

const drag = shallowRef<DragState | null>(null)

watch(
  baseRects,
  (rects) => {
    if (drag.value === null) previewRects.value = rects.map((rect) => ({ ...rect }))
  },
  { immediate: true, deep: true },
)

const placeholderRect = computed<Rect | null>(() => {
  const current = drag.value
  if (!current?.moved) return null
  return previewRects.value.find((rect) => rect.id === current.id) ?? null
})

const placeholderStyle = computed(() => {
  const rect = placeholderRect.value
  if (!rect) return null
  const pixel = pixelsOf(rect)
  return {
    left: `${pixel.left}px`,
    top: `${pixel.top}px`,
    width: `${pixel.width}px`,
    height: `${pixel.height}px`,
  }
})

const DRAG_THRESHOLD = 3

function beginMove(event: PointerEvent, instance: WidgetInstance): void {
  if (props.mode !== 'edit' || narrow.value) return
  event.preventDefault()
  event.stopPropagation()
  rootRef.value?.focus()

  const selected = props.selectedIds
  if (event.shiftKey) {
    const next = selected.includes(instance.id)
      ? selected.filter((id) => id !== instance.id)
      : [...selected, instance.id]
    emit('update:selectedIds', next)
    return
  }
  if (!selected.includes(instance.id)) {
    emit('update:selectedIds', [instance.id])
  }

  startDrag(
    'move',
    event,
    instance,
    previewRects.value.find((rect) => rect.id === instance.id),
  )
}

function beginResize(event: PointerEvent, instance: WidgetInstance, edge: 'se' | 'e' | 's'): void {
  if (props.mode !== 'edit' || narrow.value) return
  event.preventDefault()
  event.stopPropagation()
  rootRef.value?.focus()
  if (!props.selectedIds.includes(instance.id)) {
    emit('update:selectedIds', [instance.id])
  }
  startDrag(
    'resize',
    event,
    instance,
    previewRects.value.find((rect) => rect.id === instance.id),
    edge,
  )
}

function startDrag(
  kind: 'move' | 'resize',
  event: PointerEvent,
  instance: WidgetInstance,
  rect: Rect | undefined,
  edge: 'se' | 'e' | 's' = 'se',
): void {
  if (!rect) return
  drag.value = {
    kind,
    id: instance.id,
    edge,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: 0,
    offsetY: 0,
    moved: false,
    originRect: { ...rect },
    baseRects: previewRects.value.map((item) => ({ ...item })),
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
}

function onPointerMove(event: PointerEvent): void {
  const current = drag.value
  if (!current) return
  const dx = event.clientX - current.startX
  const dy = event.clientY - current.startY
  if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return

  const stepX = columnWidth.value + GRID_GAP
  const stepY = rowHeight.value + GRID_GAP

  if (current.kind === 'move') {
    const next: DragState = {
      ...current,
      moved: true,
      offsetX: dx,
      offsetY: dy,
    }
    drag.value = next
    const gridDx = stepX > 0 ? Math.round(dx / stepX) : 0
    const gridDy = stepY > 0 ? Math.round(dy / stepY) : 0
    previewRects.value = moveItem(
      current.baseRects,
      current.id,
      current.originRect.x + gridDx,
      current.originRect.y + gridDy,
    )
    return
  }

  const next: DragState = { ...current, moved: true, offsetX: dx, offsetY: dy }
  drag.value = next
  const columns = stepX > 0 ? Math.round(dx / stepX) : 0
  const rows = stepY > 0 ? Math.round(dy / stepY) : 0
  const width =
    current.edge === 's' ? current.originRect.w : Math.max(1, current.originRect.w + columns)
  const height =
    current.edge === 'e' ? current.originRect.h : Math.max(1, current.originRect.h + rows)
  previewRects.value = resizeItem(current.baseRects, current.id, width, height)
}

function endDragListeners(): void {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
}

function onPointerUp(): void {
  const current = drag.value
  endDragListeners()
  drag.value = null
  if (!current?.moved) {
    previewRects.value = baseRects.value.map((rect) => ({ ...rect }))
    return
  }
  const next = previewRects.value.map((rect) => ({ ...rect }))
  emit('commit-layout', next)
}

function onPointerCancel(): void {
  endDragListeners()
  drag.value = null
  previewRects.value = baseRects.value.map((rect) => ({ ...rect }))
}

/* ------------------------------------------------------------------------- */
/* 框选                                                                        */
/* ------------------------------------------------------------------------- */

interface MarqueeState {
  startX: number
  startY: number
  currentX: number
  currentY: number
  additive: boolean
}

const marquee = shallowRef<MarqueeState | null>(null)

const marqueeStyle = computed(() => {
  const current = marquee.value
  if (!current) return null
  const left = Math.min(current.startX, current.currentX)
  const top = Math.min(current.startY, current.currentY)
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${Math.abs(current.currentX - current.startX)}px`,
    height: `${Math.abs(current.currentY - current.startY)}px`,
  }
})

function onBackgroundPointerDown(event: PointerEvent): void {
  if (props.mode !== 'edit' || narrow.value) return
  if (event.target !== event.currentTarget) return
  event.preventDefault()
  rootRef.value?.focus()
  const root = rootRef.value
  if (!root) return
  const bounds = root.getBoundingClientRect()
  marquee.value = {
    startX: event.clientX - bounds.left,
    startY: event.clientY - bounds.top,
    currentX: event.clientX - bounds.left,
    currentY: event.clientY - bounds.top,
    additive: event.shiftKey,
  }
  window.addEventListener('pointermove', onMarqueeMove)
  window.addEventListener('pointerup', onMarqueeUp)
  window.addEventListener('pointercancel', onMarqueeCancel)
}

function onMarqueeMove(event: PointerEvent): void {
  const current = marquee.value
  const root = rootRef.value
  if (!current || !root) return
  const bounds = root.getBoundingClientRect()
  marquee.value = {
    ...current,
    currentX: event.clientX - bounds.left,
    currentY: event.clientY - bounds.top,
  }
}

function onMarqueeUp(): void {
  const current = marquee.value
  window.removeEventListener('pointermove', onMarqueeMove)
  window.removeEventListener('pointerup', onMarqueeUp)
  window.removeEventListener('pointercancel', onMarqueeCancel)
  marquee.value = null
  if (!current) return
  const left = Math.min(current.startX, current.currentX)
  const top = Math.min(current.startY, current.currentY)
  const width = Math.abs(current.currentX - current.startX)
  const height = Math.abs(current.currentY - current.startY)
  if (width < 4 || height < 4) {
    if (!current.additive) emit('update:selectedIds', [])
    return
  }
  const hits: string[] = []
  for (const rect of previewRects.value) {
    const pixel = pixelsOf(rect)
    const intersect =
      pixel.left < left + width &&
      left < pixel.left + pixel.width &&
      pixel.top < top + height &&
      top < pixel.top + pixel.height
    if (intersect) hits.push(rect.id)
  }
  const next = current.additive ? [...new Set([...props.selectedIds, ...hits])] : hits
  emit('update:selectedIds', next)
}

function onMarqueeCancel(): void {
  window.removeEventListener('pointermove', onMarqueeMove)
  window.removeEventListener('pointerup', onMarqueeUp)
  window.removeEventListener('pointercancel', onMarqueeCancel)
  marquee.value = null
}

/* ------------------------------------------------------------------------- */
/* 外部拖放（组件库 / 变量列表）                                                */
/* ------------------------------------------------------------------------- */

interface DropPreview {
  x: number
  y: number
  w: number
  h: number
  kind: 'widget' | 'variable'
  targetId: string | null
}

const dropPreview = shallowRef<DropPreview | null>(null)

const dropPreviewStyle = computed(() => {
  const current = dropPreview.value
  if (!current) return null
  const pixel = pixelsOf({ id: 'drop', x: current.x, y: current.y, w: current.w, h: current.h })
  return {
    left: `${pixel.left}px`,
    top: `${pixel.top}px`,
    width: `${pixel.width}px`,
    height: `${pixel.height}px`,
  }
})

function cellAt(event: DragEvent): { x: number; y: number } {
  const root = rootRef.value
  if (!root) return { x: 0, y: 0 }
  const bounds = root.getBoundingClientRect()
  const stepX = columnWidth.value + GRID_GAP
  const stepY = rowHeight.value + GRID_GAP
  const x = Math.floor((event.clientX - bounds.left - GRID_GAP) / Math.max(1, stepX))
  const y = Math.floor((event.clientY - bounds.top - GRID_GAP) / Math.max(1, stepY))
  return {
    x: Math.min(24, Math.max(0, x)),
    y: Math.max(0, y),
  }
}

function widgetAt(event: DragEvent): WidgetInstance | null {
  const root = rootRef.value
  if (!root) return null
  const bounds = root.getBoundingClientRect()
  const px = event.clientX - bounds.left
  const py = event.clientY - bounds.top
  for (let index = previewRects.value.length - 1; index >= 0; index -= 1) {
    const rect = previewRects.value[index]
    if (!rect) continue
    const pixel = pixelsOf(rect)
    if (
      px >= pixel.left &&
      px <= pixel.left + pixel.width &&
      py >= pixel.top &&
      py <= pixel.top + pixel.height
    ) {
      return props.dashboard.widgets.find((widget) => widget.id === rect.id) ?? null
    }
  }
  return null
}

function readDragPayload(
  event: DragEvent,
): { kind: string; type?: string; source?: string; key?: string } | null {
  const transfer = event.dataTransfer
  if (!transfer) return null
  const raw = transfer.getData(WIDGET_MIME) || transfer.getData(VARIABLE_MIME)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as {
      kind?: unknown
      type?: unknown
      source?: unknown
      key?: unknown
    }
    return {
      kind: typeof parsed.kind === 'string' ? parsed.kind : '',
      ...(typeof parsed.type === 'string' ? { type: parsed.type } : {}),
      ...(typeof parsed.source === 'string' ? { source: parsed.source } : {}),
      ...(typeof parsed.key === 'string' ? { key: parsed.key } : {}),
    }
  } catch {
    return null
  }
}

function onDragOver(event: DragEvent): void {
  if (narrow.value) return
  const payload = readDragPayload(event)
  if (!payload) return
  event.preventDefault()
  const cell = cellAt(event)
  if (payload.kind === 'widget' && typeof payload.type === 'string') {
    const definition = getWidgetDefinition(payload.type)
    const w = definition?.defaultSize.w ?? 6
    const h = definition?.defaultSize.h ?? 4
    dropPreview.value = {
      x: Math.min(24 - w, cell.x),
      y: cell.y,
      w,
      h,
      kind: 'widget',
      targetId: null,
    }
    return
  }
  if (payload.kind === 'variable') {
    const target = widgetAt(event)
    dropPreview.value = {
      x: cell.x,
      y: cell.y,
      w: target?.w ?? 12,
      h: target?.h ?? 8,
      kind: 'variable',
      targetId: target?.id ?? null,
    }
  }
}

function onDragLeave(event: DragEvent): void {
  const root = rootRef.value
  if (!root) return
  if (event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) return
  dropPreview.value = null
}

function onDrop(event: DragEvent): void {
  if (narrow.value) return
  const payload = readDragPayload(event)
  dropPreview.value = null
  if (!payload) return
  event.preventDefault()
  const cell = cellAt(event)
  if (payload.kind === 'widget' && typeof payload.type === 'string') {
    emit('create-widget', { type: payload.type, x: cell.x, y: cell.y })
    return
  }
  if (
    payload.kind === 'variable' &&
    typeof payload.source === 'string' &&
    typeof payload.key === 'string'
  ) {
    const target = widgetAt(event)
    emit('drop-variable', {
      ref: { source: payload.source, key: payload.key },
      instanceId: target?.id ?? null,
      x: cell.x,
      y: cell.y,
    })
  }
}

/* ------------------------------------------------------------------------- */
/* 右键菜单                                                                    */
/* ------------------------------------------------------------------------- */

interface ContextMenuState {
  open: boolean
  x: number
  y: number
  instanceId: string | null
}

const contextMenu = ref<ContextMenuState>({ open: false, x: 0, y: 0, instanceId: null })

const contextActions = computed(() => {
  const instance = contextMenu.value.instanceId
    ? props.dashboard.widgets.find((widget) => widget.id === contextMenu.value.instanceId)
    : undefined
  const items = [
    { action: 'copy', label: '复制' },
    { action: 'paste', label: '粘贴' },
    { action: 'duplicate', label: '创建副本' },
    { action: 'delete', label: '删除' },
    { action: 'to-top', label: '置于顶部行' },
  ]
  if (instance && instance.type.startsWith('custom:')) {
    items.push({ action: 'save-as-custom', label: '另存为自定义控件模板' })
  }
  return items
})

function onItemContextMenu(event: MouseEvent, instance: WidgetInstance): void {
  if (props.mode !== 'edit' || narrow.value) return
  event.preventDefault()
  if (!props.selectedIds.includes(instance.id)) emit('update:selectedIds', [instance.id])
  contextMenu.value = {
    open: true,
    x: event.clientX,
    y: event.clientY,
    instanceId: instance.id,
  }
}

function onCanvasContextMenu(event: MouseEvent): void {
  if (event.target !== event.currentTarget) return
  if (props.mode !== 'edit') return
  event.preventDefault()
  contextMenu.value = { open: true, x: event.clientX, y: event.clientY, instanceId: null }
}

function closeContextMenu(): void {
  if (contextMenu.value.open) contextMenu.value = { ...contextMenu.value, open: false }
}

function onContextAction(action: string): void {
  const instanceId = contextMenu.value.instanceId
  closeContextMenu()
  emit('context-action', { action, instanceId })
}

/* ------------------------------------------------------------------------- */
/* 键盘快捷键（plan §8.9）                                                     */
/* ------------------------------------------------------------------------- */

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest('input, textarea, select, [contenteditable="true"]') !== null
}

function moveSelection(dx: number, dy: number): void {
  if (props.mode !== 'edit' || narrow.value) return
  const id = props.selectedIds[0]
  if (!id) return
  const rect = previewRects.value.find((item) => item.id === id)
  if (!rect) return
  const next = moveItem(previewRects.value, id, rect.x + dx, rect.y + dy)
  emit('commit-layout', next)
}

function resizeSelection(dw: number, dh: number): void {
  if (props.mode !== 'edit' || narrow.value) return
  const id = props.selectedIds[0]
  if (!id) return
  const rect = previewRects.value.find((item) => item.id === id)
  if (!rect) return
  const next = resizeItem(previewRects.value, id, rect.w + dw, rect.h + dh)
  emit('commit-layout', next)
}

function onKeyDown(event: KeyboardEvent): void {
  if (props.mode !== 'edit' || narrow.value) return
  if (isEditableTarget(event.target)) return
  const root = rootRef.value
  const active = typeof document === 'undefined' ? null : document.activeElement
  if (!root || !(active instanceof Node) || !root.contains(active)) return

  if (event.key === 'Escape') {
    contextMenu.value = { ...contextMenu.value, open: false }
    emit('update:selectedIds', [])
    return
  }
  if (contextMenu.value.open) return

  const command = event.ctrlKey || event.metaKey
  if (command) {
    const key = event.key.toLowerCase()
    if (key === 'z') {
      event.preventDefault()
      emit('context-action', { action: event.shiftKey ? 'redo' : 'undo', instanceId: null })
      return
    }
    if (key === 'y') {
      event.preventDefault()
      emit('context-action', { action: 'redo', instanceId: null })
      return
    }
    if (key === 'c') {
      event.preventDefault()
      emit('context-action', { action: 'copy', instanceId: props.selectedIds[0] ?? null })
      return
    }
    if (key === 'v') {
      event.preventDefault()
      emit('context-action', { action: 'paste', instanceId: null })
      return
    }
    if (key === 'd') {
      event.preventDefault()
      emit('context-action', {
        action: 'duplicate',
        instanceId: props.selectedIds[0] ?? null,
      })
      return
    }
    return
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (props.selectedIds.length === 0) return
    event.preventDefault()
    emit('context-action', { action: 'delete', instanceId: props.selectedIds[0] ?? null })
    return
  }

  const arrow = event.key
  if (
    arrow === 'ArrowLeft' ||
    arrow === 'ArrowRight' ||
    arrow === 'ArrowUp' ||
    arrow === 'ArrowDown'
  ) {
    if (props.selectedIds.length === 0) return
    event.preventDefault()
    const dx = arrow === 'ArrowLeft' ? -1 : arrow === 'ArrowRight' ? 1 : 0
    const dy = arrow === 'ArrowUp' ? -1 : arrow === 'ArrowDown' ? 1 : 0
    if (event.shiftKey) resizeSelection(dx, dy)
    else moveSelection(dx, dy)
  }
}

/* ------------------------------------------------------------------------- */
/* 生命周期                                                                    */
/* ------------------------------------------------------------------------- */

let resizeObserver: ResizeObserver | null = null

function measure(): void {
  const element = rootRef.value
  if (!element) return
  canvasWidth.value = element.clientWidth
  const paneEl = element.closest<HTMLElement>('[data-dashboard-pane]')
  paneWidth.value = paneEl ? paneEl.clientWidth : element.clientWidth
}

onMounted(() => {
  measure()
  const element = rootRef.value
  if (element && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      measure()
    })
    resizeObserver.observe(element)
    const paneEl = element.closest('[data-dashboard-pane]')
    if (paneEl && paneEl !== element) resizeObserver.observe(paneEl)
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('pointerdown', onWindowPointerDown, true)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('pointerdown', onWindowPointerDown, true)
  endDragListeners()
  onMarqueeCancel()
})

function onWindowPointerDown(event: PointerEvent): void {
  if (!contextMenu.value.open) return
  const target = event.target
  if (target instanceof Element && target.closest('[data-grid-context-menu]')) return
  closeContextMenu()
}

/* ------------------------------------------------------------------------- */
/* 窄窗格                                                                      */
/* ------------------------------------------------------------------------- */

const narrowItems = computed(() =>
  sortedWidgets.value.map((widget) => ({
    widget,
    height: widget.h * rowHeight.value + Math.max(0, widget.h - 1) * GRID_GAP,
  })),
)
</script>

<template>
  <div
    ref="rootRef"
    class="grid-canvas"
    :class="{ 'is-edit': mode === 'edit', 'is-narrow': narrow }"
    :style="narrow ? undefined : gridStyle"
    tabindex="0"
    data-testid="grid-canvas"
    @pointerdown="onBackgroundPointerDown"
    @contextmenu="onCanvasContextMenu"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    @dragenter.prevent
  >
    <p v-if="narrow" class="grid-canvas__banner" data-testid="dashboard-narrow-banner">
      窗格过窄，已切换为单列只读布局
    </p>

    <template v-if="narrow">
      <div
        v-for="item in narrowItems"
        :key="item.widget.id"
        class="grid-canvas__narrow-item"
        :style="{ height: `${item.height}px` }"
        :data-testid="`widget-${item.widget.id}`"
        :data-type="item.widget.type"
      >
        <WidgetFrame :instance="item.widget" :runtime="runtime" mode="run" :selected="false" />
      </div>
    </template>

    <template v-else>
      <div
        v-for="item in displayItems"
        :key="item.instance.id"
        class="grid-canvas__item"
        :class="{
          'is-selected': selectedIds.includes(item.instance.id),
          'is-dragging': item.dragging,
          'is-drop-target':
            dropPreview?.kind === 'variable' && dropPreview.targetId === item.instance.id,
        }"
        :style="item.style"
        :data-testid="`widget-${item.instance.id}`"
        :data-type="item.instance.type"
        @pointerdown="beginMove($event, item.instance)"
        @contextmenu="onItemContextMenu($event, item.instance)"
      >
        <WidgetFrame
          :instance="item.instance"
          :runtime="runtime"
          :mode="mode"
          :selected="selectedIds.includes(item.instance.id)"
        />

        <template v-if="mode === 'edit'">
          <div
            class="grid-canvas__handle grid-canvas__handle--se"
            :data-testid="`widget-resize-${item.instance.id}`"
            title="拖动缩放"
            @pointerdown.stop="beginResize($event, item.instance, 'se')"
          />
          <div
            class="grid-canvas__handle grid-canvas__handle--e"
            :data-testid="`widget-resize-e-${item.instance.id}`"
            @pointerdown.stop="beginResize($event, item.instance, 'e')"
          />
          <div
            class="grid-canvas__handle grid-canvas__handle--s"
            :data-testid="`widget-resize-s-${item.instance.id}`"
            @pointerdown.stop="beginResize($event, item.instance, 's')"
          />
        </template>
      </div>

      <div
        v-if="placeholderStyle"
        class="grid-canvas__placeholder"
        :style="placeholderStyle"
        data-testid="dashboard-drop-placeholder"
        aria-hidden="true"
      />

      <div
        v-if="dropPreviewStyle"
        class="grid-canvas__drop"
        :class="{ 'is-target': dropPreview?.targetId !== null && dropPreview?.kind === 'variable' }"
        :style="dropPreviewStyle"
        aria-hidden="true"
      />

      <div
        v-if="marqueeStyle"
        class="grid-canvas__marquee"
        :style="marqueeStyle"
        aria-hidden="true"
      />
    </template>

    <div
      v-if="contextMenu.open"
      class="grid-canvas__menu"
      data-grid-context-menu
      data-testid="dashboard-context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
    >
      <button
        v-for="action in contextActions"
        :key="action.action"
        class="grid-canvas__menu-item"
        type="button"
        :data-testid="`dashboard-context-${action.action}`"
        @click="onContextAction(action.action)"
      >
        {{ action.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.grid-canvas {
  --grid-line: var(--border);
  position: relative;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  outline: none;
  background-color: var(--bg-sunken);
}

.grid-canvas.is-edit {
  background-color: var(--bg);
}

.grid-canvas.is-narrow {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  overflow-y: auto;
  background: var(--bg-sunken);
}

.grid-canvas__banner {
  position: sticky;
  top: 0;
  z-index: 5;
  margin: 0 0 var(--space-2);
  padding: 4px 8px;
  border: 1px solid var(--warn);
  border-radius: var(--radius-sm);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 11px;
}

.grid-canvas__narrow-item {
  flex: none;
  width: 100%;
  min-width: 0;
}

.grid-canvas__item {
  position: absolute;
  box-sizing: border-box;
  contain: layout style;
  border-radius: var(--radius-sm);
  transition: box-shadow 120ms ease;
}

.grid-canvas__item.is-selected {
  box-shadow: 0 0 0 1px var(--accent);
}

.grid-canvas__item.is-drop-target {
  box-shadow: 0 0 0 2px var(--ok);
}

.grid-canvas.is-edit .grid-canvas__item {
  cursor: grab;
}

.grid-canvas.is-edit .grid-canvas__item.is-dragging {
  cursor: grabbing;
  opacity: 0.85;
}

.grid-canvas__item :deep(.widget-frame) {
  pointer-events: auto;
}

.grid-canvas.is-edit .grid-canvas__item > :deep(.widget-frame) {
  /* 编辑模式下卡片整体用于拖动/选中，内部控件不响应点击 */
  pointer-events: none;
}

.grid-canvas__handle {
  position: absolute;
  z-index: 4;
  background: transparent;
}

.grid-canvas__handle--se {
  right: 0;
  bottom: 0;
  width: 12px;
  height: 12px;
  cursor: nwse-resize;
  border-right: 2px solid var(--accent);
  border-bottom: 2px solid var(--accent);
  border-radius: 0 0 var(--radius-sm) 0;
}

.grid-canvas__handle--e {
  top: 12px;
  right: 0;
  bottom: 12px;
  width: 5px;
  cursor: ew-resize;
}

.grid-canvas__handle--s {
  left: 12px;
  right: 12px;
  bottom: 0;
  height: 5px;
  cursor: ns-resize;
}

.grid-canvas__handle--e:hover,
.grid-canvas__handle--s:hover {
  background: var(--accent-soft);
}

.grid-canvas__placeholder {
  position: absolute;
  z-index: 20;
  border: 1px dashed var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  pointer-events: none;
}

.grid-canvas__drop {
  position: absolute;
  z-index: 21;
  border: 1px dashed var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  pointer-events: none;
}

.grid-canvas__drop.is-target {
  border-color: var(--ok);
  background: var(--ok-soft);
}

.grid-canvas__marquee {
  position: absolute;
  z-index: 22;
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  pointer-events: none;
}

.grid-canvas__menu {
  position: fixed;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  min-width: 150px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev-2);
  box-shadow: var(--shadow-pop);
}

.grid-canvas__menu-item {
  height: var(--control-h);
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font-size: 12px;
  text-align: left;
}

.grid-canvas__menu-item:hover {
  background: var(--bg-hover);
}

.grid-canvas__menu-item:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--accent);
}
</style>
