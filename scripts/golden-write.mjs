/**
 * Creates golden fixtures for frozen generators that have none yet (it never
 * overwrites one). Cross-platform wrapper for GOLDEN_WRITE=1 vitest run packages/gen.
 */
import { spawnSync } from 'node:child_process'

const result = spawnSync('npx', ['vitest', 'run', 'packages/gen'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, GOLDEN_WRITE: '1' }
})
process.exitCode = result.status ?? 1
