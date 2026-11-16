// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LogEntry } from '@/domains/link/public'

const mocks = vi.hoisted(() => ({
  entries: [] as LogEntry[],
}))

vi.mock('@/tools/serial/stores/sessions', () => {
  function makeLogBuffer(): unknown {
    const entries = mocks.entries
    return {
      maxEntries: 5000,
      maxBytes: 32 * 1024 * 1024,
      size: entries.length,
      bytes: 0,
      firstSeq: entries[0]?.seq ?? 0,
      lastSeq: entries[entries.length - 1]?.seq ?? 0,
      tail: (limit: number) => entries.slice(-limit),
      range: (from: number, limit: number) =>
        entries.filter((entry) => entry.seq >= from).slice(0, limit),
      search: (predicate: (entry: LogEntry) => boolean, limit: number) =>
        entries.filter(predicate).reverse().slice(0, limit),
      snapshot: () => entries,
      append: () => {},
      clear: () => {},
    }
  }

  function makeSession(): unknown {
    return { log: makeLogBuffer(), on: () => () => {} }
  }

  return {
    getSessionInstance: () => (mocks.entries.length > 0 ? makeSession() : null),
    getSessionView: () => (mocks.entries.length > 0 ? { id: 's1', name: '测试会话' } : undefined),
  }
})

import { updatePaneViewSettings } from '@/tools/serial/stores/layout'
import LogList from '@/tools/serial/components/LogList.vue'

function entry(partial: Partial<LogEntry> & Pick<LogEntry, 'seq' | 'dir'>): LogEntry {
  return {
    at: Date.UTC(2026, 0, 2, 3, 4, 5, 6) + partial.seq,
    level: 'info',
    bytes: new Uint8Array(0),
    text: '',
    ...partial,
  }
}

function mountList() {
  return mount(LogList, {
    props: { sessionId: 's1', paneIndex: 0, search: '', paused: false },
  })
}

beforeEach(() => {
  mocks.entries = []
  updatePaneViewSettings(0, {
    displayMode: 'raw',
    showTimestamp: true,
    showTx: true,
    showSystem: true,
    showBridge: true,
    viewAs: 'text',
    wrap: true,
    autoScroll: true,
    fontSize: 12,
  })
})

describe('LogList', () => {
  it('按开关隐藏时间戳与 TX 行', async () => {
    mocks.entries = [
      entry({ seq: 1, dir: 'rx', text: 'hello', bytes: Uint8Array.from([0x68]) }),
      entry({ seq: 2, dir: 'tx', text: 'world', bytes: Uint8Array.from([0x77]) }),
    ]
    const wrapper = mountList()
    expect(wrapper.findAll('[data-testid="log-row"]').length).toBe(2)
    expect(wrapper.findAll('.log-list__timestamp').length).toBe(2)
    expect(wrapper.text()).toContain('TX')
    expect(wrapper.text()).toContain('world')

    updatePaneViewSettings(0, { showTimestamp: false, showTx: false })
    await nextTick()

    expect(wrapper.findAll('.log-list__timestamp').length).toBe(0)
    expect(wrapper.findAll('[data-testid="log-row"]').length).toBe(1)
    expect(wrapper.text()).not.toContain('world')
  })

  it('文本模式转义控制字符，HEX 模式显示字节', async () => {
    mocks.entries = [
      entry({
        seq: 1,
        dir: 'rx',
        text: 'A\r\n',
        bytes: Uint8Array.from([0x41, 0x0d, 0x0a]),
      }),
    ]
    const wrapper = mountList()
    expect(wrapper.text()).toContain('A\\r\\n')

    updatePaneViewSettings(0, { viewAs: 'hex' })
    await nextTick()
    expect(wrapper.text()).toContain('41 0D 0A')
  })

  it('解析模式默认只显示解析行，点击可展开原始数据', async () => {
    mocks.entries = [
      entry({
        seq: 1,
        dir: 'rx',
        text: 'A5 5A',
        bytes: Uint8Array.from([0xa5, 0x5a]),
        decoded: {
          protocolId: 'p1',
          protocolName: '测试协议',
          results: [
            {
              summary: '上报',
              fields: [{ label: '温度', value: '25.30', unit: '°C' }],
            },
          ],
        },
      }),
    ]
    const wrapper = mountList()
    updatePaneViewSettings(0, { displayMode: 'decoded' })
    await nextTick()

    expect(wrapper.findAll('[data-testid="log-row"]').length).toBe(0)
    expect(wrapper.findAll('[data-testid="log-row-decoded"]').length).toBe(1)
    expect(wrapper.text()).toContain('上报  温度=25.30°C')

    await wrapper.get('[data-testid="log-row-decoded"]').trigger('click')
    expect(wrapper.findAll('[data-testid="log-row"]').length).toBe(1)
    expect(wrapper.text()).toContain('A5 5A')

    await wrapper.get('[data-testid="log-row-decoded"]').trigger('click')
    expect(wrapper.findAll('[data-testid="log-row"]').length).toBe(0)
  })

  it('原始+解析模式同时显示原始行与缩进解析行', async () => {
    mocks.entries = [
      entry({
        seq: 1,
        dir: 'rx',
        text: 'frame',
        bytes: Uint8Array.from([0x01]),
        decoded: {
          protocolId: 'p1',
          protocolName: '测试协议',
          results: [{ summary: '结果一' }, { summary: '结果二' }],
        },
      }),
    ]
    const wrapper = mountList()
    updatePaneViewSettings(0, { displayMode: 'both' })
    await nextTick()

    expect(wrapper.findAll('[data-testid="log-row"]').length).toBe(1)
    expect(wrapper.findAll('[data-testid="log-row-decoded"]').length).toBe(2)
    expect(wrapper.text()).toContain('└ 结果一')
    expect(wrapper.text()).toContain('└ 结果二')
  })

  it('未成帧数据与解码错误分别显示提示和错误行', async () => {
    mocks.entries = [
      entry({
        seq: 1,
        dir: 'rx',
        text: 'garbage',
        bytes: Uint8Array.from([0x00]),
        decoded: {
          protocolId: 'p1',
          protocolName: '测试协议',
          results: [],
          error: '未成帧数据',
          unframed: true,
        },
      }),
      entry({
        seq: 2,
        dir: 'rx',
        text: 'bad-crc',
        bytes: Uint8Array.from([0x01]),
        decoded: {
          protocolId: 'p1',
          protocolName: '测试协议',
          results: [],
          error: 'CRC 错误',
        },
      }),
    ]
    const wrapper = mountList()
    updatePaneViewSettings(0, { displayMode: 'decoded' })
    await nextTick()

    expect(wrapper.findAll('[data-testid="log-row"]').length).toBe(1)
    expect(wrapper.text()).toContain('未成帧数据')
    const decodedRows = wrapper.findAll('[data-testid="log-row-decoded"]')
    expect(decodedRows.length).toBe(2)
    expect(decodedRows[1]?.attributes('data-level')).toBe('error')
    expect(wrapper.text()).toContain('CRC 错误')
  })

  it('超过 1024 字节的内容显示截断提示', async () => {
    const text = 'A'.repeat(1100)
    mocks.entries = [entry({ seq: 1, dir: 'rx', text, bytes: new Uint8Array(1100) })]
    const wrapper = mountList()
    expect(wrapper.text()).toContain('…（共 1100 字节）')
  })
})
