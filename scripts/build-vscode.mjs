/**
 * Builds the VS Code extension into vscode/dist: the extension (Node, CommonJS), the editors' screens (the
 * app's React screens, for the webview), their styles, and the star catalogue. `--package` then makes the
 * .vsix in release/.
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ext = path.join(root, 'vscode')
const dist = path.join(ext, 'dist')
await fs.rm(dist, { recursive: true, force: true })
await fs.mkdir(dist, { recursive: true })

await build({
  entryPoints: [path.join(ext, 'src/host/extension.ts')],
  outfile: path.join(dist, 'extension.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  logLevel: 'warning'
})
await build({
  entryPoints: [path.join(ext, 'src/webview/main.tsx')],
  outfile: path.join(dist, 'webview.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  jsx: 'automatic',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@renderer': path.join(root, 'src/renderer/src') },
  logLevel: 'warning'
})
const css = await fs.readFile(path.join(root, 'src/renderer/src/styles.css'), 'utf8')
const vscss = await fs.readFile(path.join(ext, 'src/webview/vscode.css'), 'utf8')
await fs.writeFile(path.join(dist, 'webview.css'), `${css}\n${vscss}`)
await fs.copyFile(path.join(root, 'assets/catalog/hyg-stars.json'), path.join(dist, 'hyg-stars.json'))

if (process.argv.includes('--package')) {
  const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version
  const manifest = JSON.parse(await fs.readFile(path.join(ext, 'package.json'), 'utf8'))
  manifest.version = version
  await fs.writeFile(path.join(ext, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await fs.mkdir(path.join(root, 'release'), { recursive: true })
  const out = path.join(root, 'release', `malevo-science-${version}.vsix`)
  try {
    execFileSync(
      process.execPath,
      [path.join(root, 'node_modules/@vscode/vsce/vsce'), 'package', '--no-dependencies', '--allow-missing-repository', '-o', out],
      {
        cwd: ext,
        stdio: 'inherit'
      }
    )
  } finally {
    manifest.version = '0.0.0'
    await fs.writeFile(path.join(ext, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  }
}
