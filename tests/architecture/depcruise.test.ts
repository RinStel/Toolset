import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

/**
 * 对 `tests/architecture/fixtures/` 中每条依赖规则的故意违规样例运行 dependency-cruiser，
 * 断言样例被对应规则拦截（plan.md §3.2、§11.2）。
 *
 * 每个样例是一个最小的“项目”：把样例复制到临时目录，复制项目根目录的
 * `.dependency-cruiser.cjs` 进去（配置以自身所在目录为项目根，从而按样例里的
 * `src/domains`、`src/tools` 生成同名规则），再从该目录执行 `depcruise src`。
 */

const projectRoot = process.cwd()
const fixturesDir = path.join(projectRoot, 'tests', 'architecture', 'fixtures')
const tempRoot = path.join(projectRoot, '.tmp', 'arch-fixtures')
const depcruiseBin = path.join(
  projectRoot,
  'node_modules',
  'dependency-cruiser',
  'bin',
  'dependency-cruise.mjs',
)

interface FixtureCase {
  /** fixtured 目录名 */
  name: string
  /** 期望被触发的规则名（生成规则名带上实体名，故用前缀匹配） */
  expectedRule: string
}

const fixtureCases: FixtureCase[] = [
  { name: 'shared-pure', expectedRule: 'shared-pure' },
  { name: 'shared-ui', expectedRule: 'shared-ui' },
  { name: 'domain-no-ui', expectedRule: 'domain-no-ui' },
  { name: 'domain-public-only', expectedRule: 'domain-public-only' },
  { name: 'domain-direction-bytes', expectedRule: 'domain-direction-bytes' },
  { name: 'domain-direction-protocol', expectedRule: 'domain-direction-protocol' },
  { name: 'tool-isolation', expectedRule: 'tool-isolation' },
  { name: 'tool-domain-public', expectedRule: 'tool-domain-public' },
  { name: 'app-boundary', expectedRule: 'app-boundary' },
  { name: 'manifest-light', expectedRule: 'manifest-light' },
  { name: 'widget-definition-light', expectedRule: 'widget-definition-light' },
  { name: 'no-circular', expectedRule: 'no-circular' },
]

interface RunOutput {
  stdout: string
  stderr: string
}

/**
 * 沙箱禁止管道通信（spawn 的 stdio 'pipe' 会 EPERM），因此把子进程输出写入文件再读取。
 */
function runDepcruise(cwd: string): Promise<RunOutput> {
  const stdoutFile = path.join(cwd, 'depcruise-stdout.json')
  const stderrFile = path.join(cwd, 'depcruise-stderr.txt')
  const stdoutFd = fs.openSync(stdoutFile, 'w')
  const stderrFd = fs.openSync(stderrFile, 'w')

  return new Promise<RunOutput>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [depcruiseBin, 'src', '--config', '.dependency-cruiser.cjs', '--output-type', 'json'],
      { cwd, stdio: ['ignore', stdoutFd, stderrFd] },
    )
    child.on('error', (error) => {
      fs.closeSync(stdoutFd)
      fs.closeSync(stderrFd)
      reject(error)
    })
    child.on('close', () => {
      fs.closeSync(stdoutFd)
      fs.closeSync(stderrFd)
      resolve({
        stdout: fs.readFileSync(stdoutFile, 'utf8'),
        stderr: fs.readFileSync(stderrFile, 'utf8'),
      })
    })
  })
}

function prepareFixture(name: string): string {
  const tempDir = path.join(tempRoot, name)
  fs.rmSync(tempDir, { recursive: true, force: true })
  fs.mkdirSync(tempDir, { recursive: true })
  fs.cpSync(path.join(fixturesDir, name), tempDir, { recursive: true })
  fs.copyFileSync(
    path.join(projectRoot, '.dependency-cruiser.cjs'),
    path.join(tempDir, '.dependency-cruiser.cjs'),
  )
  return tempDir
}

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

describe('dependency-cruiser 规则样例', () => {
  for (const fixtureCase of fixtureCases) {
    it(`${fixtureCase.name} 被 ${fixtureCase.expectedRule} 拦截`, async () => {
      const tempDir = prepareFixture(fixtureCase.name)
      const { stdout, stderr } = await runDepcruise(tempDir)

      let parsed: { summary?: { violations?: Array<{ rule?: { name?: string } }> } }
      try {
        parsed = JSON.parse(stdout)
      } catch {
        throw new Error(
          `dependency-cruiser 未输出可解析的 JSON（fixture ${fixtureCase.name}）：\nstdout: ${stdout.slice(0, 800)}\nstderr: ${stderr.slice(0, 800)}`,
        )
      }

      const ruleNames = (parsed.summary?.violations ?? []).map(
        (violation) => violation.rule?.name ?? '',
      )
      expect(
        ruleNames.some((ruleName) => ruleName.startsWith(fixtureCase.expectedRule)),
        `期望规则 ${fixtureCase.expectedRule} 被触发，实际触发的规则：${JSON.stringify(ruleNames)}\nstderr: ${stderr.slice(0, 800)}`,
      ).toBe(true)
    }, 60_000)
  }
})
