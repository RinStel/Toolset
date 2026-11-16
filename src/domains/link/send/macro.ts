/**
 * Macro runner (plan §6.6).
 *
 * All `send` steps are composed before the macro starts; a compose failure
 * rejects the start with the failing step number. The runner is UI-agnostic and
 * reports through callbacks, so the session can write the system log.
 */

import type { TransportSignals } from '../transport/types'
import { compose, type ComposeOptions } from './compose'

/** One step of a macro. */
export type MacroStep =
  | { type: 'send'; input: string; options: ComposeOptions }
  | { type: 'delay'; ms: number }
  | { type: 'signal'; dtr?: boolean; rts?: boolean; brk?: boolean }

/** A named, optionally looping list of steps. */
export interface Macro {
  id: string
  name: string
  loop: boolean
  /** At most 100 steps. */
  steps: MacroStep[]
}

/** Runtime status shown in the UI. */
export interface MacroStatus {
  macroId: string
  name: string
  /** 0-based index of the step currently running. */
  step: number
  loopCount: number
}

/** Step after composition; `send` steps already hold their bytes. */
export type PreparedMacroStep =
  | { type: 'send'; bytes: Uint8Array }
  | { type: 'delay'; ms: number }
  | { type: 'signal'; signals: TransportSignals }

export type MacroPrepareResult =
  { ok: true; steps: PreparedMacroStep[] } | { ok: false; error: string }

/** Limits from plan §6.6. */
export const MAX_MACRO_STEPS = 100
export const MACRO_DELAY_MIN = 10
export const MACRO_DELAY_MAX = 600_000

/** Why a macro stopped. */
export type MacroStopReason =
  'finished' | 'user' | 'write-error' | 'not-open' | 'signal-unsupported' | 'disposed'

/** Composes every `send` step; returns the first failure with its step number. */
export function prepareMacro(macro: Macro): MacroPrepareResult {
  if (!Array.isArray(macro.steps) || macro.steps.length === 0) {
    return { ok: false, error: '宏至少需要 1 个步骤' }
  }
  if (macro.steps.length > MAX_MACRO_STEPS) {
    return { ok: false, error: `宏的步骤不能超过 ${MAX_MACRO_STEPS} 个` }
  }
  const prepared: PreparedMacroStep[] = []
  for (let index = 0; index < macro.steps.length; index += 1) {
    const step = macro.steps[index] as MacroStep
    const stepNumber = index + 1
    if (step.type === 'send') {
      const composed = compose(step.input, step.options)
      if (!composed.ok) {
        return { ok: false, error: `第 ${stepNumber} 步组包失败：${composed.error}` }
      }
      prepared.push({ type: 'send', bytes: composed.bytes })
      continue
    }
    if (step.type === 'delay') {
      if (!Number.isInteger(step.ms) || step.ms < MACRO_DELAY_MIN || step.ms > MACRO_DELAY_MAX) {
        return {
          ok: false,
          error: `第 ${stepNumber} 步的延时必须在 ${MACRO_DELAY_MIN}–${MACRO_DELAY_MAX}ms 之间`,
        }
      }
      prepared.push({ type: 'delay', ms: step.ms })
      continue
    }
    if (step.type === 'signal') {
      if (step.dtr === undefined && step.rts === undefined && step.brk === undefined) {
        return { ok: false, error: `第 ${stepNumber} 步没有可设置的控制线` }
      }
      const signals: TransportSignals = {}
      if (step.dtr !== undefined) signals.dtr = step.dtr
      if (step.rts !== undefined) signals.rts = step.rts
      if (step.brk !== undefined) signals.brk = step.brk
      prepared.push({ type: 'signal', signals })
      continue
    }
    return { ok: false, error: `第 ${stepNumber} 步的类型未知` }
  }
  return { ok: true, steps: prepared }
}

/** Minimal timer functions so tests can inject their own. */
export interface MacroScheduler {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
}

export interface MacroRunnerOptions {
  send(bytes: Uint8Array): Promise<void>
  setSignals(signals: TransportSignals): Promise<void>
  /** False when the transport has no control lines (`capabilities.signals`). */
  signalsSupported(): boolean
  /** False when the session is no longer open. */
  isActive(): boolean
  onStatus?(status: MacroStatus): void
  onStop?(reason: MacroStopReason): void
  scheduler?: MacroScheduler
}

export interface MacroRunner {
  /** Validates and starts the macro; throws with a Chinese message when invalid. */
  start(macro: Macro): void
  /** Stops a running macro; `reason` defaults to `'user'`. */
  stop(reason?: MacroStopReason): void
  readonly status: MacroStatus | null
  readonly running: boolean
}

const defaultScheduler: MacroScheduler = {
  setTimeout(callback, delayMs) {
    return setTimeout(callback, delayMs)
  },
  clearTimeout(handle) {
    clearTimeout(handle)
  },
}

/** Creates one macro runner slot; a runner handles one macro at a time. */
export function createMacroRunner(options: MacroRunnerOptions): MacroRunner {
  const scheduler = options.scheduler ?? defaultScheduler
  let stopped = true
  let prepared: PreparedMacroStep[] = []
  let macroId = ''
  let macroName = ''
  let stepIndex = 0
  let loopCount = 0

  let timer: ReturnType<typeof setTimeout> | null = null
  let wake: (() => void) | null = null

  function statusValue(): MacroStatus {
    return { macroId, name: macroName, step: stepIndex, loopCount }
  }

  function clearWait(): void {
    if (timer !== null) {
      scheduler.clearTimeout(timer)
      timer = null
    }
    const resolver = wake
    wake = null
    resolver?.()
  }

  function wait(delayMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        timer = null
        wake = null
        resolve()
      }
      wake = finish
      timer = scheduler.setTimeout(finish, delayMs)
    })
  }

  function stop(reason: MacroStopReason): void {
    if (stopped) return
    stopped = true
    clearWait()
    options.onStop?.(reason)
  }

  async function run(loop: boolean): Promise<void> {
    while (!stopped) {
      for (let index = 0; index < prepared.length; index += 1) {
        if (stopped) return
        if (!options.isActive()) {
          stop('not-open')
          return
        }
        stepIndex = index
        options.onStatus?.(statusValue())
        const step = prepared[index] as PreparedMacroStep
        if (step.type === 'send') {
          try {
            await options.send(step.bytes)
          } catch {
            stop('write-error')
            return
          }
          continue
        }
        if (step.type === 'delay') {
          await wait(step.ms)
          if (stopped) return
          continue
        }
        if (!options.signalsSupported()) {
          stop('signal-unsupported')
          return
        }
        try {
          await options.setSignals(step.signals)
        } catch {
          stop('write-error')
          return
        }
      }
      if (stopped) return
      loopCount += 1
      options.onStatus?.(statusValue())
      if (!loop) {
        stop('finished')
        return
      }
      stepIndex = 0
    }
  }

  return {
    start(macro) {
      const result = prepareMacro(macro)
      if (!result.ok) {
        throw new Error(result.error)
      }
      if (!stopped) throw new Error('宏已在运行')
      prepared = result.steps
      macroId = macro.id
      macroName = macro.name
      stepIndex = 0
      loopCount = 0
      stopped = false
      options.onStatus?.(statusValue())
      void run(macro.loop)
    },
    stop(reason: MacroStopReason = 'user') {
      stop(reason)
    },
    get status(): MacroStatus | null {
      return stopped ? null : statusValue()
    },
    get running(): boolean {
      return !stopped
    },
  }
}
