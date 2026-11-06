import { describe, expect, it } from 'vitest'
import {
  KINDS,
  characterText,
  dumbProse,
  escapeProse,
  smartenProse,
  isProsePath,
  nameForms,
  nameUses,
  parseCharacter,
  splitFrontMatter
} from '@malevo/model'
import { WorldEditor } from '@malevo/model/node'

const DIV = `---
name: Div
names:
  - T (Kasinov)
  - Divvy (Mara; only when she's annoyed)
---

Grew up on the docks.
`

describe('prose and characters', () => {
  it('knows prose from the world format’s own files', () => {
    expect(isProsePath('Chapter 1.md', KINDS)).toBe(true)
    expect(isProsePath('book/part one/Chapter 1.md', KINDS)).toBe(true)
    expect(isProsePath('characters/div.md', KINDS)).toBe(true)
    expect(isProsePath('systems/sol.md', KINDS)).toBe(false)
    expect(isProsePath('settings/notes.md', KINDS)).toBe(false)
    expect(isProsePath('../outside.md', KINDS)).toBe(false)
    expect(isProsePath('.hidden/x.md', KINDS)).toBe(false)
    expect(isProsePath('notes.txt', KINDS)).toBe(false)
  })

  it('reads a character file, and writes it back as it was', () => {
    const c = parseCharacter('div', 'characters/div.md', DIV)
    expect(c.problems).toEqual([])
    expect(c.name).toBe('Div')
    expect(c.names).toEqual([
      { name: 'T', usedBy: ['Kasinov'] },
      { name: 'Divvy', usedBy: ['Mara'], note: "only when she's annoyed" }
    ])
    expect(c.notes).toBe('Grew up on the docks.\n')
    expect(characterText(c)).toBe(DIV)
  })

  it('reports what it cannot read, without throwing', () => {
    expect(parseCharacter('x', 'characters/x.md', 'just notes').problems.length).toBe(1)
    expect(parseCharacter('x', 'characters/x.md', '---\nnames: T\n---\n').problems.length).toBe(2)
  })

  it('keeps front matter byte for byte', () => {
    const text = '---\nwhen: 2401-03-04\nwhere: altaris\n---\n\nIt rained.\n'
    const { front, body } = splitFrontMatter(text)
    expect(front + body).toBe(text)
    expect(body).toBe('\nIt rained.\n')
    expect(splitFrontMatter('No header.\n')).toEqual({ front: '', body: 'No header.\n' })
  })

  it('finds names as whole words, case and all, longest first', () => {
    const forms = nameForms([parseCharacter('div', 'characters/div.md', DIV)])
    const uses = nameUses(
      [{ path: 'ch1.md', text: '---\nwhen: x\n---\nT looked up. "Divvy," she said.\nThe t was silent. Tea, Divvyish.\n' }],
      forms
    )
    expect(uses.get('T')?.map((u) => u.line)).toEqual([4])
    expect(uses.get('Divvy')?.length).toBe(1)
    expect(uses.has('Div')).toBe(false)
  })

  it('lets the editor change prose like any other file, undoably', () => {
    const ed = new WorldEditor('/nowhere')
    ed.edit([{ path: 'Chapter 1.md', text: 'It rained.\n' }])
    expect(ed.dirty).toEqual(['Chapter 1.md'])
    ed.undo()
    expect(ed.dirty).toEqual([])
    expect(() => ed.edit([{ path: 'systems/x.txt', text: '' }])).toThrow()
  })

  it('escapes prose only where it would read back as formatting', () => {
    expect(escapeProse('Smith & Sons <3, [[check]], [aside] ~ fine')).toBe('Smith & Sons <3, [[check]], [aside] ~ fine')
    expect(escapeProse('a *star* and snake_case')).toBe('a \\*star\\* and snake\\_case')
    expect(escapeProse('[text](not a link) &amp; <em>')).toBe('[text\\](not a link) \\&amp; \\<em>')
    expect(escapeProse('~~gone~~')).toBe('\\~\\~gone\\~\\~')
  })

  it('shows typographer’s quotes and dashes, and gives the file back as it was', () => {
    const file =
      '# One\n\n"You\'re late," he said -- or maybe---no. \'Tis the \'90s. It\'s Div\'s - and *hers*...\n\n---\n\nCode `"x" -- y` and [[check "this" -- now]] stay.\n'
    const shown = smartenProse(file)
    expect(shown).toContain('\u201cYou\u2019re late,\u201d he said \u2013 or maybe\u2014no.')
    expect(shown).toContain('Div\u2019s \u2012 and *hers*\u2026')
    expect(shown).toContain('\n\n---\n\n')
    expect(shown).toContain('`"x" -- y` and [[check "this" -- now]]')
    expect(dumbProse(shown)).toBe(file)
  })
})
