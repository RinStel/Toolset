#!/usr/bin/env node
/**
 * Verifies the production bundle against the split rules in plan.md §3.3.
 *
 * Reads dist/.vite/chunk-report.json (written by scripts/vite-chunk-report.ts) and fails
 * with a non-zero exit code when:
 *  1. the static entry closure contains domain code, tool views/panels/stores, dashboard
 *     code, CodeMirror or uPlot;
 *  2. a tool view/panel component or a dashboard widget lives inside the entry chunk;
 *  3. the protocol worker has no standalone artifact in dist/assets/;
 *  4. a uPlot chunk is statically imported by the terminal view (SerialToolView.vue);
 *  5. the gzipped entry closure exceeds 120KB.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const projectRoot = process.cwd()
const distDir = path.join(projectRoot, 'dist')
const reportPath = path.join(distDir, '.vite', 'chunk-report.json')
const gzipLimit = 120 * 1024

function fail(message) {
  console.error(`[check-chunks] ${message}`)
  process.exit(1)
}

function toPosix(value) {
  return value.replace(/\\/g, '/')
}

/** Matches `node_modules/.../<package>/` while tolerating the plain `node_modules/<package>/` form. */
function dependencyModulePattern(packagePattern) {
  return new RegExp(`(^|/)(node_modules/.*/)?(${packagePattern})/`)
}

const uplotModuleRegex = dependencyModulePattern('uplot')

if (!fs.existsSync(reportPath)) {
  fail(`缺少 ${path.relative(projectRoot, reportPath)}，请先运行 pnpm build。`)
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const chunks = Array.isArray(report.chunks) ? report.chunks : []
if (chunks.length === 0) {
  fail('chunk 报告为空，构建产物不完整。')
}

const chunksByFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
const violations = []

/** Follows static `imports` from the given chunks and returns the whole closure. */
function staticClosure(startFileNames) {
  const closure = new Set()
  const pending = [...startFileNames]
  while (pending.length > 0) {
    const fileName = pending.pop()
    if (fileName === undefined || closure.has(fileName)) continue
    closure.add(fileName)
    const chunk = chunksByFileName.get(fileName)
    if (!chunk) continue
    for (const imported of chunk.imports) {
      if (!closure.has(imported)) pending.push(imported)
    }
  }
  return closure
}

/** 1. entry closure ------------------------------------------------------- */
const entryChunks = chunks.filter((chunk) => chunk.isEntry)
if (entryChunks.length === 0) {
  fail('未找到入口 chunk。')
}

const closure = staticClosure(entryChunks.map((chunk) => chunk.fileName))

const forbiddenModulePatterns = [
  {
    regex: /^src\/domains\//,
    label: '领域代码',
  },
  {
    regex: /^src\/tools\/[^/]+\/(views|components|panels|stores|composables)\//,
    label: '工具视图/组件',
  },
  {
    regex: /^src\/tools\/[^/]+\/dashboard\//,
    label: '仪表盘代码',
  },
  {
    regex: /(^|\/)(node_modules\/.*\/)?(codemirror|@codemirror)\//,
    label: 'CodeMirror',
  },
  {
    regex: uplotModuleRegex,
    label: 'uPlot',
  },
]

for (const fileName of closure) {
  const chunk = chunksByFileName.get(fileName)
  for (const moduleId of chunk?.moduleIds ?? []) {
    for (const { regex, label } of forbiddenModulePatterns) {
      if (regex.test(moduleId)) {
        violations.push(`入口闭包包含${label}：${moduleId}（chunk ${fileName}）`)
      }
    }
  }
}

/* 2. tool views / panels / dashboard widgets must be split out ------------- */
function collectFiles(dir, predicate, result = []) {
  if (!fs.existsSync(dir)) return result
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(full, predicate, result)
    else if (predicate(full)) result.push(full)
  }
  return result
}

const nonEntryModuleIds = new Set()
for (const chunk of chunks) {
  if (chunk.isEntry) continue
  for (const moduleId of chunk.moduleIds ?? []) nonEntryModuleIds.add(moduleId)
}

const toolsDir = path.join(projectRoot, 'src', 'tools')
const requiredSplitComponents = [
  {
    label: '工具视图/面板',
    regex: /[\\/](views|panels)[\\/][^\\/]+\.vue$/,
  },
  {
    label: '仪表盘组件',
    regex: /[\\/]dashboard[\\/]widgets[\\/][^\\/]+[\\/]Widget\.vue$/,
  },
]
for (const { label, regex } of requiredSplitComponents) {
  for (const file of collectFiles(toolsDir, (candidate) => regex.test(candidate))) {
    const moduleId = toPosix(path.relative(projectRoot, file))
    if (!nonEntryModuleIds.has(moduleId)) {
      violations.push(`${label}不在独立 chunk 中：${moduleId}`)
    }
  }
}

/** 3. protocol worker artifact --------------------------------------------- */
const workerSource = path.join(
  projectRoot,
  'src',
  'domains',
  'protocol',
  'runtime',
  'protocol.worker.ts',
)
const assetsDir = path.join(distDir, 'assets')
const assetFiles = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : []
const hasWorkerArtifact = assetFiles.some((file) => /^protocol\.worker-[\w-]+\.js$/.test(file))
if (fs.existsSync(workerSource)) {
  if (!hasWorkerArtifact) {
    violations.push('dist/assets/ 中缺少协议 Worker 的独立产物（protocol.worker-*.js）。')
  }
} else {
  console.log('[check-chunks] 尚未实现协议 Worker，跳过 Worker 产物检查。')
}

/** 4. uPlot must not be in the terminal view's static closure -------------- */
const terminalViewModuleId = 'src/tools/serial/views/SerialToolView.vue'
const terminalViewChunks = chunks.filter((chunk) =>
  (chunk.moduleIds ?? []).includes(terminalViewModuleId),
)
if (terminalViewChunks.length === 0) {
  console.log(
    `[check-chunks] 尚未找到 ${terminalViewModuleId} 所在的 chunk，跳过终端视图 uPlot 检查。`,
  )
} else {
  const terminalClosure = staticClosure(terminalViewChunks.map((chunk) => chunk.fileName))
  for (const fileName of terminalClosure) {
    const chunk = chunksByFileName.get(fileName)
    for (const moduleId of chunk?.moduleIds ?? []) {
      if (uplotModuleRegex.test(moduleId)) {
        violations.push(`终端视图的静态导入闭包包含 uPlot：${moduleId}（chunk ${fileName}）`)
      }
    }
  }
}

/** 5. gzipped entry closure size ------------------------------------------- */
let closureBytes = 0
const closureJsFiles = []
for (const fileName of closure) {
  if (!/\.m?js$/.test(fileName)) continue
  const fullPath = path.join(distDir, toPosix(fileName))
  if (!fs.existsSync(fullPath)) {
    violations.push(`入口闭包文件不存在：${fileName}`)
    continue
  }
  const gzipSize = zlib.gzipSync(fs.readFileSync(fullPath)).length
  closureBytes += gzipSize
  closureJsFiles.push(`${fileName} ${(gzipSize / 1024).toFixed(1)}KB`)
}
if (closureBytes > gzipLimit) {
  violations.push(
    `入口 JS gzip 体积 ${(closureBytes / 1024).toFixed(1)}KB 超过 ${gzipLimit / 1024}KB（${closureJsFiles.join(', ')}）`,
  )
}

if (violations.length > 0) {
  console.error(`[check-chunks] 发现 ${violations.length} 项违规：`)
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exit(1)
}

console.log(
  `[check-chunks] 通过：入口闭包 ${closure.size} 个 chunk，JS gzip 合计 ${(closureBytes / 1024).toFixed(1)}KB。`,
)
