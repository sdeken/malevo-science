import { describe, expect, it } from 'vitest'
import { KINDS, characterText, isProsePath, nameForms, nameUses, parseCharacter, splitFrontMatter } from '@malevo/model'
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
})
