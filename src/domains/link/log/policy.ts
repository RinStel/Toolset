/**
 * Per-session log policy (plan §6.6).
 *
 * The policy only controls which *decoded frames* become log entries; the
 * session `frames` event is never sampled and the no-protocol read framing,
 * unframed bytes, decode errors and TX traffic are logged regardless.
 */

/** How decoded frames are written to the log buffer. */
export type LogMode = 'all' | 'sampled' | 'none'

/** See plan §6.6; `auto` is turned off by a manual mode change. */
export interface LogPolicy {
  mode: LogMode
  /** Upper bound of decoded entries per second in `sampled` mode (≥ 1). */
  maxPerSecond: number
  /** Automatically switch `all` → `sampled` when the frame rate is too high. */
  auto: boolean
}

/** All accepted modes, in menu order. */
export const LOG_MODES: readonly LogMode[] = ['all', 'sampled', 'none']

/** Default `maxPerSecond` from plan §6.6. */
export const DEFAULT_LOG_MAX_PER_SECOND = 20

/** Default policy from plan §6.6. */
export const DEFAULT_LOG_POLICY: Readonly<LogPolicy> = Object.freeze({
  mode: 'all',
  maxPerSecond: DEFAULT_LOG_MAX_PER_SECOND,
  auto: true,
})

/** Decoded frames per second that counts as 「速率过高」 (plan §6.6). */
export const AUTO_SAMPLE_THRESHOLD_FPS = 200

/** Number of consecutive high-rate seconds needed before switching to sampled. */
export const AUTO_SAMPLE_SECONDS = 2

export function isLogMode(value: unknown): value is LogMode {
  return typeof value === 'string' && (LOG_MODES as readonly string[]).includes(value)
}

/** Fills missing/invalid fields with defaults; `maxPerSecond` is clamped to ≥ 1. */
export function normalizeLogPolicy(input?: Partial<LogPolicy> | null): LogPolicy {
  const mode = isLogMode(input?.mode) ? input.mode : DEFAULT_LOG_POLICY.mode
  const rawMax = input?.maxPerSecond
  const maxPerSecond =
    typeof rawMax === 'number' && Number.isFinite(rawMax)
      ? Math.max(1, Math.round(rawMax))
      : DEFAULT_LOG_MAX_PER_SECOND
  const auto = typeof input?.auto === 'boolean' ? input.auto : DEFAULT_LOG_POLICY.auto
  return { mode, maxPerSecond, auto }
}

export function isSameLogPolicy(left: LogPolicy, right: LogPolicy): boolean {
  return (
    left.mode === right.mode && left.maxPerSecond === right.maxPerSecond && left.auto === right.auto
  )
}

/** System log text for the frames omitted in the last second (plan §6.6). */
export function omittedFramesText(count: number): string {
  const safe = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0
  return `已省略 ${safe} 帧`
}

/**
 * System log text written when `auto` switches the policy to sampled
 * (plan §6.6 / §9).
 */
export function autoSampledText(framesPerSecond: number): string {
  const rate = Number.isFinite(framesPerSecond) ? Math.max(0, Math.round(framesPerSecond)) : 0
  return `数据帧速率过高（约 ${rate} 帧/秒），日志已切换为抽样记录，可在日志工具栏中修改`
}
