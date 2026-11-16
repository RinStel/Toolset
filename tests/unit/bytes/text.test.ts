import { describe, expect, it } from 'vitest'

import { createStreamDecoder, encodeText } from '@/domains/bytes/public'
import type { TextEncodingName } from '@/domains/bytes/public'

function encode(text: string, enc: TextEncodingName): Uint8Array {
  const result = encodeText(text, enc)
  if (!result.ok) {
    throw new Error(`期望 "${text}" 可以用 ${enc} 编码，实际失败：${result.error}`)
  }
  return result.bytes
}

function decodeAll(enc: TextEncodingName, bytes: Uint8Array): string {
  const decoder = createStreamDecoder(enc)
  return decoder.decode(bytes) + decoder.flush()
}

const SAMPLE_TEXT = 'Hello, 世界! 0123'
const MULTI_BYTE_TEXT = '中文测试：你好，世界！'

describe('encodeText 4 种编码往返', () => {
  it('utf-8 往返中文、ASCII 与 emoji', () => {
    const text = `${SAMPLE_TEXT} 🙂`
    const encoded = encode(text, 'utf-8')
    expect(decodeAll('utf-8', encoded)).toBe(text)
  })

  it('ascii 往返纯 ASCII 文本', () => {
    const text = 'Hello, Toolset! ~ 0123456789'
    expect(decodeAll('ascii', encode(text, 'ascii'))).toBe(text)
  })

  it('latin1 往返 Latin-1 范围内的字符', () => {
    const text = 'Café Ñoño Grüße'
    const encoded = encode(text, 'latin1')
    expect(Array.from(encoded)).toEqual([...text].map((char) => char.codePointAt(0)))
    expect(decodeAll('latin1', encoded)).toBe(text)
  })

  it('gbk 往返中文文本', () => {
    const encoded = encode(MULTI_BYTE_TEXT, 'gbk')
    expect(decodeAll('gbk', encoded)).toBe(MULTI_BYTE_TEXT)
  })

  it('gbk 使用标准双字节编码', () => {
    expect(Array.from(encode('中', 'gbk'))).toEqual([0xd6, 0xd0])
    expect(Array.from(encode('你', 'gbk'))).toEqual([0xc4, 0xe3])
    expect(Array.from(encode('A中', 'gbk'))).toEqual([0x41, 0xd6, 0xd0])
  })

  it('gbk 支持 CP936 的欧元符号（0x80）', () => {
    expect(Array.from(encode('€', 'gbk'))).toEqual([0x80])
    expect(decodeAll('gbk', Uint8Array.from([0x80]))).toBe('€')
  })
})

describe('encodeText 错误', () => {
  it('ascii 拒绝码点 > 0x7F，并给出字符与 0 起下标', () => {
    const result = encodeText('café', 'ascii')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.char).toBe('é')
    expect(result.index).toBe(3)
    expect(result.error).toBe("字符 'é'（第 4 个字符）无法用 ASCII 编码")
  })

  it('latin1 拒绝码点 > 0xFF', () => {
    const result = encodeText('A€', 'latin1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.char).toBe('€')
    expect(result.index).toBe(1)
    expect(result.error).toContain("字符 '€'（第 2 个字符）")
    expect(result.error).toContain('Latin-1')
  })

  it('gbk 对不可映射字符报错（plan §9 文案）', () => {
    const result = encodeText('😀', 'gbk')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.char).toBe('😀')
    expect(result.index).toBe(0)
    expect(result.error).toBe("字符 '😀'（第 1 个字符）无法用 GBK 编码")
  })

  it('gbk 报错位置指向字符在字符串中的下标', () => {
    const result = encodeText('A😀B', 'gbk')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.index).toBe(1)
    expect(result.error).toContain('（第 2 个字符）')
  })
})

describe('createStreamDecoder 流式解码', () => {
  it('UTF-8 多字节字符跨块解码', () => {
    const text = '中文🙂测试abc'
    const encoded = encode(text, 'utf-8')
    let decoded = ''
    const decoder = createStreamDecoder('utf-8')
    for (const byte of encoded) {
      decoded += decoder.decode(Uint8Array.from([byte]))
    }
    decoded += decoder.flush()
    expect(decoded).toBe(text)
  })

  it('UTF-8 在每个可能的位置分块结果都一致', () => {
    const text = '单字节A与多字节中文字符'
    const encoded = encode(text, 'utf-8')
    for (let split = 0; split <= encoded.length; split += 1) {
      const decoder = createStreamDecoder('utf-8')
      const decoded =
        decoder.decode(encoded.subarray(0, split)) +
        decoder.decode(encoded.subarray(split)) +
        decoder.flush()
      expect(decoded).toBe(text)
    }
  })

  it('GBK 多字节字符跨块解码', () => {
    const encoded = encode(MULTI_BYTE_TEXT, 'gbk')
    let decoded = ''
    const decoder = createStreamDecoder('gbk')
    for (const byte of encoded) {
      decoded += decoder.decode(Uint8Array.from([byte]))
    }
    decoded += decoder.flush()
    expect(decoded).toBe(MULTI_BYTE_TEXT)
  })

  it('GBK 按字节逐个跨块时不会丢字符', () => {
    const encoded = encode('中文ABC你好', 'gbk')
    const decoder = createStreamDecoder('gbk')
    let decoded = ''
    for (let index = 0; index < encoded.length; index += 1) {
      decoded += decoder.decode(encoded.subarray(index, index + 1))
    }
    decoded += decoder.flush()
    expect(decoded).toBe('中文ABC你好')
  })

  it('ascii 把高位字节替换为 U+FFFD', () => {
    expect(decodeAll('ascii', Uint8Array.from([0x41, 0xe9, 0x42]))).toBe('A\uFFFDB')
    const decoder = createStreamDecoder('ascii')
    expect(decoder.decode(Uint8Array.from([0x41, 0xe9]))).toBe('A\uFFFD')
    expect(decoder.decode(Uint8Array.from([0x42]))).toBe('B')
    expect(decoder.flush()).toBe('')
  })

  it('latin1 解码高位字节', () => {
    expect(decodeAll('latin1', encode('Café Ñoño', 'latin1'))).toBe('Café Ñoño')
  })

  it('flush 处理结尾残缺的 UTF-8 序列', () => {
    const decoder = createStreamDecoder('utf-8')
    expect(decoder.decode(Uint8Array.from([0xe4, 0xb8]))).toBe('')
    expect(decoder.flush()).toBe('\uFFFD')
  })
})
