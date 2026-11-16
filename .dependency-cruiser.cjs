/**
 * dependency-cruiser configuration — enforces the layering rules in plan.md §3.2.
 *
 * Domain and tool rules are generated from the directories that actually exist under
 * `src/domains` and `src/tools`, so adding a tool or a domain automatically inherits the
 * same boundaries (`pnpm check:arch`).
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = __dirname

function listDirectories(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath)
  if (!fs.existsSync(absolutePath)) return []
  return fs
    .readdirSync(absolutePath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const domains = listDirectories(path.join('src', 'domains'))
const tools = listDirectories(path.join('src', 'tools'))

/**
 * Allowed cross-domain dependencies (plan §3.1/§3.2). Domains not listed here may only
 * depend on `bytes`, matching the "future tools only need bytes" rule.
 *
 * The direction table is complete even before a domain directory exists, so enabling a
 * planned domain later only requires creating its directory.
 */
const allowedDomainDependencies = {
  bytes: [],
  protocol: ['bytes'],
  link: ['bytes', 'protocol'],
  series: ['bytes', 'protocol', 'link'],
  dashboard: ['bytes', 'protocol', 'link', 'series'],
}
const defaultAllowedDomainDependencies = ['bytes']

const externalUi = 'node_modules/(vue|pinia|vue-router)/|\\.vue$'

/** @type {import('dependency-cruiser').IConfiguration} */
const config = {
  forbidden: [
    {
      name: 'shared-pure',
      comment:
        'src/shared/lib and src/shared/contracts must stay pure TypeScript without Vue, Pinia or higher layers.',
      severity: 'error',
      from: { path: '^src/shared/(lib|contracts)/' },
      to: {
        path: `node_modules/(vue|pinia)/|src/shared/ui/|\\.vue$|^src/(domains|tools|app)/`,
      },
    },
    {
      name: 'shared-ui',
      comment: 'Generic UI components must not depend on domains, tools or the app shell.',
      severity: 'error',
      from: { path: '^src/shared/ui/' },
      to: { path: '^src/(domains|tools|app)/' },
    },
    {
      name: 'domain-no-ui',
      comment: 'Domains are pure TypeScript: no Vue, Pinia, router, SFCs or higher layers.',
      severity: 'error',
      from: { path: '^src/domains/' },
      to: {
        path: `${externalUi}|src/shared/ui/|^src/(tools|app)/`,
      },
    },
    ...domains.flatMap((sourceDomain) =>
      domains
        .filter((targetDomain) => targetDomain !== sourceDomain)
        .map((targetDomain) => ({
          name: `domain-public-only-${sourceDomain}-${targetDomain}`,
          comment: `Domain ${sourceDomain} may only import ${targetDomain}/public.ts from domain ${targetDomain}.`,
          severity: 'error',
          from: { path: `^src/domains/${escapeRegExp(sourceDomain)}/` },
          to: { path: `^src/domains/${escapeRegExp(targetDomain)}/(?!public\\.ts$)` },
        })),
    ),
    ...domains.map((domain) => {
      const allowed = allowedDomainDependencies[domain] ?? defaultAllowedDomainDependencies
      const allowedPattern = [domain, ...allowed].map(escapeRegExp).join('|')
      return {
        name: `domain-direction-${domain}`,
        comment: `Domain ${domain} may only depend on itself${allowed.length > 0 ? ` and ${allowed.join(', ')}` : ''}.`,
        severity: 'error',
        from: { path: `^src/domains/${escapeRegExp(domain)}/` },
        to: { path: `^src/domains/(?!(${allowedPattern})/)` },
      }
    }),
    ...tools.flatMap((sourceTool) =>
      tools
        .filter((targetTool) => targetTool !== sourceTool)
        .map((targetTool) => ({
          name: `tool-isolation-${sourceTool}-${targetTool}`,
          comment: `Tool ${sourceTool} must not import tool ${targetTool}.`,
          severity: 'error',
          from: { path: `^src/tools/${escapeRegExp(sourceTool)}/` },
          to: { path: `^src/tools/${escapeRegExp(targetTool)}/` },
        })),
    ),
    {
      name: 'tool-domain-public',
      comment: 'Tools may only import domains through their public.ts entry points.',
      severity: 'error',
      from: { path: '^src/tools/' },
      to: { path: '^src/domains/[^/]+/(?!public\\.ts$)' },
    },
    {
      name: 'app-boundary',
      comment: 'The app shell may not import domains, and only manifest.ts/routes.ts from tools.',
      severity: 'error',
      from: { path: '^src/app/' },
      to: {
        path: '^src/domains/|^src/tools/[^/]+/(?!(manifest|routes)\\.ts$)',
      },
    },
    {
      name: 'manifest-light',
      comment:
        'manifest.ts/routes.ts stay light: no domains, no static SFC/CodeMirror/uPlot imports (dynamic import() only).',
      severity: 'error',
      from: { path: '^src/tools/[^/]+/(manifest|routes)\\.ts$' },
      to: {
        path: '^src/domains/|\\.vue$|node_modules/(codemirror|@codemirror|uplot)/',
        dependencyTypesNot: ['dynamic-import', 'type-only'],
      },
    },
    {
      name: 'widget-definition-light',
      comment:
        'Widget definitions stay light: no static SFC/uPlot/CodeMirror imports and no domains (dynamic import() or type imports only).',
      severity: 'error',
      from: { path: '^src/tools/[^/]+/dashboard/widgets/[^/]+/definition\\.ts$' },
      to: {
        path: '\\.vue$|^src/domains/|node_modules/(codemirror|@codemirror|uplot)/',
        dependencyTypesNot: ['dynamic-import', 'type-only'],
      },
    },
    {
      name: 'no-circular',
      comment: 'Circular dependencies are never allowed.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsConfig: {
      fileName: 'tsconfig.app.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.json', '.vue'],
    },
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)',
      },
    },
  },
}

module.exports = config
