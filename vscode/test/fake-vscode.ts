/**
 * Just enough of the vscode module for the extension's editor, in memory: open documents (with unsaved text),
 * workspace edits applied to them, files deleted from the real disk, and Save writing them back.
 */
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import * as path from 'node:path'

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly fsPath: string
  ) {}
  static file(p: string): Uri {
    return new Uri('file', path.resolve(p))
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri(base.scheme, path.join(base.fsPath, ...parts))
  }
  toString(): string {
    return `${this.scheme}://${this.fsPath}`
  }
}

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
    readonly offset = 0
  ) {}
}

export class Range {
  constructor(
    readonly start: Position,
    readonly end: Position
  ) {}
}

class Doc {
  isClosed = false
  isDirty = false
  constructor(
    readonly uri: Uri,
    public text: string
  ) {}
  getText(): string {
    return this.text
  }
  positionAt(offset: number): Position {
    return new Position(0, offset, offset)
  }
}

type Op =
  | { kind: 'replace'; uri: Uri; range: Range; text: string }
  | { kind: 'insert'; uri: Uri; text: string }
  | { kind: 'create'; uri: Uri }
  | { kind: 'delete'; uri: Uri }

export class WorkspaceEdit {
  ops: Op[] = []
  replace(uri: Uri, range: Range, text: string): void {
    this.ops.push({ kind: 'replace', uri, range, text })
  }
  insert(uri: Uri, _at: Position, text: string): void {
    this.ops.push({ kind: 'insert', uri, text })
  }
  createFile(uri: Uri): void {
    this.ops.push({ kind: 'create', uri })
  }
  deleteFile(uri: Uri): void {
    this.ops.push({ kind: 'delete', uri })
  }
}

const docs: Doc[] = []
const find = (uri: Uri): Doc | undefined => docs.find((d) => !d.isClosed && d.uri.toString() === uri.toString())

export const workspace = {
  get textDocuments(): Doc[] {
    return docs
  },
  async openTextDocument(uri: Uri): Promise<Doc> {
    const have = find(uri)
    if (have) return have
    const d = new Doc(uri, readFileSync(uri.fsPath, 'utf8'))
    docs.push(d)
    return d
  },
  async applyEdit(we: WorkspaceEdit): Promise<boolean> {
    for (const op of we.ops) {
      if (op.kind === 'delete') {
        rmSync(op.uri.fsPath, { force: true })
        const d = find(op.uri)
        if (d) d.isClosed = true
      } else if (op.kind === 'create') {
        if (!find(op.uri)) docs.push(new Doc(op.uri, ''))
      } else {
        const d = find(op.uri) ?? (await workspace.openTextDocument(op.uri))
        d.text =
          op.kind === 'insert' ? op.text + d.text : d.text.slice(0, op.range.start.offset) + op.text + d.text.slice(op.range.end.offset)
        d.isDirty = true
      }
    }
    return true
  },
  async saveAll(): Promise<boolean> {
    for (const d of docs)
      if (!d.isClosed && d.isDirty) {
        mkdirSync(path.dirname(d.uri.fsPath), { recursive: true })
        writeFileSync(d.uri.fsPath, d.text)
        d.isDirty = false
      }
    return true
  }
}

export const window = {
  errors: [] as string[],
  async showErrorMessage(m: string): Promise<void> {
    window.errors.push(m)
  }
}

/** Forget every document (between tests). */
export function reset(): void {
  docs.length = 0
}

export const exists = existsSync
