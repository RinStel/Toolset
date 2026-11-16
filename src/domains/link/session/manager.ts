/**
 * `LinkManager`: owns sessions and the transport provider registry (plan §6.6).
 */

import { createEmitter, type Unsubscribe } from '../../../shared/lib/events'
import { createIdSequence } from '../../../shared/lib/id'
import { getDeviceMemory, type DeviceMemoryStore } from '../presets/devices'
import { getProvider, listProviders } from '../transport/registry'
import type { ByteTransport, TransportProvider } from '../transport/types'
import type { DisplayMode } from './state'
import type { RxOptions } from './rx-framer'
import {
  DEFAULT_LOG_MAX_BYTES,
  DEFAULT_LOG_MAX_ENTRIES,
  createLinkSession,
  type LinkSession,
} from './session'

/** One authorized port plus the session using it. */
export interface LinkManagerAuthorizedEntry {
  provider: TransportProvider
  transport: ByteTransport
  sessionId: string | null
}

/** Extra session inputs accepted by `createFrom` (extension of plan §6.6). */
export interface LinkCreateOptions {
  providerKind?: string
  settings?: Record<string, unknown>
  protocolId?: string | null
  rxOptions?: Partial<RxOptions>
  displayMode?: DisplayMode
  name?: string
}

export interface LinkManagerOptions {
  memory?: DeviceMemoryStore
  log?: { maxEntries?: number; maxBytes?: number }
}

export interface LinkManagerEvents {
  sessions: LinkSession[]
  [event: string]: unknown
}

/** See plan §6.6; `disposeAll` and `refreshDeviceAvailability` are extensions. */
export interface LinkManager {
  listProviders(): TransportProvider[]
  listAuthorized(): Promise<LinkManagerAuthorizedEntry[]>
  request(kind: string): Promise<LinkSession | null>
  createFrom(transport: ByteTransport, options?: LinkCreateOptions): LinkSession
  sessions(): LinkSession[]
  get(id: string): LinkSession | undefined
  on(ev: 'sessions', handler: (sessions: LinkSession[]) => void): Unsubscribe
  /** Disposes every session (used when the tool page unmounts). */
  disposeAll(): Promise<void>
  /** Checks authorized ports for sessions in error state and hints a reconnect. */
  refreshDeviceAvailability(): Promise<void>
}

class LinkManagerImpl implements LinkManager {
  private readonly memory: DeviceMemoryStore
  private readonly logLimits: { maxEntries: number; maxBytes: number }
  private readonly sessionsList: LinkSession[] = []
  private readonly nextId = createIdSequence('s')
  private readonly emitter = createEmitter<LinkManagerEvents>()
  private readonly providerDisposers: Array<() => void> = []

  constructor(options: LinkManagerOptions = {}) {
    this.memory = options.memory ?? getDeviceMemory()
    this.logLimits = {
      maxEntries: options.log?.maxEntries ?? DEFAULT_LOG_MAX_ENTRIES,
      maxBytes: options.log?.maxBytes ?? DEFAULT_LOG_MAX_BYTES,
    }
    for (const provider of listProviders()) {
      const subscribe = provider.onAvailabilityChange
      if (subscribe === undefined) continue
      this.providerDisposers.push(
        subscribe.call(provider, () => {
          void this.refreshDeviceAvailability()
        }),
      )
    }
  }

  listProviders(): TransportProvider[] {
    return listProviders()
  }

  async listAuthorized(): Promise<LinkManagerAuthorizedEntry[]> {
    const result: LinkManagerAuthorizedEntry[] = []
    for (const provider of listProviders()) {
      let transports: ByteTransport[]
      try {
        transports = await provider.listAuthorized()
      } catch {
        transports = []
      }
      for (const transport of transports) {
        const existing = this.findByTransport(transport)
        result.push({
          provider,
          transport,
          sessionId: existing?.id ?? null,
        })
      }
    }
    return result
  }

  async request(kind: string): Promise<LinkSession | null> {
    const provider = getProvider(kind)
    if (provider === undefined) throw new Error(`未知的通道类型：${kind}`)
    const transport = await provider.request()
    if (transport === null) return null
    const existing = this.findByTransport(transport)
    if (existing !== undefined) return existing
    return this.createFrom(transport, { providerKind: kind })
  }

  createFrom(transport: ByteTransport, options: LinkCreateOptions = {}): LinkSession {
    const existing = this.findByTransport(transport)
    if (existing !== undefined) return existing

    const providerKind = options.providerKind ?? transport.kind
    const provider = getProvider(providerKind)
    const memory = this.memory.get(transport.deviceKey)
    const settings =
      options.settings ??
      (provider === undefined
        ? { ...(memory?.settings ?? {}) }
        : { ...provider.defaultSettings(), ...(memory?.settings ?? {}) })

    const session = createLinkSession({
      id: this.nextId(),
      transport,
      providerKind,
      name: options.name ?? transport.label,
      settings,
      rxOptions: options.rxOptions ?? memory?.rxOptions,
      displayMode: options.displayMode ?? memory?.displayMode,
      protocolId:
        options.protocolId !== undefined ? options.protocolId : (memory?.protocolId ?? null),
      log: this.logLimits,
      memory: this.memory,
      onDispose: (disposed) => {
        this.removeSession(disposed)
      },
    })
    this.sessionsList.push(session)
    this.emitSessions()
    return session
  }

  sessions(): LinkSession[] {
    return this.sessionsList.slice()
  }

  get(id: string): LinkSession | undefined {
    return this.sessionsList.find((session) => session.id === id)
  }

  on(ev: 'sessions', handler: (sessions: LinkSession[]) => void): Unsubscribe {
    void ev
    return this.emitter.on('sessions', handler)
  }

  async disposeAll(): Promise<void> {
    for (const session of this.sessionsList.slice()) {
      await session.dispose()
    }
    for (const dispose of this.providerDisposers) dispose()
    this.providerDisposers.length = 0
    this.emitter.clear()
  }

  async refreshDeviceAvailability(): Promise<void> {
    const entries = await this.listAuthorized()
    for (const session of this.sessionsList) {
      if (session.state !== 'error') continue
      const available = entries.some((entry) => entry.transport.isSameDevice(session.transport))
      if (available) session.markDeviceAvailable()
    }
  }

  private findByTransport(transport: ByteTransport): LinkSession | undefined {
    return this.sessionsList.find((session) => session.transport.isSameDevice(transport))
  }

  private removeSession(session: LinkSession): void {
    const index = this.sessionsList.indexOf(session)
    if (index < 0) return
    this.sessionsList.splice(index, 1)
    this.emitSessions()
  }

  private emitSessions(): void {
    this.emitter.emit('sessions', this.sessionsList.slice())
  }
}

/** Creates an isolated manager (tests); the app uses `getLinkManager()`. */
export function createLinkManager(options: LinkManagerOptions = {}): LinkManager {
  return new LinkManagerImpl(options)
}

let singleton: LinkManager | undefined

/** Application-wide manager, created lazily. */
export function getLinkManager(): LinkManager {
  singleton ??= createLinkManager()
  return singleton
}
