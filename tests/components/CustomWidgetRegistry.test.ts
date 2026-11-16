// @vitest-environment happy-dom
/**
 * 自定义控件仓库：CRUD、导入冲突（相同代码跳过 / 覆盖 / 保留两者）与实例引用改写。
 */

import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  exportCustomWidget,
  getCustomWidgetRecord,
  importCustomWidget,
  importCustomWidgets,
  inspectCustomWidgetImport,
  listCustomWidgetIndex,
  refreshCustomWidgets,
  remapCustomWidgetTypes,
  removeCustomWidget,
  saveCustomWidget,
  serialCustomWidgets,
} from '@/tools/serial/dashboard/custom/custom-widget-registry'

const CODE_A = `return {
  apiVersion: 1,
  meta: { name: '控件 A' },
  mount(el) { el.textContent = 'A'; return {} },
}`

const CODE_B = `return {
  apiVersion: 1,
  meta: { name: '控件 B' },
  mount(el) { el.textContent = 'B'; return {} },
}`

beforeEach(async () => {
  for (const entry of listCustomWidgetIndex()) {
    await removeCustomWidget(entry.id)
  }
  localStorage.clear()
  await refreshCustomWidgets()
})

describe('custom-widget-registry', () => {
  it('保存、读取、导出与删除', async () => {
    const record = await saveCustomWidget({ code: CODE_A })
    expect(record.name).toBe('控件 A')
    expect(listCustomWidgetIndex()).toHaveLength(1)
    const loaded = await getCustomWidgetRecord(record.id)
    expect(loaded?.code).toBe(CODE_A)
    const exported = await exportCustomWidget(record.id)
    expect(exported.fileName).toBe('控件 A.widget.js')
    await removeCustomWidget(record.id)
    expect(listCustomWidgetIndex()).toHaveLength(0)
    expect(await getCustomWidgetRecord(record.id)).toBeUndefined()
  })

  it('编译失败时不写入并抛出中文错误', async () => {
    await expect(saveCustomWidget({ code: 'not-a-function' })).rejects.toThrow()
    expect(listCustomWidgetIndex()).toHaveLength(0)
  })

  it('导入相同代码跳过，不同代码按选择覆盖或保留两者', async () => {
    const original = await saveCustomWidget({ code: CODE_A })
    const incomingSame = {
      id: original.id,
      name: '控件 A',
      code: CODE_A,
      createdAt: 1,
      updatedAt: 1,
    }
    expect(await inspectCustomWidgetImport([incomingSame])).toHaveLength(0)
    const sameResult = await importCustomWidgets([incomingSame], 'overwrite')
    expect(sameResult.skipped).toBe(1)
    expect(sameResult.written).toBe(0)

    const incomingDifferent = {
      id: original.id,
      name: '控件 A 新',
      code: CODE_B,
      createdAt: 2,
      updatedAt: 2,
    }
    const conflicts = await inspectCustomWidgetImport([incomingDifferent])
    expect(conflicts).toHaveLength(1)

    const overwrite = await importCustomWidgets([incomingDifferent], 'overwrite')
    expect(overwrite.written).toBe(1)
    const overwritten = await getCustomWidgetRecord(original.id)
    expect(overwritten?.code).toBe(CODE_B)

    // 再次导入不同代码并选择「保留两者」：生成新 id 并给出映射。
    const keepBoth = await importCustomWidgets(
      [{ ...incomingDifferent, code: CODE_A, name: '控件 A 另一个版本' }],
      'keep-both',
    )
    expect(keepBoth.written).toBe(1)
    const mapped = keepBoth.idMap[original.id]
    expect(mapped).toBeDefined()
    expect(mapped).not.toBe(original.id)
    expect(await getCustomWidgetRecord(mapped as string)).toBeDefined()

    const remapped = remapCustomWidgetTypes(
      [{ type: `custom:${original.id}` }, { type: 'chart.line' }, { type: `custom:${mapped}` }],
      keepBoth.idMap,
    )
    expect(remapped[0]?.type).toBe(`custom:${mapped}`)
    expect(remapped[1]?.type).toBe('chart.line')
    expect(remapped[2]?.type).toBe(`custom:${mapped}`)
  })

  it('导入 .widget.js 文件用 meta.name 作为名称', async () => {
    const record = await importCustomWidget(CODE_B, 'whatever.widget.js')
    expect(record.name).toBe('控件 B')
    expect(serialCustomWidgets.revision).toBeGreaterThan(0)
  })
})
