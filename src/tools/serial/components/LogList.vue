<script setup lang="ts">
/**
 * 日志列表（plan §8.4）。
 *
 * 渲染策略：最多渲染最近 2000 条（`tail`），更早的记录通过顶部按钮用 `range()` 追加；
 * 每行使用 `content-visibility: auto`，不引入虚拟滚动库。
 *
 * `raw` / `decoded` / `both` 三种显示模式：解析模式下有解析结果的帧只显示解析行，
 * 点击可展开 / 收起原始数据；错误帧与未成帧数据各有独立标记。
 */

import {
  computed,
  markRaw,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'

import { type LogEntriesEvent, type LogEntry, type Origin } from '@/domains/link/public'
import { toHex } from '@/domains/bytes/public'
import { formatTimestamp } from '@/shared/lib/format'

import { serialLayout, type PaneViewSettings } from '../stores/layout'
import { getSessionInstance } from '../stores/sessions'

/** 同时渲染的最大条数（plan §8.4）。 */
const RENDER_LIMIT = 2000
/** 超过该字节数的记录会截断显示。 */
const MAX_CONTENT_BYTES = 1024
/** 距底部多少像素内视为「在底部」。 */
const BOTTOM_THRESHOLD = 32
const TEXT_ENCODER = new TextEncoder()

interface CachedEntryRows {
  key: string
  decoded: LogEntry['decoded']
  rows: LogDisplayRow[]
}

const entryRowCache = new WeakMap<LogEntry, CachedEntryRows>()

const props = defineProps<{
  sessionId: string | null
  paneIndex: number
  search: string
  paused: boolean
}>()

interface ContentSegment {
  text: string
  control: boolean
}

interface LogDisplayRow {
  key: string
  kind: 'raw' | 'decoded'
  entry: LogEntry
  /** Raw 行内容片段（控制字符单独着色）。 */
  segments: ContentSegment[]
  truncated: boolean
  totalBytes: number
  /** Decoded 行摘要（含缩进前缀）。 */
  summary: string
  /** Raw 行尾提示（如「未成帧数据」）。 */
  hint: string
  /** Decoded 行是否可点击展开原始数据。 */
  expandable: boolean
  level: 'info' | 'warn' | 'error'
}

const paneSettings = computed<PaneViewSettings>(
  () => serialLayout.panes[props.paneIndex] ?? serialLayout.panes[0],
)
const showTimestamp = computed(() => paneSettings.value.showTimestamp)
const displayMode = computed(() => paneSettings.value.displayMode)

const session = computed(() => getSessionInstance(props.sessionId))

const containerRef = ref<HTMLElement | null>(null)
const containerHeight = ref(0)
const viewportScrollTop = ref(0)
const measuredRowHeight = ref(0)
const rows = shallowRef<LogEntry[]>([])
const olderLoaded = ref(0)
const atBottom = ref(true)
const dirty = ref(false)
/** 解析模式下被展开原始数据的条目 seq。 */
const expandedSeqs = ref<number[]>([])
const hasExpanded = computed(() => expandedSeqs.value.length > 0)

function isExpanded(seq: number): boolean {
  return expandedSeqs.value.includes(seq)
}

function toggleExpanded(seq: number): void {
  expandedSeqs.value = isExpanded(seq)
    ? expandedSeqs.value.filter((item) => item !== seq)
    : [...expandedSeqs.value, seq]
}

const ORIGIN_LABELS: Record<Origin, string> = {
  manual: '',
  quick: '快捷',
  repeat: '定时',
  macro: '宏',
  protocol: '协议',
  bridge: '转发',
  widget: '控件',
  device: '设备',
}

function directionLabel(entry: LogEntry): string {
  if (entry.dir === 'rx') return 'RX'
  if (entry.dir === 'system') return 'SYS'
  const origin = entry.origin === undefined ? '' : ORIGIN_LABELS[entry.origin]
  return origin.length > 0 ? `TX·${origin}` : 'TX'
}

function escapeSegments(text: string): ContentSegment[] {
  const segments: ContentSegment[] = []
  let buffer = ''
  function flush(): void {
    if (buffer.length === 0) return
    segments.push({ text: buffer, control: false })
    buffer = ''
  }
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    let escaped: string | null = null
    if (char === '\r') escaped = '\\r'
    else if (char === '\n') escaped = '\\n'
    else if (char === '\t') escaped = '\\t'
    else if (code < 0x20 || code === 0x7f) {
      escaped = `\\x${code.toString(16).padStart(2, '0').toUpperCase()}`
    }
    if (escaped !== null) {
      flush()
      segments.push({ text: escaped, control: true })
    } else {
      buffer += char
    }
  }
  flush()
  return segments
}

function byteLength(text: string): number {
  return TEXT_ENCODER.encode(text).length
}

function truncateText(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text
  let used = 0
  let result = ''
  for (const char of text) {
    const size = byteLength(char)
    if (used + size > maxBytes) break
    result += char
    used += size
  }
  return result
}

function buildRawRow(entry: LogEntry, suffix: string, hint = ''): LogDisplayRow {
  const settings = paneSettings.value
  if (entry.dir === 'system') {
    return {
      key: `raw-${String(entry.seq)}${suffix}`,
      kind: 'raw',
      entry,
      segments: escapeSegments(entry.text),
      truncated: false,
      totalBytes: entry.bytes.length,
      summary: '',
      hint: '',
      expandable: false,
      level: entry.level,
    }
  }
  const totalBytes = entry.bytes.length
  const truncated = totalBytes > MAX_CONTENT_BYTES
  if (settings.viewAs === 'hex') {
    const bytes = truncated ? entry.bytes.subarray(0, MAX_CONTENT_BYTES) : entry.bytes
    return {
      key: `raw-${String(entry.seq)}${suffix}`,
      kind: 'raw',
      entry,
      segments: [{ text: toHex(bytes), control: false }],
      truncated,
      totalBytes,
      summary: '',
      hint,
      expandable: false,
      level: entry.level,
    }
  }
  const text = truncated ? truncateText(entry.text, MAX_CONTENT_BYTES) : entry.text
  return {
    key: `raw-${String(entry.seq)}${suffix}`,
    kind: 'raw',
    entry,
    segments: escapeSegments(text),
    truncated,
    totalBytes,
    summary: '',
    hint,
    expandable: false,
    level: entry.level,
  }
}

function formatDecodedSummary(result: {
  summary: string
  fields?: Array<{ label: string; value: string | number | boolean; unit?: string }>
}): string {
  const parts: string[] = []
  if (result.summary.length > 0) parts.push(result.summary)
  for (const field of result.fields ?? []) {
    parts.push(`${field.label}=${String(field.value)}${field.unit ?? ''}`)
  }
  return parts.join('  ')
}

function buildRows(entries: LogEntry[]): LogDisplayRow[] {
  const settings = paneSettings.value
  const result: LogDisplayRow[] = []

  function buildDecodedRow(
    entry: LogEntry,
    text: string,
    level: 'info' | 'warn' | 'error',
    suffix: string,
    prefix: string,
    expandable = false,
  ): LogDisplayRow {
    return {
      key: `decoded-${String(entry.seq)}-${suffix}`,
      kind: 'decoded',
      entry,
      segments: [],
      truncated: false,
      totalBytes: entry.bytes.length,
      summary: `${prefix}${text}`,
      hint: '',
      expandable,
      level,
    }
  }

  const isDecodedMode = settings.displayMode === 'decoded'
  const expandedSet =
    isDecodedMode && expandedSeqs.value.length > 0 ? new Set(expandedSeqs.value) : null
  const baseKey = `${settings.viewAs}|${settings.displayMode}|`
  const expandedKey = `${baseKey}1`

  for (const entry of entries) {
    if (!settings.showTx && entry.dir === 'tx') continue
    if (!settings.showSystem && entry.dir === 'system') continue
    if (!settings.showBridge && entry.origin === 'bridge') continue

    const expanded = expandedSet !== null && expandedSet.has(entry.seq)
    const cacheKey = expanded ? expandedKey : baseKey
    const cached = entryRowCache.get(entry)
    if (cached !== undefined && cached.key === cacheKey && cached.decoded === entry.decoded) {
      for (const row of cached.rows) result.push(row)
      continue
    }

    const built: LogDisplayRow[] = []
    const pushBuiltDecoded = (
      summary: string,
      level: 'info' | 'warn' | 'error',
      suffix: string,
      prefix: string,
      expandable = false,
    ): void => {
      built.push(markRaw(buildDecodedRow(entry, summary, level, suffix, prefix, expandable)))
    }

    const decoded = entry.decoded
    const system = entry.dir === 'system'

    if (settings.displayMode === 'raw' || system || decoded === undefined) {
      built.push(markRaw(buildRawRow(entry, '')))
    } else {
      const results = decoded.results
      const error = decoded.error
      const unframed = decoded.unframed === true

      if (settings.displayMode === 'decoded') {
        if (unframed) {
          pushBuiltDecoded('未成帧数据', 'warn', 'unframed', '')
        } else if (error !== undefined) {
          built.push(markRaw(buildRawRow(entry, '', '（解码错误）')))
          pushBuiltDecoded(error, 'error', 'error', '')
        } else if (results.length > 0) {
          if (expanded) built.push(markRaw(buildRawRow(entry, '')))
          results.forEach((item, index) => {
            pushBuiltDecoded(
              formatDecodedSummary(item),
              item.level ?? 'info',
              String(index),
              '',
              true,
            )
          })
        } else {
          built.push(markRaw(buildRawRow(entry, '')))
        }
      } else {
        built.push(markRaw(buildRawRow(entry, '', unframed ? '（未成帧数据）' : '')))
        results.forEach((item, index) => {
          pushBuiltDecoded(
            formatDecodedSummary(item),
            item.level ?? 'info',
            String(index),
            '',
            false,
          )
        })
        if (unframed) pushBuiltDecoded('未成帧数据', 'warn', 'unframed', '')
        else if (error !== undefined) pushBuiltDecoded(error, 'error', 'error', '')
      }
    }

    entryRowCache.set(entry, { key: cacheKey, decoded: entry.decoded, rows: built })
    for (const row of built) result.push(row)
  }
  return result
}

interface SearchState {
  entries: LogEntry[]
  count: number
  limited: boolean
  error: string
}

function regexMatcher(
  pattern: string,
  flags: string,
): { test: (value: string) => boolean } | { error: string } {
  let regex: RegExp
  try {
    regex = new RegExp(pattern, flags)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { error: `正则表达式无效：${message}` }
  }
  return {
    test: (value: string) => {
      regex.lastIndex = 0
      return regex.test(value)
    },
  }
}

function buildMatcher(query: string): { test: (value: string) => boolean } | { error: string } {
  if (!query.startsWith('/')) {
    const needle = query.toLowerCase()
    return { test: (value: string) => value.toLowerCase().includes(needle) }
  }
  const raw = query.slice(1)
  const lastSlash = raw.lastIndexOf('/')
  if (lastSlash > 0) {
    const flags = raw.slice(lastSlash + 1)
    if (/^[dgimsuvy]*$/.test(flags)) {
      return regexMatcher(raw.slice(0, lastSlash), flags.length > 0 ? flags : 'i')
    }
  }
  return regexMatcher(raw, 'i')
}

function entryMatches(entry: LogEntry, test: (value: string) => boolean): boolean {
  if (test(entry.text)) return true
  const decoded = entry.decoded
  if (decoded !== undefined) {
    if (decoded.error !== undefined && test(decoded.error)) return true
    for (const result of decoded.results) {
      if (test(formatDecodedSummary(result))) return true
      if (test(result.summary)) return true
    }
  }
  if (entry.dir !== 'system' && entry.bytes.length > 0 && test(toHex(entry.bytes))) return true
  return false
}

const searchState = computed<SearchState | null>(() => {
  const query = props.search.trim()
  // 依赖日志行引用，日志变化时重新执行搜索。
  void rows.value
  if (query.length === 0) return null
  const matcher = buildMatcher(query)
  if ('error' in matcher) {
    return { entries: [], count: 0, limited: false, error: matcher.error }
  }
  const buffer = session.value?.log
  if (!buffer) return { entries: [], count: 0, limited: false, error: '' }
  const matched = buffer.search((entry) => entryMatches(entry, matcher.test), RENDER_LIMIT + 1)
  const limited = matched.length > RENDER_LIMIT
  const entries = matched.slice(0, RENDER_LIMIT).reverse()
  return { entries, count: matched.length, limited, error: '' }
})

const displayRows = computed<LogDisplayRow[]>(() => {
  const state = searchState.value
  if (state !== null) return buildRows(state.entries)
  return buildRows(rows.value)
})

const virtualWindow = computed(() => {
  const all = displayRows.value
  const height = containerHeight.value
  if (height <= 0 || all.length <= 120) {
    return { rows: all, topPad: 0, bottomPad: 0 }
  }
  const rowH =
    measuredRowHeight.value > 0
      ? measuredRowHeight.value
      : Math.round(paneSettings.value.fontSize * 1.45) + 2
  const total = all.length
  const overscan = 15
  const visibleCount = Math.ceil(height / rowH) + overscan * 2
  const rawStart = Math.floor(viewportScrollTop.value / rowH) - overscan
  const start = Math.max(0, Math.min(Math.max(0, total - visibleCount), rawStart))
  const end = Math.min(total, start + visibleCount)
  return {
    rows: all.slice(start, end),
    topPad: start * rowH,
    bottomPad: (total - end) * rowH,
  }
})

const hasEarlier = computed(() => {
  if (searchState.value !== null) return false
  const buffer = session.value?.log
  const first = rows.value[0]
  if (!buffer || !first) return false
  return first.seq > buffer.firstSeq
})

const searchNotice = computed(() => {
  const state = searchState.value
  if (state === null) return ''
  if (state.error.length > 0) return state.error
  const count = state.limited ? `${String(state.count)}+` : String(state.count)
  return `找到 ${count} 条（最多显示 ${String(RENDER_LIMIT)} 条）`
})

function reload(): void {
  const buffer = session.value?.log
  rows.value = buffer ? buffer.tail(RENDER_LIMIT) : []
  olderLoaded.value = 0
  atBottom.value = true
  scrollToBottomSoon()
}

function loadEarlier(): void {
  const buffer = session.value?.log
  const first = rows.value[0]
  if (!buffer || !first) return
  const from = Math.max(buffer.firstSeq, first.seq - RENDER_LIMIT)
  const earlier = buffer.range(from, RENDER_LIMIT).filter((entry) => entry.seq < first.seq)
  if (earlier.length === 0) return
  rows.value = [...earlier, ...rows.value]
  olderLoaded.value += earlier.length
}

function handleEntries(payload: LogEntriesEvent): void {
  if (props.paused) {
    dirty.value = true
    return
  }
  const updated = payload.updated ?? []
  if (payload.added.length === 0 && updated.length === 0) {
    // `clearLog()` 发出的空事件：两个 Pane 同步清空。
    rows.value = []
    olderLoaded.value = 0
    return
  }
  let next = rows.value
  if (payload.added.length > 0) {
    const maxEntries = session.value?.log.maxEntries ?? RENDER_LIMIT
    const capacity = Math.min(RENDER_LIMIT, maxEntries) + olderLoaded.value
    let combined = next.concat(payload.added)
    if (combined.length > capacity) combined = combined.slice(combined.length - capacity)
    next = combined
  }
  // 条目对象由 LogBuffer 原地回填（decoded），重新赋值数组触发重渲染。
  rows.value = updated.length > 0 ? next.slice() : next
}

let unsubscribeEntries: (() => void) | null = null

function attachSession(): void {
  if (unsubscribeEntries !== null) {
    unsubscribeEntries()
    unsubscribeEntries = null
  }
  rows.value = []
  olderLoaded.value = 0
  dirty.value = false
  const current = session.value
  if (!current) {
    atBottom.value = true
    return
  }
  unsubscribeEntries = current.on('entries', handleEntries)
  reload()
}

let skipNextScrollEvent = false
let resizeObserver: ResizeObserver | null = null

function syncRowHeight(element: HTMLElement): void {
  if (measuredRowHeight.value > 0) return
  const firstRow = element.querySelector<HTMLElement>('.log-list__row')
  if (firstRow !== null) {
    const height = firstRow.getBoundingClientRect().height
    if (height > 0) measuredRowHeight.value = height
  }
}

function handleContainerScroll(): void {
  const element = containerRef.value
  if (element) viewportScrollTop.value = element.scrollTop
  if (skipNextScrollEvent) {
    skipNextScrollEvent = false
    return
  }
  updateAtBottom()
}

function updateAtBottom(): void {
  const element = containerRef.value
  if (!element) return
  atBottom.value =
    element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD
}

let scrollFrameId: number | null = null

function scrollToBottomSoon(): void {
  if (scrollFrameId !== null) return
  const applyScroll = (): void => {
    const element = containerRef.value
    if (!element) return
    syncRowHeight(element)
    const prevTop = element.scrollTop
    element.scrollTop = element.scrollHeight
    if (element.scrollTop !== prevTop) skipNextScrollEvent = true
    viewportScrollTop.value = element.scrollTop
    atBottom.value = true
  }
  if (typeof requestAnimationFrame !== 'function') {
    void nextTick(applyScroll)
    return
  }
  scrollFrameId = requestAnimationFrame(() => {
    scrollFrameId = null
    applyScroll()
  })
}

function jumpToBottom(): void {
  scrollToBottomSoon()
}

watch(() => props.sessionId, attachSession, { immediate: true })

watch(
  () => props.paused,
  (paused) => {
    if (paused) return
    if (dirty.value) {
      reload()
      dirty.value = false
    }
  },
)

watch(rows, () => {
  if (props.paused) return
  const settings = paneSettings.value
  if (settings.autoScroll && atBottom.value) scrollToBottomSoon()
  else if (!atBottom.value) updateAtBottom()
})

watch(
  () => paneSettings.value.displayMode,
  () => {
    // 显示模式变化后保持贴底。
    if (paneSettings.value.autoScroll && atBottom.value) scrollToBottomSoon()
  },
)

watch(
  () => paneSettings.value.fontSize,
  () => {
    measuredRowHeight.value = 0
  },
)

onMounted(() => {
  const element = containerRef.value
  if (!element) return
  containerHeight.value = element.clientHeight
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerHeight.value = entry.contentRect.height
      }
    })
    resizeObserver.observe(element)
  }
})

onBeforeUnmount(() => {
  if (resizeObserver !== null) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (scrollFrameId !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(scrollFrameId)
    scrollFrameId = null
  }
  if (unsubscribeEntries !== null) {
    unsubscribeEntries()
    unsubscribeEntries = null
  }
})
</script>

<template>
  <div
    ref="containerRef"
    class="log-list"
    :class="{ 'is-wrapped': paneSettings.wrap }"
    :style="{ '--log-font-size': `${paneSettings.fontSize}px` }"
    data-testid="log-list"
    @scroll="handleContainerScroll"
  >
    <div
      v-if="searchNotice"
      class="log-list__notice"
      :class="{ 'is-error': Boolean(searchState?.error) }"
    >
      {{ searchNotice }}
    </div>
    <button
      v-else-if="hasEarlier"
      class="log-list__load-earlier"
      type="button"
      data-testid="log-load-earlier"
      @click="loadEarlier"
    >
      加载更早的 2000 条
    </button>

    <p v-if="displayRows.length === 0" class="log-list__empty">
      <span class="log-list__empty-text">{{
        searchState !== null ? '没有匹配的日志。' : '暂无日志。'
      }}</span>
    </p>

    <div
      v-if="virtualWindow.topPad > 0"
      :style="{ height: `${virtualWindow.topPad}px` }"
      aria-hidden="true"
    />

    <div
      v-for="row in virtualWindow.rows"
      :key="row.key"
      v-memo="[
        row,
        showTimestamp,
        displayMode,
        hasExpanded && row.kind === 'decoded' && row.expandable && isExpanded(row.entry.seq),
      ]"
      class="log-list__row"
      :class="[
        `is-${row.entry.dir}`,
        {
          'is-error': row.level === 'error',
          'is-decoded-row': row.kind === 'decoded',
          'is-expandable': row.kind === 'decoded' && row.expandable,
        },
      ]"
      :data-testid="row.kind === 'raw' ? 'log-row' : 'log-row-decoded'"
      :data-dir="row.entry.dir"
      :data-seq="row.entry.seq"
      :data-level="row.level"
      :aria-expanded="
        row.kind === 'decoded' && row.expandable ? isExpanded(row.entry.seq) : undefined
      "
      @click="row.kind === 'decoded' && row.expandable ? toggleExpanded(row.entry.seq) : undefined"
    >
      <span
        v-if="
          paneSettings.showTimestamp &&
          !(row.kind === 'decoded' && paneSettings.displayMode === 'both')
        "
        class="log-list__timestamp"
      >
        {{ formatTimestamp(row.entry.at) }}
      </span>
      <span v-else class="log-list__slot" aria-hidden="true" />
      <span
        v-if="row.kind === 'raw' || paneSettings.displayMode === 'decoded'"
        class="log-list__direction"
      >
        {{ directionLabel(row.entry) }}
      </span>
      <span v-else class="log-list__slot" aria-hidden="true" />
      <span v-if="row.kind === 'raw'" class="log-list__content-cell">
        <span class="log-list__content">
          <span
            v-for="(segment, index) in row.segments"
            :key="index"
            :class="['log-list__char', { 'is-control': segment.control }]"
            >{{ segment.text }}</span
          >
        </span>
        <span v-if="row.hint" class="log-list__hint">{{ row.hint }}</span>
        <span v-if="row.truncated" class="log-list__truncated"
          >…（共 {{ row.totalBytes }} 字节）</span
        >
      </span>
      <span v-else class="log-list__content-cell">
        <span
          v-if="paneSettings.displayMode === 'both'"
          class="log-list__decoded-marker"
          aria-hidden="true"
        >
          {{ '└ ' }}
        </span>
        <span class="log-list__decoded" :class="[`is-${row.level}`]">
          {{ row.summary }}
        </span>
        <span v-if="row.kind === 'decoded' && row.expandable" class="log-list__expand">
          {{ isExpanded(row.entry.seq) ? '▾' : '▸' }}
        </span>
      </span>
    </div>

    <div
      v-if="virtualWindow.bottomPad > 0"
      :style="{ height: `${virtualWindow.bottomPad}px` }"
      aria-hidden="true"
    />

    <button
      v-if="!atBottom"
      class="log-list__to-bottom"
      type="button"
      data-testid="log-to-bottom"
      @click="jumpToBottom"
    >
      回到底部
    </button>
  </div>
</template>

<style scoped>
.log-list {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  overflow-anchor: none;
  contain: layout style;
  background: var(--bg-log, var(--bg-sunken));
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--log-font-size, 12.5px);
  line-height: 1.45;
}

.log-list__notice {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 3px var(--space-2);
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text-dim);
  font-family: var(--font-ui);
  font-size: 11px;
}

.log-list__notice.is-error {
  color: var(--danger);
}

.log-list__load-earlier {
  display: block;
  width: 100%;
  padding: 2px var(--space-2);
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  font-family: var(--font-ui);
  font-size: 11px;
  text-align: center;
  transition:
    background-color 120ms ease,
    color 120ms ease;
}

.log-list__load-earlier:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.log-list__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 240px;
  margin: 0;
  padding: var(--space-5);
  color: var(--text-faint);
  font-family: var(--font-ui);
  text-align: center;
}

.log-list__empty-text {
  color: var(--text-dim);
  font-size: 12px;
}

.log-list__row {
  display: grid;
  grid-template-columns: 88px 46px minmax(0, 1fr);
  column-gap: 8px;
  align-items: baseline;
  min-height: calc(var(--row-h) + 2px);
  padding: 1px 8px;
  overflow: hidden;
  contain: layout style;
  content-visibility: auto;
  contain-intrinsic-size: auto var(--row-h);
  white-space: pre;
}

.log-list:not(.is-wrapped) .log-list__row {
  height: calc(var(--row-h) + 2px);
  contain: strict;
}

.log-list.is-wrapped .log-list__row {
  align-items: start;
  white-space: pre-wrap;
  word-break: break-all;
}

.log-list__row:hover {
  background: var(--bg-hover);
  background: color-mix(in srgb, var(--bg-hover) 60%, transparent);
}

.log-list__row.is-rx {
  --row-color: var(--log-rx);
}

.log-list__row.is-tx {
  --row-color: var(--log-tx);
}

.log-list__row.is-system {
  --row-color: var(--log-sys);
}

.log-list__row.is-error {
  --row-color: var(--log-err);
  box-shadow: inset 2px 0 0 var(--log-err);
}

.log-list__timestamp {
  color: var(--log-ts);
  font-size: 11px;
  white-space: nowrap;
}

.log-list__slot {
  min-width: 0;
}

.log-list__direction {
  justify-self: start;
  min-width: 34px;
  padding: 0 4px;
  border: 1px solid currentColor;
  border-radius: 2px;
  background: color-mix(in srgb, currentColor 8%, transparent);
  color: var(--row-color, var(--text-faint));
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  text-align: center;
  white-space: nowrap;
}

.log-list__content-cell {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.log-list__content {
  min-width: 0;
  overflow: hidden;
  color: var(--row-color, var(--text));
  font-weight: 500;
}

.log-list.is-wrapped .log-list__content {
  overflow: visible;
}

.log-list__char.is-control {
  color: color-mix(in srgb, var(--row-color, var(--text)) 75%, var(--text-dim));
}

.log-list__truncated {
  flex: none;
  color: var(--text-faint);
  font-size: 11px;
}

.log-list__hint {
  flex: none;
  color: var(--warn);
  font-family: var(--font-ui);
  font-size: 11px;
}

.log-list__row.is-expandable {
  cursor: pointer;
}

.log-list__row.is-expandable:hover {
  background: var(--bg-hover);
  background: color-mix(in srgb, var(--bg-hover) 60%, transparent);
}

.log-list__decoded-marker {
  flex: none;
  color: var(--log-decoded);
  opacity: 0.75;
}

.log-list__decoded {
  min-width: 0;
  color: var(--log-decoded);
  font-family: var(--font-mono);
  font-weight: 500;
}

.log-list__decoded.is-error {
  color: var(--log-err);
}

.log-list__decoded.is-warn {
  color: var(--warn);
}

.log-list__expand {
  flex: none;
  margin-left: auto;
  color: var(--text-faint);
  font-family: var(--font-ui);
  font-size: 10px;
}

.log-list__to-bottom {
  position: sticky;
  bottom: var(--space-2);
  z-index: 3;
  display: block;
  width: max-content;
  margin-left: auto;
  margin-right: var(--space-2);
  padding: 2px var(--space-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-elev-2);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 11px;
  box-shadow: var(--shadow-pop);
}

.log-list__to-bottom:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
