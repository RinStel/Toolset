import { describe, expect, it } from 'vitest'

import { parseHex, toHex } from '@/domains/bytes/public'

function parseBytes(input: string): number[] {
  const result = parseHex(input)
  if (!result.ok) {
    throw new Error(`期望 "${input}" 解析成功，实际失败：${result.error}`)
  }
  return Array.from(result.bytes)
}

function expectFailure(input: string): { error: string; index: number } {
  const result = parseHex(input)
  if (result.ok) {
    throw new Error(`期望 "${input}" 解析失败，实际成功：${Array.from(result.bytes).join(',')}`)
  }
  return { error: result.error, index: result.index }
}

describe('parseHex 合法格式', () => {
  it('解析空格分隔的 HEX', () => {
    expect(parseBytes('48 65 6C 6C 6F')).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f])
  })

  it('解析无分隔符的连续 HEX', () => {
    expect(parseBytes('48656C6C6F')).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f])
  })

  it('解析小写字母', () => {
    expect(parseBytes('de ad be ef')).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  it('允许逗号、制表符、换行作为分隔符', () => {
    expect(parseBytes('48,65\t6c\n6C 6f')).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f])
    expect(parseBytes('\n 0x48 , 0x65\t\n')).toEqual([0x48, 0x65])
  })

  it('解析 0x / 0X 前缀，1 位数字也是合法字节', () => {
    expect(parseBytes('0x48 0X65 0x6c')).toEqual([0x48, 0x65, 0x6c])
    expect(parseBytes('0xA')).toEqual([0x0a])
    expect(parseBytes('0x0A 0x1')).toEqual([0x0a, 0x01])
    expect(parseBytes('0x1234')).toEqual([0x12, 0x34])
  })
})

describe('parseHex 错误与位置', () => {
  it('拒绝不带 0x 前缀的 1 位写法', () => {
    const failure = expectFailure('A')
    expect(failure.error).toBe('HEX 位数为奇数')
    expect(failure.index).toBe(0)
  })

  it('奇数位报错并指向最后一个不完整字节的末位', () => {
    const failure = expectFailure('12 3')
    expect(failure.error).toBe('HEX 位数为奇数')
    expect(failure.index).toBe(3)
  })

  it('非法字符报错，文案带 1 起的位置与字符，index 是 0 起下标', () => {
    const input = '12 3G'
    const failure = expectFailure(input)
    expect(failure.error).toBe("第 5 个字符 'G' 不是十六进制数字")
    expect(failure.index).toBe(4)
    expect(input[failure.index]).toBe('G')
  })

  it('开头的非法字符位置为第 1 个字符', () => {
    const failure = expectFailure('GG')
    expect(failure.error).toBe("第 1 个字符 'G' 不是十六进制数字")
    expect(failure.index).toBe(0)
  })

  it('0x 前缀后缺少数位时报错', () => {
    const failure = expectFailure('0x')
    expect(failure.error).toContain('缺少十六进制数字')
    expect(failure.index).toBe(1)
  })

  it('空输入与纯分隔符输入报错', () => {
    expect(expectFailure('').error).toBe('HEX 内容为空')
    expect(expectFailure('  ,\n').error).toBe('HEX 内容为空')
  })
})

describe('toHex', () => {
  it('默认用空格分隔、大写', () => {
    expect(toHex(Uint8Array.from([0x48, 0x0a, 0xff]))).toBe('48 0A FF')
  })

  it('支持自定义分隔符', () => {
    expect(toHex(Uint8Array.from([0x48, 0x0a, 0xff]), '-')).toBe('48-0A-FF')
    expect(toHex(Uint8Array.from([0x48, 0x0a]), '')).toBe('480A')
  })

  it('支持小写输出', () => {
    expect(toHex(Uint8Array.from([0xab, 0xcd]), ' ', false)).toBe('ab cd')
  })

  it('空数组输出空字符串', () => {
    expect(toHex(Uint8Array.from([]))).toBe('')
  })

  it('与 parseHex 往返一致', () => {
    const source = Uint8Array.from([0x00, 0x7f, 0x80, 0xff])
    expect(parseBytes(toHex(source, ',', false))).toEqual(Array.from(source))
  })
})
