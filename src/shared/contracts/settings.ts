/**
 * Generic description of one setting form field.
 *
 * Tools and transport providers expose their settings as `SettingField[]`; the
 * shared `SettingForm` component renders them without knowing the owning module.
 * `advanced` fields are folded into a collapsed "高级" section.
 */

export interface SettingOption {
  label: string
  value: string | number
  disabled?: boolean
}

interface SettingFieldBase {
  key: string
  label: string
  /** Render inside the collapsed advanced section, defaults to false. */
  advanced?: boolean
  /** Optional helper text rendered under the control. */
  hint?: string
}

export interface NumberSettingField extends SettingFieldBase {
  type: 'number'
  min?: number
  max?: number
  step?: number
  default?: number
  /** Unit shown next to the control, e.g. `ms`. */
  unit?: string
}

export interface TextSettingField extends SettingFieldBase {
  type: 'text'
  maxLength?: number
  default?: string
}

export interface SelectSettingField extends SettingFieldBase {
  type: 'select'
  options: SettingOption[]
  /** Allow entering a value outside `options` (used for custom baud rates). */
  allowCustom?: boolean
  /** Bounds applied to the custom numeric input when `allowCustom` is true. */
  min?: number
  max?: number
  step?: number
  unit?: string
  default?: string | number
}

export interface CheckboxSettingField extends SettingFieldBase {
  type: 'checkbox'
  default?: boolean
}

export type SettingField =
  NumberSettingField | TextSettingField | SelectSettingField | CheckboxSettingField

/** Values of a setting form, keyed by `SettingField['key']`. */
export type SettingValues = Record<string, unknown>
