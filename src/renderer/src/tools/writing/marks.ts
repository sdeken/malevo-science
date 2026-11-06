/**
 * Editor's marks: notes to yourself in the text, written as [[double
 * brackets]]. They stay plain text in the file; the editor only draws them
 * (the brackets faint, the note highlighted), closes "[[" as you type it,
 * wraps a selection with Ctrl+Alt+M, and jumps from one to the next.
 */
import { Extension } from '@tiptap/core'
import Italic from '@tiptap/extension-italic'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { escapeProse } from '@malevo/model'

export const MARK_RE = /\[\[([^[\]\n]*)\]\]/g

const marksKey = new PluginKey<DecorationSet>('editorMarks')

/** Every editor's mark in a document: positions of the whole [[…]] span. */
export function findEditorMarks(doc: PMNode): { from: number; to: number; text: string }[] {
  const out: { from: number; to: number; text: string }[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    for (const m of node.text.matchAll(MARK_RE)) {
      const from = pos + (m.index ?? 0)
      out.push({ from, to: from + m[0].length, text: m[1] })
    }
  })
  return out
}

function decorate(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  for (const m of findEditorMarks(doc)) {
    decos.push(
      Decoration.inline(m.from, m.from + 2, { class: 'editor-mark-bracket' }),
      Decoration.inline(m.from + 2, m.to - 2, { class: 'editor-mark', title: 'Editor’s mark' }),
      Decoration.inline(m.to - 2, m.to, { class: 'editor-mark-bracket' })
    )
  }
  return DecorationSet.create(doc, decos)
}

export const EditorMarks = Extension.create({
  name: 'editorMarks',
  addCommands() {
    return {
      /** Wrap the selection in [[ ]], or put an empty pair at the cursor with the cursor inside. */
      insertEditorMark:
        () =>
        ({ state, dispatch }) => {
          const { from, to } = state.selection
          const tr = state.tr.insertText(']]', to).insertText('[[', from)
          tr.setSelection(TextSelection.create(tr.doc, from + 2, to + 2))
          dispatch?.(tr.scrollIntoView())
          return true
        },
      /** Select the next editor's mark after the cursor (wrapping round to the first). */
      nextEditorMark:
        () =>
        ({ state, dispatch }) => {
          const marks = findEditorMarks(state.doc)
          if (!marks.length) return false
          const next = marks.find((m) => m.from >= state.selection.to) ?? marks[0]
          dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, next.from + 2, next.to - 2)).scrollIntoView())
          return true
        }
    }
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-m': () => this.editor.commands.insertEditorMark()
    }
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: marksKey,
        state: {
          init: (_, state) => decorate(state.doc),
          apply: (tr, old, _o, state) => (tr.docChanged ? decorate(state.doc) : old)
        },
        props: {
          decorations(state) {
            return marksKey.getState(state)
          },
          // Typing the second "[" closes the mark: [[|]].
          handleTextInput(view, from, to, text) {
            if (text !== '[' || from !== to) return false
            const before = view.state.doc.textBetween(Math.max(0, from - 1), from)
            if (before !== '[') return false
            const tr = view.state.tr.insertText('[]]', from)
            tr.setSelection(TextSelection.create(tr.doc, from + 1))
            view.dispatch(tr)
            return true
          }
        }
      })
    ]
  }
})

interface ManagerTextHook {
  codeTypes: Set<string>
  encodeTextForMarkdown(text: string, node: { marks?: (string | { type: string })[] }, parent?: { type?: string }): string
}

/**
 * Text saved the way it was typed. The Markdown writer would backslash every
 * bracket and turn "&" into "&amp;"; this escapes only what would read back
 * as formatting (escapeProse), and code as it is.
 */
export const PlainProse = Extension.create({
  name: 'plainProse',
  onCreate() {
    const mgr = (this.editor as unknown as { markdown?: ManagerTextHook }).markdown
    if (!mgr) return
    mgr.encodeTextForMarkdown = function (text, node, parent) {
      const inCode =
        (parent?.type != null && this.codeTypes.has(parent.type)) ||
        (node.marks ?? []).some((m) => this.codeTypes.has(typeof m === 'string' ? m : m.type))
      return inCode ? text : escapeProse(text)
    }
  }
})

/** Italics written as _underscores_ (the editor's default is *asterisks*). */
export const UnderscoreItalic = Italic.extend({
  renderMarkdown: (node, h) => `_${h.renderChildren(node)}_`
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    editorMarks: {
      insertEditorMark: () => ReturnType
      nextEditorMark: () => ReturnType
    }
  }
}
