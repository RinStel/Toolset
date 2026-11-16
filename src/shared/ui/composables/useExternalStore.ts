import { onScopeDispose, shallowRef, type ShallowRef } from 'vue'

/**
 * Subscribes to an external (non-Vue) store and mirrors its snapshot in a
 * `shallowRef`. The subscription is disposed together with the owning component or
 * effect scope (plan §7.3).
 *
 * ```ts
 * const value = useExternalStore(
 *   (notify) => store.subscribe(() => notify()),
 *   () => store.get(),
 * )
 * ```
 */
export function useExternalStore<T>(
  subscribe: (onChange: () => void) => () => void,
  getSnapshot: () => T,
): ShallowRef<T> {
  const state = shallowRef(getSnapshot()) as ShallowRef<T>
  const unsubscribe = subscribe(() => {
    state.value = getSnapshot()
  })
  onScopeDispose(unsubscribe)
  return state
}
