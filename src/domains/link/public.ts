/**
 * 通道领域的公共入口（plan §6.7）。
 *
 * 工具只能通过本文件使用通道领域。
 */

export { getLinkManager } from './session/manager'
export type {
  LinkCreateOptions,
  LinkManager,
  LinkManagerAuthorizedEntry,
  LinkManagerOptions,
} from './session/manager'

export { getBridgeService } from './bridge/service'
export type {
  BridgeAddResult,
  BridgeMode,
  BridgeRule,
  BridgeService,
  BridgeSession,
  BridgeServiceOptions,
} from './bridge/service'

export { getPresetStore } from './presets/presets'
export type {
  Preset,
  PresetApplyResult,
  PresetApplyTarget,
  PresetExportFile,
  PresetImportResult,
  PresetInput,
  PresetStore,
} from './presets/presets'

export { getDeviceMemory } from './presets/devices'
export type { DeviceMemory, DeviceMemoryStore } from './presets/devices'

export { compose } from './send/compose'
export type { ComposeOptions, ComposeResult } from './send/compose'

export { exportLog } from './log/export'
export type { ExportFormat, ExportLogFile, ExportLogOptions } from './log/export'

export { DEFAULT_LOG_POLICY } from './log/policy'
export type { LogMode, LogPolicy } from './log/policy'

export type {
  ByteTransport,
  TransportCapabilities,
  TransportProvider,
  TransportSignals,
  TransportSupport,
} from './transport/types'
export type { SettingField, SettingValues } from '../../shared/contracts/settings'

export type {
  LinkSession,
  LinkSessionEvents,
  LinkSessionOptions,
  LinkSignals,
  LinkTasks,
  SessionProtocol,
  SessionStats,
} from './session/session'
export type { DecodedFrame } from './session/frames'
export type { RxOptions } from './session/rx-framer'
export type { DisplayMode, Origin, SessionState } from './session/state'
export type { LogBuffer, LogDecoded, LogEntriesEvent, LogEntry } from './log/buffer'
export type { Macro, MacroStatus, MacroStep } from './send/macro'
export type { RepeatOptions, RepeatStatus } from './send/repeat'
