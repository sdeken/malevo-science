/**
 * The VS Code editors in a plain browser: the built webview (vscode/dist), talking to the real world session
 * through a stand-in for VS Code's message bridge. Drives a detached system (Altaris) and one of its bodies.
 * `node scripts/vscode-harness.mjs` after `npm run vscode:build`.
 */
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'malevo-vscode-'))
const shots = path.join(tmp, 'shots')
await fs.mkdir(shots)
const hostFile = path.join(tmp, 'host.mjs')
await build({
  entryPoints: [path.join(root, 'vscode/test/harness-host.ts')],
  outfile: hostFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning'
})
const { startHost } = await import(pathToFileURL(hostFile).href)
const { createWorld, writeWorldFile } = await import(pathToFileURL(path.join(tmp, 'model-node.mjs')).href).catch(async () => {
  await build({
    entryPoints: [path.join(root, 'packages/model/src/node.ts')],
    outfile: path.join(tmp, 'model-node.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'warning'
  })
  return import(pathToFileURL(path.join(tmp, 'model-node.mjs')).href)
})

let failures = 0
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures++
}

// A world with a detached system: Altaris, around its own K1 star, with one planet.
const worldDir = path.join(tmp, 'world')
await createWorld(worldDir, 'Harness', 7)
await writeWorldFile(worldDir, 'systems/altaris.json', JSON.stringify({ name: 'Altaris', spect: 'K1V' }, null, 2) + '\n')
await writeWorldFile(
  worldDir,
  'bodies/altaris-b.json',
  JSON.stringify(
    {
      name: 'Altaris b',
      system: 'altaris',
      class: 'ocean',
      orbit: { a_au: 0.62, e: 0.03, i_deg: 0, node_deg: 0, peri_deg: 0, meanAnomaly_deg: 40, epoch: { t_s: 0 } },
      mass_mearth: 1.1,
      radius_km: 6600,
      rotation: { period_h: 31, tilt_deg: 18 }
    },
    null,
    2
  ) + '\n'
)
const host = await startHost(worldDir, path.join(root, 'assets/catalog/hyg-stars.json'))

const css = await fs.readFile(path.join(root, 'vscode/dist/webview.css'), 'utf8')
const js = await fs.readFile(path.join(root, 'vscode/dist/webview.js'), 'utf8')
const browser = await chromium.launch(process.env.HARNESS_CHROMIUM ? { executablePath: process.env.HARNESS_CHROMIUM } : {})
const open = async (kind, id) => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  page.on('pageerror', (e) => {
    console.log('  [pageerror]', e.message)
    failures++
  })
  await page.exposeFunction('__toHost', async (m) => {
    if (m.type !== 'call') return
    try {
      const value = await host.call(m.method, m.args ?? [])
      await page.evaluate((r) => window.postMessage(r, '*'), { type: 'result', id: m.id, value: value === undefined ? null : value })
    } catch (err) {
      await page.evaluate((r) => window.postMessage(r, '*'), { type: 'result', id: m.id, error: String(err.message ?? err) })
    }
  })
  host.onEvent((name, payload) => void page.evaluate((e) => window.postMessage(e, '*'), { type: 'event', name, payload }).catch(() => {}))
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body class="vscode-host"><div id="root"></div>
<script id="boot" type="application/json">${JSON.stringify({ kind, id, root: worldDir })}</script>
<script>window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__toHost(m) })</script>
<script>${js.replace(/<\/script/g, '<\\/script')}</script></body></html>`)
  return page
}

// The system.
const sys = await open('system', 'altaris')
await sys.waitForSelector('[data-system-detail="altaris"]', { timeout: 20_000 })
const line = (await sys.locator('.star-line').textContent()) ?? ''
check(
  /K1V/.test(line) && /not placed among the stars/.test(line),
  `a detached system shows its own star, unplaced (${line.trim().slice(0, 120)})`
)
check((await sys.locator('.datebar #currentDate').count()) === 1, 'with the current date bar on top')
await sys.screenshot({ path: path.join(shots, 'system.png'), fullPage: true })
await sys.locator('[data-body-row="altaris-b"]').first().click()
await sleep(200)
check(host.opened.includes('body:altaris-b'), `clicking a body opens it in its own tab (${host.opened.join(', ')})`)
await sys.locator('#placement-stand-in').click()
await sys.locator('#placementSearch').fill('Proxima')
await sys.waitForSelector('[data-place="hip.70890"]')
await sys.locator('[data-place="hip.70890"]').click()
await sleep(300)
const placed = host.session.snapshot().systems.find((s) => s.id === 'altaris')
check(
  placed.placement === 'stand-in' && placed.starId === 'hip.70890' && placed.star.mass < 0.9,
  'it can borrow a stand-in star (Proxima) and keep its own K1 star'
)
await sys.locator('#placementRandom').click()
await sleep(400)
const moved = host.session.snapshot().systems.find((s) => s.id === 'altaris')
check(/^g\./.test(moved.starId) && moved.placement === 'stand-in', `or a random generated star nearby (${moved.starId})`)
await sys.screenshot({ path: path.join(shots, 'system-stand-in.png'), fullPage: true })

// The body.
const body = await open('body', 'altaris-b')
await body.waitForSelector('.body-editor', { timeout: 20_000 })
check(
  /Orbital period/.test((await body.locator('.body-editor').textContent()) ?? ''),
  'a body opens in the body editor, with what follows from it'
)
await body.locator('#bodyName').fill('Altaris')
await body.locator('#bodyName').press('Enter')
await sleep(300)
check(
  host.session.snapshot().systems.some((s) => s.bodies.some((b) => b.name === 'Altaris' && b.id === 'altaris')),
  'editing it changes the file (unsaved, like any edit); a new name renames the file (VS Code reopens the tab under it)'
)
await body.close()
const body2 = await open('body', 'altaris')
await body2.waitForSelector('.body-editor', { timeout: 20_000 })
await body2.locator('#openSystem').click()
await sleep(200)
check(host.opened.includes('system:altaris'), 'and its system opens from it')
// The current date: set in one editor, followed by the other.
await body2.locator('#currentDate').fill('2350-03-01 08:00')
await body2.locator('#currentDate').press('Enter')
await sys
  .waitForFunction(() => document.querySelector('#currentDate')?.value === '2350-03-01 08:00', null, { timeout: 5000 })
  .then(
    () => check(true, 'the current date set in one editor moves the other'),
    () => check(false, 'the current date set in one editor moves the other')
  )
await body2.screenshot({ path: path.join(shots, 'body.png'), fullPage: true })
await browser.close()
console.log(`\nscreenshots: ${shots}`)
console.log(failures ? `\n${failures} check(s) failed` : '\nharness passed')
process.exit(failures ? 1 : 0)
