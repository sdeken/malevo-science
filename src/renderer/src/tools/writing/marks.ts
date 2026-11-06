/**
 * What the writing page adds to plain Markdown, all of it saved as plain text:
 *
 * - Editor's notes: `[[a note]]` in the file, one marker in the text (the
 *   cursor steps over it), and the note itself in the margin. Typing TK or CQ
 *   as a word, or `[[`, drops a marker and opens its note; Escape returns to
 *   the text just after it.
 * - Typography: “quotes” and dashes are shown, never saved (smartenProse on
 *   loading, dumbProse on saving): `--` is –, `---` is —, a spaced ` - ` is ‒.
 * - Link speech: «between guillemets» is shown in italics; typing `<<` or `>>`
 *   gives the guillemet itself.
 * - Italics are written _with underscores_.
 */
import { Extension, InputRule, Node, textInputRule } from '@tiptap/core'
import Italic from '@tiptap/extension-italic'
import Typography from '@tiptap/extension-typography'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { dumbProse, escapeProse } from '@malevo/model'

// ---- editor's notes ----

export interface NoteAt {
  pos: number
  text: string
}

/** Every editor's note in a document, in order. */
export function findNotes(doc: PMNode): NoteAt[] {
  const out: NoteAt[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'editorNote') out.push({ pos, text: String(node.attrs.text ?? '') })
  })
  return out
}

export interface EditorNoteOptions {
  /** Open the note at this position in the margin, ready to type. */
  onOpen: (pos: number) => void
}

/** Starts a note: TK or CQ typed as a word (kept as the note's first word), or `[[`. */
const STARTERS = /(?:^|[\s([{“‘—–‒])(TK|CQ)$/

export const EditorNote = Node.create<EditorNoteOptions>({
  name: 'editorNote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { onOpen: () => {} }
  },
  addAttributes() {
    return { text: { default: '' } }
  },
  parseHTML() {
    return [{ tag: 'span[data-note]', getAttrs: (el) => ({ text: (el as HTMLElement).getAttribute('data-note') ?? '' }) }]
  },
  renderHTML({ node }) {
    return ['span', { 'data-note': node.attrs.text, class: 'note-anchor', title: node.attrs.text || 'Editor’s note' }]
  },
  markdownTokenName: 'editorNote',
  markdownTokenizer: {
    name: 'editorNote',
    level: 'inline',
    start: (src: string) => src.indexOf('[['),
    tokenize: (src: string) => {
      const m = /^\[\[([^[\]\n]*)\]\]/.exec(src)
      return m ? { type: 'editorNote', raw: m[0], text: m[1] } : undefined
    }
  },
  parseMarkdown: (token) => ({ type: 'editorNote', attrs: { text: String((token as { text?: string }).text ?? '') } }),
  renderMarkdown: (node) => `[[${String(node.attrs?.text ?? '').replace(/[[\]\n]/g, '')}]]`,

  addCommands() {
    return {
      /** Put a note at the end of the selection and open it. */
      insertNote:
        (text = '') =>
        ({ state, dispatch }) => {
          const at = state.selection.to
          if (dispatch) {
            dispatch(state.tr.insert(at, this.type.create({ text })))
            setTimeout(() => this.options.onOpen(at))
          }
          return true
        },
      /** Change a note's text. */
      setNoteText:
        (pos: number, text: string) =>
        ({ state, dispatch }) => {
          const node = state.doc.nodeAt(pos)
          if (!node || node.type !== this.type) return false
          if (dispatch) dispatch(state.tr.setNodeMarkup(pos, undefined, { text }))
          return true
        },
      /** Select the next note after the cursor (round to the first) and open it. */
      nextNote:
        () =>
        ({ state, dispatch }) => {
          const notes = findNotes(state.doc)
          if (!notes.length) return false
          const next = notes.find((n) => n.pos >= state.selection.to) ?? notes[0]
          if (dispatch) {
            dispatch(state.tr.setSelection(NodeSelection.create(state.doc, next.pos)).scrollIntoView())
            setTimeout(() => this.options.onOpen(next.pos))
          }
          return true
        }
    }
  },
  addKeyboardShortcuts() {
    return { 'Mod-Alt-m': () => this.editor.commands.insertNote() }
  },
  addInputRules() {
    const open = (state: Parameters<InputRule['handler']>[0]['state'], from: number, to: number, text: string): void => {
      state.tr.replaceWith(from, to, this.type.create({ text }))
      setTimeout(() => this.options.onOpen(from))
    }
    return [
      new InputRule({
        find: STARTERS,
        handler: ({ state, range, match }) => {
          const start = range.from + match[0].lastIndexOf(match[1])
          open(state, start, range.to, `${match[1]} `)
        }
      }),
      new InputRule({
        find: /\[\[$/,
        handler: ({ state, range }) => open(state, range.from, range.to, '')
      })
    ]
  }
})

// ---- typography ----

/** Quotes, ellipsis and guillemets as you type; dashes our way (-- en, --- em, a spaced - figure dash). Nothing else. */
export const ProseTypography = Typography.configure({
  emDash: false,
  leftArrow: false,
  rightArrow: false,
  copyright: false,
  trademark: false,
  servicemark: false,
  registeredTrademark: false,
  oneHalf: false,
  plusMinus: false,
  notEqual: false,
  multiplication: false,
  superscriptTwo: false,
  superscriptThree: false,
  oneQuarter: false,
  threeQuarters: false
})

export const ProseDashes = Extension.create({
  name: 'proseDashes',
  addInputRules() {
    return [
      textInputRule({ find: /–-$/, replace: '—' }),
      textInputRule({ find: /--$/, replace: '–' }),
      textInputRule({ find: /(?<=\s)(-)\s$/, replace: '‒' })
    ]
  }
})

// ---- link speech ----

const speechKey = new PluginKey<DecorationSet>('linkSpeech')

function speech(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return
    const text = node.textContent
    for (const m of text.matchAll(/«[^«»]*»/g)) {
      // Map text offsets to positions (text nodes only; atoms count as one).
      let offset = 0
      let from = -1
      let to = -1
      node.forEach((child, childOffset) => {
        const len = child.isText ? child.text!.length : child.textContent.length
        const start = m.index!
        const end = m.index! + m[0].length
        if (from < 0 && start < offset + len) from = pos + 1 + childOffset + (start - offset)
        if (to < 0 && end <= offset + len) to = pos + 1 + childOffset + (end - offset)
        offset += len
      })
      if (from >= 0 && to > from) decos.push(Decoration.inline(from, to, { class: 'link-speech' }))
    }
    return false
  })
  return DecorationSet.create(doc, decos)
}

/** «Link speech» drawn in italics; the guillemets themselves are plain characters in the file. */
export const LinkSpeech = Extension.create({
  name: 'linkSpeech',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: speechKey,
        state: {
          init: (_, state) => speech(state.doc),
          apply: (tr, old, _o, state) => (tr.docChanged ? speech(state.doc) : old)
        },
        props: {
          decorations(state) {
            return speechKey.getState(state)
          }
        }
      })
    ]
  }
})

// ---- saving ----

interface ManagerTextHook {
  codeTypes: Set<string>
  encodeTextForMarkdown(text: string, node: { marks?: (string | { type: string })[] }, parent?: { type?: string }): string
}

/**
 * Text saved the way it was typed: the page's typographer's quotes and dashes
 * go back to plain ones (dumbProse), and only what would read back as
 * formatting is escaped (escapeProse). Code is left as it is.
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
      return inCode ? text : escapeProse(dumbProse(text))
    }
  }
})

/** Italics written as _underscores_ (the editor's default is *asterisks*). */
export const UnderscoreItalic = Italic.extend({
  renderMarkdown: (node, h) => `_${h.renderChildren(node)}_`
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    editorNote: {
      insertNote: (text?: string) => ReturnType
      setNoteText: (pos: number, text: string) => ReturnType
      nextNote: () => ReturnType
    }
  }
}
