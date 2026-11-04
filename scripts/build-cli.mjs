/**
 * Bundles the malevo command into out/cli/malevo.mjs: one self-contained file
 * that plain Node runs. `npm run malevo -- check <world>` builds and runs it.
 */
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
await build({
  entryPoints: [path.join(root, 'packages/cli/src/main.ts')],
  outfile: path.join(root, 'out/cli/malevo.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'warning'
})
