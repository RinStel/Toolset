<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string
    /** Helper text shown under the control when there is no error. */
    hint?: string
    /** Error text; replaces the hint and marks the field. */
    error?: string
    required?: boolean
    htmlFor?: string
    layout?: 'vertical' | 'horizontal'
  }>(),
  {
    label: '',
    hint: '',
    error: '',
    required: false,
    htmlFor: undefined,
    layout: 'vertical',
  },
)
</script>

<template>
  <div class="ui-form-field" :class="[`ui-form-field--${layout}`, { 'has-error': Boolean(error) }]">
    <label v-if="label || $slots.label" class="ui-form-field__label" :for="htmlFor">
      <slot name="label">{{ label }}</slot>
      <span v-if="required" class="ui-form-field__required" aria-hidden="true">*</span>
    </label>
    <div class="ui-form-field__control">
      <slot />
    </div>
    <p v-if="error" class="ui-form-field__error" role="alert">{{ error }}</p>
    <p v-else-if="hint || $slots.hint" class="ui-form-field__hint">
      <slot name="hint">{{ hint }}</slot>
    </p>
  </div>
</template>

<style scoped>
.ui-form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.ui-form-field--horizontal {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  align-items: center;
  column-gap: var(--space-3);
  row-gap: 6px;
}

.ui-form-field--horizontal .ui-form-field__label {
  grid-column: 1;
}

.ui-form-field--horizontal .ui-form-field__control {
  grid-column: 2;
}

.ui-form-field--horizontal .ui-form-field__hint,
.ui-form-field--horizontal .ui-form-field__error {
  grid-column: 2;
  margin: 0;
}

.ui-form-field__label {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  color: var(--text-dim);
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.4;
}

.ui-form-field__required {
  color: var(--danger);
}

.ui-form-field__control {
  min-width: 0;
}

.ui-form-field__hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.5;
}

.ui-form-field__error {
  margin: 0;
  color: var(--danger);
  font-size: 11px;
  line-height: 1.5;
}

.ui-form-field.has-error :deep(.ui-input),
.ui-form-field.has-error :deep(.ui-number-input) {
  border-color: var(--danger);
}
</style>
