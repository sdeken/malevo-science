/**
 * Names in the editor, without marking up the text: recognised character
 * names are decorated as you read (the document is untouched), and typing
 * "@" offers every name and nickname, inserting the plain name.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { nameMatcher, type NameForm } from '@malevo/model'

const namesKey = new PluginKey<DecorationSet>('names')

function decorate(doc: PMNode, forms: readonly NameForm[]): DecorationSet {
  const re = nameMatcher(forms)
  if (!re) return DecorationSet.empty
  const byForm = new Map<string, NameForm[]>()
  for (const f of forms) byForm.set(f.form, [...(byForm.get(f.form) ?? []), f])
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    for (const m of node.text.matchAll(re)) {
      const at = pos + (m.index ?? 0)
      const who = byForm.get(m[0]) ?? []
      const shared = new Set(who.map((w) => w.character)).size > 1
      decos.push(
        Decoration.inline(at, at + m[0].length, {
          class: shared ? 'name-mark shared' : 'name-mark',
          'data-character': who[0]?.character ?? '',
          title: who
            .map((w) =>
              w.primary
                ? w.characterName
                : `${w.characterName}${w.usedBy.length ? ` (${w.usedBy.join(' and ')}’s name${w.note ? `; ${w.note}` : ''})` : w.note ? ` (${w.note})` : ''}`
            )
            .join(' · or ')
        })
      )
    }
  })
  return DecorationSet.create(doc, decos)
}

export interface NamesOptions {
  forms: NameForm[]
}

/** Decorates known names. Update the forms with `editor.commands.setNameForms(forms)`. */
export const Names = Extension.create<NamesOptions>({
  name: 'names',
  addOptions() {
    return { forms: [] }
  },
  addStorage() {
    return { forms: [] as NameForm[] }
  },
  onCreate() {
    this.storage.forms = this.options.forms
  },
  addCommands() {
    return {
      setNameForms:
        (forms: NameForm[]) =>
        ({ tr, dispatch }) => {
          this.storage.forms = forms
          if (dispatch) tr.setMeta(namesKey, forms)
          return true
        }
    }
  },
  addProseMirrorPlugins() {
    const storage = this.storage as { forms: NameForm[] }
    return [
      new Plugin<DecorationSet>({
        key: namesKey,
        state: {
          init: (_, state) => decorate(state.doc, storage.forms),
          apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(namesKey) ? decorate(state.doc, storage.forms) : old)
        },
        props: {
          decorations(state) {
            return namesKey.getState(state)
          }
        }
      }),
      Suggestion<NameForm>({
        editor: this.editor,
        char: '@',
        pluginKey: new PluginKey('nameSuggest'),
        allowSpaces: false,
        items: ({ query }) => {
          const q = query.toLowerCase()
          return storage.forms
            .filter((f: NameForm) => f.form.toLowerCase().startsWith(q) || f.characterName.toLowerCase().startsWith(q))
            .sort((a: NameForm, b: NameForm) => Number(!a.form.toLowerCase().startsWith(q)) - Number(!b.form.toLowerCase().startsWith(q)))
            .slice(0, 8)
        },
        command: ({ editor, range, props }) => {
          editor.chain().focus().insertContentAt(range, props.form).run()
        },
        render: () => {
          let el: HTMLDivElement | null = null
          let items: NameForm[] = []
          let index = 0
          let pick: ((f: NameForm) => void) | null = null
          const draw = (): void => {
            if (!el) return
            el.replaceChildren(
              ...(items.length
                ? items.map((f, k) => {
                    const row = document.createElement('div')
                    row.className = k === index ? 'name-option on' : 'name-option'
                    const strong = document.createElement('strong')
                    strong.textContent = f.form
                    const why = document.createElement('span')
                    why.className = 'muted'
                    why.textContent = f.primary
                      ? ''
                      : ` ${f.characterName}${f.usedBy.length ? `, ${f.usedBy.join(' and ')}’s name` : ''}${f.note ? ` (${f.note})` : ''}`
                    row.append(strong, why)
                    row.onmousedown = (e) => {
                      e.preventDefault()
                      pick?.(f)
                    }
                    return row
                  })
                : [Object.assign(document.createElement('div'), { className: 'name-option muted', textContent: 'No name starts so' })])
            )
          }
          const place = (props: SuggestionProps<NameForm>): void => {
            const r = props.clientRect?.()
            if (!el || !r) return
            el.style.left = `${r.left}px`
            el.style.top = `${r.bottom + 4}px`
          }
          return {
            onStart: (props) => {
              el = document.createElement('div')
              el.className = 'name-suggest'
              document.body.appendChild(el)
              items = props.items
              index = 0
              pick = (f) => props.command(f)
              draw()
              place(props)
            },
            onUpdate: (props) => {
              items = props.items
              index = Math.min(index, Math.max(0, items.length - 1))
              pick = (f) => props.command(f)
              draw()
              place(props)
            },
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              if (event.key === 'ArrowDown') {
                index = (index + 1) % Math.max(1, items.length)
                draw()
                return true
              }
              if (event.key === 'ArrowUp') {
                index = (index + Math.max(1, items.length) - 1) % Math.max(1, items.length)
                draw()
                return true
              }
              if ((event.key === 'Enter' || event.key === 'Tab') && items[index]) {
                pick?.(items[index])
                return true
              }
              if (event.key === 'Escape') {
                el?.remove()
                el = null
                return true
              }
              return false
            },
            onExit: () => {
              el?.remove()
              el = null
            }
          }
        }
      })
    ]
  }
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    names: {
      setNameForms: (forms: NameForm[]) => ReturnType
    }
  }
}
