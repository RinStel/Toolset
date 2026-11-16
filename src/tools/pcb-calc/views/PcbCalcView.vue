<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { BookmarkPlus, Copy, SlidersHorizontal, Trash2 } from 'lucide-vue-next'

import UiBadge from '@/shared/ui/components/UiBadge.vue'
import UiButton from '@/shared/ui/components/UiButton.vue'
import UiDialog from '@/shared/ui/components/UiDialog.vue'
import UiFormField from '@/shared/ui/components/UiFormField.vue'
import UiInput from '@/shared/ui/components/UiInput.vue'
import UiNumberInput from '@/shared/ui/components/UiNumberInput.vue'
import UiSegmented from '@/shared/ui/components/UiSegmented.vue'
import UiSelect from '@/shared/ui/components/UiSelect.vue'
import { toast } from '@/shared/ui/services/toast'

import PcbCrossSectionSvg from '../components/PcbCrossSectionSvg.vue'
import {
  calculateTraceCurrent,
  POWER_RAIL_PRESETS,
  type CurrentSolveMode,
  type TraceLayerKind,
} from '../core/current'
import {
  calculateCrosstalkAndTuning,
  calculateImpedance,
  solveTraceRecommendations,
  type TraceRecommendation,
} from '../core/impedance'
import {
  buildStackupSpansFromUser,
  formatCopperLayerName,
  formatDualLength,
  formatLength,
  fromUnitValue,
  getStackupPreset,
  getTransmissionModeMeta,
  HIGH_SPEED_PRESETS,
  milToMm,
  ozToMil,
  resolveStackupRoutingGeometry,
  STACKUP_PRESETS,
  toUnitValue,
  TRANSMISSION_MODE_OPTIONS,
  type HighSpeedPreset,
  type LengthUnit,
  type TransmissionLineMode,
  type UserTracePreset,
} from '../core/presets'
import { calculateViaParams, VIA_PRESETS } from '../core/via'
import {
  pcbCalcSettings,
  removeUserStackupPreset,
  removeUserTracePreset,
  saveUserStackupPreset,
  saveUserTracePreset,
  userStackupPresets,
  userTracePresets,
} from '../stores/settings'

type ToolMode = 'impedance' | 'current' | 'via'

const toolModeOptions = [
  { label: '阻抗与串扰', value: 'impedance' },
  { label: '载流与压降', value: 'current' },
  { label: '过孔参数', value: 'via' },
]

const unitOptions = [
  { label: 'mil', value: 'mil' },
  { label: 'mm', value: 'mm' },
]

const copperOzOptions = [
  { label: '0.5 oz', value: 0.5 },
  { label: '1 oz', value: 1 },
  { label: '2 oz', value: 2 },
  { label: '3 oz', value: 3 },
]

const layerKindOptions = [
  { label: '外层走线', value: 'external' },
  { label: '内层走线', value: 'internal' },
]

const currentSolveOptions = [
  { label: '由电流算线宽', value: 'current-to-width' },
  { label: '由线宽算载流', value: 'width-to-current' },
]

const toolMode = ref<ToolMode>('impedance')
const unit = ref<LengthUnit>(pcbCalcSettings.defaultUnit)

/* ------------------------------------------------------------------------- */
/* 模式一：特征阻抗与防串扰                                                   */
/* ------------------------------------------------------------------------- */

const initialStackup = getStackupPreset(pcbCalcSettings.defaultStackupId)
const activeHighSpeedId = ref<string | null>('usb2-hs')
const activeUserPresetId = ref<string | null>(null)
const stackupId = ref<string>(initialStackup.id)
const lineMode = ref<TransmissionLineMode>('diff-microstrip')
const targetZ = ref<number>(90)

const wMil = ref<number>(5.4)
const sMil = ref<number>(6.0)
const sGndMil = ref<number>(8.0)
const signalLayerIdx = ref<number>(0)
const refAboveIdx = ref<number | null>(null)
const refBelowIdx = ref<number | null>(1)
const hMil = ref<number>(initialStackup.outerHMil)
const h2Mil = ref<number>(initialStackup.innerH2Mil)
const tMil = ref<number>(ozToMil(initialStackup.outerCopperOz))
const er = ref<number>(initialStackup.outerEr)
const customMinTrackMil = ref<number>(initialStackup.minTrackMil)
const neighborEdgeGapMil = ref<number>(18.0)

const targetZFieldRef = ref<HTMLElement | null>(null)
const hFieldRef = ref<HTMLElement | null>(null)
const currentInputWrapRef = ref<HTMLElement | null>(null)
const viaHoleWrapRef = ref<HTMLElement | null>(null)

const resolvedStackupMeta = computed(() => {
  if (stackupId.value === 'custom') {
    return {
      id: 'custom',
      label: '自定义层叠',
      layers: 4 as const,
      outerHMil: hMil.value,
      outerEr: er.value,
      innerH1Mil: hMil.value,
      innerH2Mil: h2Mil.value,
      innerEr: er.value,
      outerCopperOz: tMil.value / 1.378,
      innerCopperOz: tMil.value / 1.378,
      minTrackMil: customMinTrackMil.value,
    }
  }
  const userMatch = userStackupPresets.list.find((item) => item.id === stackupId.value)
  if (userMatch) {
    return {
      id: userMatch.id,
      label: userMatch.name,
      layers: userMatch.layers,
      outerHMil: userMatch.outerHMil,
      outerEr: userMatch.outerEr,
      innerH1Mil: userMatch.innerH1Mil,
      innerH2Mil: userMatch.innerH2Mil,
      innerEr: userMatch.innerEr,
      outerCopperOz: userMatch.outerCopperOz,
      innerCopperOz: userMatch.innerCopperOz,
      minTrackMil: userMatch.minTrackMil,
    }
  }
  return getStackupPreset(stackupId.value)
})

const isCustomHighSpeed = computed(
  () => activeHighSpeedId.value === null && activeUserPresetId.value === null,
)
const isCustomStackup = computed(() => stackupId.value === 'custom')

const stackupStructure = computed(() => {
  if (stackupId.value === 'custom') {
    return {
      layers: 4,
      copperOzByLayer: [tMil.value / 1.378, 0.5, 0.5, tMil.value / 1.378],
      dielectrics: [
        { thicknessMil: hMil.value, er: er.value },
        { thicknessMil: h2Mil.value, er: er.value },
        { thicknessMil: hMil.value, er: er.value },
      ],
    }
  }
  const userMatch = userStackupPresets.list.find((item) => item.id === stackupId.value)
  if (userMatch) return buildStackupSpansFromUser(userMatch)
  const builtin = getStackupPreset(stackupId.value)
  return {
    layers: builtin.layers,
    copperOzByLayer: builtin.copperOzByLayer,
    dielectrics: builtin.dielectrics,
  }
})

const signalLayerOptions = computed(() =>
  Array.from({ length: stackupStructure.value.layers }, (_, i) => ({
    label: formatCopperLayerName(i, stackupStructure.value.layers),
    value: i,
  })),
)

const refAboveOptions = computed(() => {
  const opts: Array<{ label: string; value: number }> = [{ label: '无', value: -1 }]
  for (let i = 0; i < signalLayerIdx.value; i += 1) {
    opts.push({
      label: formatCopperLayerName(i, stackupStructure.value.layers),
      value: i,
    })
  }
  return opts
})

const refBelowOptions = computed(() => {
  const opts: Array<{ label: string; value: number }> = [{ label: '无', value: -1 }]
  for (let i = signalLayerIdx.value + 1; i < stackupStructure.value.layers; i += 1) {
    opts.push({
      label: formatCopperLayerName(i, stackupStructure.value.layers),
      value: i,
    })
  }
  return opts
})

const svgRefLabels = computed(() => {
  const total = stackupStructure.value.layers
  const above = refAboveIdx.value !== null ? formatCopperLayerName(refAboveIdx.value, total) : 'L2'
  const below = refBelowIdx.value !== null ? formatCopperLayerName(refBelowIdx.value, total) : 'L2'
  const single =
    refBelowIdx.value !== null
      ? `${formatCopperLayerName(refBelowIdx.value, total)} 参考平面`
      : refAboveIdx.value !== null
        ? `${formatCopperLayerName(refAboveIdx.value, total)} 参考平面`
        : '参考平面 (GND / PWR)'
  return { single, above, below }
})

const activeHighSpeed = computed<HighSpeedPreset | null>(
  () => HIGH_SPEED_PRESETS.find((item) => item.id === activeHighSpeedId.value) ?? null,
)
const lineMeta = computed(() => getTransmissionModeMeta(lineMode.value))

const impedanceInput = computed(() => ({
  mode: lineMode.value,
  targetZ: targetZ.value,
  wMil: wMil.value,
  sMil: sMil.value,
  sGndMil: sGndMil.value,
  hMil: hMil.value,
  h2Mil: h2Mil.value,
  tMil: tMil.value,
  er: er.value,
}))

const impedanceResult = computed(() => calculateImpedance(impedanceInput.value))

const recommendations = computed(() =>
  solveTraceRecommendations(impedanceInput.value, resolvedStackupMeta.value.minTrackMil),
)

const isWithinTolerance = computed(
  () => Math.abs(impedanceResult.value.errorPct) <= pcbCalcSettings.tolerancePct,
)

const minGapUsedMil = computed(() => {
  const gaps = [wMil.value]
  if (lineMeta.value.isDifferential) gaps.push(sMil.value)
  if (lineMeta.value.usesCoplanarGnd) gaps.push(sGndMil.value)
  return Math.min(...gaps)
})

const isManufacturable = computed(
  () => minGapUsedMil.value >= resolvedStackupMeta.value.minTrackMil,
)

const crosstalkResult = computed(() =>
  calculateCrosstalkAndTuning({
    wMil: wMil.value,
    sMil: sMil.value,
    hMil: hMil.value,
    neighborEdgeGapMil: neighborEdgeGapMil.value,
    isDifferential: lineMeta.value.isDifferential,
  }),
)

function applyRecommendation(rec: TraceRecommendation, syncNeighbor = true): void {
  wMil.value = Number(rec.wMil.toFixed(2))
  if (lineMeta.value.isDifferential) {
    sMil.value = Number(rec.sMil.toFixed(2))
  }
  if (lineMeta.value.usesCoplanarGnd) {
    sGndMil.value = Number(rec.sGndMil.toFixed(2))
  }
  if (syncNeighbor) {
    const factor = lineMeta.value.isDifferential ? 4 : 2
    neighborEdgeGapMil.value = Number(Math.max(factor * wMil.value, 3 * hMil.value).toFixed(2))
  }
}

function autoMatchBestRecommendation(syncNeighbor = true): void {
  const list = recommendations.value
  const preferred =
    list.find(
      (item) =>
        item.manufacturable &&
        (item.id === 'balanced' || item.id === 'std-gnd' || item.id === 'std-cpwg'),
    ) ??
    list.find((item) => item.manufacturable) ??
    list.find(
      (item) => item.id === 'balanced' || item.id === 'std-gnd' || item.id === 'std-cpwg',
    ) ??
    list[0]
  if (preferred) applyRecommendation(preferred, syncNeighbor)
}

function syncLayerGeometryAndMode(autoSolve = true): void {
  const struct = stackupStructure.value
  const safeSig = Math.max(0, Math.min(struct.layers - 1, signalLayerIdx.value))
  signalLayerIdx.value = safeSig
  if (refAboveIdx.value !== null && refAboveIdx.value >= safeSig) {
    refAboveIdx.value = safeSig > 0 ? safeSig - 1 : null
  }
  if (refBelowIdx.value !== null && refBelowIdx.value <= safeSig) {
    refBelowIdx.value = safeSig < struct.layers - 1 ? safeSig + 1 : null
  }
  if (refAboveIdx.value === null && refBelowIdx.value === null) {
    if (safeSig < struct.layers - 1) refBelowIdx.value = safeSig + 1
    else if (safeSig > 0) refAboveIdx.value = safeSig - 1
  }

  const geom = resolveStackupRoutingGeometry(
    struct.copperOzByLayer,
    struct.dielectrics,
    safeSig,
    refAboveIdx.value,
    refBelowIdx.value,
  )
  hMil.value = geom.hMil
  h2Mil.value = geom.h2Mil
  tMil.value = geom.tMil
  er.value = geom.er

  const curMeta = getTransmissionModeMeta(lineMode.value)
  if (geom.isInnerSandwich && !curMeta.isInnerLayer) {
    lineMode.value = curMeta.isDifferential ? 'diff-stripline' : 'stripline'
  } else if (!geom.isInnerSandwich && curMeta.isInnerLayer) {
    lineMode.value = curMeta.isDifferential ? 'diff-microstrip' : 'microstrip'
  }

  if (autoSolve) {
    autoMatchBestRecommendation()
  }
}

function onSignalLayerChange(val: string | number | null): void {
  if (val === null) return
  const nextIdx = Number(val)
  const total = stackupStructure.value.layers
  signalLayerIdx.value = Math.max(0, Math.min(total - 1, nextIdx))
  refAboveIdx.value = signalLayerIdx.value > 0 ? signalLayerIdx.value - 1 : null
  refBelowIdx.value = signalLayerIdx.value < total - 1 ? signalLayerIdx.value + 1 : null
  if (stackupId.value !== 'custom') {
    syncLayerGeometryAndMode(true)
  } else {
    autoMatchBestRecommendation()
  }
}

function onRefAboveChange(val: string | number | null): void {
  if (val === null) return
  const parsed = Number(val)
  refAboveIdx.value = parsed < 0 ? null : parsed
  if (refAboveIdx.value === null && refBelowIdx.value === null) {
    refBelowIdx.value =
      signalLayerIdx.value < stackupStructure.value.layers - 1 ? signalLayerIdx.value + 1 : null
    if (refBelowIdx.value === null && signalLayerIdx.value > 0) {
      refAboveIdx.value = signalLayerIdx.value - 1
    }
  }
  if (stackupId.value !== 'custom') syncLayerGeometryAndMode(true)
}

function onRefBelowChange(val: string | number | null): void {
  if (val === null) return
  const parsed = Number(val)
  refBelowIdx.value = parsed < 0 ? null : parsed
  if (refAboveIdx.value === null && refBelowIdx.value === null) {
    refAboveIdx.value = signalLayerIdx.value > 0 ? signalLayerIdx.value - 1 : null
    if (refAboveIdx.value === null && signalLayerIdx.value < stackupStructure.value.layers - 1) {
      refBelowIdx.value = signalLayerIdx.value + 1
    }
  }
  if (stackupId.value !== 'custom') syncLayerGeometryAndMode(true)
}

function applyStackup(id: string, autoSolve = true): void {
  stackupId.value = id
  activeUserPresetId.value = null
  if (id === 'custom') {
    if (autoSolve) autoMatchBestRecommendation()
    return
  }
  const userMatch = userStackupPresets.list.find((item) => item.id === id)
  const source = userMatch ?? getStackupPreset(id)
  customMinTrackMil.value = source.minTrackMil
  const total = stackupStructure.value.layers
  if (signalLayerIdx.value >= total) {
    signalLayerIdx.value = 0
  }
  if (lineMeta.value.isInnerLayer && total <= 2) {
    signalLayerIdx.value = 0
    refAboveIdx.value = null
    refBelowIdx.value = 1
  } else {
    refAboveIdx.value = signalLayerIdx.value > 0 ? signalLayerIdx.value - 1 : null
    refBelowIdx.value = signalLayerIdx.value < total - 1 ? signalLayerIdx.value + 1 : null
  }
  syncLayerGeometryAndMode(autoSolve)
}

function resolveModeForHighSpeedPreset(preset: HighSpeedPreset): TransmissionLineMode {
  const presetMeta = getTransmissionModeMeta(preset.mode)
  const currentMeta = lineMeta.value
  if (presetMeta.isDifferential) {
    if (currentMeta.usesCoplanarGnd || resolvedStackupMeta.value.layers === 2) return 'diff-cpwg'
    if (currentMeta.isInnerLayer && resolvedStackupMeta.value.layers > 2) return 'diff-stripline'
    return preset.mode
  }
  if (currentMeta.usesCoplanarGnd || resolvedStackupMeta.value.layers === 2) return 'cpwg'
  if (currentMeta.isInnerLayer && resolvedStackupMeta.value.layers > 2) return 'stripline'
  return preset.mode
}

function selectHighSpeedPreset(preset: HighSpeedPreset): void {
  activeHighSpeedId.value = preset.id
  activeUserPresetId.value = null
  lineMode.value = resolveModeForHighSpeedPreset(preset)
  targetZ.value = preset.targetZ
  applyStackup(stackupId.value, false)
  autoMatchBestRecommendation()
}

function focusInputInside(container: HTMLElement | null): void {
  const input = container?.querySelector('input')
  if (input) {
    input.focus()
    input.select()
  }
}

function activateCustomHighSpeed(): void {
  activeHighSpeedId.value = null
  activeUserPresetId.value = null
  void nextTick(() => focusInputInside(targetZFieldRef.value))
}

function activateCustomStackup(): void {
  stackupId.value = 'custom'
  activeUserPresetId.value = null
  void nextTick(() => focusInputInside(hFieldRef.value))
}

function onLineModeChange(nextValue: TransmissionLineMode): void {
  lineMode.value = nextValue
  activeUserPresetId.value = null
  const nextMeta = getTransmissionModeMeta(nextValue)
  if (
    activeHighSpeed.value &&
    getTransmissionModeMeta(activeHighSpeed.value.mode).isDifferential !== nextMeta.isDifferential
  ) {
    activeHighSpeedId.value = null
  }
  const total = stackupStructure.value.layers
  if (nextMeta.isInnerLayer && total > 2) {
    if (signalLayerIdx.value === 0 || signalLayerIdx.value === total - 1) {
      signalLayerIdx.value = 1
    }
    refAboveIdx.value = signalLayerIdx.value - 1
    refBelowIdx.value = signalLayerIdx.value + 1
  } else if (
    !nextMeta.isInnerLayer &&
    signalLayerIdx.value > 0 &&
    signalLayerIdx.value < total - 1
  ) {
    signalLayerIdx.value = 0
    refAboveIdx.value = null
    refBelowIdx.value = 1
  }
  if (stackupId.value !== 'custom') {
    syncLayerGeometryAndMode(true)
  } else {
    autoMatchBestRecommendation()
  }
}

function applyUserPreset(preset: UserTracePreset): void {
  activeUserPresetId.value = preset.id
  activeHighSpeedId.value = null
  stackupId.value = preset.stackupId
  lineMode.value = preset.mode
  targetZ.value = preset.targetZ
  wMil.value = preset.wMil
  sMil.value = preset.sMil
  sGndMil.value = preset.sGndMil
  hMil.value = preset.hMil
  h2Mil.value = preset.h2Mil
  tMil.value = preset.tMil
  er.value = preset.er
}

// 首次挂载时根据默认层叠和 USB 2.0 HS 匹配精确推荐值
autoMatchBestRecommendation()

function isRecommendationActive(rec: TraceRecommendation): boolean {
  const wMatch = Math.abs(wMil.value - rec.wMil) < 0.08
  const sMatch = !lineMeta.value.isDifferential || Math.abs(sMil.value - rec.sMil) < 0.08
  const gndMatch = !lineMeta.value.usesCoplanarGnd || Math.abs(sGndMil.value - rec.sGndMil) < 0.08
  return wMatch && sMatch && gndMatch
}

type GeometryField = 'wMil' | 'sMil' | 'sGndMil' | 'hMil' | 'h2Mil' | 'tMil' | 'minTrackMil'

function onGeometryInput(field: GeometryField, value: number | null): void {
  if (value === null || !Number.isFinite(value)) return
  activeUserPresetId.value = null
  const minMil =
    field === 'tMil'
      ? 0.1
      : field === 'sMil' ||
          field === 'sGndMil' ||
          field === 'hMil' ||
          field === 'h2Mil' ||
          field === 'minTrackMil'
        ? 0.5
        : 0.2
  const nextMil = Math.max(minMil, fromUnitValue(value, unit.value))
  if (field === 'wMil') {
    wMil.value = nextMil
  } else if (field === 'sMil') {
    sMil.value = nextMil
  } else if (field === 'sGndMil') {
    sGndMil.value = nextMil
  } else if (field === 'hMil') {
    hMil.value = nextMil
    stackupId.value = 'custom'
  } else if (field === 'h2Mil') {
    h2Mil.value = nextMil
    stackupId.value = 'custom'
  } else if (field === 'tMil') {
    tMil.value = nextMil
    stackupId.value = 'custom'
  } else {
    customMinTrackMil.value = nextMil
    stackupId.value = 'custom'
  }
}

function setCopperOz(oz: number): void {
  activeUserPresetId.value = null
  stackupId.value = 'custom'
  tMil.value = Number(ozToMil(oz).toFixed(3))
}

function onTargetZUpdate(value: number | null): void {
  if (value === null || !Number.isFinite(value)) return
  targetZ.value = value
  activeHighSpeedId.value = null
  activeUserPresetId.value = null
}

function onErUpdate(value: number | null): void {
  if (value === null || !Number.isFinite(value)) return
  activeUserPresetId.value = null
  stackupId.value = 'custom'
  er.value = value
}

function onNeighborGapUpdate(value: number | null): void {
  if (value === null || !Number.isFinite(value)) return
  neighborEdgeGapMil.value = Math.max(1, fromUnitValue(value, unit.value))
}

function applyRecommendedNeighborGap(): void {
  neighborEdgeGapMil.value = Number(crosstalkResult.value.recommendedPairGapMil.toFixed(2))
}

/* 打开工具参考警告弹窗 ----------------------------------------------------- */
const disclaimerOpen = ref(true)

/* 个人接口预设 & 个人层叠预设弹窗 ----------------------------------------- */
const saveDialogOpen = ref(false)
const presetNameDraft = ref('')

const saveStackupDialogOpen = ref(false)
const stackupNameDraft = ref('')

function openSaveDialog(): void {
  const baseLabel = activeHighSpeed.value ? activeHighSpeed.value.label : `${targetZ.value}Ω`
  presetNameDraft.value = `${baseLabel} · ${resolvedStackupMeta.value.layers}L`
  saveDialogOpen.value = true
}

function confirmSavePreset(): void {
  const name = presetNameDraft.value.trim()
  if (!name) return
  const saved = saveUserTracePreset({
    name,
    mode: lineMode.value,
    stackupId: stackupId.value,
    targetZ: targetZ.value,
    wMil: Number(wMil.value.toFixed(2)),
    sMil: Number(sMil.value.toFixed(2)),
    sGndMil: Number(sGndMil.value.toFixed(2)),
    hMil: Number(hMil.value.toFixed(3)),
    h2Mil: Number(h2Mil.value.toFixed(3)),
    tMil: Number(tMil.value.toFixed(3)),
    er: Number(er.value.toFixed(2)),
  })
  activeUserPresetId.value = saved.id
  activeHighSpeedId.value = null
  saveDialogOpen.value = false
  toast.show({ type: 'success', message: `已保存接口预设：${saved.name}` })
}

function onDeleteUserPreset(id: string): void {
  if (activeUserPresetId.value === id) activeUserPresetId.value = null
  removeUserTracePreset(id)
  toast.show({ type: 'info', message: '已删除接口预设' })
}

function openSaveStackupDialog(): void {
  stackupNameDraft.value = `自定义 · H=${formatLength(hMil.value, unit.value)} Dk=${er.value.toFixed(2)}`
  saveStackupDialogOpen.value = true
}

function confirmSaveStackup(): void {
  const name = stackupNameDraft.value.trim()
  if (!name) return
  const copperOz = Number((tMil.value / 1.378).toFixed(2))
  const saved = saveUserStackupPreset({
    name,
    layers: 4,
    outerHMil: Number(hMil.value.toFixed(3)),
    outerEr: Number(er.value.toFixed(2)),
    innerH1Mil: Number(hMil.value.toFixed(3)),
    innerH2Mil: Number(h2Mil.value.toFixed(3)),
    innerEr: Number(er.value.toFixed(2)),
    outerCopperOz: copperOz,
    innerCopperOz: copperOz,
    minTrackMil: Number(customMinTrackMil.value.toFixed(2)),
  })
  stackupId.value = saved.id
  saveStackupDialogOpen.value = false
  toast.show({ type: 'success', message: `已保存层叠预设：${saved.name}` })
}

function onDeleteUserStackup(id: string): void {
  if (stackupId.value === id) stackupId.value = 'custom'
  removeUserStackupPreset(id)
  toast.show({ type: 'info', message: '已删除层叠预设' })
}

/* ------------------------------------------------------------------------- */
/* 模式二：载流与压降                                                         */
/* ------------------------------------------------------------------------- */

const solveMode = ref<CurrentSolveMode>('current-to-width')
const targetCurrentA = ref<number>(2.0)
const currentWidthMil = ref<number>(30)
const traceLayer = ref<TraceLayerKind>('external')
const currentCopperOz = ref<number>(1)
const tempRiseC = ref<number>(pcbCalcSettings.defaultTempRiseC)
const ambientTempC = ref<number>(pcbCalcSettings.ambientTempC)
const traceLengthMm = ref<number>(50)
const supplyVoltageV = ref<number>(5.0)

watch(
  () => [pcbCalcSettings.defaultTempRiseC, pcbCalcSettings.ambientTempC],
  ([dt, amb]) => {
    if (typeof dt === 'number') tempRiseC.value = dt
    if (typeof amb === 'number') ambientTempC.value = amb
  },
)

const activePowerRailId = computed(
  () =>
    POWER_RAIL_PRESETS.find(
      (rail) => rail.voltageV === supplyVoltageV.value && rail.currentA === targetCurrentA.value,
    )?.id ?? null,
)

const currentResult = computed(() =>
  calculateTraceCurrent({
    solveMode: solveMode.value,
    targetCurrentA: targetCurrentA.value,
    widthMil: currentWidthMil.value,
    layer: traceLayer.value,
    copperOz: currentCopperOz.value,
    tempRiseC: tempRiseC.value,
    ambientTempC: ambientTempC.value,
    lengthMm: traceLengthMm.value,
    supplyVoltageV: supplyVoltageV.value,
  }),
)

function applyPowerRail(railId: string): void {
  const rail = POWER_RAIL_PRESETS.find((item) => item.id === railId)
  if (!rail) return
  solveMode.value = 'current-to-width'
  supplyVoltageV.value = rail.voltageV
  targetCurrentA.value = rail.currentA
}

function focusCustomCurrent(): void {
  solveMode.value = 'current-to-width'
  void nextTick(() => focusInputInside(currentInputWrapRef.value))
}

function onCurrentWidthUpdate(value: number | null): void {
  if (value === null || !Number.isFinite(value)) return
  currentWidthMil.value = Math.max(1, fromUnitValue(value, unit.value))
}

type CurrentField = 'targetCurrentA' | 'tempRiseC' | 'traceLengthMm' | 'supplyVoltageV'

function onCurrentField(field: CurrentField, value: number | null): void {
  if (value === null || !Number.isFinite(value)) return
  if (field === 'targetCurrentA') targetCurrentA.value = value
  else if (field === 'tempRiseC') tempRiseC.value = value
  else if (field === 'traceLengthMm') traceLengthMm.value = value
  else supplyVoltageV.value = value
}

/* ------------------------------------------------------------------------- */
/* 模式三：过孔参数                                                           */
/* ------------------------------------------------------------------------- */

const activeViaPresetId = ref<string>('jlc-03-06')
const viaHoleDiaMm = ref<number>(0.3)
const viaPadDiaMm = ref<number>(0.6)
const viaAntiPadDiaMm = ref<number>(0.9)
const viaBoardThicknessMm = ref<number>(1.6)
const viaPlatingUm = ref<number>(20)
const viaTempRiseC = ref<number>(pcbCalcSettings.defaultTempRiseC)
const viaTotalCurrentA = ref<number>(2.5)
const viaEr = ref<number>(4.2)

const viaResult = computed(() =>
  calculateViaParams({
    holeDiaMm: viaHoleDiaMm.value,
    padDiaMm: viaPadDiaMm.value,
    antiPadDiaMm: viaAntiPadDiaMm.value,
    boardThicknessMm: viaBoardThicknessMm.value,
    platingUm: viaPlatingUm.value,
    tempRiseC: viaTempRiseC.value,
    ambientTempC: pcbCalcSettings.ambientTempC,
    totalCurrentA: viaTotalCurrentA.value,
    er: viaEr.value,
  }),
)

function applyViaPreset(id: string): void {
  const preset = VIA_PRESETS.find((item) => item.id === id)
  if (!preset) return
  activeViaPresetId.value = preset.id
  viaHoleDiaMm.value = preset.holeDiaMm
  viaPadDiaMm.value = preset.padDiaMm
  viaAntiPadDiaMm.value = preset.antiPadDiaMm
}

function focusCustomVia(): void {
  activeViaPresetId.value = ''
  void nextTick(() => focusInputInside(viaHoleWrapRef.value))
}

type ViaField =
  | 'holeDiaMm'
  | 'padDiaMm'
  | 'antiPadDiaMm'
  | 'boardThicknessMm'
  | 'platingUm'
  | 'totalCurrentA'
  | 'tempRiseC'
  | 'er'

function onViaField(field: ViaField, value: number | null): void {
  if (value === null || !Number.isFinite(value)) return
  if (field === 'holeDiaMm') {
    activeViaPresetId.value = ''
    viaHoleDiaMm.value = value
  } else if (field === 'padDiaMm') {
    activeViaPresetId.value = ''
    viaPadDiaMm.value = value
  } else if (field === 'antiPadDiaMm') {
    viaAntiPadDiaMm.value = value
  } else if (field === 'boardThicknessMm') {
    viaBoardThicknessMm.value = value
  } else if (field === 'platingUm') {
    viaPlatingUm.value = value
  } else if (field === 'totalCurrentA') {
    viaTotalCurrentA.value = value
  } else if (field === 'tempRiseC') {
    viaTempRiseC.value = value
  } else {
    viaEr.value = value
  }
}

/* ------------------------------------------------------------------------- */
/* 规则摘要复制                                                               */
/* ------------------------------------------------------------------------- */

function buildCopySummary(): string {
  if (toolMode.value === 'impedance') {
    const r = impedanceResult.value
    const ct = crosstalkResult.value
    const gapParts: string[] = []
    if (lineMeta.value.isDifferential)
      gapParts.push(`S=${formatDualLength(sMil.value, unit.value)}`)
    if (lineMeta.value.usesCoplanarGnd)
      gapParts.push(`S_gnd=${formatDualLength(sGndMil.value, unit.value)}`)
    const gapDesc = gapParts.length > 0 ? gapParts.join(' | ') : '单端'
    return [
      `[${activeHighSpeed.value?.label ?? lineMeta.value.label}] ${resolvedStackupMeta.value.label}`,
      `W=${formatDualLength(wMil.value, unit.value)} | ${gapDesc} | H=${formatDualLength(hMil.value, unit.value)} | Dk=${er.value.toFixed(2)}`,
      `实际阻抗=${r.primaryZ.toFixed(1)}Ω (目标 ${targetZ.value}Ω, 误差 ${r.errorPct >= 0 ? '+' : ''}${r.errorPct.toFixed(1)}%) | 延时=${r.delayPsPerMm.toFixed(2)}ps/mm`,
      `防串扰净距: 3W=${formatLength(ct.edgeGap3WMil, unit.value)}, 5W=${formatLength(ct.edgeGap5WMil, unit.value)}, 3H=${formatLength(ct.edgeGap3HMil, unit.value)}, 推荐对间≥${formatLength(ct.recommendedPairGapMil, unit.value)}`,
    ].join('\n')
  }
  if (toolMode.value === 'current') {
    const cr = currentResult.value
    return [
      `[PCB 载流] ${traceLayer.value === 'external' ? '外层' : '内层'} ${currentCopperOz.value}oz · 温升 ${tempRiseC.value}°C`,
      `电流=${cr.activeCurrentA.toFixed(2)}A | 线宽=${formatDualLength(cr.activeWidthMil, unit.value)} | 长=${traceLengthMm.value}mm`,
      `直流电阻=${cr.resistanceMOhm.toFixed(1)}mΩ | 压降=${cr.voltageDropMv.toFixed(1)}mV (${cr.voltageDropPct.toFixed(2)}%) | 功耗=${cr.powerLossMw.toFixed(1)}mW`,
    ].join('\n')
  }
  const vr = viaResult.value
  return [
    `[PCB 过孔] 孔=${viaHoleDiaMm.value}mm / 盘=${viaPadDiaMm.value}mm / 板厚=${viaBoardThicknessMm.value}mm / 镀铜=${viaPlatingUm.value}μm`,
    `单孔载流=${vr.singleViaCurrentA.toFixed(2)}A | 目标${viaTotalCurrentA.value}A 建议并联=${vr.recommendedCount}孔 | 等效1oz线宽=${formatLength(vr.equivalent1OzWidthMil, unit.value)}`,
    `寄生 L=${vr.parasiticIndNh.toFixed(2)}nH | C=${vr.parasiticCapPf.toFixed(2)}pF | Z_via=${vr.viaImpedanceOhm.toFixed(1)}Ω`,
  ].join('\n')
}

async function copySummary(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    toast.show({ type: 'warn', message: '当前环境不支持剪贴板写入' })
    return
  }
  try {
    await navigator.clipboard.writeText(buildCopySummary())
    toast.show({ type: 'success', message: '已复制参数摘要到剪贴板' })
  } catch {
    toast.show({ type: 'error', message: '复制摘要失败' })
  }
}
</script>

<template>
  <section class="ui-tool-page pcb-tool" data-testid="pcb-calc-tool">
    <!-- 顶栏 -->
    <header class="ui-toolbar pcb-toolbar">
      <div class="ui-toolbar__group pcb-toolbar__modes">
        <UiSegmented
          :model-value="toolMode"
          :options="toolModeOptions"
          size="md"
          aria-label="计算模块"
          data-testid="pcb-mode-tabs"
          @update:model-value="toolMode = $event as ToolMode"
        />
      </div>

      <div class="ui-toolbar__group pcb-toolbar__actions">
        <UiSegmented
          :model-value="unit"
          :options="unitOptions"
          size="md"
          aria-label="主长度单位"
          data-testid="pcb-unit-toggle"
          @update:model-value="unit = $event as LengthUnit"
        />
        <UiButton
          v-if="toolMode === 'impedance'"
          size="md"
          data-testid="pcb-save-preset-btn"
          @click="openSaveDialog"
        >
          <BookmarkPlus :size="15" aria-hidden="true" />
          存为预设
        </UiButton>
        <UiButton size="md" variant="primary" data-testid="pcb-copy-summary" @click="copySummary">
          <Copy :size="15" aria-hidden="true" />
          复制摘要
        </UiButton>
      </div>
    </header>

    <!-- ===================================================================== -->
    <!-- 模式一：特征阻抗与防串扰                                                -->
    <!-- ===================================================================== -->
    <template v-if="toolMode === 'impedance'">
      <!-- 常用高速线 & 层叠预设快捷条 -->
      <section class="ui-panel pcb-preset-bar">
        <div class="ui-panel__body pcb-preset-bar__body">
          <div class="pcb-chip-group">
            <span class="eyebrow pcb-chip-label">高速接口</span>
            <div class="pcb-chips" role="group" aria-label="高速接口预设与自定义">
              <button
                v-for="preset in HIGH_SPEED_PRESETS"
                :key="preset.id"
                type="button"
                class="pcb-chip"
                :class="{ 'is-active': activeHighSpeedId === preset.id }"
                :data-testid="`pcb-hs-preset-${preset.id}`"
                @click="selectHighSpeedPreset(preset)"
              >
                <span class="pcb-chip__title">{{ preset.label }}</span>
                <span class="pcb-chip__badge">{{ preset.badge }}</span>
              </button>

              <div
                v-for="up in userTracePresets.list"
                :key="up.id"
                class="pcb-user-chip"
                :class="{ 'is-active': activeUserPresetId === up.id }"
              >
                <button
                  type="button"
                  class="pcb-user-chip__btn"
                  :data-testid="`pcb-user-preset-${up.id}`"
                  @click="applyUserPreset(up)"
                >
                  <span class="pcb-chip__title">{{ up.name }}</span>
                  <span class="pcb-chip__badge">{{ up.targetZ }}Ω</span>
                </button>
                <button
                  type="button"
                  class="pcb-user-chip__del"
                  aria-label="删除预设"
                  @click="onDeleteUserPreset(up.id)"
                >
                  <Trash2 :size="13" aria-hidden="true" />
                </button>
              </div>

              <button
                type="button"
                class="pcb-chip pcb-chip--custom"
                :class="{ 'is-active': isCustomHighSpeed }"
                data-testid="pcb-hs-preset-custom"
                @click="activateCustomHighSpeed"
              >
                <SlidersHorizontal :size="13" aria-hidden="true" />
                <span class="pcb-chip__title">自定义接口</span>
              </button>
            </div>
          </div>

          <div class="hairline" />

          <div class="pcb-chip-group">
            <span class="eyebrow pcb-chip-label">PCB 层叠</span>
            <div class="pcb-chips" role="group" aria-label="层叠预设与自定义">
              <button
                v-for="st in STACKUP_PRESETS"
                :key="st.id"
                type="button"
                class="pcb-chip pcb-chip--stackup"
                :class="{ 'is-active': stackupId === st.id }"
                :data-testid="`pcb-stackup-${st.id}`"
                @click="applyStackup(st.id, true)"
              >
                <span class="pcb-chip__title">{{ st.label }}</span>
                <span class="pcb-chip__sub">
                  H {{ formatLength(st.outerHMil, unit) }} · Dk {{ st.outerEr.toFixed(2) }}
                </span>
              </button>

              <div
                v-for="us in userStackupPresets.list"
                :key="us.id"
                class="pcb-user-chip pcb-user-chip--stackup"
                :class="{ 'is-active': stackupId === us.id }"
              >
                <button
                  type="button"
                  class="pcb-user-chip__btn pcb-user-chip__btn--stackup"
                  :data-testid="`pcb-user-stackup-${us.id}`"
                  @click="applyStackup(us.id, true)"
                >
                  <span class="pcb-chip__title">{{ us.name }}</span>
                  <span class="pcb-chip__sub">
                    H {{ formatLength(us.outerHMil, unit) }} · Dk {{ us.outerEr.toFixed(2) }}
                  </span>
                </button>
                <button
                  type="button"
                  class="pcb-user-chip__del"
                  aria-label="删除层叠预设"
                  @click="onDeleteUserStackup(us.id)"
                >
                  <Trash2 :size="13" aria-hidden="true" />
                </button>
              </div>

              <button
                type="button"
                class="pcb-chip pcb-chip--stackup pcb-chip--custom"
                :class="{ 'is-active': isCustomStackup }"
                data-testid="pcb-stackup-custom"
                @click="activateCustomStackup"
              >
                <span class="pcb-chip__title">自定义层叠</span>
                <span class="pcb-chip__sub">手动设定介质 / Dk / 铜厚</span>
              </button>

              <UiButton size="md" data-testid="pcb-save-stackup-btn" @click="openSaveStackupDialog">
                <BookmarkPlus :size="14" aria-hidden="true" />
                保存当前层叠
              </UiButton>
            </div>
          </div>
        </div>
      </section>

      <div class="pcb-workspace">
        <!-- 左栏：传输线结构 + 推荐方案 + 几何微调 -->
        <div class="pcb-col-left">
          <section class="ui-panel">
            <div class="ui-panel__header">
              <div class="ui-panel__heading">
                <h2 class="ui-panel__title">传输线结构与推荐方案</h2>
              </div>
              <div class="ui-panel__actions">
                <UiBadge tone="muted" size="sm">{{ lineMeta.shortLabel }}</UiBadge>
              </div>
            </div>
            <div class="ui-panel__body">
              <!-- 大尺寸 3×2 / 2×3 网格单选按钮组 -->
              <div
                class="pcb-mode-grid"
                role="radiogroup"
                aria-label="传输线结构"
                data-testid="pcb-line-mode"
              >
                <button
                  v-for="opt in TRANSMISSION_MODE_OPTIONS"
                  :key="opt.value"
                  type="button"
                  role="radio"
                  :aria-checked="lineMode === opt.value"
                  class="pcb-mode-btn"
                  :class="{ 'is-active': lineMode === opt.value }"
                  @click="onLineModeChange(opt.value)"
                >
                  {{ opt.shortLabel }}
                </button>
              </div>

              <div ref="targetZFieldRef" class="pcb-target-row">
                <UiFormField label="目标阻抗" layout="horizontal">
                  <UiNumberInput
                    :model-value="targetZ"
                    :min="10"
                    :max="300"
                    :step="5"
                    unit="Ω"
                    size="md"
                    aria-label="目标阻抗"
                    data-testid="pcb-target-z"
                    @update:model-value="onTargetZUpdate"
                  />
                </UiFormField>
                <UiButton
                  size="md"
                  data-testid="pcb-auto-solve-btn"
                  @click="autoMatchBestRecommendation(true)"
                >
                  匹配线宽
                </UiButton>
              </div>

              <!-- 三档直选推荐方案（去除多余描述文字） -->
              <div class="pcb-rec-grid" data-testid="pcb-recommendations">
                <button
                  v-for="rec in recommendations"
                  :key="rec.id"
                  type="button"
                  class="pcb-rec-card"
                  :class="{ 'is-active': isRecommendationActive(rec) }"
                  :data-testid="`pcb-rec-${rec.id}`"
                  @click="applyRecommendation(rec, true)"
                >
                  <div class="pcb-rec-card__head">
                    <span class="pcb-rec-card__title">{{ rec.tierLabel }}</span>
                    <UiBadge :tone="rec.manufacturable ? 'ok' : 'warn'" size="sm">
                      {{ rec.actualZ.toFixed(1) }} Ω
                    </UiBadge>
                  </div>
                  <div class="pcb-rec-card__dims">
                    <span>W {{ formatLength(rec.wMil, unit) }}</span>
                    <span v-if="lineMeta.isDifferential">
                      · S {{ formatLength(rec.sMil, unit) }}
                    </span>
                    <span v-if="lineMeta.usesCoplanarGnd">
                      · 包地 {{ formatLength(rec.sGndMil, unit) }}
                    </span>
                  </div>
                  <div v-if="!rec.manufacturable" class="pcb-warn-text">
                    &lt; {{ formatLength(resolvedStackupMeta.minTrackMil, unit) }}
                  </div>
                </button>
              </div>
            </div>
          </section>

          <section class="ui-panel">
            <div class="ui-panel__header">
              <div class="ui-panel__heading">
                <h2 class="ui-panel__title">几何与介质参数</h2>
              </div>
              <div class="ui-panel__actions">
                <UiBadge :tone="isCustomStackup ? 'accent' : 'muted'" size="sm">
                  {{ resolvedStackupMeta.label }}
                </UiBadge>
              </div>
            </div>
            <div class="ui-panel__body">
              <div v-if="!isCustomStackup" class="pcb-layer-bar" data-testid="pcb-layer-selectors">
                <UiFormField label="布线层">
                  <UiSelect
                    :model-value="signalLayerIdx"
                    :options="signalLayerOptions"
                    size="md"
                    aria-label="布线层"
                    data-testid="pcb-signal-layer"
                    @update:model-value="onSignalLayerChange"
                  />
                </UiFormField>
                <UiFormField label="上参考平面">
                  <UiSelect
                    :model-value="refAboveIdx ?? -1"
                    :options="refAboveOptions"
                    :disabled="signalLayerIdx === 0"
                    size="md"
                    aria-label="上参考平面"
                    data-testid="pcb-ref-above"
                    @update:model-value="onRefAboveChange"
                  />
                </UiFormField>
                <UiFormField label="下参考平面">
                  <UiSelect
                    :model-value="refBelowIdx ?? -1"
                    :options="refBelowOptions"
                    :disabled="signalLayerIdx >= stackupStructure.layers - 1"
                    size="md"
                    aria-label="下参考平面"
                    data-testid="pcb-ref-below"
                    @update:model-value="onRefBelowChange"
                  />
                </UiFormField>
              </div>

              <div class="pcb-form-grid">
                <UiFormField
                  label="线宽 W"
                  :hint="
                    unit === 'mil' ? `${milToMm(wMil).toFixed(3)} mm` : `${wMil.toFixed(2)} mil`
                  "
                >
                  <UiNumberInput
                    :model-value="toUnitValue(wMil, unit)"
                    :min="0.02"
                    :max="500"
                    :step="unit === 'mm' ? 0.01 : 0.2"
                    :unit="unit"
                    size="md"
                    aria-label="线宽 W"
                    data-testid="pcb-input-w"
                    @update:model-value="onGeometryInput('wMil', $event)"
                  />
                </UiFormField>

                <UiFormField
                  v-if="lineMeta.isDifferential"
                  label="对内间距 S"
                  :hint="
                    unit === 'mil' ? `${milToMm(sMil).toFixed(3)} mm` : `${sMil.toFixed(2)} mil`
                  "
                >
                  <UiNumberInput
                    :model-value="toUnitValue(sMil, unit)"
                    :min="0.02"
                    :max="500"
                    :step="unit === 'mm' ? 0.01 : 0.5"
                    :unit="unit"
                    size="md"
                    aria-label="差分间距 S"
                    data-testid="pcb-input-s"
                    @update:model-value="onGeometryInput('sMil', $event)"
                  />
                </UiFormField>

                <UiFormField
                  v-if="lineMeta.usesCoplanarGnd"
                  label="包地净距 S_gnd"
                  :hint="
                    unit === 'mil'
                      ? `${milToMm(sGndMil).toFixed(3)} mm`
                      : `${sGndMil.toFixed(2)} mil`
                  "
                >
                  <UiNumberInput
                    :model-value="toUnitValue(sGndMil, unit)"
                    :min="0.02"
                    :max="500"
                    :step="unit === 'mm' ? 0.01 : 0.5"
                    :unit="unit"
                    size="md"
                    aria-label="包地间距"
                    data-testid="pcb-input-sgnd"
                    @update:model-value="onGeometryInput('sGndMil', $event)"
                  />
                </UiFormField>

                <div ref="hFieldRef" class="pcb-field-wrap">
                  <UiFormField
                    :label="lineMeta.isInnerLayer ? '上介质厚 H1' : '介质厚度 H'"
                    :hint="
                      unit === 'mil' ? `${milToMm(hMil).toFixed(3)} mm` : `${hMil.toFixed(2)} mil`
                    "
                  >
                    <UiNumberInput
                      :model-value="toUnitValue(hMil, unit)"
                      :min="0.02"
                      :max="500"
                      :step="unit === 'mm' ? 0.01 : 0.2"
                      :unit="unit"
                      size="md"
                      aria-label="介质厚度 H"
                      data-testid="pcb-input-h"
                      @update:model-value="onGeometryInput('hMil', $event)"
                    />
                  </UiFormField>
                </div>

                <UiFormField
                  v-if="lineMeta.isInnerLayer"
                  label="下介质厚 H2"
                  :hint="
                    unit === 'mil' ? `${milToMm(h2Mil).toFixed(3)} mm` : `${h2Mil.toFixed(2)} mil`
                  "
                >
                  <UiNumberInput
                    :model-value="toUnitValue(h2Mil, unit)"
                    :min="0.02"
                    :max="500"
                    :step="unit === 'mm' ? 0.01 : 0.5"
                    :unit="unit"
                    size="md"
                    aria-label="下介质厚度 H2"
                    data-testid="pcb-input-h2"
                    @update:model-value="onGeometryInput('h2Mil', $event)"
                  />
                </UiFormField>

                <UiFormField label="介电常数 Dk (εr)">
                  <UiNumberInput
                    :model-value="er"
                    :min="1"
                    :max="15"
                    :step="0.05"
                    :precision="2"
                    size="md"
                    aria-label="介电常数 Dk"
                    data-testid="pcb-input-er"
                    @update:model-value="onErUpdate"
                  />
                </UiFormField>

                <UiFormField
                  v-if="isCustomStackup"
                  label="最小工艺线宽/距"
                  :hint="
                    unit === 'mil'
                      ? `${milToMm(customMinTrackMil).toFixed(3)} mm`
                      : `${customMinTrackMil.toFixed(2)} mil`
                  "
                >
                  <UiNumberInput
                    :model-value="toUnitValue(customMinTrackMil, unit)"
                    :min="0.05"
                    :max="50"
                    :step="unit === 'mm' ? 0.01 : 0.5"
                    :unit="unit"
                    size="md"
                    aria-label="最小工艺线宽"
                    data-testid="pcb-input-mintrack"
                    @update:model-value="onGeometryInput('minTrackMil', $event)"
                  />
                </UiFormField>

                <UiFormField
                  class="pcb-field-full"
                  label="铜箔厚度 T"
                  :hint="`${(tMil / 1.378).toFixed(2)} oz`"
                >
                  <div class="pcb-copper-row">
                    <UiNumberInput
                      :model-value="toUnitValue(tMil, unit)"
                      :min="0.01"
                      :max="20"
                      :step="unit === 'mm' ? 0.005 : 0.1"
                      :unit="unit"
                      size="md"
                      aria-label="铜箔厚度 T"
                      data-testid="pcb-input-t"
                      @update:model-value="onGeometryInput('tMil', $event)"
                    />
                    <div class="pcb-copper-btns">
                      <UiButton size="md" @click="setCopperOz(0.5)">0.5oz</UiButton>
                      <UiButton size="md" @click="setCopperOz(1)">1oz</UiButton>
                      <UiButton size="md" @click="setCopperOz(2)">2oz</UiButton>
                    </div>
                  </div>
                </UiFormField>
              </div>
            </div>
          </section>
        </div>

        <!-- 右栏：计算结果、截面图与防串扰 -->
        <div class="pcb-col-right">
          <section class="ui-panel" data-testid="pcb-impedance-result">
            <div class="ui-panel__header">
              <div class="ui-panel__heading">
                <h2 class="ui-panel__title">{{ lineMeta.label }}计算结果</h2>
              </div>
            </div>

            <div class="ui-panel__body">
              <!-- 大号特征阻抗读数 -->
              <div class="pcb-hero-metric">
                <div class="pcb-hero-metric__main">
                  <span class="eyebrow">
                    {{ lineMeta.isDifferential ? '差分阻抗 Z_diff' : '特征阻抗 Z_0' }}
                  </span>
                  <div class="pcb-hero-metric__val" data-testid="pcb-z-result">
                    {{ impedanceResult.primaryZ.toFixed(1) }} <span class="pcb-unit">Ω</span>
                  </div>
                </div>
                <div class="pcb-hero-metric__sub">
                  <span class="ui-code-pill">目标 {{ targetZ.toFixed(0) }} Ω</span>
                  <span
                    class="ui-code-pill"
                    :class="isWithinTolerance ? 'pcb-pill--ok' : 'pcb-pill--warn'"
                  >
                    偏差 {{ impedanceResult.errorOhm >= 0 ? '+' : ''
                    }}{{ impedanceResult.errorOhm.toFixed(1) }} Ω ({{
                      impedanceResult.errorPct >= 0 ? '+' : ''
                    }}{{ impedanceResult.errorPct.toFixed(1) }}%)
                  </span>
                  <span
                    class="ui-code-pill"
                    :class="isManufacturable ? 'pcb-pill--ok' : 'pcb-pill--danger'"
                  >
                    {{
                      isManufacturable
                        ? `≥ ${formatLength(resolvedStackupMeta.minTrackMil, unit)} 可加工`
                        : `< ${formatLength(resolvedStackupMeta.minTrackMil, unit)}`
                    }}
                  </span>
                </div>
              </div>

              <!-- 衍生电学参数网格 -->
              <div class="pcb-stats-grid">
                <div v-if="impedanceResult.zOdd !== null" class="ui-stat-card">
                  <span class="ui-stat-card__label">奇模 / 偶模阻抗</span>
                  <span class="ui-stat-card__value">
                    {{ impedanceResult.zOdd.toFixed(1) }} /
                    {{ impedanceResult.zEven?.toFixed(1) }} Ω
                  </span>
                </div>
                <div v-else class="ui-stat-card">
                  <span class="ui-stat-card__label">有效介电常数 ε_eff</span>
                  <span class="ui-stat-card__value">{{ impedanceResult.effEr.toFixed(2) }}</span>
                </div>

                <div class="ui-stat-card">
                  <span class="ui-stat-card__label">传播延时</span>
                  <span class="ui-stat-card__value">
                    {{ impedanceResult.delayPsPerMm.toFixed(2) }} ps/mm
                  </span>
                </div>

                <div class="ui-stat-card">
                  <span class="ui-stat-card__label">单位电感 / 电容</span>
                  <span class="ui-stat-card__value">
                    {{ impedanceResult.inductanceNhPerMm.toFixed(2) }} nH /
                    {{ impedanceResult.capacitancePfPerMm.toFixed(3) }} pF
                  </span>
                </div>
              </div>

              <!-- 矢量截面图 -->
              <div class="ui-preview-stage pcb-svg-stage">
                <PcbCrossSectionSvg
                  :kind="lineMode"
                  :unit="unit"
                  :w-mil="wMil"
                  :s-mil="sMil"
                  :s-gnd-mil="sGndMil"
                  :h-mil="hMil"
                  :h2-mil="h2Mil"
                  :t-mil="tMil"
                  :er="er"
                  :ref-label="svgRefLabels.single"
                  :ref-above-label="svgRefLabels.above"
                  :ref-below-label="svgRefLabels.below"
                />
              </div>
            </div>
          </section>

          <!-- 防串扰间距 & 等长绕线面板 -->
          <section class="ui-panel" data-testid="pcb-crosstalk-panel">
            <div class="ui-panel__header">
              <div class="ui-panel__heading">
                <h2 class="ui-panel__title">防串扰间距与蛇形等长</h2>
              </div>
              <div class="ui-panel__actions">
                <UiBadge
                  v-if="activeHighSpeed?.maxIntraPairSkewMil !== null && activeHighSpeed"
                  tone="accent"
                  size="sm"
                >
                  对内 ≤ {{ formatLength(activeHighSpeed.maxIntraPairSkewMil, unit) }}
                </UiBadge>
                <UiBadge
                  :tone="
                    crosstalkResult.nextLevel === 'low'
                      ? 'ok'
                      : crosstalkResult.nextLevel === 'moderate'
                        ? 'accent'
                        : 'warn'
                  "
                  size="sm"
                >
                  NEXT {{ crosstalkResult.nextDb.toFixed(1) }} dB
                </UiBadge>
              </div>
            </div>

            <div class="ui-panel__body">
              <div class="pcb-crosstalk-top">
                <UiFormField
                  label="邻线净距 D (边到边)"
                  layout="horizontal"
                  :hint="
                    unit === 'mil'
                      ? `${milToMm(neighborEdgeGapMil).toFixed(3)} mm`
                      : `${neighborEdgeGapMil.toFixed(2)} mil`
                  "
                >
                  <UiNumberInput
                    :model-value="toUnitValue(neighborEdgeGapMil, unit)"
                    :min="0.05"
                    :max="500"
                    :step="unit === 'mm' ? 0.05 : 1"
                    :unit="unit"
                    size="md"
                    aria-label="当前邻线净距"
                    data-testid="pcb-input-neighbor-gap"
                    @update:model-value="onNeighborGapUpdate"
                  />
                </UiFormField>
                <UiButton size="md" @click="applyRecommendedNeighborGap">应用推荐净距</UiButton>
              </div>

              <div class="pcb-kv-list">
                <div class="ui-kv-row">
                  <span class="ui-kv-row__key">3W 净间距 (2×W)</span>
                  <span class="ui-kv-row__val">
                    {{ formatDualLength(crosstalkResult.edgeGap3WMil, unit) }}
                  </span>
                </div>
                <div class="ui-kv-row">
                  <span class="ui-kv-row__key">5W 净间距 (4×W)</span>
                  <span class="ui-kv-row__val">
                    {{ formatDualLength(crosstalkResult.edgeGap5WMil, unit) }}
                  </span>
                </div>
                <div class="ui-kv-row">
                  <span class="ui-kv-row__key">3H 耦合净距 (3×H)</span>
                  <span class="ui-kv-row__val">
                    {{ formatDualLength(crosstalkResult.edgeGap3HMil, unit) }}
                  </span>
                </div>
                <div class="ui-kv-row">
                  <span class="ui-kv-row__key">
                    {{ lineMeta.isDifferential ? '差分对间推荐净距' : '同层邻线推荐净距' }}
                  </span>
                  <span class="ui-kv-row__val pcb-val-accent">
                    ≥ {{ formatDualLength(crosstalkResult.recommendedPairGapMil, unit) }}
                  </span>
                </div>
                <div class="ui-kv-row">
                  <span class="ui-kv-row__key">
                    {{ lineMeta.usesCoplanarGnd ? '包地屏蔽过孔间距' : '周边铺铜净空' }}
                  </span>
                  <span class="ui-kv-row__val">
                    {{
                      lineMeta.usesCoplanarGnd
                        ? `≤ ${formatDualLength(crosstalkResult.cpwgViaPitchMil, unit)}`
                        : `≥ ${formatDualLength(crosstalkResult.copperPourGapMil, unit)}`
                    }}
                  </span>
                </div>
                <div class="ui-kv-row">
                  <span class="ui-kv-row__key">蛇形等长 (间隙 / 振幅)</span>
                  <span class="ui-kv-row__val">
                    {{ formatLength(crosstalkResult.tromboneMinGapMil, unit) }} / ≥
                    {{ formatLength(crosstalkResult.tromboneMinAmplitudeMil, unit) }}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>

    <!-- ===================================================================== -->
    <!-- 模式二：走线载流与压降                                                 -->
    <!-- ===================================================================== -->
    <template v-else-if="toolMode === 'current'">
      <section class="ui-panel pcb-preset-bar">
        <div class="ui-panel__body pcb-preset-bar__body">
          <div class="pcb-chip-group">
            <span class="eyebrow pcb-chip-label">常用电源轨</span>
            <div class="pcb-chips" role="group" aria-label="常用电源轨预设">
              <button
                v-for="rail in POWER_RAIL_PRESETS"
                :key="rail.id"
                type="button"
                class="pcb-chip"
                :class="{ 'is-active': activePowerRailId === rail.id }"
                :data-testid="`pcb-rail-${rail.id}`"
                @click="applyPowerRail(rail.id)"
              >
                <span class="pcb-chip__title">{{ rail.label }}</span>
              </button>

              <button
                type="button"
                class="pcb-chip pcb-chip--custom"
                :class="{ 'is-active': activePowerRailId === null }"
                @click="focusCustomCurrent"
              >
                <SlidersHorizontal :size="13" aria-hidden="true" />
                <span class="pcb-chip__title">自定义电流/电压</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <div class="pcb-workspace">
        <div class="pcb-col-left">
          <section class="ui-panel">
            <div class="ui-panel__header">
              <div class="ui-panel__heading">
                <h2 class="ui-panel__title">载流与温升参数</h2>
              </div>
            </div>
            <div class="ui-panel__body">
              <UiFormField label="计算方向">
                <UiSegmented
                  :model-value="solveMode"
                  :options="currentSolveOptions"
                  size="md"
                  aria-label="载流计算方向"
                  data-testid="pcb-current-solve-mode"
                  @update:model-value="solveMode = $event as CurrentSolveMode"
                />
              </UiFormField>

              <div class="pcb-form-grid">
                <div v-if="solveMode === 'current-to-width'" ref="currentInputWrapRef">
                  <UiFormField label="目标电流 I">
                    <UiNumberInput
                      :model-value="targetCurrentA"
                      :min="0.05"
                      :max="200"
                      :step="0.5"
                      unit="A"
                      size="md"
                      aria-label="目标电流"
                      data-testid="pcb-current-input"
                      @update:model-value="onCurrentField('targetCurrentA', $event)"
                    />
                  </UiFormField>
                </div>

                <UiFormField
                  v-else
                  label="实际线宽 W"
                  :hint="
                    unit === 'mil'
                      ? `${milToMm(currentWidthMil).toFixed(3)} mm`
                      : `${currentWidthMil.toFixed(2)} mil`
                  "
                >
                  <UiNumberInput
                    :model-value="toUnitValue(currentWidthMil, unit)"
                    :min="0.05"
                    :max="2000"
                    :step="unit === 'mm' ? 0.1 : 5"
                    :unit="unit"
                    size="md"
                    aria-label="实际线宽"
                    data-testid="pcb-current-width-input"
                    @update:model-value="onCurrentWidthUpdate"
                  />
                </UiFormField>

                <UiFormField label="允许温升 ΔT">
                  <UiNumberInput
                    :model-value="tempRiseC"
                    :min="1"
                    :max="100"
                    :step="5"
                    unit="°C"
                    size="md"
                    aria-label="允许温升"
                    data-testid="pcb-current-dt"
                    @update:model-value="onCurrentField('tempRiseC', $event)"
                  />
                </UiFormField>

                <UiFormField label="铜层位置">
                  <UiSegmented
                    :model-value="traceLayer"
                    :options="layerKindOptions"
                    size="md"
                    aria-label="铜层位置"
                    @update:model-value="traceLayer = $event as TraceLayerKind"
                  />
                </UiFormField>

                <UiFormField label="铜箔厚度">
                  <UiSegmented
                    :model-value="currentCopperOz"
                    :options="copperOzOptions"
                    size="md"
                    aria-label="铜箔厚度"
                    @update:model-value="currentCopperOz = Number($event)"
                  />
                </UiFormField>

                <UiFormField label="走线长度 L">
                  <UiNumberInput
                    :model-value="traceLengthMm"
                    :min="1"
                    :max="5000"
                    :step="10"
                    unit="mm"
                    size="md"
                    aria-label="走线长度"
                    @update:model-value="onCurrentField('traceLengthMm', $event)"
                  />
                </UiFormField>

                <UiFormField label="供电电压 V">
                  <UiNumberInput
                    :model-value="supplyVoltageV"
                    :min="0.5"
                    :max="400"
                    :step="0.5"
                    unit="V"
                    size="md"
                    aria-label="供电电压"
                    @update:model-value="onCurrentField('supplyVoltageV', $event)"
                  />
                </UiFormField>
              </div>
            </div>
          </section>
        </div>

        <div class="pcb-col-right">
          <section class="ui-panel" data-testid="pcb-current-result">
            <div class="ui-panel__header">
              <div class="ui-panel__heading">
                <h2 class="ui-panel__title">载流能力与压降分析</h2>
              </div>
              <div class="ui-panel__actions">
                <UiBadge
                  :tone="
                    currentResult.voltageDropPct <= 2
                      ? 'ok'
                      : currentResult.voltageDropPct <= 5
                        ? 'warn'
                        : 'danger'
                  "
                  size="sm"
                >
                  压降占比 {{ currentResult.voltageDropPct.toFixed(2) }}%
                </UiBadge>
              </div>
            </div>

            <div class="ui-panel__body">
              <div class="pcb-hero-metric">
                <div class="pcb-hero-metric__main">
                  <span class="eyebrow">
                    {{
                      solveMode === 'current-to-width' ? '推荐最小线宽 W_min' : '安全最大载流 I_max'
                    }}
                  </span>
                  <div class="pcb-hero-metric__val" data-testid="pcb-current-main-val">
                    <template v-if="solveMode === 'current-to-width'">
                      {{ formatLength(currentResult.recommendedWidthMil, unit) }}
                    </template>
                    <template v-else>
                      {{ currentResult.maxCurrentA.toFixed(2) }} <span class="pcb-unit">A</span>
                    </template>
                  </div>
                </div>
                <div class="pcb-hero-metric__sub">
                  <span class="ui-code-pill">
                    {{ formatDualLength(currentResult.activeWidthMil, unit) }}
                  </span>
                  <span class="ui-code-pill">
                    工作温度 {{ currentResult.operatingTempC.toFixed(0) }} °C
                  </span>
                </div>
              </div>

              <div class="pcb-stats-grid">
                <div class="ui-stat-card">
                  <span class="ui-stat-card__label">直流电阻 R</span>
                  <span class="ui-stat-card__value">
                    {{ currentResult.resistanceMOhm.toFixed(1) }} mΩ
                  </span>
                </div>
                <div class="ui-stat-card">
                  <span class="ui-stat-card__label">走线压降 ΔV</span>
                  <span class="ui-stat-card__value">
                    {{ currentResult.voltageDropMv.toFixed(1) }} mV
                  </span>
                </div>
                <div class="ui-stat-card">
                  <span class="ui-stat-card__label">铜损发热功率</span>
                  <span class="ui-stat-card__value">
                    {{ currentResult.powerLossMw.toFixed(1) }} mW
                  </span>
                </div>
              </div>

              <div class="pcb-kv-list">
                <div
                  v-for="row in currentResult.tempRiseTable"
                  :key="row.tempRiseC"
                  class="ui-kv-row"
                >
                  <span class="ui-kv-row__key">允许温升 ΔT = {{ row.tempRiseC }} °C</span>
                  <span class="ui-kv-row__val">
                    {{
                      solveMode === 'current-to-width'
                        ? formatDualLength(row.recommendedWidthMil, unit)
                        : `${row.maxCurrentA.toFixed(2)} A`
                    }}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>

    <!-- ===================================================================== -->
    <!-- 模式三：过孔参数                                                       -->
    <!-- ===================================================================== -->
    <template v-else>
      <section class="ui-panel pcb-preset-bar">
        <div class="ui-panel__body pcb-preset-bar__body">
          <div class="pcb-chip-group">
            <span class="eyebrow pcb-chip-label">过孔规格</span>
            <div class="pcb-chips" role="group" aria-label="常用过孔规格与自定义">
              <button
                v-for="vp in VIA_PRESETS"
                :key="vp.id"
                type="button"
                class="pcb-chip pcb-chip--stackup"
                :class="{ 'is-active': activeViaPresetId === vp.id }"
                :data-testid="`pcb-via-preset-${vp.id}`"
                @click="applyViaPreset(vp.id)"
              >
                <span class="pcb-chip__title">{{ vp.label }}</span>
                <span class="pcb-chip__sub">{{ vp.tag }}</span>
              </button>

              <button
                type="button"
                class="pcb-chip pcb-chip--stackup pcb-chip--custom"
                :class="{ 'is-active': activeViaPresetId === '' }"
                @click="focusCustomVia"
              >
                <span class="pcb-chip__title">自定义孔径</span>
                <span class="pcb-chip__sub">任意孔径与焊盘</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <div class="pcb-workspace">
        <div class="pcb-col-left">
          <section class="ui-panel">
            <div class="ui-panel__header">
              <div class="ui-panel__heading">
                <h2 class="ui-panel__title">过孔几何与电流参数</h2>
              </div>
            </div>
            <div class="ui-panel__body">
              <div class="pcb-form-grid">
                <div ref="viaHoleWrapRef">
                  <UiFormField label="钻孔孔径 d">
                    <UiNumberInput
                      :model-value="viaHoleDiaMm"
                      :min="0.15"
                      :max="2.0"
                      :step="0.05"
                      unit="mm"
                      size="md"
                      aria-label="过孔孔径"
                      data-testid="pcb-via-hole"
                      @update:model-value="onViaField('holeDiaMm', $event)"
                    />
                  </UiFormField>
                </div>

                <UiFormField label="焊盘外径 D1">
                  <UiNumberInput
                    :model-value="viaPadDiaMm"
                    :min="0.25"
                    :max="4.0"
                    :step="0.05"
                    unit="mm"
                    size="md"
                    aria-label="焊盘外径"
                    @update:model-value="onViaField('padDiaMm', $event)"
                  />
                </UiFormField>

                <UiFormField label="反焊盘内径 D2">
                  <UiNumberInput
                    :model-value="viaAntiPadDiaMm"
                    :min="0.4"
                    :max="6.0"
                    :step="0.05"
                    unit="mm"
                    size="md"
                    aria-label="反焊盘直径"
                    @update:model-value="onViaField('antiPadDiaMm', $event)"
                  />
                </UiFormField>

                <UiFormField label="PCB 板厚 h">
                  <UiNumberInput
                    :model-value="viaBoardThicknessMm"
                    :min="0.4"
                    :max="3.2"
                    :step="0.2"
                    unit="mm"
                    size="md"
                    aria-label="PCB板厚"
                    @update:model-value="onViaField('boardThicknessMm', $event)"
                  />
                </UiFormField>

                <UiFormField label="孔壁镀铜厚度">
                  <UiNumberInput
                    :model-value="viaPlatingUm"
                    :min="10"
                    :max="50"
                    :step="5"
                    unit="μm"
                    size="md"
                    aria-label="孔壁镀铜厚度"
                    @update:model-value="onViaField('platingUm', $event)"
                  />
                </UiFormField>

                <UiFormField label="目标换层总电流">
                  <UiNumberInput
                    :model-value="viaTotalCurrentA"
                    :min="0.1"
                    :max="100"
                    :step="0.5"
                    unit="A"
                    size="md"
                    aria-label="目标换层总电流"
                    data-testid="pcb-via-current"
                    @update:model-value="onViaField('totalCurrentA', $event)"
                  />
                </UiFormField>

                <UiFormField label="允许温升 ΔT">
                  <UiNumberInput
                    :model-value="viaTempRiseC"
                    :min="5"
                    :max="60"
                    :step="5"
                    unit="°C"
                    size="md"
                    aria-label="过孔温升"
                    @update:model-value="onViaField('tempRiseC', $event)"
                  />
                </UiFormField>

                <UiFormField label="板材 Dk (εr)">
                  <UiNumberInput
                    :model-value="viaEr"
                    :min="1"
                    :max="15"
                    :step="0.1"
                    :precision="2"
                    size="md"
                    aria-label="过孔板材Dk"
                    @update:model-value="onViaField('er', $event)"
                  />
                </UiFormField>
              </div>
            </div>
          </section>
        </div>

        <div class="pcb-col-right">
          <section class="ui-panel" data-testid="pcb-via-result">
            <div class="ui-panel__header">
              <div class="ui-panel__heading">
                <h2 class="ui-panel__title">过孔载流与高速寄生参数</h2>
              </div>
              <div class="ui-panel__actions">
                <UiBadge tone="accent" size="sm">含 20% 均流余量</UiBadge>
              </div>
            </div>

            <div class="ui-panel__body">
              <div class="pcb-hero-metric">
                <div class="pcb-hero-metric__main">
                  <span class="eyebrow">建议并联过孔数</span>
                  <div class="pcb-hero-metric__val" data-testid="pcb-via-count">
                    {{ viaResult.recommendedCount }} <span class="pcb-unit">颗</span>
                  </div>
                </div>
                <div class="pcb-hero-metric__sub">
                  <span class="ui-code-pill">
                    单孔载流 {{ viaResult.singleViaCurrentA.toFixed(2) }} A
                  </span>
                  <span class="ui-code-pill">
                    等效 1oz 线宽 {{ formatLength(viaResult.equivalent1OzWidthMil, unit) }}
                  </span>
                </div>
              </div>

              <div class="pcb-stats-grid">
                <div class="ui-stat-card">
                  <span class="ui-stat-card__label">单孔电阻 / 并联压降</span>
                  <span class="ui-stat-card__value">
                    {{ viaResult.singleViaResistanceMOhm.toFixed(2) }} mΩ /
                    {{ viaResult.parallelDropMv.toFixed(2) }} mV
                  </span>
                </div>
                <div class="ui-stat-card">
                  <span class="ui-stat-card__label">寄生电感 L / 电容 C</span>
                  <span class="ui-stat-card__value">
                    {{ viaResult.parasiticIndNh.toFixed(2) }} nH /
                    {{ viaResult.parasiticCapPf.toFixed(2) }} pF
                  </span>
                </div>
                <div class="ui-stat-card">
                  <span class="ui-stat-card__label">过孔阻抗 Z_via / 拐点</span>
                  <span class="ui-stat-card__value">
                    {{ viaResult.viaImpedanceOhm.toFixed(1) }} Ω /
                    {{ viaResult.kneeFreqGhz.toFixed(1) }} GHz
                  </span>
                </div>
              </div>

              <div class="ui-preview-stage pcb-svg-stage">
                <PcbCrossSectionSvg
                  kind="via"
                  :unit="unit"
                  :hole-dia-mm="viaHoleDiaMm"
                  :pad-dia-mm="viaPadDiaMm"
                  :anti-pad-dia-mm="viaAntiPadDiaMm"
                  :board-thickness-mm="viaBoardThicknessMm"
                  :plating-um="viaPlatingUm"
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>

    <!-- 保存自定义接口走线预设弹窗 -->
    <UiDialog
      v-model="saveDialogOpen"
      title="保存为个人接口预设"
      width="400px"
      confirm-text="保存预设"
      :confirm-disabled="!presetNameDraft.trim()"
      @confirm="confirmSavePreset"
    >
      <UiFormField label="预设名称">
        <UiInput
          :model-value="presetNameDraft"
          :maxlength="28"
          placeholder="例如：项目A USB差分 90Ω"
          data-testid="pcb-preset-name-input"
          @update:model-value="presetNameDraft = $event"
          @enter="confirmSavePreset"
        />
      </UiFormField>
    </UiDialog>

    <!-- 保存自定义层叠预设弹窗 -->
    <UiDialog
      v-model="saveStackupDialogOpen"
      title="保存为个人层叠预设"
      width="400px"
      confirm-text="保存层叠"
      :confirm-disabled="!stackupNameDraft.trim()"
      @confirm="confirmSaveStackup"
    >
      <UiFormField label="层叠名称">
        <UiInput
          :model-value="stackupNameDraft"
          :maxlength="28"
          placeholder="例如：定制 6层 3313 (H=3.5mil)"
          data-testid="pcb-stackup-name-input"
          @update:model-value="stackupNameDraft = $event"
          @enter="confirmSaveStackup"
        />
      </UiFormField>
    </UiDialog>

    <!-- 打开工具参考警告弹窗 -->
    <UiDialog
      v-model="disclaimerOpen"
      title="计算结果参考提示"
      width="min(92vw, 440px)"
      :show-cancel="false"
      confirm-text="我知道了"
      data-testid="pcb-disclaimer-dialog"
      @confirm="disclaimerOpen = false"
    >
      <p class="pcb-disclaimer-text">该工具计算的结果可能与嘉立创官方有所偏差，一切以官方为准。</p>
    </UiDialog>
  </section>
</template>

<style scoped>
.pcb-tool {
  min-width: 0;
}

.pcb-toolbar {
  gap: var(--space-2);
}

.pcb-toolbar__modes,
.pcb-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.pcb-preset-bar__body {
  gap: var(--space-3);
  padding: 12px 14px;
}

.pcb-chip-group {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  min-width: 0;
}

.pcb-chip-label {
  flex: none;
  width: 72px;
  padding-top: 9px;
}

.pcb-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pcb-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-sunken);
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.3;
  transition:
    border-color 120ms ease,
    background-color 120ms ease,
    color 120ms ease;
}

.pcb-chip:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
  color: var(--text);
}

.pcb-chip.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text);
}

.pcb-chip--custom {
  border-style: dashed;
}

.pcb-chip--stackup {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 2px;
  min-height: 46px;
  padding: 6px 12px;
}

.pcb-chip__title {
  font-weight: 500;
  color: var(--text);
}

.pcb-chip__badge {
  color: var(--accent-strong);
  font-family: var(--font-mono);
  font-size: 11.5px;
}

.pcb-chip__sub {
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 11px;
}

.pcb-user-chip {
  display: inline-flex;
  align-items: stretch;
  min-height: 36px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-sunken);
  overflow: hidden;
}

.pcb-user-chip--stackup {
  min-height: 46px;
}

.pcb-user-chip.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.pcb-user-chip__btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 12px;
  font-size: 13px;
}

.pcb-user-chip__btn--stackup {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 2px;
}

.pcb-user-chip__del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  color: var(--text-faint);
  border-left: 1px solid var(--border);
}

.pcb-user-chip__del:hover {
  background: var(--danger-soft);
  color: var(--danger);
}

.pcb-workspace {
  display: grid;
  grid-template-columns: minmax(360px, 460px) minmax(0, 1fr);
  align-items: start;
  gap: var(--space-3);
}

.pcb-col-left,
.pcb-col-right {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

/* 3×2 大号传输线结构选择网格 */
.pcb-mode-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.pcb-mode-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-sunken);
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.2;
  text-align: center;
  transition:
    border-color 120ms ease,
    background-color 120ms ease,
    color 120ms ease;
}

.pcb-mode-btn:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
  color: var(--text);
}

.pcb-mode-btn.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-weight: 600;
}

.pcb-target-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.pcb-rec-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.pcb-rec-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 68px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-sunken);
  text-align: left;
  transition:
    border-color 120ms ease,
    background-color 120ms ease;
}

.pcb-rec-card:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}

.pcb-rec-card.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.pcb-rec-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.pcb-rec-card__title {
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.pcb-rec-card__dims {
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
}

.pcb-warn-text {
  color: var(--warn);
  font-family: var(--font-mono);
  font-size: 11px;
}

.pcb-layer-bar {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border);
}

.pcb-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3) var(--space-2);
}

.pcb-field-wrap {
  min-width: 0;
}

.pcb-field-full {
  grid-column: 1 / -1;
}

.pcb-copper-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.pcb-copper-row > :first-child {
  flex: 1 1 130px;
}

.pcb-copper-btns {
  display: flex;
  gap: 6px;
}

.pcb-hero-metric {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-sunken);
}

.pcb-hero-metric__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pcb-hero-metric__val {
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 26px;
  font-weight: 700;
  line-height: 1.15;
}

.pcb-unit {
  color: var(--text-dim);
  font-size: 14px;
  font-weight: 500;
}

.pcb-hero-metric__sub {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pcb-pill--ok {
  border-color: var(--ok);
  background: var(--ok-soft);
  color: var(--ok);
}

.pcb-pill--warn {
  border-color: var(--warn);
  background: var(--warn-soft);
  color: var(--warn);
}

.pcb-pill--danger {
  border-color: var(--danger);
  background: var(--danger-soft);
  color: var(--danger);
}

.pcb-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
}

.pcb-svg-stage {
  padding: var(--space-2);
}

.pcb-crosstalk-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.pcb-kv-list {
  display: flex;
  flex-direction: column;
}

.pcb-val-accent {
  color: var(--accent-strong);
  font-weight: 600;
}

@media (max-width: 1080px) {
  .pcb-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 768px) {
  .pcb-chip-group {
    flex-direction: column;
    gap: 6px;
  }

  .pcb-chip-label {
    width: auto;
    padding-top: 0;
  }

  .pcb-rec-grid,
  .pcb-stats-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 480px) {
  .pcb-toolbar {
    padding: 10px;
  }

  .pcb-toolbar__modes,
  .pcb-toolbar__actions {
    width: 100%;
    justify-content: space-between;
  }

  .pcb-mode-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .pcb-mode-btn {
    min-height: 42px;
  }

  .pcb-chip {
    min-height: 40px;
  }

  .pcb-layer-bar,
  .pcb-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.pcb-disclaimer-text {
  margin: 0;
  font-size: var(--text-sm);
  line-height: 1.65;
  color: var(--color-text);
}
</style>
