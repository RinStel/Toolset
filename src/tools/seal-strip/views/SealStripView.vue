<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Copy,
  Dices,
  Download,
  FileSpreadsheet,
  Printer,
  RefreshCw,
  SearchCheck,
  ShieldAlert,
  Type,
  Upload,
} from 'lucide-vue-next'

import { downloadText } from '@/shared/lib/download'
import UiBadge from '@/shared/ui/components/UiBadge.vue'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiFormField from '@/shared/ui/components/UiFormField.vue'
import UiInput from '@/shared/ui/components/UiInput.vue'
import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'
import UiSegmented from '@/shared/ui/components/UiSegmented.vue'
import UiSelect from '@/shared/ui/components/UiSelect.vue'
import { toast } from '@/shared/ui/services/toast'

import SvgStage from '../components/SvgStage.vue'
import {
  A4_COLS,
  A4_H,
  A4_TOTAL,
  A4_W,
  CARD_H,
  CARD_W,
  SEAL_STYLE_PRESETS,
  type SealStyleId,
} from '../core/seal-themes'
import {
  checkRequiredFonts,
  getPrintFontStylesHtml,
  loadCloudFonts,
  loadLocalFontFiles,
  type FontCheckItem,
} from '../core/fonts'
import {
  A4_GAP_X,
  A4_GAP_Y,
  A4_MARGIN_X,
  A4_MARGIN_Y,
  buildCardRecord,
  cardsToCsv,
  generateCardBatch,
  makeA4SheetSvg,
  makeCardSvg,
  normalizeSealCode,
  randCode,
  verifySealInput,
  type CardRecord,
} from '../core/generator'
import { sealStripSettings, type SeedMode } from '../stores/settings'

type ToolMode = 'generate' | 'verify' | 'fonts'
type PreviewMode = 'single' | 'sheet'

const modeOptions = [
  { label: '排版生成', value: 'generate' },
  { label: '编码核验', value: 'verify' },
  { label: '专用字体', value: 'fonts' },
]

const previewModeOptions = [
  { label: '单张预览 (56×34mm)', value: 'single' },
  { label: 'A4 二十一联 (210×297mm)', value: 'sheet' },
]

const seedModeOptions = [
  { label: '随机生成', value: 'random' },
  { label: '固定种子复现', value: 'fixed' },
]

const cardStyleOptions = SEAL_STYLE_PRESETS.map((preset) => ({
  label: preset.label,
  value: preset.id,
}))

const toolMode = ref<ToolMode>('generate')
const previewMode = ref<PreviewMode>('single')

const brand = ref(sealStripSettings.brand)
const cnTitle = ref(sealStripSettings.cnTitle)
const baseName = ref(sealStripSettings.baseName)
const cardStyle = ref<SealStyleId>(sealStripSettings.cardStyle)
const seedMode = ref<SeedMode>(sealStripSettings.defaultSeedMode)
const seedInput = ref<number>(sealStripSettings.defaultSeed)
const startSeq = ref<number>(1)

function createInitialBatch(): CardRecord[] {
  return generateCardBatch({
    seed: seedMode.value === 'fixed' ? seedInput.value : null,
    startSeq: startSeq.value,
    count: A4_TOTAL,
  })
}

const cards = ref<CardRecord[]>(createInitialBatch())
const selectedIndex = ref(0)

const selectedCard = computed<CardRecord>(() => cards.value[selectedIndex.value] ?? cards.value[0]!)

const codeInput = ref(selectedCard.value.code)
const codeInputError = ref(false)

watch(selectedCard, (card) => {
  codeInput.value = card.code
  codeInputError.value = false
})

watch(startSeq, (nextStart) => {
  const safeStart = Math.max(1, Math.min(999, Math.trunc(nextStart || 1)))
  cards.value = cards.value.map((card, idx) => ({
    ...card,
    seq: safeStart + idx,
  }))
})

const renderOptions = computed(() => ({
  brand: brand.value,
  cnTitle: cnTitle.value,
  styleId: cardStyle.value,
}))

const singleCardSvg = computed(() =>
  makeCardSvg(selectedCard.value.code, selectedCard.value.seq, renderOptions.value),
)

const sheetSvg = computed(() => makeA4SheetSvg(cards.value, renderOptions.value))

/* ------------------------------------------------------------------------- */
/* 排版生成操作                                                               */
/* ------------------------------------------------------------------------- */

function regenerateBatch(forcedSeed?: number | null): void {
  const activeSeed =
    forcedSeed !== undefined ? forcedSeed : seedMode.value === 'fixed' ? seedInput.value : null
  const safeStart = Math.max(1, Math.min(999, Math.trunc(startSeq.value || 1)))
  cards.value = generateCardBatch({
    seed: activeSeed,
    startSeq: safeStart,
    count: A4_TOTAL,
  })
  selectedIndex.value = 0
}

function onSeedModeChange(value: string | number): void {
  seedMode.value = value === 'fixed' ? 'fixed' : 'random'
  if (seedMode.value === 'fixed') {
    regenerateBatch(seedInput.value)
  } else {
    regenerateBatch(null)
  }
}

function onSeedInputUpdate(value: number | null): void {
  if (value === null) return
  seedInput.value = Math.max(0, Math.trunc(value))
}

function onApplySeed(): void {
  seedMode.value = 'fixed'
  regenerateBatch(seedInput.value)
  toast.show({
    type: 'success',
    message: `已按种子 ${seedInput.value} 生成 ${cards.value.length} 联封箱条`,
  })
}

function onStartSeqUpdate(value: number | null): void {
  if (value === null) return
  startSeq.value = Math.max(1, Math.min(999, Math.trunc(value)))
}

function onCardStyleChange(value: string | number | null): void {
  if (typeof value === 'string') {
    cardStyle.value = value as SealStyleId
  }
}

function onCodeInputUpdate(value: string): void {
  codeInput.value = value
  const normalized = normalizeSealCode(value)
  if (!normalized) {
    codeInputError.value = value.trim().length > 0
    return
  }
  codeInputError.value = false
  const current = selectedCard.value
  cards.value[selectedIndex.value] = buildCardRecord(normalized, current.seq)
}

function rerollCurrentCard(): void {
  const current = selectedCard.value
  const next = buildCardRecord(randCode(), current.seq)
  cards.value[selectedIndex.value] = next
  codeInput.value = next.code
  codeInputError.value = false
}

function selectCard(index: number): void {
  if (index >= 0 && index < cards.value.length) {
    selectedIndex.value = index
  }
}

function onSheetClick(event: MouseEvent): void {
  const container = event.currentTarget as HTMLElement | null
  const svgEl = container?.querySelector('svg')
  if (!svgEl) return
  const rect = svgEl.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return

  const svgX = ((event.clientX - rect.left) / rect.width) * A4_W
  const svgY = ((event.clientY - rect.top) / rect.height) * A4_H

  for (let idx = 0; idx < cards.value.length; idx += 1) {
    const col = idx % A4_COLS
    const row = Math.floor(idx / A4_COLS)
    const x = A4_MARGIN_X + col * (CARD_W + A4_GAP_X)
    const y = A4_MARGIN_Y + row * (CARD_H + A4_GAP_Y)
    if (svgX >= x && svgX <= x + CARD_W && svgY >= y && svgY <= y + CARD_H) {
      selectCard(idx)
      return
    }
  }
}

async function copyText(text: string, label: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    toast.show({ type: 'warn', message: '当前环境不支持剪贴板写入' })
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    toast.show({ type: 'success', message: `已复制${label}：${text}` })
  } catch {
    toast.show({ type: 'error', message: `复制${label}失败` })
  }
}

/* ------------------------------------------------------------------------- */
/* 导出与 A4 矢量打印                                                         */
/* ------------------------------------------------------------------------- */

function sanitizedPrefix(): string {
  const trimmed = baseName.value.trim()
  return trimmed ? trimmed.replace(/[\\/:*?"<>|]/g, '_') : 'RinStel_封箱证明'
}

function downloadSingleSvg(): void {
  const card = selectedCard.value
  const fileName = `${sanitizedPrefix()}_单张_${card.code}.svg`
  downloadText(singleCardSvg.value, fileName, 'image/svg+xml;charset=utf-8')
  toast.show({ type: 'success', message: `已下载 ${fileName}` })
}

function downloadSheetSvg(): void {
  const fileName = `${sanitizedPrefix()}_A4二十一联打印.svg`
  downloadText(sheetSvg.value, fileName, 'image/svg+xml;charset=utf-8')
  toast.show({ type: 'success', message: `已下载 ${fileName}` })
}

function exportCsv(): void {
  const fileName = `${sanitizedPrefix()}_核验清单.csv`
  const csv = cardsToCsv(cards.value, { brand: brand.value, cnTitle: cnTitle.value })
  downloadText(csv, fileName, 'text/csv;charset=utf-8')
  toast.show({ type: 'success', message: `已导出 ${fileName}` })
}

function printA4Sheet(): void {
  if (typeof document === 'undefined') return
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.visibility = 'hidden'
  document.body.append(iframe)

  const doc = iframe.contentDocument
  const win = iframe.contentWindow
  if (!doc || !win) {
    iframe.remove()
    toast.show({
      type: 'warn',
      message: '当前环境不支持直接打印，请下载 A4 SVG 后在浏览器中打印为 PDF',
    })
    return
  }

  const fontHtml = getPrintFontStylesHtml()
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>商品封箱条 · A4 二十一联打印</title>
    ${fontHtml}
    <style>
      @page { size: A4 portrait; margin: 0; }
      html, body { margin: 0; padding: 0; background: #ffffff; }
      svg { display: block; width: ${A4_W}mm; height: ${A4_H}mm; }
    </style>
  </head>
  <body>${sheetSvg.value}</body>
</html>`

  const cleanup = (): void => {
    setTimeout(() => {
      iframe.remove()
    }, 300)
  }

  win.addEventListener('afterprint', cleanup, { once: true })

  doc.open()
  doc.write(html)
  doc.close()

  const triggerPrint = async (): Promise<void> => {
    try {
      if (doc.fonts?.ready) {
        await doc.fonts.ready
      }
      win.focus()
      win.print()
    } catch {
      toast.show({
        type: 'warn',
        message: '调用打印窗口失败，请下载 A4 SVG 后手动打印',
      })
      cleanup()
    }
  }

  setTimeout(() => {
    void triggerPrint()
  }, 60)
}

/* ------------------------------------------------------------------------- */
/* 编码核验模式                                                               */
/* ------------------------------------------------------------------------- */

const verifyInput = ref('')
const verifyResult = computed(() => verifySealInput(verifyInput.value))
const verifyPreviewSvg = computed(() => {
  if (!verifyResult.value.validFormat) return ''
  return makeCardSvg(verifyResult.value.code, 1, renderOptions.value)
})

function fillVerifyWithCurrent(kind: 'code' | 'qr'): void {
  const card = selectedCard.value
  verifyInput.value = kind === 'qr' ? card.qrPayload : card.code
}

/* ------------------------------------------------------------------------- */
/* 专用字体检查、云端自动加载与本地加载                                       */
/* ------------------------------------------------------------------------- */

const fontChecks = ref<FontCheckItem[]>(checkRequiredFonts())
const fontFileInputRef = ref<HTMLInputElement | null>(null)
const fontsLoading = ref(false)

const missingFontCount = computed(() => fontChecks.value.filter((item) => !item.available).length)

function refreshFontChecks(): void {
  fontChecks.value = checkRequiredFonts()
}

async function loadFontsFromCloud(options: { silent?: boolean } = {}): Promise<void> {
  if (fontsLoading.value) return
  fontsLoading.value = true
  try {
    fontChecks.value = await loadCloudFonts(`${brand.value}${cnTitle.value}`)
    if (!options.silent) {
      const missing = fontChecks.value.filter((item) => !item.available).length
      if (missing === 0) {
        toast.show({ type: 'success', message: '专用字体已从公共云加载就绪' })
      } else {
        toast.show({
          type: 'warn',
          message: `仍有 ${missing} 款字体未能从云端加载，可检查网络或加载本地字体`,
        })
      }
    }
  } finally {
    fontsLoading.value = false
  }
}

function triggerFontFileSelect(): void {
  fontFileInputRef.value?.click()
}

async function onFontFilesSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return

  const result = await loadLocalFontFiles(files)
  refreshFontChecks()
  input.value = ''

  if (result.loaded.length > 0) {
    toast.show({
      type: 'success',
      message: `已加载本地字体：${result.loaded.join('、')}`,
    })
  }
  for (const err of result.errors) {
    toast.show({ type: 'warn', message: err })
  }
}

onMounted(() => {
  refreshFontChecks()
  if (missingFontCount.value > 0) {
    void loadFontsFromCloud({ silent: true })
  }
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    void document.fonts.ready.then(() => {
      refreshFontChecks()
    })
  }
})
</script>

<template>
  <section class="ui-tool-page seal-tool" data-testid="seal-strip-tool">
    <header class="ui-toolbar seal-toolbar">
      <div class="ui-toolbar__group">
        <UiSegmented
          :model-value="toolMode"
          :options="modeOptions"
          size="sm"
          aria-label="工作模式"
          data-testid="seal-mode-tabs"
          @update:model-value="toolMode = $event as ToolMode"
        />
        <UiSegmented
          v-if="toolMode === 'generate'"
          :model-value="previewMode"
          :options="previewModeOptions"
          size="sm"
          aria-label="预览比例"
          data-testid="seal-preview-mode"
          @update:model-value="previewMode = $event as PreviewMode"
        />
      </div>

      <div class="ui-toolbar__group">
        <button
          type="button"
          class="seal-font-pill"
          data-testid="seal-font-status-btn"
          @click="toolMode = 'fonts'"
        >
          <UiBadge
            :tone="missingFontCount === 0 ? 'ok' : fontsLoading ? 'accent' : 'warn'"
            size="sm"
          >
            {{
              fontsLoading
                ? '正在加载云端字体…'
                : missingFontCount === 0
                  ? '专用字体就绪'
                  : `缺少 ${missingFontCount} 款字体`
            }}
          </UiBadge>
        </button>

        <template v-if="toolMode === 'generate'">
          <UiButton size="sm" data-testid="seal-regenerate" @click="regenerateBatch(null)">
            <RefreshCw :size="14" aria-hidden="true" />
            随机生成一页
          </UiButton>
          <UiButton size="sm" data-testid="seal-download-single" @click="downloadSingleSvg">
            <Download :size="14" aria-hidden="true" />
            单张 SVG
          </UiButton>
          <UiButton size="sm" data-testid="seal-download-sheet" @click="downloadSheetSvg">
            <Download :size="14" aria-hidden="true" />
            A4 21联 SVG
          </UiButton>
          <UiButton size="sm" data-testid="seal-export-csv" @click="exportCsv">
            <FileSpreadsheet :size="14" aria-hidden="true" />
            清单 CSV
          </UiButton>
          <UiButton variant="primary" size="sm" data-testid="seal-print-btn" @click="printA4Sheet">
            <Printer :size="14" aria-hidden="true" />
            打印 / PDF
          </UiButton>
        </template>
      </div>
    </header>

    <!-- 模式一：排版生成 -->
    <div v-if="toolMode === 'generate'" class="seal-workspace">
      <div class="seal-sidebar">
        <!-- 批次参数 -->
        <section class="ui-panel">
          <div class="ui-panel__header">
            <div class="ui-panel__heading">
              <h2 class="ui-panel__title">批次参数</h2>
            </div>
            <div class="ui-panel__actions">
              <UiBadge tone="muted" size="sm"
                >{{ CARD_W }}×{{ CARD_H }}mm · {{ A4_TOTAL }}联</UiBadge
              >
            </div>
          </div>
          <div class="ui-panel__body">
            <UiFormField label="编码生成方式">
              <UiSegmented
                :model-value="seedMode"
                :options="seedModeOptions"
                size="sm"
                aria-label="编码生成方式"
                data-testid="seal-seed-mode"
                @update:model-value="onSeedModeChange"
              />
            </UiFormField>

            <div class="seal-form-grid">
              <UiFormField label="固定种子">
                <div class="seal-inline-control">
                  <UiNumberInput
                    :model-value="seedInput"
                    :min="0"
                    :max="999999999"
                    :step="1"
                    size="sm"
                    aria-label="固定种子"
                    data-testid="seal-seed-input"
                    @update:model-value="onSeedInputUpdate"
                  />
                  <UiButton size="sm" data-testid="seal-apply-seed" @click="onApplySeed">
                    生成
                  </UiButton>
                </div>
              </UiFormField>

              <UiFormField label="起始序号">
                <UiNumberInput
                  :model-value="startSeq"
                  :min="1"
                  :max="999"
                  :step="1"
                  size="sm"
                  aria-label="起始序号"
                  data-testid="seal-start-seq"
                  @update:model-value="onStartSeqUpdate"
                />
              </UiFormField>
            </div>

            <div class="seal-form-grid">
              <UiFormField label="品牌标识">
                <UiInput
                  :model-value="brand"
                  size="sm"
                  :maxlength="24"
                  aria-label="品牌标识"
                  data-testid="seal-brand-input"
                  @update:model-value="brand = $event"
                />
              </UiFormField>

              <UiFormField label="封签标题">
                <UiInput
                  :model-value="cnTitle"
                  size="sm"
                  :maxlength="16"
                  aria-label="封签标题"
                  data-testid="seal-title-input"
                  @update:model-value="cnTitle = $event"
                />
              </UiFormField>
            </div>

            <div class="seal-form-grid">
              <UiFormField label="油墨风格">
                <UiSelect
                  :model-value="cardStyle"
                  :options="cardStyleOptions"
                  size="sm"
                  aria-label="油墨风格"
                  data-testid="seal-style-select"
                  @update:model-value="onCardStyleChange"
                />
              </UiFormField>

              <UiFormField label="导出文件前缀">
                <UiInput
                  :model-value="baseName"
                  size="sm"
                  :maxlength="48"
                  aria-label="导出文件前缀"
                  data-testid="seal-basename-input"
                  @update:model-value="baseName = $event"
                />
              </UiFormField>
            </div>
          </div>
        </section>

        <!-- 当前选中封箱条详情 -->
        <section class="ui-panel" data-testid="seal-selected-panel">
          <div class="ui-panel__header">
            <div class="ui-panel__heading">
              <h2 class="ui-panel__title">
                当前选中：#{{ String(selectedCard.seq).padStart(2, '0') }}
              </h2>
            </div>
            <div class="ui-panel__actions">
              <UiButton size="sm" data-testid="seal-reroll-one" @click="rerollCurrentCard">
                <Dices :size="13" aria-hidden="true" />
                重摇此条
              </UiButton>
            </div>
          </div>
          <div class="ui-panel__body">
            <UiFormField
              label="主封箱编号（SEAL ID）"
              :error="codeInputError ? '须为 11 位有效字符（剔除 0 / O / 1 / I）' : undefined"
            >
              <div class="seal-inline-control">
                <UiInput
                  :model-value="codeInput"
                  size="sm"
                  monospace
                  :invalid="codeInputError"
                  aria-label="主封箱编号"
                  data-testid="seal-current-code"
                  @update:model-value="onCodeInputUpdate"
                />
                <UiButton
                  size="sm"
                  title="复制主封箱编号"
                  @click="copyText(selectedCard.code, 'SEAL ID')"
                >
                  <Copy :size="13" aria-hidden="true" />
                </UiButton>
              </div>
            </UiFormField>

            <div class="seal-stats-grid">
              <div class="ui-stat-card">
                <span class="ui-stat-card__label">CHK 校验码</span>
                <span class="ui-stat-card__value" data-testid="seal-current-chk">
                  {{ selectedCard.chkText }}
                </span>
              </div>
              <div class="ui-stat-card">
                <span class="ui-stat-card__label">SIG 签名短码</span>
                <span class="ui-stat-card__value" data-testid="seal-current-sig">
                  {{ selectedCard.sig6 }}
                </span>
              </div>
              <div class="ui-stat-card seal-stat-card--wide">
                <span class="ui-stat-card__label">16 位微缩摘要</span>
                <span class="ui-stat-card__value" data-testid="seal-current-token">
                  {{ selectedCard.token16 }}
                </span>
              </div>
            </div>

            <div class="seal-fingerprint-row">
              <div class="seal-matrix-mini" aria-label="4×4 视觉指纹矩阵">
                <template v-for="(row, rIdx) in selectedCard.matrixCells" :key="rIdx">
                  <span
                    v-for="(filled, cIdx) in row"
                    :key="`${rIdx}-${cIdx}`"
                    class="seal-matrix-mini__cell"
                    :class="{ 'is-filled': filled }"
                  />
                </template>
              </div>
              <div class="seal-qr-meta">
                <span class="eyebrow">QR PAYLOAD</span>
                <code class="ui-code-pill seal-qr-meta__code">{{ selectedCard.qrPayload }}</code>
                <UiButton
                  size="sm"
                  variant="ghost"
                  @click="copyText(selectedCard.qrPayload, '二维码载荷')"
                >
                  <Copy :size="12" aria-hidden="true" />
                  复制扫码原文
                </UiButton>
              </div>
            </div>
          </div>
        </section>

        <!-- 本页 21 联清单 -->
        <section class="ui-panel">
          <div class="ui-panel__header">
            <div class="ui-panel__heading">
              <h2 class="ui-panel__title">本页 {{ cards.length }} 联清单</h2>
            </div>
          </div>
          <div class="seal-card-list" role="listbox" aria-label="本页封箱条清单">
            <button
              v-for="(card, index) in cards"
              :key="card.seq"
              type="button"
              role="option"
              :aria-selected="index === selectedIndex"
              class="seal-card-row"
              :class="{ 'is-active': index === selectedIndex }"
              :data-testid="`seal-card-row-${index}`"
              @click="selectCard(index)"
            >
              <span class="seal-card-row__seq">#{{ String(card.seq).padStart(2, '0') }}</span>
              <span class="seal-card-row__code">{{ card.code }}</span>
              <span class="seal-card-row__sig">SIG {{ card.sig6 }}</span>
            </button>
          </div>
        </section>
      </div>

      <!-- 右侧矢量预览台 -->
      <section class="ui-panel seal-preview-panel">
        <div class="ui-panel__header">
          <div class="ui-panel__heading">
            <h2 class="ui-panel__title">
              {{
                previewMode === 'single'
                  ? `单张预览 · #${String(selectedCard.seq).padStart(2, '0')} (${selectedCard.code})`
                  : `A4 二十一联排版 (${A4_W}×${A4_H}mm)`
              }}
            </h2>
          </div>
          <div class="ui-panel__actions">
            <UiBadge tone="accent" size="sm">
              {{ previewMode === 'single' ? '56×34mm' : 'A4 21联' }}
            </UiBadge>
          </div>
        </div>

        <div class="ui-panel__body seal-preview-body">
          <div
            v-if="previewMode === 'single'"
            class="ui-preview-stage seal-stage-single"
            data-testid="seal-single-preview"
          >
            <div class="seal-stage-single__frame">
              <SvgStage
                :svg="singleCardSvg"
                :aria-label="`商品封箱条 ${selectedCard.code} 单张矢量预览`"
              />
            </div>
          </div>

          <div
            v-else
            class="ui-preview-stage seal-stage-sheet"
            data-testid="seal-sheet-preview"
            @click="onSheetClick"
          >
            <div class="seal-stage-sheet__frame">
              <SvgStage :svg="sheetSvg" aria-label="商品封箱条 A4 二十一联矢量排版预览" />
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 模式二：编码核验 -->
    <div v-else-if="toolMode === 'verify'" class="seal-verify-layout">
      <section class="ui-panel">
        <div class="ui-panel__header">
          <div class="ui-panel__heading">
            <h2 class="ui-panel__title">商品封箱条核验台</h2>
          </div>
          <div class="ui-panel__actions">
            <UiButton size="sm" @click="fillVerifyWithCurrent('code')"> 填入当前编号 </UiButton>
            <UiButton size="sm" @click="fillVerifyWithCurrent('qr')"> 填入当前二维码载荷 </UiButton>
          </div>
        </div>
        <div class="ui-panel__body">
          <UiFormField label="核验输入（SEAL ID 或二维码扫描全文）">
            <div class="seal-inline-control">
              <UiInput
                :model-value="verifyInput"
                monospace
                placeholder="例如：M3YC-QDWE-84H 或 RINSTEL-SEAL|M3YC-QDWE-84H|14-58E2-A039"
                aria-label="核验输入"
                data-testid="seal-verify-input"
                @update:model-value="verifyInput = $event"
              />
              <UiButton size="sm" variant="ghost" @click="verifyInput = ''">清空</UiButton>
            </div>
          </UiFormField>
        </div>
      </section>

      <section class="ui-panel" data-testid="seal-verify-result">
        <div class="ui-panel__header">
          <div class="ui-panel__heading">
            <h2 class="ui-panel__title">核验结果与特征重构</h2>
          </div>
          <div class="ui-panel__actions">
            <UiBadge
              v-if="verifyResult.validFormat && verifyResult.chkMatched === true"
              tone="ok"
              variant="solid"
            >
              <CheckCircle2 :size="12" aria-hidden="true" />
              校验码匹配 · 正品格式
            </UiBadge>
            <UiBadge
              v-else-if="verifyResult.validFormat && verifyResult.chkMatched === false"
              tone="danger"
              variant="solid"
            >
              <ShieldAlert :size="12" aria-hidden="true" />
              校验码不匹配 · 疑似篡改
            </UiBadge>
            <UiBadge v-else-if="verifyResult.validFormat" tone="accent" variant="soft">
              <SearchCheck :size="12" aria-hidden="true" />
              编号有效 · 请核对下方派生特征
            </UiBadge>
            <UiBadge v-else tone="warn" variant="soft">
              <AlertTriangle :size="12" aria-hidden="true" />
              等待有效输入
            </UiBadge>
          </div>
        </div>

        <div class="ui-panel__body">
          <p v-if="!verifyResult.validFormat" class="seal-verify-empty">
            {{ verifyResult.errorMessage }}
          </p>

          <div v-else class="seal-verify-grid">
            <div class="seal-verify-details">
              <div class="ui-kv-row">
                <span class="ui-kv-row__key">规范化 SEAL ID</span>
                <span class="ui-kv-row__val">{{ verifyResult.code }}</span>
              </div>
              <div class="ui-kv-row">
                <span class="ui-kv-row__key">标准校验码（CHK）</span>
                <span class="ui-kv-row__val">{{ verifyResult.expectedChk }}</span>
              </div>
              <div v-if="verifyResult.providedChk !== null" class="ui-kv-row">
                <span class="ui-kv-row__key">二维码携带 CHK</span>
                <span
                  class="ui-kv-row__val"
                  :style="{
                    color: verifyResult.chkMatched ? 'var(--ok)' : 'var(--danger)',
                  }"
                >
                  {{ verifyResult.providedChk }}
                  ({{ verifyResult.chkMatched ? '一致' : '不一致' }})
                </span>
              </div>
              <div class="ui-kv-row">
                <span class="ui-kv-row__key">16 位微缩摘要</span>
                <span class="ui-kv-row__val">{{ verifyResult.token16 }}</span>
              </div>
              <div class="ui-kv-row">
                <span class="ui-kv-row__key">BLAKE2s 短码（SIG）</span>
                <span class="ui-kv-row__val">{{ verifyResult.sig6 }}</span>
              </div>
              <div class="ui-kv-row">
                <span class="ui-kv-row__key">标准二维码载荷</span>
                <span class="ui-kv-row__val">{{ verifyResult.qrPayload }}</span>
              </div>

              <div class="seal-verify-matrix-box">
                <span class="eyebrow">4×4 视觉指纹</span>
                <div class="seal-matrix-large">
                  <template v-for="(row, rIdx) in verifyResult.matrixCells" :key="rIdx">
                    <span
                      v-for="(filled, cIdx) in row"
                      :key="`v-${rIdx}-${cIdx}`"
                      class="seal-matrix-large__cell"
                      :class="{ 'is-filled': filled }"
                    />
                  </template>
                </div>
              </div>
            </div>

            <div class="ui-preview-stage seal-verify-preview">
              <span class="eyebrow">封箱条预览</span>
              <div class="seal-stage-single__frame">
                <SvgStage
                  :svg="verifyPreviewSvg"
                  :aria-label="`核验重构商品封箱条 ${verifyResult.code}`"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 模式三：专用字体 -->
    <div v-else class="seal-fonts-layout">
      <section class="ui-panel">
        <div class="ui-panel__header">
          <div class="ui-panel__heading">
            <h2 class="ui-panel__title">专用字体</h2>
          </div>
          <div class="ui-panel__actions">
            <UiButton
              size="sm"
              :loading="fontsLoading"
              data-testid="seal-load-cloud-fonts"
              @click="loadFontsFromCloud()"
            >
              <Cloud :size="13" aria-hidden="true" />
              云端加载
            </UiButton>
            <UiButton size="sm" @click="refreshFontChecks">
              <RefreshCw :size="13" aria-hidden="true" />
              重新检测
            </UiButton>
            <UiButton variant="primary" size="sm" @click="triggerFontFileSelect">
              <Upload :size="13" aria-hidden="true" />
              本地字体
            </UiButton>
            <input
              ref="fontFileInputRef"
              type="file"
              class="visually-hidden"
              multiple
              accept=".ttf,.otf,.ttc,.woff2"
              @change="onFontFilesSelected"
            />
          </div>
        </div>
        <div class="ui-panel__body">
          <div class="seal-fonts-grid">
            <article
              v-for="font in fontChecks"
              :key="font.name"
              class="ui-stat-card seal-font-card"
            >
              <div class="seal-font-card__head">
                <div class="seal-font-card__name">
                  <Type :size="14" aria-hidden="true" />
                  <strong>{{ font.name }}</strong>
                </div>
                <UiBadge :tone="font.available ? 'ok' : 'warn'" size="sm">
                  {{
                    font.sourceKind === 'local'
                      ? '本地已加载'
                      : font.sourceKind === 'cloud'
                        ? '云端已加载'
                        : font.sourceKind === 'system'
                          ? '系统已就绪'
                          : '未就绪'
                  }}
                </UiBadge>
              </div>
              <div class="seal-font-card__meta">{{ font.role }}</div>
              <div class="seal-font-card__sample" :style="{ fontFamily: `'${font.cssFamily}'` }">
                {{ font.sampleText }}
              </div>
            </article>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.seal-tool {
  min-width: 0;
}

.seal-font-pill {
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-sm);
}

.seal-workspace {
  display: grid;
  grid-template-columns: minmax(320px, 400px) minmax(0, 1fr);
  align-items: start;
  gap: var(--space-3);
}

.seal-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.seal-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}

.seal-inline-control {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.seal-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}

.seal-stat-card--wide {
  grid-column: 1 / -1;
}

.seal-fingerprint-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-sunken);
}

.seal-matrix-mini {
  display: grid;
  grid-template-columns: repeat(4, 9px);
  grid-template-rows: repeat(4, 9px);
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--border-strong);
  border-radius: 2px;
  background: #ffffff;
  flex: none;
}

.seal-matrix-mini__cell {
  background: transparent;
}

.seal-matrix-mini__cell.is-filled {
  background: #0f172a;
}

.seal-qr-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
}

.seal-qr-meta__code {
  max-width: 100%;
  overflow-wrap: anywhere;
}

.seal-card-list {
  display: flex;
  flex-direction: column;
  max-height: 290px;
  overflow: auto;
}

.seal-card-row {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
  min-height: 30px;
  padding: 4px 12px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  font-size: 12px;
  transition: background-color 100ms ease;
}

.seal-card-row:last-child {
  border-bottom: 0;
}

.seal-card-row:hover {
  background: var(--bg-hover);
}

.seal-card-row.is-active {
  background: var(--accent-soft);
  box-shadow: inset 3px 0 0 var(--accent);
}

.seal-card-row__seq {
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 11px;
}

.seal-card-row__code {
  color: var(--text);
  font-family: var(--font-mono);
  font-weight: 600;
}

.seal-card-row__sig {
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
}

.seal-preview-panel {
  min-width: 0;
}

.seal-preview-body {
  min-width: 0;
}

.seal-stage-single {
  gap: var(--space-4);
}

.seal-stage-single__frame {
  width: 100%;
  max-width: 480px;
}

.seal-stage-sheet {
  cursor: pointer;
}

.seal-stage-sheet__frame {
  width: 100%;
  max-width: 680px;
}

.seal-verify-layout,
.seal-fonts-layout {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.seal-verify-empty {
  color: var(--text-dim);
  font-size: 12.5px;
}

.seal-verify-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 420px);
  gap: var(--space-4);
  align-items: start;
}

.seal-verify-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.seal-verify-matrix-box {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin-top: var(--space-2);
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-sunken);
}

.seal-matrix-large {
  display: grid;
  grid-template-columns: repeat(4, 22px);
  grid-template-rows: repeat(4, 22px);
  gap: 3px;
  padding: 8px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: #ffffff;
}

.seal-matrix-large__cell {
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: transparent;
}

.seal-matrix-large__cell.is-filled {
  border-color: #0f172a;
  background: #0f172a;
}

.seal-verify-preview {
  gap: var(--space-3);
}

.seal-fonts-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
}

.seal-font-card {
  gap: 8px;
  padding: 12px;
}

.seal-font-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.seal-font-card__name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text);
  font-size: 13px;
}

.seal-font-card__meta {
  color: var(--text-dim);
  font-size: 11.5px;
  line-height: 1.5;
}

.seal-font-card__sample {
  margin-top: auto;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
  color: var(--text);
  font-size: 18px;
  font-weight: 700;
  text-align: center;
}

@media (max-width: 960px) {
  .seal-workspace,
  .seal-verify-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .seal-fonts-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 600px) {
  .seal-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
