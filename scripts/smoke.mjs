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
    // SMOKE_GL=1 draws WebGL in software, to see the 3D views.
    args: [
      appRoot,
      '--no-sandbox',
      ...(process.env.SMOKE_GL ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--disable-gpu'])
    ],
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
  check((await page.locator('.tool-link.is-current').textContent()) === 'Timeline', 'the Timeline tool is first and selected')
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
  // A new world holds world.json and a copy of the template (packages/model/template, less its README).
  const TEMPLATE_FILES = (await listAll(path.join(appRoot, 'packages/model/template'))).filter((p) => p !== 'README.md')
  const files = await listAll(worldDir)
  // Every new world also starts with the real Solar System: Sol and its bodies.
  const solBodies = files.filter((p) => p.startsWith('bodies/'))
  check(
    ['bodies/earth.json', 'bodies/moon.json', 'bodies/main-belt.json', 'bodies/jupiter.json'].every((p) => solBodies.includes(p)) &&
      solBodies.length >= 30,
    `a new world starts with the Solar System (${solBodies.length} bodies)`
  )
  const EXPECTED_FILES = JSON.stringify([...TEMPLATE_FILES, ...solBodies, 'systems/sol.json', 'world.json'].sort())
  check(
    JSON.stringify(files) === EXPECTED_FILES,
    `the world folder holds world.json, the template and the Solar System, nothing else (${files.join(', ')})`
  )
  const text = await fs.readFile(path.join(worldDir, 'world.json'), 'utf8')
  const manifest = JSON.parse(text)
  check(manifest.format === 1 && manifest.name === 'Smoke World', 'world.json has format 1 and the name')
  check(Number.isInteger(manifest.seed) && manifest.seed >= 0 && manifest.seed < 2 ** 32, 'world.json has a 32-bit seed')
  check(
    text === `{\n  "format": 1,\n  "name": "Smoke World",\n  "seed": ${manifest.seed}\n}\n`,
    'world.json is canonical (key order, indent, LF, trailing newline)'
  )
  await page.locator('.tool-link', { hasText: 'World' }).click()
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
  const addedText = (await page.locator('.ok').textContent()) ?? ''
  check(
    addedText.startsWith('Added ') && TEMPLATE_FILES.every((p) => addedText.includes(p)),
    `the Checks tool adds the missing template files (${addedText})`
  )
  check((await page.locator('.checks-summary').textContent()) === 'No problems found.', 'after which the old world checks clean')
  await page.locator('.tool-link', { hasText: 'World' }).click()
  await page.evaluate(() => window.malevo.world.close())
  await page.waitForSelector('.welcome .recent', { timeout: 10_000 })

  // 9. Reopen from the recent list.
  await page.locator('.recent-open', { hasText: 'Smoke World' }).click()
  await page.waitForSelector('.workspace', { timeout: 10_000 })
  check(true, 'a recent world reopens from the welcome screen')

  // 11. Phase 2: the timeline, calendars, saving, undo, scripts, fork and compare.
  const tool = async (name) => {
    await page.locator('.tool-link', { hasText: name }).first().click()
    await page.waitForSelector(`[data-tool]`)
  }
  const statusText = async () => (await page.locator('.statusbar').textContent()) ?? ''
  const exists = async (p) =>
    fs
      .access(path.join(worldDir, p))
      .then(() => true)
      .catch(() => false)
  await tool('Timeline')
  await page.waitForSelector('#currentDate')
  check(
    (await page.locator('#currentDate').inputValue()) === '2000-01-01 12:00',
    'the current date starts at the epoch in the Gregorian calendar'
  )

  // A first event: unsaved until saved.
  await page.locator('#newEvent').click()
  await page.waitForSelector('[data-editing="new-event"]')
  check((await statusText()).includes('1 unsaved change'), 'a new event is an unsaved change')
  check(!(await exists('events/new-event.json')), 'nothing is written before saving')
  await page.locator('#eventName').fill('Charter')
  await page.locator('#eventName').press('Enter')
  const dateField = page.locator('[data-editing="new-event"] fieldset.when .date-input input').first()
  await dateField.fill('2700-06')
  await dateField.press('Enter')
  await page.waitForFunction(() => document.querySelector('[data-editing="new-event"] .resolved code')?.textContent === '2700-06')
  check(true, 'the date is parsed, and shown to the precision it was entered at')
  await page.locator('.status-save').click()
  await page.waitForFunction(() => document.querySelector('.status-saved') !== null)
  const charter = JSON.parse(await fs.readFile(path.join(worldDir, 'events/new-event.json'), 'utf8'))
  check(
    charter.name === 'Charter' && charter.when.at.text === '2700-06' && charter.when.at.cal === 'gregorian',
    'saving writes the event file'
  )

  // A second event anchored to the first, 130 years later.
  await page.locator('#newEvent').click()
  await page.waitForSelector('[data-editing="new-event-2"]')
  await page.locator('#eventName').fill('Founding')
  await page.locator('#eventName').press('Enter')
  await page.locator('[data-editing="new-event-2"] .seg button', { hasText: 'Relative to an event' }).click()
  await page.waitForSelector('[data-editing="new-event-2"] .offset-grid')
  const years = page.locator('[data-editing="new-event-2"] .offset-grid label', { hasText: 'years' }).locator('input')
  await years.fill('130')
  await years.press('Enter')
  await page.waitForFunction(() => document.querySelector('[data-editing="new-event-2"] .resolved code')?.textContent === '2830-06')
  check(true, 'an anchored event resolves 130 years after its anchor, at the anchor’s precision')
  await page.locator('.toolbar button', { hasText: 'Fit' }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-event]').length === 2)
  check(true, 'after Fit, both events are drawn on the timeline')

  // Undo and redo with the keyboard (outside a text field), then save from the File menu.
  await page.locator('.timeline-canvas').click({ position: { x: 5, y: 120 } })
  await page.keyboard.press('Control+z')
  await page.waitForFunction(
    () =>
      document.querySelector('[data-editing="new-event-2"] .resolved code')?.textContent !== '2830-06' ||
      !document.querySelector('[data-editing="new-event-2"]')
  )
  check(true, 'Ctrl+Z undoes the last change')
  await page.keyboard.press('Control+y')
  await page.locator('[data-event="new-event-2"]').click()
  await page.waitForFunction(() => document.querySelector('[data-editing="new-event-2"] .resolved code')?.textContent === '2830-06')
  check(true, 'Ctrl+Y redoes it')
  await app.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu().items.find((i) => i.label === '&File')
    file.submenu.items.find((i) => i.label === '&Save').click()
  })
  await page.waitForFunction(() => document.querySelector('.status-saved') !== null)
  const founding = JSON.parse(await fs.readFile(path.join(worldDir, 'events/new-event-2.json'), 'utf8'))
  check(founding.when.after === 'new-event' && founding.when.offset.year === 130, 'File › Save writes the anchored event')
  await page.screenshot({ path: path.join(shots, '05-timeline.png') })

  // Moving the anchor moves what is anchored to it.
  await page.locator('[data-event="new-event"]').click()
  const charterDate = page.locator('[data-editing="new-event"] fieldset.when .date-input input').first()
  await charterDate.fill('2750-06')
  await charterDate.press('Enter')
  await page.locator('.toolbar button', { hasText: 'Fit' }).click()
  await page.locator('[data-event="new-event-2"]').click()
  await page.waitForFunction(() => document.querySelector('[data-editing="new-event-2"] .resolved code')?.textContent === '2880-06')
  check(true, 'moving the anchor moves the anchored event')
  await page.evaluate(() => window.malevo.world.discard())
  await page.waitForFunction(() => document.querySelector('.status-saved') !== null)

  // A script calendar, made from the template, run in the sandbox.
  await tool('Calendars')
  await page.locator('#newCalendar').click()
  await page.locator('[data-add-kind="script"]').click()
  await page.waitForFunction(() => document.querySelector('.preview-date')?.textContent?.startsWith('Y-99-01-01'))
  check(true, 'a new script calendar runs its template script (year 2000 is Y-99)')
  const code = page.locator('textarea.code')
  await code.fill('module.exports = {}')
  await page.locator('#calendarName').click()
  await page.waitForFunction(() => document.querySelector('.calendar-editor .preview .error')?.textContent?.includes('toFields'))
  check(true, 'a broken script is reported, not run')
  await page.locator('.split-list h2').click()
  await page.keyboard.press('Control+z')
  await page.waitForFunction(() => document.querySelector('.preview-date')?.textContent?.startsWith('Y-99'))
  check(true, 'undo restores the working script')
  await page.screenshot({ path: path.join(shots, '06-calendars.png') })

  // An era calendar, then show the current date in it.
  await page.locator('#newCalendar').click()
  await page.locator('[data-add-kind="era"]').click()
  await page.waitForFunction(() => document.querySelector('.preview-date')?.textContent?.endsWith(' NE-01-01 12:00:00'))
  check(
    (await page.locator('.preview-date').textContent()) === '-99 NE-01-01 12:00:00',
    'an era calendar counts years from its epoch (2000 is year −99 when 2100 is year 1)'
  )
  await page.locator('.status-save').click()
  await page.waitForFunction(() => document.querySelector('.status-saved') !== null)
  check(
    (await exists('calendars/script-calendar.js')) && (await exists('calendars/era-count-calendar.json')),
    'saving writes the calendars and the script'
  )

  // The checks agree that the saved world is sound.
  await tool('Checks')
  await page.locator('.checks-bar button').click()
  await page.waitForFunction(() => document.querySelector('.checks-summary')?.textContent === 'No problems found.')
  check(true, 'the saved world, script calendar included, passes every check')

  // Fork, change the fork on disk, compare, and take the change back.
  const forkDir = path.join(tmp, 'worlds', 'fork')
  const forked = await page.evaluate((dir) => window.malevo.world.fork(dir), forkDir)
  check(forked.ok && forked.world.name === 'Smoke World (fork)', 'forking copies the saved world under a new name')
  const forkEvent = path.join(forkDir, 'events/new-event.json')
  const ev = JSON.parse(await fs.readFile(forkEvent, 'utf8'))
  ev.when.at.text = '2750-06'
  ev.when.at.t_s += 50 * 365.2425 * 86400
  await fs.writeFile(forkEvent, JSON.stringify(ev, null, 2) + '\n')
  const report = await page.evaluate((dir) => window.malevo.world.compare(dir), forkDir)
  check(report.changed.length === 1 && report.changed[0].key === 'event/new-event', 'the comparison finds the one changed event')
  check(report.timeChanges.map((c) => c.id).join() === 'new-event,new-event-2', 'and shows that the anchored event moves with it')
  await tool('Fork & compare')
  await page.evaluate((keys) => window.malevo.world.take(keys[0], keys.slice(1)), [forkDir, 'event/new-event'])
  await page.waitForFunction(() => document.querySelector('.status-dirty') !== null)
  check(true, 'taking a change from the fork is an unsaved change here')
  await page.evaluate(() => window.malevo.world.discard())
  await page.waitForFunction(() => document.querySelector('.status-saved') !== null)
  check(JSON.stringify(await listAll(forkDir)).includes('events/new-event.json'), 'the fork is a complete world folder')

  // 12. Phase 3: stars, a system on one, rolled planets, a calendar that follows a body.
  await tool('Stars')
  await page.waitForSelector('.star-map', { timeout: 15_000 })
  await page.waitForFunction(() => /\d+ stars/.test(document.querySelector('.stars-side')?.textContent ?? ''), null, { timeout: 30_000 })
  check(true, 'the Stars tool loads the stars around Sol')
  await page.locator('#starSearch').fill('Proxima')
  await page.locator('[data-hit="hip.70890"]').click()
  await page.waitForSelector('[data-star="hip.70890"]', { timeout: 15_000 })
  check((await page.locator('.star-card h3').textContent()) === 'Proxima Centauri', 'searching finds Proxima Centauri and selects it')
  const card = (await page.locator('.star-card').textContent()) ?? ''
  check(/M5Ve/.test(card) && /4\.2\d* ly/.test(card), `its card shows its type and distance (${card.slice(0, 120)}…)`)
  await page.screenshot({ path: path.join(shots, '07-stars.png') })
  await page.locator('#newSystemHere').click()
  await page.waitForSelector('[data-system-detail="proxima-centauri"]', { timeout: 15_000 })
  check(true, 'a new system on the star opens in the Systems tool')
  await page.locator('#rollPlanets').click()
  await page.waitForSelector('.roll-panel', { timeout: 15_000 })
  const rollNo = async () => Number(/Roll (\d+)/.exec((await page.locator('.roll-panel h3').textContent()) ?? '')?.[1] ?? -1)
  const rollOnce = async () => {
    const before = await rollNo()
    await page.locator('.roll-panel button', { hasText: 'Roll again' }).click()
    await page.waitForFunction((n) => document.querySelector('.roll-panel h3')?.textContent === `Roll ${n}`, before + 1)
  }
  await rollOnce()
  await rollOnce()
  check((await rollNo()) === 2, 'rolling again gives a different system')
  // The world's seed is new every run, and now and then a small red dwarf rolls no planets: roll on until one has some.
  for (let k = 0; k < 20 && (await page.locator('.roll-panel tbody tr').count()) === 0; k++) await rollOnce()
  await page.locator('#keepRoll').click()
  await page.waitForSelector('[data-body-row]', { timeout: 15_000 })
  const kept = await page.locator('[data-body-row]').count()
  check(kept > 0, `keeping a roll adds its planets (${kept})`)
  const firstRow = page.locator('[data-body-row]').first()
  await firstRow.click()
  await page.waitForSelector('.body-editor', { timeout: 10_000 })
  check(/Orbital period/.test((await page.locator('.body-editor').textContent()) ?? ''), 'a body shows what follows from it')
  await page.screenshot({ path: path.join(shots, '08-system.png') })
  await page.locator('.status-save').click()
  await page.waitForFunction(() => document.querySelector('.status-saved') !== null)
  const sysFile = JSON.parse(await fs.readFile(path.join(worldDir, 'systems/proxima-centauri.json'), 'utf8'))
  check(sysFile.star === 'hip.70890', 'saving writes the system on its star')
  const bodyFiles = (await fs.readdir(path.join(worldDir, 'bodies'))).filter((f) => f.startsWith('proxima-centauri-'))
  check(bodyFiles.length === kept, 'and one file per kept planet')
  const planetFile = JSON.parse(await fs.readFile(path.join(worldDir, 'bodies', bodyFiles[0]), 'utf8'))
  check(
    planetFile.lock?.gen === 'planets@1' && Number.isInteger(planetFile.lock.seed),
    'kept planets record the generator and seed that made them'
  )
  // A planet-local calendar that follows the first planet (if it has a day to follow).
  const planetId = bodyFiles[0].replace(/\.json$/, '')
  await page.evaluate(
    (id) =>
      window.malevo.world.setEntity('calendar', 'local-days', {
        name: 'Local days',
        kind: 'solar',
        body: id,
        epoch: { t_s: 0 },
        epochYear: 1,
        hoursPerDay: 24,
        minutesPerHour: 60,
        secondsPerMinute: 60
      }),
    planetId
  )
  const snap = await page.evaluate(() => window.malevo.world.snapshot())
  const local = snap.calendars.find((c) => c.id === 'local-days')
  const planet = snap.systems.find((x) => x.id === 'proxima-centauri').bodies.find((b) => b.id === planetId)
  check(
    Number.isFinite(planet.solarDay) ? local.error === null : /same face/.test(local.error ?? ''),
    'a planet-local calendar follows its body (or says why it cannot)'
  )
  await page.evaluate(() => window.malevo.world.discard())
  await tool('Checks')
  await page.locator('.checks-bar button').click()
  await page.waitForFunction(() => /No problems found|notes/.test(document.querySelector('.checks-summary')?.textContent ?? ''))
  const summary = (await page.locator('.checks-summary').textContent()) ?? ''
  check(
    summary === 'No problems found.' || / 0 errors, 0 warnings/.test(` ${summary}`),
    `the world with its new system checks clean (${summary})`
  )

  // 13. Phase 4: cultures, a relation that departs from their traits, a polity, and a system's history.
  await tool('Cultures')
  await page.locator('[data-tab="cultures"]').click()
  await page.locator('#addEntity').click()
  await page.waitForSelector('[data-editing="new-culture"]')
  await page.locator('#cultureName').fill('Plainsfolk')
  await page.locator('#cultureName').press('Enter')
  await page.locator('[data-editing="new-culture"] [data-trait="openness"]').fill('0.9')
  await page.locator('#addEntity').click()
  await page.waitForSelector('[data-editing="new-culture-2"]')
  await page.locator('#cultureName').fill('Hillfolk')
  await page.locator('#cultureName').press('Enter')
  await page.locator('[data-editing="new-culture-2"] [data-trait="openness"]').fill('0.1')
  await page.waitForFunction(() => document.querySelectorAll('[data-entity]').length === 2)
  check(true, 'two cultures are made and given traits')
  await page.locator('[data-tab="relations"]').click()
  const cell = page.locator('[data-cell="new-culture--new-culture-2"]').first()
  await cell.waitFor()
  const derivedText = (await cell.textContent()) ?? ''
  check(Number(derivedText) < 0.5, `insular and open cultures start cool to each other (${derivedText})`)
  await cell.click()
  await page.locator('#relationAffinity').fill('0.8')
  await page.locator('#relationAffinity').press('Enter')
  await page.waitForFunction(() => document.querySelector('[data-cell="new-culture--new-culture-2"]')?.textContent?.startsWith('0.8'))
  check(true, 'a relation set by hand replaces the affinity from their traits')
  await page.screenshot({ path: path.join(shots, '11-relations.png') })
  await page.locator('[data-tab="polities"]').click()
  await page.locator('#addEntity').click()
  await page.waitForSelector('[data-editing="new-polity"]')
  await page.locator('#polityName').fill('The League')
  await page.locator('#polityName').press('Enter')
  await tool('Systems')
  await page.waitForSelector('#addHistory')
  await page.locator('#addHistory').click()
  await page.waitForSelector('[data-history="0"]')
  await page.locator('[data-history="0"] select').filter({ hasText: '(no polity)' }).selectOption('new-polity')
  await page.waitForFunction(() => /At the current date: The League/.test(document.querySelector('.history-editor')?.textContent ?? ''))
  check(true, 'a history entry at the current date makes the polity hold the system now')
  await page.locator('.status-save').click()
  await page.waitForFunction(() => document.querySelector('.status-saved') !== null)
  const relation = JSON.parse(await fs.readFile(path.join(worldDir, 'relations/new-culture--new-culture-2.json'), 'utf8'))
  check(
    relation.affinity === 0.8 && relation.between.join() === 'new-culture,new-culture-2',
    'saving writes the relation under its sorted pair id'
  )
  const held = JSON.parse(await fs.readFile(path.join(worldDir, 'systems/proxima-centauri.json'), 'utf8'))
  check(held.history?.[0]?.polity === 'new-polity', 'and the system’s history')
  await tool('Checks')
  await page.locator('.checks-bar button').click()
  await page.waitForFunction(() => /No problems found|notes/.test(document.querySelector('.checks-summary')?.textContent ?? ''))
  const s4 = (await page.locator('.checks-summary').textContent()) ?? ''
  check(s4 === 'No problems found.' || /0 errors, 0 warnings/.test(s4), `cultures, polities and history check clean (${s4})`)

  // 14. Phase 5: a planned route, one-way traffic, the balance it upsets, and the helper's fix.
  await tool('Routes')
  await page.locator('[data-tab="routes"]').click()
  await page.locator('#addEntity').click()
  await page.waitForSelector('#newRoute')
  await page.locator('#routeFrom').selectOption('system:proxima-centauri')
  await page.locator('#newRoute .node-picker').nth(1).locator('input.search').fill('Altair')
  await page.locator('#newRoute [data-hit="hip.97649"]').click()
  await page.locator('#planRoute').click()
  await page.waitForSelector('[data-route]', { timeout: 30_000 })
  const legs = await page.locator('#waypoints [data-waypoint]').count()
  const legText = (await page.locator('#waypoints').textContent()) ?? ''
  check(legs >= 3 && !/too long|crosses/.test(legText), `the planner chains Proxima to Altair in legs under the limit (${legs} waypoints)`)
  await page.locator('#addServiceForward').click()
  await page.waitForSelector('[data-service="0"]')
  // Above the 1 ship/day tolerance floor, so the imbalance counts.
  await page.locator('[data-service="0"] input[type="number"]').fill('5')
  await page.locator('[data-service="0"] input[type="number"]').press('Enter')
  await page.waitForFunction(() => window.malevo.world.snapshot().then((s) => s.routes[0]?.services[0]?.perDay === 5))
  check(
    /\d/.test((await page.locator('[data-service="0"]').textContent()) ?? ''),
    'a one-way service shows its door-to-door time and fleet'
  )
  await page.screenshot({ path: path.join(shots, '12-route.png') })
  await page.locator('[data-tab="balance"]').click()
  await page.waitForSelector('[data-node="system:proxima-centauri"]')
  check(
    /off by/.test((await page.locator('[data-node="system:proxima-centauri"]').textContent()) ?? ''),
    'one-way traffic leaves its ends unbalanced'
  )
  await page.locator('#suggestBalance').click()
  await page.waitForSelector('#acceptAll')
  await page.locator('#acceptAll').click()
  await page.waitForFunction(() => !/off by/.test(document.querySelector('#balanceTable')?.textContent ?? 'off by'))
  check(true, 'the balancing helper’s return traffic balances every node')
  await page.screenshot({ path: path.join(shots, '13-balance.png') })
  await page.locator('.status-save').click()
  await page.waitForFunction(() => document.querySelector('.status-saved') !== null)
  const routeFiles = await fs.readdir(path.join(worldDir, 'routes'))
  const routeFile = JSON.parse(await fs.readFile(path.join(worldDir, 'routes', routeFiles[0]), 'utf8'))
  check(
    routeFiles.length === 1 &&
      routeFile.waypoints[0].system === 'proxima-centauri' &&
      routeFile.waypoints.at(-1).star === 'hip.97649' &&
      routeFile.services.length === 2,
    'saving writes the route with its waypoints and both services'
  )
  await tool('Checks')
  await page.locator('.checks-bar button').click()
  await page.waitForFunction(() => /No problems found|notes/.test(document.querySelector('.checks-summary')?.textContent ?? ''))
  const s5 = (await page.locator('.checks-summary').textContent()) ?? ''
  check(s5 === 'No problems found.' || /0 errors, 0 warnings/.test(s5), `routes and traffic check clean (${s5})`)

  // 15. Phase 6: the sky from a kept planet, with the route's torches; an approach into the system.
  await tool('Sky')
  await page.waitForSelector('#skyFacts', { timeout: 30_000 })
  check(true, 'the Sky tool works out the sky from a planet')
  await page.waitForSelector('[data-sky-route]', { timeout: 15_000 })
  const skyRows = await page.locator('[data-sky-route]').allTextContents()
  const counts = skyRows.map((r) => {
    const m = r.match(/(\d+)\s*\(avg ([\d.,]+)\)/)
    return m ? [Number(m[1]), Number(m[2].replace(/,/g, ''))] : null
  })
  check(
    counts.length >= 2 && counts.every((c) => c && (c[0] === Math.floor(c[1]) || c[0] === Math.ceil(c[1]) || Math.abs(c[0] - c[1]) <= 1)),
    `the sky shows each route's torches, ships per day × crawl time (${JSON.stringify(counts)})`
  )
  await page.screenshot({ path: path.join(shots, '14-sky.png') })
  await tool('Approach')
  await page.waitForSelector('#approachFacts', { timeout: 30_000 })
  check(
    /AU from the star/.test((await page.locator('#approachFacts').textContent()) ?? ''),
    'the approach finds where ships drop out of the foam'
  )
  await page.waitForSelector('#approachChart', { timeout: 60_000 })
  check(true, 'and sweeps the crawl over the years')
  await page.screenshot({ path: path.join(shots, '15-approach.png') })

  // 16. Phase 7: set up the history generator, run it, accept the run, and trace news through it.
  await page.evaluate(async () => {
    const yr = 31_557_600
    for (const [id, name, y] of [
      ['slow-ships', 'Slow ships', 300],
      ['foam-drive', 'The foam drive', 650],
      ['run-end', 'End of the run', 800],
      ['big-news', 'Big news', 760]
    ])
      await window.malevo.world.setEntity('event', id, { name, type: 'event', when: { at: { t_s: y * yr } } })
  })
  await tool('History')
  await page.waitForSelector('#historySetup')
  await page.locator('#histOrigin').selectOption('proxima-centauri')
  await page.locator('#histCulture').selectOption('new-culture')
  await page.locator('#histSlow').selectOption('slow-ships')
  await page.locator('#histFoam').selectOption('foam-drive')
  await page.locator('#histEnd').selectOption('run-end')
  await page.locator('#historyCreate').click()
  await page.waitForSelector('#historyRun')
  // Keep the smoke run small.
  await page.evaluate(async () => {
    const s = (await window.malevo.world.snapshot()).historySettings
    await window.malevo.world.setEntity('historySettings', 'historySettings', { ...s, growth: { systems: 30, maxRadius_ly: 45 } })
  })
  await page.locator('#historyRun').click()
  await page.waitForSelector('#historySummary', { timeout: 60_000 })
  const summary7 = (await page.locator('#historySummary').textContent()) ?? ''
  const proposedSystems = Number(summary7.match(/(\d+) systems/)?.[1] ?? 0)
  check(proposedSystems >= 15, `a run proposes a settlement history (${summary7.trim()})`)
  await page.screenshot({ path: path.join(shots, '16-history.png') })
  await page.locator('#historyAccept').click()
  await page.waitForFunction(() => /Accepted \d+ file/.test(document.querySelector('.history-run')?.textContent ?? ''))
  await page.locator('.status-save').click()
  await page.waitForFunction(() => document.querySelector('.status-saved') !== null)
  const sysFiles = await fs.readdir(path.join(worldDir, 'systems'))
  const locked = (
    await Promise.all(sysFiles.map(async (f) => JSON.parse(await fs.readFile(path.join(worldDir, 'systems', f), 'utf8')).lock?.gen))
  ).filter((g) => g === 'history@1').length
  check(locked >= 15, `accepting writes the systems, locked to history@1 (${locked})`)
  await page.evaluate(async () => {
    const yr = 31_557_600
    await window.malevo.world.setEntity('event', 'big-news', {
      name: 'Big news',
      type: 'event',
      when: { at: { t_s: 760 * yr } },
      where: 'proxima-centauri'
    })
  })
  await page.locator('[data-tab="news"]').click()
  await page.locator('#newsEvent').selectOption('big-news')
  await page.waitForSelector('#newsTable [data-news]')
  check(
    (await page.locator('#newsTable [data-news="ships"]').count()) > 0,
    'news of an event reaches other systems by ship, ahead of radio'
  )
  await page.evaluate(() => window.malevo.world.discard())
  await tool('Checks')
  await page.locator('.checks-bar button').click()
  await page.waitForFunction(() => /No problems found|notes|errors?/.test(document.querySelector('.checks-summary')?.textContent ?? ''))
  const s7 = (await page.locator('.checks-summary').textContent()) ?? ''
  check(s7 === 'No problems found.' || /(^|\D)0 errors/.test(s7), `the accepted history has no errors (${s7})`)

  // 17. Phase 8: terrain for Earth, re-rolled, locked and saved as text.
  await tool('Terrain')
  await page.locator('[data-terrain-body="earth"]').click()
  await page.locator('#makeTerrain').click()
  await page.waitForSelector('#terrainStats', { timeout: 30_000 })
  check(/under water/.test((await page.locator('#terrainStats').textContent()) ?? ''), 'a new terrain draws its map and globe')
  await page.locator('#terrainReroll').click()
  await page.waitForFunction(() => /Roll 1 of terrain@1/.test(document.querySelector('.terrain')?.textContent ?? ''))
  await page.locator('#terrainLock').check()
  await page.waitForFunction(() => document.querySelector('#terrainReroll')?.disabled === true)
  check(true, 'it re-rolls, and locking stops re-rolling')
  await page.screenshot({ path: path.join(shots, '17-terrain.png') })
  await page.locator('.status-save').click()
  await page.waitForFunction(() => document.querySelector('.status-saved') !== null)
  const terrainFile = JSON.parse(await fs.readFile(path.join(worldDir, 'terrains/earth.json'), 'utf8'))
  check(
    terrainFile.roll === 1 && terrainFile.lock?.gen === 'terrain@1' && terrainFile.body === 'earth',
    'saving writes the terrain as text, locked to terrain@1'
  )

  await tool('Terrain')
  await page.locator('[data-terrain-body="earth"]').click()
  await page.locator('#addClouds').click()
  await page.waitForSelector('#showClouds', { timeout: 30_000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: path.join(shots, '17b-clouds.png') })
  check(true, 'a cloud layer can be added over the surface')
  await page.evaluate(() => window.malevo.world.discard())

  await tool('Terrain')
  await page.locator('[data-terrain-body="jupiter"]').click()
  await page.locator('#makeTerrain').click()
  await page.waitForSelector('#bandsEditor', { timeout: 30_000 })
  await page.waitForFunction(() => /Cloud tops/.test(document.querySelector('#terrainStats')?.textContent ?? ''))
  check(true, 'a gas giant gets cloud bands instead of a surface')
  await page.evaluate(() => window.malevo.world.discard())

  // 18. Phase 9: a city on Earth, placed on the map, with conditions there.
  await tool('Population')
  await page.locator('#addCity').click()
  await page.waitForSelector('[data-city-detail="new-city"]')
  await page.waitForSelector('#conditions dl', { timeout: 30_000 })
  check(
    /local solar time/.test((await page.locator('#conditions').textContent()) ?? ''),
    'a new city shows the conditions there at the current date'
  )
  // Coordinate clicks miss anything outside the window, and layouts differ by platform.
  await page.locator('#placeMap').scrollIntoViewIfNeeded()
  const placeBox = await page.locator('#placeMap').boundingBox()
  await page.mouse.click(placeBox.x + placeBox.width * 0.5, placeBox.y + placeBox.height * 0.25)
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('#cityLat')?.value) - 45) < 1)
  check(true, 'clicking the map places it')
  await page.screenshot({ path: path.join(shots, '18-population.png') })
  await page.locator('.status-save').click()
  await page.waitForFunction(() => document.querySelector('.status-saved') !== null)
  const cityFile = JSON.parse(await fs.readFile(path.join(worldDir, 'cities/new-city.json'), 'utf8'))
  check(
    cityFile.body === 'earth' && Math.abs(cityFile.lat_deg - 45) < 1 && cityFile.population?.length === 1,
    'saving writes the city, its place and its people'
  )

  // 19. Phase 10: a plan for the city, a district drawn on it, a trip across it.
  await tool('City planner')
  await page.locator('[data-plan-city="new-city"]').click()
  await page.locator('#startPlan').click()
  await page.waitForSelector('#planPanel')
  await page.waitForFunction(() => /boxes from cityplan@1/.test(document.querySelector('.plan-canvas')?.textContent ?? ''))
  await page.locator('#drawRegion').selectOption('buildings')
  await page.locator('.plan-svg').scrollIntoViewIfNeeded()
  const svgBox = await page.locator('.plan-svg').boundingBox()
  const viewH = await page.evaluate(() => window.innerHeight)
  // Fractions of the part of the canvas inside the window.
  const visH = Math.min(svgBox.height, viewH - svgBox.y - 4)
  const at = (fx, fy) => [svgBox.x + svgBox.width * fx, svgBox.y + visH * fy]
  for (const [fx, fy] of [
    [0.35, 0.3],
    [0.65, 0.3],
    [0.65, 0.45]
  ])
    await page.mouse.click(...at(fx, fy))
  await page.mouse.dblclick(...at(0.35, 0.45))
  await page.waitForSelector('#objectPanel')
  await page.waitForFunction(() => {
    const m = /([\d,]+) boxes from/.exec(document.querySelector('.plan-canvas')?.textContent ?? '')
    return m && Number(m[1].replace(/,/g, '')) > 20
  })
  check(true, 'drawing a district fills it with buildings')
  await page.locator('#planTravel').click()
  await page.mouse.click(...at(0.2, 0.7))
  await page.mouse.click(...at(0.8, 0.7))
  await page.waitForFunction(() => /arriving/.test(document.querySelector('#travelPanel')?.textContent ?? ''))
  check(true, 'clicking two places gives the travel time between them')
  await page.screenshot({ path: path.join(shots, '19-cityplan.png') })
  await page.locator('#plan3d').click()
  await page.waitForSelector('.plan-3d')
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(shots, '20-cityplan-3d.png') })
  check(true, 'the plan switches to 3D')
  await page.locator('.status-save').click()
  await page.waitForFunction(() => document.querySelector('.status-saved') !== null)
  const planFile = JSON.parse(await fs.readFile(path.join(worldDir, 'cityplans/new-city.json'), 'utf8'))
  check(planFile.city === 'new-city' && planFile.regions?.[0]?.preset === 'buildings', 'saving writes the plan as text')

  // 10. The update status reports a dev build.
  const status = await page.evaluate(() => window.malevo.updates.status())
  check(status.state === 'unavailable', 'an unpackaged build reports updates as unavailable')
} catch (err) {
  failures.push(String(err?.stack ?? err))
  console.error(err)
} finally {
  // Unsaved changes would hold the window open behind a Save prompt.
  await app
    ?.windows()[0]
    ?.evaluate(() => window.malevo.world.discard())
    .catch(() => {})
  await app?.close().catch(() => {})
}

console.log(`\nscreenshots: ${shots}`)
if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed`)
  process.exit(1)
}
console.log('\nsmoke test passed')
