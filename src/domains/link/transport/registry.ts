/**
 * Transport provider registry (plan §5).
 *
 * Every `transports/<name>/provider.ts` module exports a `provider`; Vite's eager
 * glob collects them at build time so adding a transport never touches this file.
 */

import type { TransportProvider } from './types'

interface ProviderModule {
  provider?: TransportProvider
}

const modules = import.meta.glob<ProviderModule>('../transports/*/provider.ts', {
  eager: true,
})

let cached: TransportProvider[] | null = null

function collect(): TransportProvider[] {
  const providers: TransportProvider[] = []
  for (const module of Object.values(modules)) {
    const candidate = module.provider
    if (candidate === undefined) continue
    if (providers.some((provider) => provider.kind === candidate.kind)) continue
    providers.push(candidate)
  }
  return providers.sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order
    return left.kind.localeCompare(right.kind)
  })
}

/** All registered providers, sorted by `order`. */
export function listProviders(): TransportProvider[] {
  cached ??= collect()
  return cached
}

/** Looks up one provider by its kind, e.g. `'web-serial'`. */
export function getProvider(kind: string): TransportProvider | undefined {
  return listProviders().find((provider) => provider.kind === kind)
}
