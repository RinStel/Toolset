<script setup lang="ts">
/**
 * 属性编辑器分发（plan §8.10）。
 *
 * 按 `WidgetPropField.type` 渲染对应编辑器；所有编辑器都在 `prop-editors/` 目录中。
 * 新增一种属性类型时只需新增编辑器并在这里加一个分支。
 */

import type { WidgetPropField } from '@/domains/dashboard/public'

import PropCheckboxEditor from './PropCheckboxEditor.vue'
import PropColorEditor from './PropColorEditor.vue'
import PropCommandEditor from './PropCommandEditor.vue'
import PropExpressionEditor from './PropExpressionEditor.vue'
import PropNumberEditor from './PropNumberEditor.vue'
import PropOptionsEditor from './PropOptionsEditor.vue'
import PropRangeEditor from './PropRangeEditor.vue'
import PropSelectEditor from './PropSelectEditor.vue'
import PropTextEditor from './PropTextEditor.vue'
import PropTextareaEditor from './PropTextareaEditor.vue'
import PropThresholdsEditor from './PropThresholdsEditor.vue'
import PropVariableEditor from './PropVariableEditor.vue'
import PropVariablesEditor from './PropVariablesEditor.vue'
import PropZonesEditor from './PropZonesEditor.vue'
import type { PropEditorContext, PropEditorEmits, PropFieldOf } from './types'

const props = defineProps<{
  field: WidgetPropField
  value: unknown
  context: PropEditorContext
}>()

const emit = defineEmits<PropEditorEmits>()

function asField<T extends WidgetPropField['type']>(field: WidgetPropField): PropFieldOf<T> {
  return field as PropFieldOf<T>
}

function onUpdate(value: unknown): void {
  emit('update', value)
}
</script>

<template>
  <div class="prop-editor" :data-editor-type="field.type">
    <PropNumberEditor
      v-if="field.type === 'number'"
      :field="asField<'number'>(field)"
      :value="value"
      :context="props.context"
      @update="onUpdate"
    />
    <PropTextEditor
      v-else-if="field.type === 'text'"
      :field="asField<'text'>(field)"
      :value="value"
      :context="props.context"
      @update="onUpdate"
    />
    <PropTextareaEditor
      v-else-if="field.type === 'textarea'"
      :field="asField<'textarea'>(field)"
      :value="value"
      :context="props.context"
      @update="onUpdate"
    />
    <PropSelectEditor
      v-else-if="field.type === 'select'"
      :field="asField<'select'>(field)"
      :value="value"
      :context="props.context"
      @update="onUpdate"
    />
    <PropCheckboxEditor
      v-else-if="field.type === 'checkbox'"
      :field="asField<'checkbox'>(field)"
      :value="value"
      :context="props.context"
      @update="onUpdate"
    />
    <PropColorEditor
      v-else-if="field.type === 'color'"
      :field="asField<'color'>(field)"
      :value="value"
      :context="props.context"
      @update="onUpdate"
    />
    <PropRangeEditor
      v-else-if="field.type === 'range'"
      :field="asField<'range'>(field)"
      :value="value"
      :context="props.context"
      @update="onUpdate"
    />
    <PropVariableEditor
      v-else-if="field.type === 'variable'"
      :field="asField<'variable'>(field)"
      :value="value"
      :context="props.context"
      @update="onUpdate"
    />
    <PropVariablesEditor
      v-else-if="field.type === 'variables'"
      :field="asField<'variables'>(field)"
      :value="value"
      :context="props.context"
      @update="onUpdate"
    />
    <PropThresholdsEditor
      v-else-if="field.type === 'thresholds'"
      :field="asField<'thresholds'>(field)"
      :value="value"
      :context="props.context"
      @update="onUpdate"
    />
    <PropZonesEditor
      v-else-if="field.type === 'zones'"
      :field="asField<'zones'>(field)"
      :value="value"
      :context="props.context"
      @update="onUpdate"
    />
    <PropOptionsEditor
      v-else-if="field.type === 'options'"
      :field="asField<'options'>(field)"
      :value="value"
      :context="props.context"
      @update="onUpdate"
    />
    <PropCommandEditor
      v-else-if="field.type === 'command'"
      :field="asField<'command'>(field)"
      :value="value"
      :context="props.context"
      @update="onUpdate"
    />
    <PropExpressionEditor
      v-else-if="field.type === 'expression'"
      :field="asField<'expression'>(field)"
      :value="value"
      :context="props.context"
      @update="onUpdate"
    />
  </div>
</template>
