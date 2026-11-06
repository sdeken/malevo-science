/**
 * Packs given and family names, by language, from the faker package (MIT, a
 * build-time dependency) into out/names/names.json for the Names tool's
 * people-name mode. Only languages whose names are written in Latin letters.
 */
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as faker from '@faker-js/faker'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const outDir = path.join(root, 'out/names')
const latin = /^[\p{Script=Latin}' .-]+$/u
const label = new Intl.DisplayNames(['en'], { type: 'language' })
const regionLabel = new Intl.DisplayNames(['en'], { type: 'region' })

const clean = (list) =>
  [...new Set((list ?? []).filter((n) => typeof n === 'string').map((n) => n.trim()))].filter((n) => n && latin.test(n)).sort()
const locales = []
const seen = new Set()
for (const [id, def] of Object.entries(faker)) {
  const p = def && typeof def === 'object' && def.person
  if (!p || /BORK|ocker/.test(id)) continue
  const fn = p.first_name ?? {}
  const given = {
    female: clean(fn.female),
    male: clean(fn.male),
    any: clean([...(fn.generic ?? []), ...(fn.female ?? []), ...(fn.male ?? [])])
  }
  const family = clean(Object.values(p.last_name ?? {}).flat())
  const total = Object.values(fn).flat().length + Object.values(p.last_name ?? {}).flat().length
  if (!total || (given.any.length + family.length) / total < 0.8 || given.any.length + family.length < 40) continue
  const sig = JSON.stringify([given.any, family])
  if (seen.has(sig)) continue
  seen.add(sig)
  const [lang, region] = id.split('_')
  let name = id
  try {
    name = label.of(lang) + (region && /^[A-Z]{2}$/.test(region) ? ` (${regionLabel.of(region)})` : '')
  } catch {
    // keep the id
  }
  locales.push({ id, label: name, given, family })
}
locales.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
mkdirSync(outDir, { recursive: true })
writeFileSync(
  path.join(outDir, 'names.json'),
  JSON.stringify({ source: `faker ${require('@faker-js/faker/package.json').version}`, locales })
)
copyFileSync(path.join(path.dirname(require.resolve('@faker-js/faker/package.json')), 'LICENSE'), path.join(outDir, 'LICENSE'))
console.log(`names: ${locales.length} languages packed into out/names/names.json`)
