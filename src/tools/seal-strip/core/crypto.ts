/**
 * 纯 TypeScript 密码学摘要与 Python 兼容 PRNG 模块。
 *
 * 确保浏览器端生成的防掉包封箱卡编码、校验码、微缩摘要、签名短码与
 * 波浪底纹同 Python 脚本 `create_rinstel_anti_fake_card.py` 100% 一致。
 */

const textEncoder = new TextEncoder()

function toBytes(input: string | Uint8Array): Uint8Array {
  return typeof input === 'string' ? textEncoder.encode(input) : input
}

function bytesToUpperHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    out += (bytes[i] ?? 0).toString(16).padStart(2, '0')
  }
  return out.toUpperCase()
}

function rotr32(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits))
}

/* ------------------------------------------------------------------------- */
/* SHA-256 (FIPS 180-4)                                                      */
/* ------------------------------------------------------------------------- */

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const SHA256_IV = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
])

export function sha256Bytes(input: string | Uint8Array): Uint8Array {
  const msg = toBytes(input)
  const bitLen = msg.length * 8
  const paddedLen = Math.ceil((msg.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLen)
  padded.set(msg)
  padded[msg.length] = 0x80

  const view = new DataView(padded.buffer)
  const highBits = Math.floor(bitLen / 0x100000000)
  const lowBits = bitLen >>> 0
  view.setUint32(paddedLen - 8, highBits, false)
  view.setUint32(paddedLen - 4, lowBits, false)

  const h = new Uint32Array(SHA256_IV)
  const w = new Uint32Array(64)

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false)
    }
    for (let i = 16; i < 64; i += 1) {
      const w15 = w[i - 15] ?? 0
      const w2 = w[i - 2] ?? 0
      const s0 = rotr32(w15, 7) ^ rotr32(w15, 18) ^ (w15 >>> 3)
      const s1 = rotr32(w2, 17) ^ rotr32(w2, 19) ^ (w2 >>> 10)
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0
    }

    let a = h[0] ?? 0
    let b = h[1] ?? 0
    let c = h[2] ?? 0
    let d = h[3] ?? 0
    let e = h[4] ?? 0
    let f = h[5] ?? 0
    let g = h[6] ?? 0
    let hh = h[7] ?? 0

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (hh + s1 + ch + (SHA256_K[i] ?? 0) + (w[i] ?? 0)) >>> 0
      const s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) >>> 0

      hh = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    h[0] = ((h[0] ?? 0) + a) >>> 0
    h[1] = ((h[1] ?? 0) + b) >>> 0
    h[2] = ((h[2] ?? 0) + c) >>> 0
    h[3] = ((h[3] ?? 0) + d) >>> 0
    h[4] = ((h[4] ?? 0) + e) >>> 0
    h[5] = ((h[5] ?? 0) + f) >>> 0
    h[6] = ((h[6] ?? 0) + g) >>> 0
    h[7] = ((h[7] ?? 0) + hh) >>> 0
  }

  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  for (let i = 0; i < 8; i += 1) {
    outView.setUint32(i * 4, h[i] ?? 0, false)
  }
  return out
}

export function sha256Hex(input: string | Uint8Array): string {
  return bytesToUpperHex(sha256Bytes(input))
}

/* ------------------------------------------------------------------------- */
/* BLAKE2s (RFC 7693)                                                        */
/* ------------------------------------------------------------------------- */

const BLAKE2S_IV = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
])

const BLAKE2S_SIGMA: ReadonlyArray<readonly number[]> = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
]

function blake2sG(
  v: Uint32Array,
  a: number,
  b: number,
  c: number,
  d: number,
  x: number,
  y: number,
): void {
  v[a] = ((v[a] ?? 0) + (v[b] ?? 0) + x) >>> 0
  v[d] = rotr32((v[d] ?? 0) ^ (v[a] ?? 0), 16)
  v[c] = ((v[c] ?? 0) + (v[d] ?? 0)) >>> 0
  v[b] = rotr32((v[b] ?? 0) ^ (v[c] ?? 0), 12)
  v[a] = ((v[a] ?? 0) + (v[b] ?? 0) + y) >>> 0
  v[d] = rotr32((v[d] ?? 0) ^ (v[a] ?? 0), 8)
  v[c] = ((v[c] ?? 0) + (v[d] ?? 0)) >>> 0
  v[b] = rotr32((v[b] ?? 0) ^ (v[c] ?? 0), 7)
}

export function blake2sBytes(input: string | Uint8Array, digestSize = 32): Uint8Array {
  if (!Number.isInteger(digestSize) || digestSize < 1 || digestSize > 32) {
    throw new RangeError(`Invalid BLAKE2s digestSize: ${digestSize}`)
  }

  const msg = toBytes(input)
  const h = new Uint32Array(BLAKE2S_IV)
  h[0] = (h[0] ?? 0) ^ (0x01010000 ^ digestSize)

  const total = msg.length
  const blocks = Math.max(1, Math.ceil(total / 64))
  const m = new Uint32Array(16)
  const v = new Uint32Array(16)
  const padded = new Uint8Array(64)
  const paddedView = new DataView(padded.buffer)

  for (let blockIdx = 0; blockIdx < blocks; blockIdx += 1) {
    const offset = blockIdx * 64
    const isLast = blockIdx === blocks - 1
    const bytesCompressed = isLast ? total : (blockIdx + 1) * 64

    padded.fill(0)
    padded.set(msg.subarray(offset, offset + 64))
    for (let i = 0; i < 16; i += 1) {
      m[i] = paddedView.getUint32(i * 4, true)
    }

    v.set(h, 0)
    v.set(BLAKE2S_IV, 8)
    v[12] = (v[12] ?? 0) ^ (bytesCompressed >>> 0)
    v[13] = (v[13] ?? 0) ^ (Math.floor(bytesCompressed / 0x100000000) >>> 0)
    if (isLast) v[14] = (v[14] ?? 0) ^ 0xffffffff

    for (let r = 0; r < 10; r += 1) {
      const s = BLAKE2S_SIGMA[r]!
      blake2sG(v, 0, 4, 8, 12, m[s[0]!] ?? 0, m[s[1]!] ?? 0)
      blake2sG(v, 1, 5, 9, 13, m[s[2]!] ?? 0, m[s[3]!] ?? 0)
      blake2sG(v, 2, 6, 10, 14, m[s[4]!] ?? 0, m[s[5]!] ?? 0)
      blake2sG(v, 3, 7, 11, 15, m[s[6]!] ?? 0, m[s[7]!] ?? 0)
      blake2sG(v, 0, 5, 10, 15, m[s[8]!] ?? 0, m[s[9]!] ?? 0)
      blake2sG(v, 1, 6, 11, 12, m[s[10]!] ?? 0, m[s[11]!] ?? 0)
      blake2sG(v, 2, 7, 8, 13, m[s[12]!] ?? 0, m[s[13]!] ?? 0)
      blake2sG(v, 3, 4, 9, 14, m[s[14]!] ?? 0, m[s[15]!] ?? 0)
    }

    for (let i = 0; i < 8; i += 1) {
      h[i] = ((h[i] ?? 0) ^ (v[i] ?? 0) ^ (v[i + 8] ?? 0)) >>> 0
    }
  }

  const full = new Uint8Array(32)
  const fullView = new DataView(full.buffer)
  for (let i = 0; i < 8; i += 1) {
    fullView.setUint32(i * 4, h[i] ?? 0, true)
  }
  return full.slice(0, digestSize)
}

export function blake2sHex(input: string | Uint8Array, digestSize = 32): string {
  return bytesToUpperHex(blake2sBytes(input, digestSize))
}

/* ------------------------------------------------------------------------- */
/* Python 3 random.Random 兼容 MT19937 PRNG                                  */
/* ------------------------------------------------------------------------- */

const MT_N = 624
const MT_M = 397
const MATRIX_A = 0x9908b0df
const UPPER_MASK = 0x80000000
const LOWER_MASK = 0x7fffffff

export class PyRandom {
  private readonly mt = new Uint32Array(MT_N)
  private mti = MT_N + 1

  constructor(seedValue: number | bigint) {
    this.seed(seedValue)
  }

  private initGenrand(s: number): void {
    this.mt[0] = s >>> 0
    for (let i = 1; i < MT_N; i += 1) {
      const prev = (this.mt[i - 1] ?? 0) ^ ((this.mt[i - 1] ?? 0) >>> 30)
      this.mt[i] = (Math.imul(1812433253, prev) + i) >>> 0
    }
    this.mti = MT_N
  }

  seed(seedValue: number | bigint): void {
    let val = typeof seedValue === 'bigint' ? seedValue : BigInt(Math.trunc(seedValue))
    if (val < 0n) val = -val
    const key: number[] = []
    while (val > 0n) {
      key.push(Number(val & 0xffffffffn))
      val >>= 32n
    }
    if (key.length === 0) key.push(0)

    this.initGenrand(19650218)
    let i = 1
    let j = 0
    for (let k = Math.max(MT_N, key.length); k > 0; k -= 1) {
      const prev = (this.mt[i - 1] ?? 0) ^ ((this.mt[i - 1] ?? 0) >>> 30)
      this.mt[i] = (((this.mt[i] ?? 0) ^ Math.imul(prev, 1664525)) + (key[j] ?? 0) + j) >>> 0
      i += 1
      j += 1
      if (i >= MT_N) {
        this.mt[0] = this.mt[MT_N - 1] ?? 0
        i = 1
      }
      if (j >= key.length) j = 0
    }
    for (let k = MT_N - 1; k > 0; k -= 1) {
      const prev = (this.mt[i - 1] ?? 0) ^ ((this.mt[i - 1] ?? 0) >>> 30)
      this.mt[i] = (((this.mt[i] ?? 0) ^ Math.imul(prev, 1566083941)) - i) >>> 0
      i += 1
      if (i >= MT_N) {
        this.mt[0] = this.mt[MT_N - 1] ?? 0
        i = 1
      }
    }
    this.mt[0] = 0x80000000
  }

  int32(): number {
    let y = 0
    if (this.mti >= MT_N) {
      for (let kk = 0; kk < MT_N - MT_M; kk += 1) {
        y = ((this.mt[kk] ?? 0) & UPPER_MASK) | ((this.mt[kk + 1] ?? 0) & LOWER_MASK)
        this.mt[kk] = (this.mt[kk + MT_M] ?? 0) ^ (y >>> 1) ^ ((y & 1) === 0 ? 0 : MATRIX_A)
      }
      for (let kk = MT_N - MT_M; kk < MT_N - 1; kk += 1) {
        y = ((this.mt[kk] ?? 0) & UPPER_MASK) | ((this.mt[kk + 1] ?? 0) & LOWER_MASK)
        this.mt[kk] =
          (this.mt[kk + (MT_M - MT_N)] ?? 0) ^ (y >>> 1) ^ ((y & 1) === 0 ? 0 : MATRIX_A)
      }
      y = ((this.mt[MT_N - 1] ?? 0) & UPPER_MASK) | ((this.mt[0] ?? 0) & LOWER_MASK)
      this.mt[MT_N - 1] = (this.mt[MT_M - 1] ?? 0) ^ (y >>> 1) ^ ((y & 1) === 0 ? 0 : MATRIX_A)
      this.mti = 0
    }

    y = this.mt[this.mti] ?? 0
    this.mti += 1
    y ^= y >>> 11
    y ^= (y << 7) & 0x9d2c5680
    y ^= (y << 15) & 0xefc60000
    y ^= y >>> 18
    return y >>> 0
  }

  getrandbits(k: number): number {
    if (k <= 0) return 0
    if (k > 32) throw new RangeError(`k must be <= 32, got ${k}`)
    return this.int32() >>> (32 - k)
  }

  randbelow(n: number): number {
    if (n <= 0) throw new RangeError(`n must be > 0, got ${n}`)
    const k = 32 - Math.clz32(n)
    let r = this.getrandbits(k)
    while (r >= n) r = this.getrandbits(k)
    return r
  }

  choice(seq: string): string {
    if (seq.length === 0) throw new RangeError('Cannot choose from an empty sequence')
    return seq.charAt(this.randbelow(seq.length))
  }

  random(): number {
    const a = this.int32() >>> 5
    const b = this.int32() >>> 6
    return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0)
  }
}
