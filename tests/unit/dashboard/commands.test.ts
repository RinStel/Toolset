import { describe, expect, it } from 'vitest'

import type { ComposeOptions } from '../../../src/domains/link/public'
import { renderCommand } from '../../../src/domains/dashboard/public'
import type {
  CommandSpec,
  CommandVarLookup,
  RenderCommandResult,
} from '../../../src/domains/dashboard/public'

const BASE_OPTIONS: Omit<ComposeOptions, 'mode'> = {
  encoding: 'utf-8',
  eol: 'none',
  checksum: 'none',
  checksumEndian: 'le',
  checksumSkip: 0,
}

type TemplateSpec = Extract<CommandSpec, { kind: 'template' }>

function templateSpec(
  template: string,
  mode: 'text' | 'hex' = 'text',
  options: Partial<Omit<ComposeOptions, 'mode'>> = {},
): TemplateSpec {
  return {
    kind: 'template',
    source: 'main',
    mode,
    template,
    options: { ...BASE_OPTIONS, ...options },
  }
}

const noVariables: CommandVarLookup = () => undefined

function bytesOf(result: RenderCommandResult): number[] {
  expect(result.ok).toBe(true)
  if (!result.ok) return []
  expect(result.action.kind).toBe('bytes')
  if (result.action.kind !== 'bytes') return []
  return Array.from(result.action.bytes)
}

function errorOf(result: RenderCommandResult): string {
  expect(result.ok).toBe(false)
  return result.ok ? '' : result.error
}

function textBytes(
  template: string,
  value: number | boolean | string | undefined = undefined,
  options: Partial<Omit<ComposeOptions, 'mode'>> = {},
  lookup: CommandVarLookup = noVariables,
): number[] {
  return bytesOf(renderCommand(templateSpec(template, 'text', options), value, lookup))
}

function hexBytes(
  template: string,
  value: number | boolean | string | undefined,
  options: Partial<Omit<ComposeOptions, 'mode'>> = {},
): number[] {
  return bytesOf(renderCommand(templateSpec(template, 'hex', options), value, noVariables))
}

function floatBytes(value: number, size: 4 | 8, little: boolean): number[] {
  const view = new DataView(new ArrayBuffer(size))
  if (size === 4) view.setFloat32(0, value, little)
  else view.setFloat64(0, value, little)
  return Array.from(new Uint8Array(view.buffer))
}

describe('text templates', () => {
  it('renders a number with String() when no format is given', () => {
    expect(textBytes('{value}', 12.5)).toEqual([...Buffer.from('12.5')])
    expect(textBytes('温度 {value}', 21)).toEqual([...Buffer.from('温度 21')])
  })

  it('renders booleans as 1/0 and strings verbatim', () => {
    expect(textBytes('{value}', true)).toEqual([...Buffer.from('1')])
    expect(textBytes('{value}', false)).toEqual([...Buffer.from('0')])
    expect(textBytes('{value}', 'abc')).toEqual([...Buffer.from('abc')])
  })

  it('supports .Nf', () => {
    expect(textBytes('{value:.2f}', 3.14159)).toEqual([...Buffer.from('3.14')])
    expect(textBytes('{value:.0f}', 3.6)).toEqual([...Buffer.from('4')])
  })

  it('rounds with d (half away from zero)', () => {
    expect(textBytes('{value:d}', 2.5)).toEqual([...Buffer.from('3')])
    expect(textBytes('{value:d}', -2.5)).toEqual([...Buffer.from('-3')])
  })

  it('zero-pads with 0Nd', () => {
    expect(textBytes('{value:05d}', 42)).toEqual([...Buffer.from('00042')])
  })

  it('formats hex with x / X', () => {
    expect(textBytes('{value:x}', 255)).toEqual([...Buffer.from('ff')])
    expect(textBytes('{value:X}', 255)).toEqual([...Buffer.from('FF')])
  })

  it('resolves var.<key> with the format applied', () => {
    const lookup: CommandVarLookup = (ref) => (ref.key === 'temp' ? 21.06 : undefined)
    expect(textBytes('{var.temp:.1f} °C', undefined, {}, lookup)).toEqual([
      ...Buffer.from('21.1 °C'),
    ])
  })

  it('treats {{ and }} as literal braces', () => {
    expect(textBytes('a{{b}}c')).toEqual([...Buffer.from('a{b}c')])
    expect(textBytes('{{value}}')).toEqual([...Buffer.from('{value}')])
  })

  it('rejects unknown placeholders, unclosed placeholders and invalid formats', () => {
    expect(errorOf(renderCommand(templateSpec('{foo}'), 1, noVariables))).toContain(
      '不支持的占位符',
    )
    expect(errorOf(renderCommand(templateSpec('abc{value'), 1, noVariables))).toContain('未闭合')
    expect(errorOf(renderCommand(templateSpec('{value:.11f}'), 1, noVariables))).toContain(
      '无效的格式化',
    )
    expect(errorOf(renderCommand(templateSpec('{value:q}'), 1, noVariables))).toContain(
      '无效的格式化',
    )
  })

  it('reports a missing control value and a missing variable', () => {
    expect(errorOf(renderCommand(templateSpec('{value}'), undefined, noVariables))).toBe(
      '控件没有当前值',
    )
    expect(errorOf(renderCommand(templateSpec('{var.temp}'), 1, noVariables))).toBe(
      '变量 temp 暂无数据',
    )
  })

  it('passes the source alias to the lookup callback', () => {
    const seen: Array<{ source: string; key: string }> = []
    const lookup: CommandVarLookup = (ref) => {
      seen.push({ ...ref })
      return 7
    }
    expect(textBytes('{var.a}', undefined, {}, lookup)).toEqual([...Buffer.from('7')])
    expect(seen).toEqual([{ source: 'main', key: 'a' }])
  })

  it('applies compose options (EOL and checksum) after substitution', () => {
    expect(textBytes('AB', undefined, { eol: 'crlf' })).toEqual([0x41, 0x42, 0x0d, 0x0a])
    expect(textBytes('AB', undefined, { checksum: 'sum8' })).toEqual([0x41, 0x42, 0x41 + 0x42])
  })
})

describe('hex templates', () => {
  it('writes all integer byte types with the correct endianness', () => {
    const cases: Array<[string, number, number[]]> = [
      ['u8', 255, [0xff]],
      ['u8', 0, [0x00]],
      ['i8', -1, [0xff]],
      ['i8', 127, [0x7f]],
      ['u16le', 0x1234, [0x34, 0x12]],
      ['u16be', 0x1234, [0x12, 0x34]],
      ['i16le', -2, [0xfe, 0xff]],
      ['i16be', -2, [0xff, 0xfe]],
      ['u32le', 0x12345678, [0x78, 0x56, 0x34, 0x12]],
      ['u32be', 0x12345678, [0x12, 0x34, 0x56, 0x78]],
      ['i32le', -2, [0xfe, 0xff, 0xff, 0xff]],
      ['i32be', -2, [0xff, 0xff, 0xff, 0xfe]],
    ]
    for (const [format, value, expected] of cases) {
      expect(hexBytes(`{value:${format}}`, value), format).toEqual(expected)
    }
  })

  it('writes float byte types', () => {
    for (const format of ['f32le', 'f32be', 'f64le', 'f64be'] as const) {
      const size = format.startsWith('f32') ? 4 : 8
      const little = format.endsWith('le')
      const value = format.startsWith('f32') ? 1.5 : Math.PI
      expect(hexBytes(`{value:${format}}`, value), format).toEqual(floatBytes(value, size, little))
    }
  })

  it('rounds integer values before checking the range', () => {
    expect(hexBytes('{value:u8}', 2.5)).toEqual([3])
    expect(hexBytes('{value:u8}', 254.6)).toEqual([255])
  })

  it('keeps literal hex bytes around placeholders', () => {
    expect(hexBytes('AA {value:u8} BB', 0x0f)).toEqual([0xaa, 0x0f, 0xbb])
  })

  it('reports out-of-range integers with a Chinese message', () => {
    expect(errorOf(renderCommand(templateSpec('{value:u8}', 'hex'), 300, noVariables))).toBe(
      '值 300 超出 u8 范围（0–255）',
    )
    expect(errorOf(renderCommand(templateSpec('{value:i8}', 'hex'), -200, noVariables))).toBe(
      '值 -200 超出 i8 范围（-128–127）',
    )
    expect(errorOf(renderCommand(templateSpec('{value:u16le}', 'hex'), -1, noVariables))).toContain(
      '超出 u16le 范围',
    )
  })

  it('requires a byte type on every placeholder', () => {
    expect(errorOf(renderCommand(templateSpec('{value}', 'hex'), 1, noVariables))).toContain(
      '必须指定字节类型',
    )
    expect(errorOf(renderCommand(templateSpec('{value:u9}', 'hex'), 1, noVariables))).toContain(
      '不支持的字节类型',
    )
  })

  it('applies compose options after substitution', () => {
    expect(hexBytes('{value:u8}', 0x42, { eol: 'lf' })).toEqual([0x42, 0x0a])
  })
})

describe('protocol commands', () => {
  it('preserves raw types for {value} and {var.<key>}', () => {
    const lookup: CommandVarLookup = (ref) => (ref.key === 'temp' ? 42 : undefined)
    const spec: CommandSpec = {
      kind: 'protocol',
      source: 'main',
      values: {
        rawValue: '{value}',
        rawVar: '{var.temp}',
        formatted: '{value:.1f}',
        templated: 'x{var.temp:d}y',
        plain: 'plain',
        number: 12,
      },
    }
    const result = renderCommand(spec, 3.14159, lookup)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.action.kind).toBe('form')
    if (result.action.kind !== 'form') return
    expect(result.action.values).toEqual({
      rawValue: 3.14159,
      rawVar: 42,
      formatted: '3.1',
      templated: 'x42y',
      plain: 'plain',
      number: 12,
    })
  })

  it('keeps boolean values raw', () => {
    const result = renderCommand(
      { kind: 'protocol', source: 'main', values: { on: '{value}' } },
      true,
      noVariables,
    )
    expect(result.ok).toBe(true)
    if (!result.ok || result.action.kind !== 'form') return
    expect(result.action.values.on).toBe(true)
  })

  it('reports missing values and missing variables', () => {
    expect(
      errorOf(
        renderCommand(
          { kind: 'protocol', source: 'main', values: { a: '{value}' } },
          undefined,
          noVariables,
        ),
      ),
    ).toBe('控件没有当前值')
    expect(
      errorOf(
        renderCommand(
          { kind: 'protocol', source: 'main', values: { a: '{var.missing}' } },
          1,
          noVariables,
        ),
      ),
    ).toBe('变量 missing 暂无数据')
  })
})

describe('signal and quick commands', () => {
  it('passes signal commands through', () => {
    const withSignals = renderCommand(
      { kind: 'signal', source: 'main', dtr: true, rts: false },
      undefined,
      noVariables,
    )
    expect(withSignals).toEqual({
      ok: true,
      action: { kind: 'signal', source: 'main', dtr: true, rts: false },
    })
    const empty = renderCommand({ kind: 'signal', source: 'main' }, undefined, noVariables)
    expect(empty).toEqual({ ok: true, action: { kind: 'signal', source: 'main' } })
  })

  it('passes quick commands through', () => {
    expect(
      renderCommand({ kind: 'quick', source: 'main', quickItemId: 'q1' }, undefined, noVariables),
    ).toEqual({ ok: true, action: { kind: 'quick', source: 'main', quickItemId: 'q1' } })
  })
})

describe('binding and unknown kinds', () => {
  it('reports an unbound data source', () => {
    const result = renderCommand(templateSpec('1'), 1, noVariables, {
      isSourceBound: () => false,
    })
    expect(errorOf(result)).toBe('数据源 main 未连接')
  })

  it('does not report an error when the source is bound', () => {
    const result = renderCommand(templateSpec('1'), 1, noVariables, {
      isSourceBound: (source) => source === 'main',
    })
    expect(bytesOf(result)).toEqual([...Buffer.from('1')])
  })

  it('reports unknown command kinds', () => {
    const unknown = { kind: 'nope', source: 'main' } as unknown as CommandSpec
    expect(errorOf(renderCommand(unknown, 1, noVariables))).toContain('未知的命令类型')
  })
})
