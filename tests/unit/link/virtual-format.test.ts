import { afterEach, describe, expect, it, vi } from 'vitest'

import { checksum } from '../../../src/domains/bytes/public'
import {
  DEMO_CHANNELS_DEFAULT,
  DEMO_FORMAT_DEFAULT,
  DEMO_INTERVAL_DEFAULT,
  VirtualTransport,
  normalizeDemoChannels,
  normalizeDemoFormat,
  normalizeDemoInterval,
} from '../../../src/domains/link/transports/virtual/device'
import { provider } from '../../../src/domains/link/transports/virtual/provider'

interface Opened {
  transport: VirtualTransport
  reader: ReadableStreamDefaultReader<Uint8Array>
  writer: WritableStreamDefaultWriter<Uint8Array>
}

const opened: VirtualTransport[] = []

async function openTransport(settings: Record<string, unknown>): Promise<Opened> {
  const transport = new VirtualTransport('演示端口 测试')
  opened.push(transport)
  await transport.open(settings)
  const readable = transport.readable
  const writable = transport.writable
  if (readable === null || writable === null) throw new Error('没有可读/可写流')
  return { transport, reader: readable.getReader(), writer: writable.getWriter() }
}

async function readBlock(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  advanceMs = 0,
): Promise<Uint8Array> {
  const pending = reader.read()
  if (advanceMs > 0) await vi.advanceTimersByTimeAsync(advanceMs)
  const result = await pending
  if (result.done) throw new Error('流已关闭')
  return result.value
}

function textOf(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

function firewaterValues(bytes: Uint8Array): { fields: string[]; values: number[] } {
  const fields = textOf(bytes).trimEnd().split(',')
  return { fields, values: fields.map(Number) }
}

function justfloatValues(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const values: number[] = []
  for (let offset = 0; offset + 4 <= bytes.length - 4; offset += 4) {
    values.push(view.getFloat32(offset, true))
  }
  return values
}

function kvValues(bytes: Uint8Array): Record<string, number> {
  const result: Record<string, number> = {}
  for (const item of textOf(bytes).trimEnd().split(',')) {
    const [key, value] = item.split(':')
    if (key !== undefined && value !== undefined) result[key] = Number(value)
  }
  return result
}

afterEach(async () => {
  vi.useRealTimers()
  for (const transport of opened.splice(0)) await transport.close()
})

describe('demo device settings', () => {
  it('normalizes format, interval and channels', () => {
    expect(normalizeDemoFormat(undefined)).toBe('sensor-a5')
    expect(normalizeDemoFormat('nope')).toBe('sensor-a5')
    expect(normalizeDemoFormat('firewater')).toBe('firewater')
    // A5 needs 100ms at least; other formats accept 10ms (and 1ms).
    expect(normalizeDemoInterval(10, 'sensor-a5')).toBe(100)
    expect(normalizeDemoInterval(undefined, 'sensor-a5')).toBe(1000)
    expect(normalizeDemoInterval(undefined, 'firewater')).toBe(10)
    expect(normalizeDemoInterval(1, 'justfloat')).toBe(1)
    expect(normalizeDemoInterval(20_000, 'firewater')).toBe(10_000)
    expect(normalizeDemoChannels(undefined)).toBe(8)
    expect(normalizeDemoChannels(0)).toBe(1)
    expect(normalizeDemoChannels(99)).toBe(16)
  })

  it('exposes the settings schema from plan §6.6 and default settings', () => {
    const keys = provider.settingsSchema.map((field) => field.key)
    expect(keys).toEqual(['format', 'interval', 'channels'])
    const format = provider.settingsSchema[0]
    expect(format?.type).toBe('select')
    expect(provider.defaultSettings()).toEqual({
      format: DEMO_FORMAT_DEFAULT,
      interval: DEMO_INTERVAL_DEFAULT,
      channels: DEMO_CHANNELS_DEFAULT,
    })
    expect(new VirtualTransport('x').format).toBe('sensor-a5')
  })
})

describe('demo device firewater output', () => {
  it('writes eight variables with the plan §8.7 formulas', async () => {
    vi.useFakeTimers()
    const { transport, reader } = await openTransport({
      format: 'firewater',
      interval: 10,
      channels: 8,
    })
    expect(transport.format).toBe('firewater')
    expect(transport.channels).toBe(8)

    const { fields, values } = firewaterValues(await readBlock(reader, 10))
    expect(fields).toHaveLength(8)
    expect(values[0]).toBeCloseTo(0, 6)
    expect(values[1]).toBeCloseTo(1, 6)
    expect(values[2]).toBe(0)
    expect(values[3]).toBeCloseTo(0, 6)
    expect(values[4]).toBeGreaterThanOrEqual(0.4)
    expect(values[4]).toBeLessThanOrEqual(0.6)
    expect(values[5]).toBeCloseTo(0, 6)
    expect(values[6]).toBeCloseTo(25, 6)
    expect(fields[7]).toBe('0')

    const second = firewaterValues(await readBlock(reader, 10))
    expect(second.fields[7]).toBe('1')
    expect(second.values[0]).toBeCloseTo(Math.sin(2 * Math.PI * 0.01), 5)
    expect(second.values[1]).toBeCloseTo(Math.cos(2 * Math.PI * 0.01), 5)
    expect(second.values[2]).toBeCloseTo(1, 6)
    expect(second.values[3]).toBeCloseTo(0.002, 6)
  })

  it('supports up to 16 channels with the k × π / 8 phase offset', async () => {
    vi.useFakeTimers()
    const { reader } = await openTransport({ format: 'firewater', interval: 10, channels: 16 })
    expect(firewaterValues(await readBlock(reader, 10)).fields).toHaveLength(16)
    const second = firewaterValues(await readBlock(reader, 10))
    expect(second.values[0]).toBeCloseTo(0.0627905, 5)
    // ch8 reuses the ch0 formula with a π phase offset.
    expect(second.values[8]).toBeCloseTo(-0.0627905, 5)
  })

  it('merges catch-up frames into one block (10ms driver)', async () => {
    vi.useFakeTimers()
    const { reader } = await openTransport({ format: 'firewater', interval: 1, channels: 8 })
    const block = await readBlock(reader, 10)
    const lines = textOf(block)
      .split('\n')
      .filter((line) => line.length > 0)
    expect(lines).toHaveLength(10)
    const last = firewaterValues(new TextEncoder().encode(lines[9] as string))
    expect(last.fields[7]).toBe('9')
  })
})

describe('demo device justfloat output', () => {
  it('writes f32le values followed by the tail frame', async () => {
    vi.useFakeTimers()
    const { reader } = await openTransport({
      format: 'justfloat',
      interval: 10,
      channels: 8,
    })
    const block = await readBlock(reader, 10)
    expect(block).toHaveLength(8 * 4 + 4)
    expect([...block.subarray(block.length - 4)]).toEqual([0x00, 0x00, 0x80, 0x7f])
    const values = justfloatValues(block)
    expect(values).toHaveLength(8)
    expect(values[0]).toBeCloseTo(0, 6)
    expect(values[1]).toBeCloseTo(1, 6)
    expect(values[5]).toBeCloseTo(0, 6)
    expect(values[6]).toBeCloseTo(25, 6)
    expect(values[7]).toBe(0)
  })
})

describe('demo device kv-text output', () => {
  it('writes key:value pairs and ignores the channels setting', async () => {
    vi.useFakeTimers()
    const { reader } = await openTransport({ format: 'kv-text', interval: 10, channels: 16 })
    const block = await readBlock(reader, 10)
    expect(textOf(block).startsWith('ch0:')).toBe(true)
    const values = kvValues(block)
    expect(Object.keys(values)).toHaveLength(8)
    expect(values.ch0).toBeCloseTo(0, 6)
    expect(values.ch1).toBeCloseTo(1, 6)
    expect(values.ch6).toBeCloseTo(25, 6)
    expect(values.ch7).toBe(0)
  })
})

describe('demo device text commands', () => {
  it('replies OK/ERR for interval= and amp= in firewater mode', async () => {
    vi.useFakeTimers()
    const { transport, reader, writer } = await openTransport({
      format: 'firewater',
      interval: 10,
    })

    await writer.write(new TextEncoder().encode('interval=20\n'))
    expect(textOf(await readBlock(reader))).toBe('OK interval=20\n')
    expect(transport.intervalMs).toBe(20)

    await writer.write(new TextEncoder().encode('amp=2\n'))
    expect(textOf(await readBlock(reader))).toBe('OK amp=2\n')

    await writer.write(new TextEncoder().encode('interval=20000\n'))
    expect(textOf(await readBlock(reader))).toBe('ERR interval=20000\n')
    expect(transport.intervalMs).toBe(20)

    await writer.write(new TextEncoder().encode('amp=11\n'))
    expect(textOf(await readBlock(reader))).toBe('ERR amp=11\n')

    const { values } = firewaterValues(await readBlock(reader, 20))
    expect(values[1]).toBeCloseTo(2, 6)
  })

  it('does not reply in justfloat mode (the frame stream stays intact)', async () => {
    vi.useFakeTimers()
    const { reader, writer } = await openTransport({ format: 'justfloat', interval: 10 })
    await writer.write(new TextEncoder().encode('interval=10\n'))
    const block = await readBlock(reader, 10)
    expect(block).toHaveLength(8 * 4 + 4)
    expect(textOf(block)).not.toContain('OK')
  })

  it('applies commands in sensor-a5 mode without replying', async () => {
    vi.useFakeTimers()
    const { transport, reader, writer } = await openTransport({
      format: 'sensor-a5',
      interval: 100,
    })
    await writer.write(new TextEncoder().encode('interval=200\n'))
    expect(transport.intervalMs).toBe(200)
    const frame = await readBlock(reader, 200)
    expect([...frame.subarray(0, 4)]).toEqual([0xa5, 0x5a, 11, 0x01])
  })
})

describe('demo device echo and signals', () => {
  it('echoes printable text that is not a command in firewater mode', async () => {
    vi.useFakeTimers()
    const { reader, writer } = await openTransport({ format: 'firewater', interval: 1000 })
    await writer.write(new TextEncoder().encode('hello\r\n'))
    expect(textOf(await readBlock(reader))).toBe('hello\r\n')
  })

  it('does not echo in justfloat mode', async () => {
    vi.useFakeTimers()
    const { reader, writer } = await openTransport({ format: 'justfloat', interval: 10 })
    await writer.write(new TextEncoder().encode('hello\r\n'))
    const block = await readBlock(reader, 10)
    expect(block).toHaveLength(8 * 4 + 4)
  })

  it('resets the sample counter on a DTR falling edge and sends the reset text', async () => {
    vi.useFakeTimers()
    const { transport, reader } = await openTransport({ format: 'firewater', interval: 10 })
    expect(firewaterValues(await readBlock(reader, 10)).fields[7]).toBe('0')
    expect(firewaterValues(await readBlock(reader, 10)).fields[7]).toBe('1')

    await transport.setSignals({ dtr: true })
    await transport.setSignals({ dtr: false })
    expect(textOf(await readBlock(reader))).toBe('[demo] reset\r\n')

    const afterReset = firewaterValues(await readBlock(reader, 10))
    expect(afterReset.fields[7]).toBe('0')
    // Virtual time restarts as well, so the waveform starts over.
    expect(afterReset.values[0]).toBeCloseTo(0, 6)
  })

  it('does not send the reset text in justfloat mode', async () => {
    vi.useFakeTimers()
    const { transport, reader } = await openTransport({ format: 'justfloat', interval: 10 })
    await transport.setSignals({ dtr: true })
    await transport.setSignals({ dtr: false })
    const block = await readBlock(reader, 10)
    expect(block).toHaveLength(8 * 4 + 4)
  })
})

describe('demo device sensor-a5 mode', () => {
  it('keeps the A5 report and interval command behavior', async () => {
    vi.useFakeTimers()
    const { transport, reader, writer } = await openTransport({
      format: 'sensor-a5',
      interval: 100,
    })
    const first = await readBlock(reader, 100)
    expect([...first.subarray(0, 4)]).toEqual([0xa5, 0x5a, 11, 0x01])
    expect(transport.intervalMs).toBe(100)

    // 0x10 with interval 200 (valid) → ACK status 0 and new interval.
    const body = [0xa5, 0x5a, 3, 0x10, 200, 0]
    const crc = checksum('crc16-modbus', Uint8Array.from(body))
    body.push(crc & 0xff, (crc >> 8) & 0xff)
    await writer.write(Uint8Array.from(body))
    const ack = await readBlock(reader)
    expect([...ack.subarray(0, 4)]).toEqual([0xa5, 0x5a, 4, 0x90])
    expect(ack[4]).toBe(0)
    expect(transport.intervalMs).toBe(200)
  })
})
