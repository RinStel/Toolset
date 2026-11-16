/**
 * 变量时间序列领域的公共入口（plan §6.7 / §6.8）。
 *
 * 工具与 `domains/dashboard` 只能通过本文件使用本领域；内部模块不得被外部直接导入。
 */

export { getSeriesHub } from './hub'
export { spectrum } from './fft'
export { minMaxDecimate } from './decimate'
export { exportSeriesCsv } from './export'

export type {
  ComputedVariable,
  DecimatedSeries,
  SeriesExportRange,
  SeriesHub,
  SeriesHubOptions,
  SeriesReadQuery,
  SeriesSlice,
  SeriesSource,
  Spectrum,
  SpectrumOptions,
  SpectrumScale,
  SpectrumWindow,
  VariableInfo,
} from './types'
