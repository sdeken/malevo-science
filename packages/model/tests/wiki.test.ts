import { describe, expect, it } from 'vitest'
import {
  backlinksTo,
  bodyKind,
  findLinks,
  headingTitle,
  isPagePath,
  KINDS,
  linksFrom,
  movePageChanges,
  newPagePath,
  readWorld,
  relativeLink,
  relink,
  resolveLink,
  serializeEntity,
  solarSystem,
  splitFrontMatter,
  templateFiles,
  type WorldFile
} from '@malevo/model'
import { addBuiltins } from '@malevo/model'
import { renamePlan } from '@malevo/model/node'

const map = (o: Record<string, string>): Map<string, string | null> => new Map(Object.entries(o))
const apply = (m: Map<string, string | null>, changes: { path: string; text: string | null }[]): Map<string, string | null> => {
  const out = new Map(m)
  for (const c of changes) {
    if (c.text === null) out.delete(c.path)
    else out.set(c.path, c.text)
  }
  return out
}

describe('links in pages', () => {
  it('finds inline links, images and reference definitions, but not in code', () => {
    const text = [
      'See [Bluff](../../cities/bluff.md) and ![map](maps/a.png "A map").',
      '`[not](a link)` and',
      '```',
      '[also not](x.md)',
      '```',
      '[ref]: ../people/kativa.md',
      '[web](https://example.com) [anchor](#history) [[odd]](odd.md)'
    ].join('\n')
    expect(findLinks(text).map((l) => l.url)).toEqual([
      '../../cities/bluff.md',
      'maps/a.png',
      '../people/kativa.md',
      'https://example.com',
      '#history',
      'odd.md'
    ])
    for (const l of findLinks(text)) expect(text.slice(l.urlStart, l.urlEnd)).toBe(l.url)
    expect(linksFrom('wiki/places/x.md', text)).toEqual([
      'cities/bluff.md',
      'wiki/places/maps/a.png',
      'wiki/people/kativa.md',
      'wiki/places/odd.md'
    ])
  })

  it('resolves and makes relative links', () => {
    expect(resolveLink('wiki/people/kativa.md', '../../bodies/altaris.md')).toBe('bodies/altaris.md')
    expect(resolveLink('wiki/people/kativa.md', 'mother.md#early-life')).toBe('wiki/people/mother.md')
    expect(resolveLink('wiki/a.md', '../../../outside.md')).toBe(null)
    expect(resolveLink('wiki/a.md', 'https://x.org/a.md')).toBe(null)
    expect(resolveLink('wiki/a.md', 'hotel%20meridian.md')).toBe('wiki/hotel meridian.md')
    expect(relativeLink('wiki/people/kativa.md', 'bodies/altaris.md')).toBe('../../bodies/altaris.md')
    expect(relativeLink('bodies/altaris.md', 'bodies/moon.md')).toBe('moon.md')
    expect(relativeLink('wiki/a.md', 'wiki/places/bluff/the hotel.md')).toBe('places/bluff/the%20hotel.md')
  })

  it('reads titles and keeps front matter apart', () => {
    expect(headingTitle('# The Meridian\n\nA hotel.')).toBe('The Meridian')
    expect(headingTitle('---\ntags: [x]\n---\n\n# Kativa Rhee\n')).toBe('Kativa Rhee')
    expect(headingTitle('Just text.\n# Later heading')).toBe(null)
    expect(splitFrontMatter('---\na: 1\n---\nbody').front).toBe('---\na: 1\n---\n')
  })

  it('knows which files are pages', () => {
    expect(isPagePath('wiki/people/kativa.md', KINDS)).toBe(true)
    expect(isPagePath('bodies/altaris.md', KINDS)).toBe(true)
    expect(isPagePath('chapters/one.md', KINDS)).toBe(false)
    expect(isPagePath('wiki/.hidden/x.md', KINDS)).toBe(false)
    expect(newPagePath('people', 'Kativa Rhee', new Set(['wiki/people/kativa-rhee.md']))).toBe('wiki/people/kativa-rhee-2.md')
  })
})

describe('moving pages keeps links working', () => {
  const files = map({
    'wiki/people/kativa.md': '# Kativa\n\nBorn on [Altaris](../../bodies/altaris.md); works at [the Meridian](../places/meridian.md).\n',
    'wiki/places/meridian.md': '# The Meridian\n\nA hotel in [Bluff](../../cities/bluff.md). Owned by [Kativa](../people/kativa.md).\n',
    'cities/bluff.md': 'Home of [Kativa](../wiki/people/kativa.md) and `[Kativa](../wiki/people/kativa.md)` in code.\n',
    'chapters/one.md': 'Outside the wiki, still kept working: [Kativa](../wiki/people/kativa.md).\n'
  })

  it('rewrites links to a moved page, and the moved page’s own links, and nothing else', () => {
    const changes = movePageChanges(files, 'wiki/people/kativa.md', 'wiki/people/crew/kativa-rhee.md', {
      from: 'Kativa',
      to: 'Kativa Rhee'
    })
    if ('error' in changes) throw new Error(changes.error)
    const after = apply(files, changes)
    expect(after.has('wiki/people/kativa.md')).toBe(false)
    expect(after.get('wiki/people/crew/kativa-rhee.md')).toBe(
      '# Kativa Rhee\n\nBorn on [Altaris](../../../bodies/altaris.md); works at [the Meridian](../../places/meridian.md).\n'
    )
    expect(after.get('wiki/places/meridian.md')).toBe(
      '# The Meridian\n\nA hotel in [Bluff](../../cities/bluff.md). Owned by [Kativa Rhee](../people/crew/kativa-rhee.md).\n'
    )
    // Code is never touched.
    expect(after.get('cities/bluff.md')).toBe(
      'Home of [Kativa Rhee](../wiki/people/crew/kativa-rhee.md) and `[Kativa](../wiki/people/kativa.md)` in code.\n'
    )
    expect(after.get('chapters/one.md')).toBe('Outside the wiki, still kept working: [Kativa Rhee](../wiki/people/crew/kativa-rhee.md).\n')
    expect(backlinksTo(after, 'wiki/people/crew/kativa-rhee.md')).toEqual(['chapters/one.md', 'cities/bluff.md', 'wiki/places/meridian.md'])
  })

  it('leaves link text alone when it was not the old title', () => {
    const changes = movePageChanges(files, 'wiki/places/meridian.md', 'wiki/places/hotel-meridian.md', {
      from: 'The Meridian',
      to: 'Hotel Meridian'
    })
    if ('error' in changes) throw new Error(changes.error)
    const after = apply(files, changes)
    expect(after.get('wiki/people/kativa.md')).toContain('works at [the Meridian](../places/hotel-meridian.md)')
    expect(after.get('wiki/places/hotel-meridian.md')!.startsWith('# Hotel Meridian\n')).toBe(true)
  })

  it('changes nothing when nothing moved', () => {
    expect(relink(files, new Map())).toEqual([])
  })
})

describe('an entity’s article follows its id', () => {
  it('moves the article and rewrites links to it, even before it is written', () => {
    const sol = solarSystem().map((f) => ({ path: `${f.kind.folder}/${f.id}.json`, text: serializeEntity(f.kind, f.value as never) }))
    const files: WorldFile[] = [
      { path: 'world.json', text: '{"format": 1, "name": "W", "seed": 1}' },
      ...templateFiles(),
      ...sol,
      { path: 'bodies/mars.md', text: 'Red. Next to [Earth](earth.md).\n' },
      { path: 'wiki/people/a.md', text: 'From [Mars](../../bodies/mars.md), visited [Ceres](../../bodies/ceres.md).\n' }
    ]
    const w = addBuiltins(readWorld(files))
    const m = new Map(files.map((f) => [f.path, f.text]))
    const plan = renamePlan(w, m, bodyKind, 'mars', 'barsoom', { from: 'Mars', to: 'Barsoom' })
    if ('error' in plan) throw new Error(plan.error)
    const after = apply(m, plan.changes)
    expect(after.get('bodies/barsoom.md')).toBe('Red. Next to [Earth](earth.md).\n')
    expect(after.get('wiki/people/a.md')).toBe('From [Barsoom](../../bodies/barsoom.md), visited [Ceres](../../bodies/ceres.md).\n')
    // Ceres has no article yet; a link to where it would be still follows its id.
    const plan2 = renamePlan(w, m, bodyKind, 'ceres', 'ceres-prime')
    if ('error' in plan2) throw new Error(plan2.error)
    expect(apply(m, plan2.changes).get('wiki/people/a.md')).toContain('[Ceres](../../bodies/ceres-prime.md)')
  })
})
