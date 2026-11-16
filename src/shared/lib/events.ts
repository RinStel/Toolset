/** Events map: event name to payload type. */
export type EventMap = Record<string, unknown>

export type EventHandler<T> = (payload: T) => void

export type Unsubscribe = () => void

export interface TypedEmitter<Events extends EventMap> {
  /** Subscribes to `event`; the returned function removes the handler again. */
  on<K extends keyof Events & string>(event: K, handler: EventHandler<Events[K]>): Unsubscribe
  /** Subscribes once; the handler is removed before it is invoked. */
  once<K extends keyof Events & string>(event: K, handler: EventHandler<Events[K]>): Unsubscribe
  off<K extends keyof Events & string>(event: K, handler: EventHandler<Events[K]>): void
  emit<K extends keyof Events & string>(event: K, payload: Events[K]): void
  /** Removes all handlers, or only the ones of one event. */
  clear(event?: keyof Events & string): void
  listenerCount(event?: keyof Events & string): number
}

type AnyHandler = EventHandler<never>

/**
 * Creates a typed event emitter supporting multiple subscribers.
 *
 * Handlers run synchronously in subscription order on a snapshot of the handler
 * list, so subscribing/unsubscribing inside a handler is safe. Handler exceptions
 * propagate to the emitter (callers are expected to guard their own handlers).
 */
export function createEmitter<Events extends EventMap>(): TypedEmitter<Events> {
  const handlers = new Map<string, Set<AnyHandler>>()

  function add<K extends keyof Events & string>(
    event: K,
    handler: EventHandler<Events[K]>,
  ): Unsubscribe {
    let set = handlers.get(event)
    if (!set) {
      set = new Set<AnyHandler>()
      handlers.set(event, set)
    }
    set.add(handler as AnyHandler)
    return () => {
      remove(event, handler)
    }
  }

  function remove<K extends keyof Events & string>(
    event: K,
    handler: EventHandler<Events[K]>,
  ): void {
    const set = handlers.get(event)
    if (!set) return
    set.delete(handler as AnyHandler)
    if (set.size === 0) handlers.delete(event)
  }

  return {
    on: add,
    once(event, handler) {
      const unsubscribe = add(event, (payload) => {
        unsubscribe()
        handler(payload)
      })
      return unsubscribe
    },
    off: remove,
    emit(event, payload) {
      const set = handlers.get(event)
      if (!set) return
      for (const handler of [...set]) {
        const typed = handler as unknown as EventHandler<Events[typeof event]>
        typed(payload)
      }
    },
    clear(event) {
      if (event === undefined) handlers.clear()
      else handlers.delete(event)
    },
    listenerCount(event) {
      if (event === undefined) {
        let total = 0
        for (const set of handlers.values()) total += set.size
        return total
      }
      return handlers.get(event)?.size ?? 0
    },
  }
}
