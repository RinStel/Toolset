import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'vite'

const projectRoot = process.cwd()

function toPosix(value: string): string {
  return value.replace(/\\/g, '/')
}

function toProjectRelative(id: string): string {
  const posix = toPosix(id)
  if (posix.startsWith('\0')) return posix
  const root = toPosix(projectRoot)
  if (/^[A-Za-z]:\//.test(posix) || posix.startsWith('/')) {
    const relative = path.posix.relative(root, posix)
    if (!relative.startsWith('..')) return relative
  }
  if (posix.startsWith(`${root}/`)) return posix.slice(root.length + 1)
  return posix.replace(/^\.\//, '')
}

export interface ChunkReportEntry {
  fileName: string
  isEntry: boolean
  isDynamicEntry: boolean
  imports: string[]
  dynamicImports: string[]
  moduleIds: string[]
}

/**
 * Writes `dist/.vite/chunk-report.json` during the build so `scripts/check-chunks.mjs`
 * can verify the entry closure and split boundaries without re-parsing the bundle.
 */
export default function chunkReportPlugin(): Plugin {
  return {
    name: 'toolset:chunk-report',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks: ChunkReportEntry[] = []
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue
        const explicitModuleIds = (item as unknown as { moduleIds?: string[] }).moduleIds
        const moduleIds = explicitModuleIds ?? Object.keys(item.modules ?? {})
        chunks.push({
          fileName: toPosix(item.fileName),
          isEntry: Boolean(item.isEntry),
          isDynamicEntry: Boolean(item.isDynamicEntry),
          imports: item.imports.map(toPosix),
          dynamicImports: item.dynamicImports.map(toPosix),
          moduleIds: [...new Set(moduleIds.map(toProjectRelative))].sort(),
        })
      }
      chunks.sort((a, b) => a.fileName.localeCompare(b.fileName))
      const outputDir = path.join(projectRoot, 'dist', '.vite')
      fs.mkdirSync(outputDir, { recursive: true })
      fs.writeFileSync(
        path.join(outputDir, 'chunk-report.json'),
        `${JSON.stringify({ chunks }, null, 2)}\n`,
        'utf8',
      )
    },
  }
}
