/**
 * One decoded frame delivered through the session `frames` event (plan §6.6).
 *
 * The event carries complete batches straight from the protocol runtime: it is
 * never sampled or merged, so consumers such as the series domain see every
 * frame together with its session-local sequence number.
 */

import type { DecodeDirection, DecodeResult } from '../../protocol/public'

export interface DecodedFrame {
  /** Monotonic per-session frame number, starting at 1; independent of log seq. */
  seq: number
  /** Raw bytes of the frame as produced by the protocol framing. */
  bytes: Uint8Array
  at: number
  direction: DecodeDirection
  /** Decode results; empty when decoding failed. */
  results: DecodeResult[]
  /** Decode error of this frame; the frame is still emitted. */
  error?: string
}
