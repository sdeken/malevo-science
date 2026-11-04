/**
 * End-to-end smoke test: launches the built app with a throwaway userData
 * folder, creates a world, checks what landed on disk, relaunches, and checks
 * the refusal paths.
 *
 *   npm run build && node scripts/smoke.mjs        (Windows / desktop)
 *   npm run build && xvfb-run -a node scripts/smoke.mjs   (Linux CI)
 */
import { _electron as electron } from 'playwright-core'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'malevo-smoke-'))
const userData = path.join(tmp, 'userData')
const worldDir = path.join(tmp, 'worlds', 'smoke')
const shots = process.env.SMOKE_SHOTS ? path.resolve(process.env.SMOKE_SHOTS) : path.join(tmp, 'shots')
await fs.mkdir(userData, { recursive: true })
await fs.mkdir(shots, { recursive: true })

const failures = []
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`)
  if (!cond) failures.push(msg)
}

async function launch() {
  const app = await electron.launch({
    args: [appRoot, '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, MALEVO_USER_DATA: userData, NODE_ENV: 'production' }
  })
  app.on('console', (m) => console.log('  [main]', m.text()))
  const page = await app.firstWindow()
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log('  [renderer]', m.type(), m.text())
  })
  page.on('pageerror', (e) => {
    console.log('  [pageerror]', e.message)
    failures.push(`page error: ${e.message}`)
  })
  return { app, page }
}

let app
try {
  // 1. First run: no world.
  ;({ app } = await launch())
  let page = await app.firstWindow()
  await page.waitForSelector('.welcome', { timeout: 30_000 })
  check((await page.locator('.welcome h1').textContent()) === 'Malevo Science', 'first run shows the welcome screen')
  check((await page.locator('.recent').count()) === 0, 'no recent worlds yet')
  await page.screenshot({ path: path.join(shots, '01-welcome.png') })

  // 2. The new-world dialog opens and refuses to create without a folder.
  await page.locator('.welcome-actions button.primary').click()
  await page.waitForSelector('.modal')
  await page.locator('#worldName').fill('Smoke World')
  check(await page.locator('.modal button[type=submit]').isDisabled(), 'Create is disabled until a folder is chosen')
  await page.screenshot({ path: path.join(shots, '02-new-world.png') })
  await page.locator('.modal button', { hasText: 'Cancel' }).click()

  // 3. Create a world (the native folder picker can't be driven, so call the same API the dialog uses).
  const created = await page.evaluate((dir) => window.malevo.world.create(dir, '  Smoke   World '), worldDir)
  check(created.ok === true, 'creating a world in a missing folder succeeds')
  await page.waitForSelector('.workspace', { timeout: 10_000 })
  check((await page.locator('.sidebar-world').textContent()) === 'Smoke World', 'the workspace shows the world name, normalized')
  check((await page.locator('.tool-link.is-current').textContent()) === 'World', 'the World tool is registered and selected')
  check(
    (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())) === 'Smoke World — Malevo Science',
    'window title names the world'
  )

  // 4. What landed on disk: world.json and the new-world template, nothing else, all canonical.
  const listAll = async (dir, rel = '') => {
    const out = []
    for (const e of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) out.push(...(await listAll(path.join(dir, e.name), r)))
      else out.push(r)
    }
    return out
  }
  const EXPECTED_FILES = '["calendars/gregorian.json","settings/physics.json","world.json"]'
  const files = await listAll(worldDir)
  check(JSON.stringify(files) === EXPECTED_FILES, `the world folder holds world.json and the template, nothing else (${files.join(', ')})`)
  const text = await fs.readFile(path.join(worldDir, 'world.json'), 'utf8')
  const manifest = JSON.parse(text)
  check(manifest.format === 1 && manifest.name === 'Smoke World', 'world.json has format 1 and the name')
  check(Number.isInteger(manifest.seed) && manifest.seed >= 0 && manifest.seed < 2 ** 32, 'world.json has a 32-bit seed')
  check(
    text === `{\n  "format": 1,\n  "name": "Smoke World",\n  "seed": ${manifest.seed}\n}\n`,
    'world.json is canonical (key order, indent, LF, trailing newline)'
  )
  check((await page.locator('.world-seed').textContent()) === String(manifest.seed), 'the World tool shows the seed from the file')
  check(!JSON.stringify(await fs.readdir(userData)).includes('world.json'), 'nothing world-related is written to userData but settings')
  const stat = await fs.stat(path.join(worldDir, 'world.json'))
  const physicsStat = await fs.stat(path.join(worldDir, 'settings', 'physics.json'))

  // 4b. The Checks tool finds nothing wrong with a new world, and writes nothing.
  await page.locator('.tool-link', { hasText: 'Checks' }).click()
  await page.waitForSelector('.checks-summary', { timeout: 10_000 })
  check((await page.locator('.checks-summary').textContent()) === 'No problems found.', 'the Checks tool finds no problems in a new world')
  check((await page.locator('.checks-fix').count()) === 0, 'a new world needs no formatting fixes')
  await page.screenshot({ path: path.join(shots, '04-checks.png') })
  await page.locator('.tool-link', { hasText: 'World' }).click()

  // 4c. The command-line checker agrees, and reads only.
  let cliOut = ''
  let cliStatus = 0
  try {
    cliOut = execFileSync(process.execPath, [path.join(appRoot, 'out/cli/malevo.mjs'), 'check', worldDir], { encoding: 'utf8' })
  } catch (err) {
    cliStatus = err.status
    cliOut = String(err.stdout)
  }
  check(
    cliStatus === 0 && cliOut.trim().endsWith('No problems found.'),
    `malevo check passes the new world (${cliOut.trim().split('\n').at(-1)})`
  )
  await page.screenshot({ path: path.join(shots, '03-world.png') })

  // 5. A non-empty folder is refused.
  const busyDir = path.join(tmp, 'busy')
  await fs.mkdir(busyDir)
  await fs.writeFile(path.join(busyDir, 'notes.txt'), 'hello')
  const refused = await page.evaluate((dir) => window.malevo.world.create(dir, 'Nope'), busyDir)
  check(refused.ok === false && refused.code === 'not-empty', 'creating in a non-empty folder is refused')
  check(JSON.stringify(await fs.readdir(busyDir)) === '["notes.txt"]', 'the non-empty folder is left untouched')

  // 6. Relaunch: the last world reopens, and opening writes nothing.
  await app.close()
  ;({ app } = await launch())
  page = await app.firstWindow()
  await page.waitForSelector('.workspace', { timeout: 30_000 })
  check((await page.locator('.sidebar-world').textContent()) === 'Smoke World', 'relaunch reopens the last world')
  const after = await fs.stat(path.join(worldDir, 'world.json'))
  check(after.mtimeMs === stat.mtimeMs, 'reopening a world does not write to it')
  check(
    (await fs.stat(path.join(worldDir, 'settings', 'physics.json'))).mtimeMs === physicsStat.mtimeMs,
    'checking and reopening never rewrite world files'
  )
  check(JSON.stringify(await listAll(worldDir)) === EXPECTED_FILES, 'the world folder still holds only its own files')

  // 7. Close the world: back to welcome, with it in the recent list.
  await page.evaluate(() => window.malevo.world.close())
  await page.waitForSelector('.welcome .recent', { timeout: 10_000 })
  check((await page.locator('.recent-name').first().textContent()) === 'Smoke World', 'the closed world is listed under recent worlds')

  // 8. A world from a newer app is refused with a clear message.
  const futureDir = path.join(tmp, 'future')
  await fs.mkdir(futureDir)
  await fs.writeFile(path.join(futureDir, 'world.json'), '{"format": 99, "name": "Future", "seed": 1}\n')
  const future = await page.evaluate((dir) => window.malevo.world.open(dir), futureDir)
  check(future.ok === false && future.code === 'format-too-new', 'a newer world format is refused')
  check((await fs.readFile(path.join(futureDir, 'world.json'), 'utf8')).includes('"format": 99'), 'the refused world is left untouched')

  // 8b. A world from before physics settings existed gets them from the Checks tool.
  const oldDir = path.join(tmp, 'old-world')
  await fs.mkdir(oldDir)
  await fs.writeFile(path.join(oldDir, 'world.json'), '{\n  "format": 1,\n  "name": "Old",\n  "seed": 5\n}\n')
  const opened = await page.evaluate((dir) => window.malevo.world.open(dir), oldDir)
  check(opened.ok === true, 'a Phase 0 world (world.json only) still opens')
  await page.locator('.tool-link', { hasText: 'Checks' }).click()
  await page.waitForSelector('.checks-fix button.primary', { timeout: 10_000 })
  await page.locator('.checks-fix button.primary').click()
  await page.waitForSelector('.ok', { timeout: 10_000 })
  check(
    (await page.locator('.ok').textContent()) === 'Added settings/physics.json, calendars/gregorian.json.',
    'the Checks tool adds the missing template files'
  )
  check((await page.locator('.checks-summary').textContent()) === 'No problems found.', 'after which the old world checks clean')
  await page.locator('.tool-link', { hasText: 'World' }).click()
  await page.evaluate(() => window.malevo.world.close())
  await page.waitForSelector('.welcome .recent', { timeout: 10_000 })

  // 9. Reopen from the recent list.
  await page.locator('.recent-open', { hasText: 'Smoke World' }).click()
  await page.waitForSelector('.workspace', { timeout: 10_000 })
  check(true, 'a recent world reopens from the welcome screen')

  // 10. The update status reports a dev build.
  const status = await page.evaluate(() => window.malevo.updates.status())
  check(status.state === 'unavailable', 'an unpackaged build reports updates as unavailable')
} catch (err) {
  failures.push(String(err?.stack ?? err))
  console.error(err)
} finally {
  await app?.close().catch(() => {})
}

console.log(`\nscreenshots: ${shots}`)
if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed`)
  process.exit(1)
}
console.log('\nsmoke test passed')
