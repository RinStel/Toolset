/**
 * GBK 编码表（仅解码方向由平台提供，编码方向在此反推）。
 *
 * 平台只提供 `TextDecoder('gbk')`。本模块在首次使用时枚举全部合法双字节组合
 * （首字节 0x81–0xFE，尾字节 0x40–0xFE），用解码结果反向构建「码点 → 字节序列」
 * 映射并缓存在模块内。CP936 把单字节 0x80 定义为欧元符号，解码器也如此处理，
 * 因此一并收录，使编码器与 `TextDecoder('gbk')` 互为逆映射。
 */

const GBK_LABEL = 'gbk'

/** 码点 → GBK 字节序列（1 或 2 字节）。 */
export type GbkEncodeMap = ReadonlyMap<number, readonly number[]>

let encodeMapCache: GbkEncodeMap | null = null

function buildGbkEncodeMap(): GbkEncodeMap {
  const decoder = new TextDecoder(GBK_LABEL)
  const map = new Map<number, readonly number[]>()

  const singleByte = decoder.decode(new Uint8Array([0x80]))
  const euroCodePoint = codePointOfSingleChar(singleByte)
  if (euroCodePoint !== undefined) {
    map.set(euroCodePoint, [0x80])
  }

  for (let lead = 0x81; lead <= 0xfe; lead += 1) {
    for (let trail = 0x40; trail <= 0xfe; trail += 1) {
      const text = decoder.decode(new Uint8Array([lead, trail]))
      const codePoint = codePointOfSingleChar(text)
      if (codePoint === undefined) continue
      // 同一码点可能由多个字节对解出，保留枚举顺序中的第一个。
      if (!map.has(codePoint)) {
        map.set(codePoint, [lead, trail])
      }
    }
  }

  return map
}

function codePointOfSingleChar(text: string): number | undefined {
  if (text.length === 0) return undefined
  if (text.length !== 1) return undefined
  const codePoint = text.codePointAt(0)
  if (codePoint === undefined || codePoint === 0xfffd) return undefined
  return codePoint
}

/** 取 GBK 编码表；首次调用时构建，之后直接返回缓存结果。 */
export function gbkEncodeMap(): GbkEncodeMap {
  encodeMapCache ??= buildGbkEncodeMap()
  return encodeMapCache
}

/** 查询单个码点的 GBK 字节序列；无法映射时返回 `undefined`。 */
export function encodeGbkCodePoint(codePoint: number): readonly number[] | undefined {
  return gbkEncodeMap().get(codePoint)
}
