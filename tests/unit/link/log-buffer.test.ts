import { describe, expect, it } from 'vitest'

import {
  createLogBuffer,
  estimateEntryBytes,
  type LogEntry,
} from '../../../src/domains/link/log/buffer'
import {
  exportLog,
  exportLogFileName,
  formatExportTime,
} from '../../../src/domains/link/log/export'

function entry(overrides: Partial<Omit<LogEntry, 'seq'>> = {}): LogEntry {
  return {
    seq: 0,
    at: 0,
    dir: 'rx',
    level: 'info',
    bytes: new Uint8Array(0),
    text: '',
    ...overrides,
  }
}

describe('log buffer', () => {
  it('assigns continuous seqs starting at 1', () => {
    const buffer = createLogBuffer({ maxEntries: 10, maxBytes: 10_000 })
    buffer.append([entry({ text: 'a' }), entry({ text: 'b' })])
    buffer.append([entry({ text: 'c' })])

    expect(buffer.size).toBe(3)
    expect(buffer.firstSeq).toBe(1)
    expect(buffer.lastSeq).toBe(3)
    expect(buffer.snapshot().map((item) => item.seq)).toEqual([1, 2, 3])
  })

  it('evicts the oldest entries when maxEntries is exceeded', () => {
    const buffer = createLogBuffer({ maxEntries: 2, maxBytes: 10_000 })
    buffer.append([entry({ text: 'a' }), entry({ text: 'b' }), entry({ text: 'c' })])

    expect(buffer.size).toBe(2)
    expect(buffer.firstSeq).toBe(2)
    expect(buffer.lastSeq).toBe(3)
    expect(buffer.snapshot().map((item) => item.text)).toEqual(['b', 'c'])
  })

  it('evicts by estimated byte usage (bytes + text*2 + 128)', () => {
    const first = entry({ bytes: new Uint8Array([1, 2, 3, 4, 5]) })
    const cost = estimateEntryBytes(first)
    const buffer = createLogBuffer({ maxEntries: 10, maxBytes: cost })
    buffer.append([first])
    expect(buffer.size).toBe(1)
    expect(buffer.bytes).toBe(cost)

    buffer.append([entry({ bytes: new Uint8Array([1, 2, 3, 4, 5]) })])
    expect(buffer.size).toBe(1)
    expect(buffer.firstSeq).toBe(2)
    expect(buffer.bytes).toBe(cost)
  })

  it('applies new limits when maxEntries/maxBytes change', () => {
    const buffer = createLogBuffer({ maxEntries: 10, maxBytes: 10_000 })
    buffer.append([entry({ text: 'a' }), entry({ text: 'b' }), entry({ text: 'c' })])
    buffer.maxEntries = 1
    expect(buffer.snapshot().map((item) => item.text)).toEqual(['c'])
  })

  it('returns ranges, tails and newest-first search results', () => {
    const buffer = createLogBuffer({ maxEntries: 10, maxBytes: 100_000 })
    buffer.append([
      entry({ text: 'a', bytes: new Uint8Array([0x61]) }),
      entry({ text: 'b', bytes: new Uint8Array([0x62]) }),
      entry({ text: 'c', bytes: new Uint8Array([0x63]) }),
      entry({ text: 'bb', bytes: new Uint8Array([0x62, 0x62]) }),
    ])

    expect(buffer.range(2, 2).map((item) => item.seq)).toEqual([2, 3])
    expect(buffer.range(0, 2).map((item) => item.seq)).toEqual([1, 2])
    expect(buffer.range(99, 2)).toEqual([])
    expect(buffer.tail(2).map((item) => item.text)).toEqual(['c', 'bb'])
    expect(buffer.tail(10)).toHaveLength(4)

    const found = buffer.search((item) => item.text.includes('b'), 2)
    expect(found.map((item) => item.seq)).toEqual([4, 2])
  })

  it('supports decoded backfill of an existing entry', () => {
    const buffer = createLogBuffer({ maxEntries: 10, maxBytes: 100_000 })
    buffer.append([entry({ dir: 'tx', text: 'x' })])
    const decoded = {
      protocolId: 'p',
      protocolName: 'P',
      results: [{ summary: 'ok' }],
    }
    expect(buffer.update(1, { decoded })).toBe(true)
    expect(buffer.get(1)?.decoded?.results[0]?.summary).toBe('ok')
    expect(buffer.update(99, { decoded })).toBe(false)
  })

  it('clears entries and restarts seq at 1', () => {
    const buffer = createLogBuffer({ maxEntries: 10, maxBytes: 100_000 })
    buffer.append([entry({ text: 'a' })])
    buffer.clear()

    expect(buffer.size).toBe(0)
    expect(buffer.bytes).toBe(0)
    expect(buffer.firstSeq).toBe(0)
    expect(buffer.lastSeq).toBe(0)
    expect(buffer.snapshot()).toEqual([])

    buffer.append([entry({ text: 'again' })])
    expect(buffer.lastSeq).toBe(1)
  })
})

describe('log export', () => {
  const at = new Date(2024, 0, 1, 1, 2, 3).getTime()

  function sampleEntries(): LogEntry[] {
    return [
      {
        seq: 1,
        at,
        dir: 'rx',
        level: 'info',
        bytes: Uint8Array.from([0x68, 0x69]),
        text: 'hi',
        decoded: {
          protocolId: 'p',
          protocolName: 'P',
          results: [{ summary: '温度 25°C', fields: [{ label: '温度', value: 25, unit: '°C' }] }],
        },
      },
      {
        seq: 2,
        at,
        dir: 'tx',
        level: 'info',
        bytes: Uint8Array.from([0x41]),
        text: 'A',
        origin: 'manual',
      },
      {
        seq: 3,
        at,
        dir: 'rx',
        level: 'error',
        bytes: Uint8Array.from([0x78]),
        text: 'x',
        decoded: {
          protocolId: 'p',
          protocolName: 'P',
          results: [],
          error: '未成帧数据',
          unframed: true,
        },
      },
      {
        seq: 4,
        at,
        dir: 'system',
        level: 'warn',
        bytes: new Uint8Array(0),
        text: '系统消息',
      },
    ]
  }

  it('builds a sanitized file name with a local timestamp', () => {
    expect(exportLogFileName('COM3: 测试/端口', 'txt', at)).toBe(
      'COM3_ 测试_端口_20240101-010203.txt',
    )
    expect(exportLogFileName('   ', 'bin', at)).toBe('会话_20240101-010203.bin')
    expect(formatExportTime(at)).toBe('2024-01-01 01:02:03.000')
  })

  it('exports TXT rows with display mode and text/HEX rendering', () => {
    const snapshot = sampleEntries()
    const raw = exportLog(snapshot, {
      format: 'txt',
      sessionName: '会话',
      displayMode: 'raw',
      viewAs: 'hex',
      now: () => at,
    })
    const text = new TextDecoder().decode(raw.data)
    expect(raw.fileName).toBe('会话_20240101-010203.txt')
    expect(raw.mimeType).toBe('text/plain;charset=utf-8')
    expect(text).toContain('RX 68 69')
    expect(text).toContain('TX 41')
    expect(text).toContain('SYS 系统消息')
    expect(text.startsWith('2024-01-01 01:02:03.000 ')).toBe(true)

    const decoded = new TextDecoder().decode(
      exportLog(snapshot, {
        format: 'txt',
        sessionName: '会话',
        displayMode: 'decoded',
        now: () => at,
      }).data,
    )
    expect(decoded).toContain('温度 25°C')
    expect(decoded).toContain('未成帧数据')

    const both = new TextDecoder().decode(
      exportLog(snapshot, {
        format: 'txt',
        sessionName: '会话',
        displayMode: 'both',
        viewAs: 'text',
        now: () => at,
      }).data,
    )
    expect(both).toContain('hi | 温度 25°C')
  })

  it('filters TX/system/bridge rows when requested', () => {
    const entries: LogEntry[] = [
      ...sampleEntries(),
      {
        seq: 5,
        at,
        dir: 'tx',
        level: 'info',
        bytes: Uint8Array.from([0x42]),
        text: 'B',
        origin: 'bridge',
      },
    ]
    const text = new TextDecoder().decode(
      exportLog(entries, {
        format: 'txt',
        sessionName: '会话',
        showTx: false,
        showSystem: false,
        showBridge: false,
        now: () => at,
      }).data,
    )
    expect(text).not.toContain('TX')
    expect(text).not.toContain('SYS')
    expect(text).not.toContain('bridge')
    expect(text).toContain('RX hi')
  })

  it('exports CSV with a UTF-8 BOM and the documented columns', () => {
    const csv = exportLog(sampleEntries(), {
      format: 'csv',
      sessionName: '会话',
      now: () => at,
    })
    expect(csv.mimeType).toBe('text/csv;charset=utf-8')
    expect([...csv.data.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(csv.data)
    expect(text.startsWith('\uFEFF')).toBe(true)
    const lines = text.slice(1).split('\r\n')
    expect(lines[0]).toBe('time,dir,origin,level,hex,text,summary,fields')
    expect(lines[1]).toContain('2024-01-01 01:02:03.000,rx,,info,68 69,hi,温度 25°C,')
    expect(lines[1]).toContain('温度')
  })

  it('concatenates RX bytes for BIN exports', () => {
    const bin = exportLog(sampleEntries(), {
      format: 'bin',
      sessionName: '会话',
      now: () => at,
    })
    expect(bin.mimeType).toBe('application/octet-stream')
    expect([...bin.data]).toEqual([0x68, 0x69, 0x78])
  })
})
