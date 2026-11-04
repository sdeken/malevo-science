/**
 * The `malevo` command (docs/PLAN.md §7.9). It knows nothing about git.
 *
 *   malevo check [world] [--fix] [--json]
 *   malevo template [world]
 *
 * `check` reads a world and reports what the checks find; it writes nothing
 * unless --fix is given, and --fix only rewrites files into canonical form
 * (their values never change). `template` copies any new-world template files
 * the world lacks, never touching one that exists.
 *
 * Exit status: 0 when no errors were found, 1 when some were, 2 when the
 * command itself could not run (bad arguments, not a world folder).
 */
import path from 'node:path'
import { canonicalFixes, runChecks, type Issue } from '@malevo/model'
import { addMissingTemplateFiles, applyFixes, loadWorld, nodeEnv } from '@malevo/model/node'

export interface Io {
  out(line: string): void
  err(line: string): void
  cwd: string
}

const USAGE = `Usage:
  malevo check [world] [--fix] [--json]   Check a world folder (default: the current folder).
                                          --fix rewrites files into canonical form; values never change.
                                          --json prints the findings as JSON.
  malevo template [world]                 Add any new-world template files the world is missing.
  malevo help                             Show this.`

export async function run(argv: readonly string[], io: Io): Promise<number> {
  const [command, ...rest] = argv
  const flags = new Set(rest.filter((a) => a.startsWith('--')))
  const args = rest.filter((a) => !a.startsWith('--'))
  const world = path.resolve(io.cwd, args[0] ?? '.')
  try {
    switch (command) {
      case 'check':
        return await check(world, flags, io)
      case 'template':
        return await template(world, io)
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        io.out(USAGE)
        return command === undefined ? 2 : 0
      default:
        io.err(`Unknown command "${command}".\n\n${USAGE}`)
        return 2
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    io.err(e.code === 'ENOENT' ? `${world} does not exist.` : e.code === 'ENOTDIR' ? `${world} is not a folder.` : e.message)
    return 2
  }
}

async function check(root: string, flags: Set<string>, io: Io): Promise<number> {
  for (const f of flags) if (f !== '--fix' && f !== '--json') throw new Error(`Unknown option ${f}.\n\n${USAGE}`)
  let world = await loadWorld(root)
  if (!world.manifest) {
    const why = world.issues.find((i) => i.path === 'world.json' || i.code === 'no-manifest')
    throw new Error(`${root}: ${why?.message ?? 'not a world folder.'}`)
  }
  const name = world.manifest.name
  let fixed: string[] = []
  if (flags.has('--fix')) {
    fixed = await applyFixes(root, canonicalFixes(world))
    if (fixed.length) world = await loadWorld(root)
  }
  const issues = runChecks(world, nodeEnv)
  if (flags.has('--json')) {
    io.out(JSON.stringify({ world: root, fixed, issues }, null, 2))
  } else {
    io.out(`Checking ${name} (${root})`)
    for (const p of fixed) io.out(`  fixed    ${p}  (rewritten in canonical form)`)
    for (const i of issues) io.out(`  ${formatIssue(i)}`)
    io.out(summary(issues))
  }
  return issues.some((i) => i.severity === 'error') ? 1 : 0
}

async function template(root: string, io: Io): Promise<number> {
  const added = await addMissingTemplateFiles(root)
  if (added.length === 0) io.out('The world already has every template file.')
  for (const p of added) io.out(`added ${p}`)
  return 0
}

export function formatIssue(i: Issue): string {
  const where = i.path ? `${i.path}${i.field ? ` › ${i.field}` : ''}` : '(world)'
  return `${i.severity.padEnd(8)} ${where}: ${i.message} [${i.check}/${i.code}]`
}

export function summary(issues: readonly Issue[]): string {
  const n = (s: Issue['severity']): number => issues.filter((i) => i.severity === s).length
  if (issues.length === 0) return 'No problems found.'
  const part = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`
  return `${part(n('error'), 'error')}, ${part(n('warning'), 'warning')}, ${part(n('info'), 'note')}.`
}
