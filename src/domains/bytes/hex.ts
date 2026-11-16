/** HEX 字符串与字节数组的互转。 */

/** `parseHex` 的成功结果。 */
interface ParseHexSuccess {
  ok: true
  bytes: Uint8Array
}

/** `parseHex` 的失败结果；`index` 是输入字符串中 0 起的字符下标。 */
interface ParseHexFailure {
  ok: false
  error: string
  index: number
}

type ParseHexResult = ParseHexSuccess | ParseHexFailure

function isSeparator(charCode: number): boolean {
  // 空白（空格、制表、换行、回车、垂直制表、换页）与英文逗号。
  return (
    charCode === 0x20 ||
    charCode === 0x09 ||
    charCode === 0x0a ||
    charCode === 0x0d ||
    charCode === 0x0b ||
    charCode === 0x0c ||
    charCode === 0x2c
  )
}

function isHexDigit(charCode: number): boolean {
  return (
    (charCode >= 0x30 && charCode <= 0x39) ||
    (charCode >= 0x41 && charCode <= 0x46) ||
    (charCode >= 0x61 && charCode <= 0x66)
  )
}

function hexDigitValue(charCode: number): number {
  if (charCode >= 0x30 && charCode <= 0x39) return charCode - 0x30
  if (charCode >= 0x41 && charCode <= 0x46) return charCode - 0x37
  return charCode - 0x57
}

function invalidCharFailure(input: string, index: number): ParseHexFailure {
  const char = input.charAt(index)
  return {
    ok: false,
    error: `第 ${index + 1} 个字符 '${char}' 不是十六进制数字`,
    index,
  }
}

/**
 * 解析 HEX 字符串。
 *
 * 允许空白与逗号作为分隔符，允许 `0x`/`0X` 前缀。每字节必须写 2 位十六进制；
 * 带 `0x` 前缀时允许只写 1 位（如 `0xA`）。
 */
export function parseHex(input: string): ParseHexResult {
  const bytes: number[] = []
  let index = 0

  while (index < input.length) {
    const charCode = input.charCodeAt(index)
    if (isSeparator(charCode)) {
      index += 1
      continue
    }

    const hasPrefix =
      charCode === 0x30 &&
      (input.charCodeAt(index + 1) === 0x78 || input.charCodeAt(index + 1) === 0x58)
    if (hasPrefix) {
      index += 2
    }

    const digits: number[] = []
    const digitIndexes: number[] = []
    while (index < input.length && isHexDigit(input.charCodeAt(index))) {
      digits.push(hexDigitValue(input.charCodeAt(index)))
      digitIndexes.push(index)
      index += 1
    }

    if (digits.length === 0) {
      if (hasPrefix) {
        // "0x" 之后既没有数字，也不是有效分隔符时，优先报告前缀缺少数位。
        const nextChar = index < input.length ? input.charCodeAt(index) : -1
        if (nextChar === -1 || isSeparator(nextChar)) {
          const prefixIndex = index - 2
          return {
            ok: false,
            error: `第 ${prefixIndex + 2} 个字符 '${input.charAt(prefixIndex + 1)}' 之后缺少十六进制数字`,
            index: prefixIndex + 1,
          }
        }
      }
      return invalidCharFailure(input, index)
    }

    // 带 0x 前缀且只有 1 位数字是允许的单字节写法。
    if (hasPrefix && digits.length === 1) {
      bytes.push(digits[0] as number)
      continue
    }

    // 数字串因非法字符而截断时，优先报告非法字符（它通常才是真正的笔误）。
    if (index < input.length && !isSeparator(input.charCodeAt(index))) {
      return invalidCharFailure(input, index)
    }

    if (digits.length % 2 !== 0) {
      return {
        ok: false,
        error: 'HEX 位数为奇数',
        index: digitIndexes[digitIndexes.length - 1] as number,
      }
    }

    for (let digitIndex = 0; digitIndex < digits.length; digitIndex += 2) {
      const high = digits[digitIndex] as number
      const low = digits[digitIndex + 1] as number
      bytes.push((high << 4) | low)
    }
  }

  if (bytes.length === 0) {
    return { ok: false, error: 'HEX 内容为空', index: 0 }
  }

  return { ok: true, bytes: Uint8Array.from(bytes) }
}

/**
 * 把字节数组格式化成 HEX 字符串。
 *
 * @param bytes 字节数组
 * @param sep 字节之间的分隔符，默认空格；传空字符串则连续输出
 * @param upper 是否使用大写字母，默认 `true`
 */
export function toHex(bytes: Uint8Array, sep = ' ', upper = true): string {
  const parts: string[] = []
  for (const byte of bytes) {
    parts.push(byte.toString(16).padStart(2, '0'))
  }
  const text = parts.join(sep)
  return upper ? text.toUpperCase() : text
}
