/**
 * Appearance store (plan.md §7.2, §7.4).
 *
 * Theme, UI style, font size and density are persisted in `toolset/app/settings.v1`
 * (`{ version: 1, data: { theme, style, fontSize, density } }`), the same key the inline
 * script in `index.html` reads before first paint. The store owns all DOM side
 * effects: `data-theme`, `data-style`, `data-density` and `--font-size`.
 *
 * It intentionally uses Vue's plain reactivity instead of Pinia so the shell can
 * import it without an active Pinia instance and component tests stay trivial.
 * Storage is only read in {@link initAppearance} so `main.ts` can register the
 * storage issue handler first and surface corrupt-data warnings as toasts.
 */

import { computed, reactive, readonly, ref, type ComputedRef } from 'vue'

import { createAppStorage } from '@/shared/lib/storage/namespace'
import {
  DEFAULT_UI_STYLE,
  isUiStyleId,
  UI_STYLE_PRESETS,
  uiStyleLabel,
  type UiStyleId,
  type UiStylePreset,
} from '@/shared/ui/styles/themes'

export { DEFAULT_UI_STYLE, isUiStyleId, UI_STYLE_PRESETS, uiStyleLabel }
export type { UiStyleId, UiStylePreset }

export type ThemeMode = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'
export type Density = 'compact' | 'comfortable'

export interface AppearanceSettings {
  theme: ThemeMode
  style: UiStyleId
  /** UI font size in px, constrained to 12–18. */
  fontSize: number
  density: Density
}

export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 18

export const DEFAULT_APPEARANCE: Readonly<AppearanceSettings> = Object.freeze({
  theme: 'dark',
  style: DEFAULT_UI_STYLE,
  fontSize: 13,
  density: 'compact',
})

const settingsStore = createAppStorage().local<AppearanceSettings>('settings', {
  version: 1,
  defaults: () => ({ ...DEFAULT_APPEARANCE }),
})

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light' || value === 'system'
}

function clampFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_APPEARANCE.fontSize
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
}

function normalize(raw: unknown): AppearanceSettings {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    theme: isThemeMode(source.theme) ? source.theme : DEFAULT_APPEARANCE.theme,
    style: isUiStyleId(source.style) ? source.style : DEFAULT_APPEARANCE.style,
    fontSize: clampFontSize(source.fontSize ?? DEFAULT_APPEARANCE.fontSize),
    density: source.density === 'comfortable' ? 'comfortable' : 'compact',
  }
}

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark'
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

const state = reactive<AppearanceSettings>({ ...DEFAULT_APPEARANCE })
const systemThemeValue = ref<ResolvedTheme>(systemTheme())

/** Current appearance settings; treat the object as read-only. */
export const appearance: Readonly<AppearanceSettings> = readonly(state)

/** Theme actually applied to `data-theme` (`system` resolved via media query). */
export const resolvedTheme: ComputedRef<ResolvedTheme> = computed<ResolvedTheme>(() =>
  state.theme === 'system' ? systemThemeValue.value : state.theme,
)

/** Chinese label for a theme mode, used by the header button and settings drawer. */
export function themeLabel(theme: ThemeMode): string {
  switch (theme) {
    case 'light':
      return '浅色'
    case 'system':
      return '跟随系统'
    default:
      return '深色'
  }
}

function applyAppearance(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = resolvedTheme.value
  root.dataset.style = state.style
  root.dataset.density = state.density
  root.style.setProperty('--font-size', `${state.fontSize}px`)
}

function applyStored(value: AppearanceSettings): void {
  Object.assign(state, normalize(value))
  applyAppearance()
}

/** Persists a patch, applies it and keeps the reactive snapshot in sync. */
function commit(patch: Partial<AppearanceSettings>): void {
  const next = normalize({ ...state, ...patch })
  applyStored(next)
  settingsStore.set(next)
}

/** Switches the explicit theme mode. */
export function setTheme(theme: ThemeMode): void {
  commit({ theme })
}

/** Switches the UI style preset (`industrial`, `moss`, ...). */
export function setUiStyle(style: UiStyleId): void {
  commit({ style })
}

/** Cycles dark → light → system → dark, matching the header button (plan §7.2). */
export function cycleTheme(): ThemeMode {
  const next: ThemeMode =
    state.theme === 'dark' ? 'light' : state.theme === 'light' ? 'system' : 'dark'
  setTheme(next)
  return next
}

/** Sets the UI font size in px, clamped to 12–18. */
export function setFontSize(fontSize: number): void {
  commit({ fontSize: clampFontSize(fontSize) })
}

/** Switches between the compact and comfortable density. */
export function setDensity(density: Density): void {
  commit({ density })
}

/** Restores the default appearance (dark, industrial, 13px, compact). */
export function resetAppearance(): void {
  applyStored({ ...DEFAULT_APPEARANCE })
  settingsStore.reset()
}

let mediaQuery: MediaQueryList | null = null

function onSystemThemeChange(): void {
  systemThemeValue.value = mediaQuery?.matches ? 'light' : 'dark'
  applyAppearance()
}

let initialized = false

/**
 * Reads the persisted appearance, applies it and keeps the `system` theme in sync
 * with the OS. Called once from `main.ts` before mounting the app.
 */
export function initAppearance(): void {
  if (initialized) return
  initialized = true
  applyStored(settingsStore.get())
  settingsStore.subscribe(applyStored)
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
      mediaQuery.addEventListener('change', onSystemThemeChange)
    } catch {
      mediaQuery = null
    }
  }
  systemThemeValue.value = systemTheme()
  applyAppearance()
}
