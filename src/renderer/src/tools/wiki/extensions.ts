/**
 * The page editor's own extensions:
 * - links to pages that don't exist yet are shown red (decorations only: the text is untouched);
 * - typing "@" offers every page (every entity's article, and the free pages) and inserts a relative
 *   Markdown link to the one picked, or to a new page of that name.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { newPagePath, relativeLink, resolveLink } from '@malevo/model'
import type { PageDto } from '../../../../shared/types'

export interface PageLinksStorage {
  /** The page being edited. */
  path: string
  pages: PageDto[]
  /** Paths that have a page to go to: written, or an entity's. */
  known: Set<string>
}

const linksKey = new PluginKey<DecorationSet>('pageLinks')

function decorate(doc: PMNode, s: PageLinksStorage): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const link = node.marks.find((m) => m.type.name === 'link')
    if (!link) return
    const target = resolveLink(s.path, String(link.attrs.href ?? ''))
    if (target === null) {
      decos.push(Decoration.inline(pos, pos + node.nodeSize, { class: 'link-external' }))
      return
    }
    if (target.endsWith('.md') && !s.known.has(target))
      decos.push(Decoration.inline(pos, pos + node.nodeSize, { class: 'link-new', title: `${target} (not written yet)` }))
  })
  return DecorationSet.create(doc, decos)
}

interface Item {
  title: string
  note: string
  path: string
}

/** Pages matching what's typed after "@": titles starting so first, then containing it. */
function matches(s: PageLinksStorage, query: string): Item[] {
  const q = query.trim().toLowerCase()
  const hits = s.pages
    .filter((p) => p.path !== s.path && (!q || p.title.toLowerCase().includes(q)))
    .sort((a, b) => Number(!a.title.toLowerCase().startsWith(q)) - Number(!b.title.toLowerCase().startsWith(q)))
    .slice(0, 10)
    .map((p) => ({ title: p.title, note: p.category || 'page', path: p.path }))
  if (q && !s.pages.some((p) => p.title.toLowerCase() === q)) {
    const path = newPagePath('', query.trim(), new Set(s.pages.map((p) => p.path)))
    hits.push({ title: query.trim(), note: `new page, ${path}`, path })
  }
  return hits
}

export const PageLinks = Extension.create<Record<string, never>, PageLinksStorage>({
  name: 'pageLinks',
  addStorage() {
    return { path: '', pages: [], known: new Set<string>() }
  },
  addCommands() {
    return {
      setPages:
        (path: string, pages: PageDto[]) =>
        ({ tr, dispatch }) => {
          this.storage.path = path
          this.storage.pages = pages
          this.storage.known = new Set(pages.filter((p) => p.exists || p.kind).map((p) => p.path))
          if (dispatch) tr.setMeta(linksKey, true)
          return true
        }
    }
  },
  addProseMirrorPlugins() {
    const storage = this.storage
    return [
      new Plugin<DecorationSet>({
        key: linksKey,
        state: {
          init: (_, state) => decorate(state.doc, storage),
          apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(linksKey) ? decorate(state.doc, storage) : old)
        },
        props: {
          decorations(state) {
            return linksKey.getState(state)
          }
        }
      }),
      Suggestion<Item>({
        editor: this.editor,
        char: '@',
        pluginKey: new PluginKey('pageSuggest'),
        allowSpaces: true,
        items: ({ query }) => matches(storage, query),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: 'text', text: props.title, marks: [{ type: 'link', attrs: { href: relativeLink(storage.path, props.path) } }] },
              { type: 'text', text: ' ' }
            ])
            .unsetMark('link')
            .run()
        },
        render: () => {
          let el: HTMLDivElement | null = null
          let items: Item[] = []
          let index = 0
          let pick: ((f: Item) => void) | null = null
          const draw = (): void => {
            if (!el) return
            el.replaceChildren(
              ...(items.length
                ? items.map((f, k) => {
                    const row = document.createElement('div')
                    row.className = k === index ? 'page-option on' : 'page-option'
                    const strong = document.createElement('strong')
                    strong.textContent = f.title
                    const why = document.createElement('span')
                    why.className = 'muted'
                    why.textContent = ` ${f.note}`
                    row.append(strong, why)
                    row.onmousedown = (e) => {
                      e.preventDefault()
                      pick?.(f)
                    }
                    return row
                  })
                : [Object.assign(document.createElement('div'), { className: 'page-option muted', textContent: 'Type to find a page' })])
            )
          }
          const place = (props: SuggestionProps<Item>): void => {
            const r = props.clientRect?.()
            if (!el || !r) return
            el.style.left = `${r.left}px`
            el.style.top = `${r.bottom + 4}px`
          }
          return {
            onStart: (props) => {
              el = document.createElement('div')
              el.className = 'page-suggest'
              el.id = 'pageSuggest'
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
    pageLinks: {
      setPages: (path: string, pages: PageDto[]) => ReturnType
    }
  }
}
