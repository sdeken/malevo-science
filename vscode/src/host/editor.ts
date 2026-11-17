/**
 * A world's files as VS Code sees them: what is on disk, with every open document's text on top (saved or
 * not). Edits become VS Code edits, so unsaved changes, undo and Save are VS Code's own; nothing here writes
 * to the disk itself.
 */
import * as path from 'node:path'
import * as vscode from 'vscode'
import { KINDS, addBuiltins, entityPath, readWorld, type KindDef, type WorldData, type WorldFile } from '@malevo/model'
import { assertWorldPath, entityText, readWorldFiles, type FileChange, type SessionEditor } from '@malevo/model/node'

export class VsEditor implements SessionEditor {
  private disk = new Map<string, string | null>()
  /** Edits handed to VS Code and not yet seen in its documents (a deletion stays until the file is gone for good). */
  private inflight = new Map<string, string | null>()
  private cached: WorldData | null = null
  private queue: Promise<void> = Promise.resolve()
  readonly rootUri: vscode.Uri

  constructor(
    readonly root: string,
    /** Called when edits have landed in VS Code's documents. */
    private readonly onApplied: () => void
  ) {
    this.rootUri = vscode.Uri.file(root)
  }

  async load(): Promise<void> {
    this.disk = new Map((await readWorldFiles(this.root)).map((f) => [f.path, f.text]))
    for (const [p, t] of [...this.inflight]) if (t === null && !this.disk.has(p) && !this.openDoc(p)) this.inflight.delete(p)
    this.invalidate()
  }

  invalidate(): void {
    this.cached = null
  }

  /** The world-relative path of a file, or null if it is outside the world. */
  rel(uri: vscode.Uri): string | null {
    if (uri.scheme !== 'file') return null
    const r = path.relative(this.root, uri.fsPath)
    if (!r || r.startsWith('..') || path.isAbsolute(r)) return null
    return r.split(path.sep).join('/')
  }

  uri(p: string): vscode.Uri {
    return vscode.Uri.joinPath(this.rootUri, ...p.split('/'))
  }

  private openDoc(p: string): vscode.TextDocument | undefined {
    const want = this.uri(p).toString()
    return vscode.workspace.textDocuments.find((d) => !d.isClosed && d.uri.toString() === want)
  }

  files(): WorldFile[] {
    const m = new Map(this.disk)
    for (const d of vscode.workspace.textDocuments) {
      if (d.isClosed) continue
      const p = this.rel(d.uri)
      if (p) m.set(p, d.getText())
    }
    for (const [p, t] of this.inflight) {
      if (t === null) m.delete(p)
      else m.set(p, t)
    }
    return [...m].map(([p, text]) => ({ path: p, text }))
  }

  world(): WorldData {
    this.cached ??= addBuiltins(readWorld(this.files(), KINDS))
    return this.cached
  }

  get dirty(): string[] {
    return vscode.workspace.textDocuments.flatMap((d) => {
      const p = d.isDirty ? this.rel(d.uri) : null
      return p ? [p] : []
    })
  }

  // Undo and redo are VS Code's (each document's own), so the session's are not used.
  readonly canUndo = false
  readonly canRedo = false

  edit(changes: readonly FileChange[]): void {
    for (const c of changes) assertWorldPath(c.path, KINDS)
    for (const c of changes) this.inflight.set(c.path, c.text)
    this.invalidate()
    this.queue = this.queue
      .then(() => this.apply(changes))
      .catch((err) => {
        void vscode.window.showErrorMessage(`Malevo Science could not make the change: ${(err as Error).message}`)
      })
  }

  private async apply(changes: readonly FileChange[]): Promise<void> {
    const we = new vscode.WorkspaceEdit()
    for (const c of changes) {
      const uri = this.uri(c.path)
      if (c.text === null) {
        we.deleteFile(uri, { ignoreIfNotExists: true })
        continue
      }
      let doc = this.openDoc(c.path)
      if (!doc && this.disk.has(c.path)) doc = await vscode.workspace.openTextDocument(uri)
      if (doc) {
        if (doc.getText() === c.text) continue
        we.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), c.text)
      } else {
        we.createFile(uri, { ignoreIfExists: true })
        we.insert(uri, new vscode.Position(0, 0), c.text)
      }
    }
    await vscode.workspace.applyEdit(we)
    for (const c of changes) if (c.text !== null && this.inflight.get(c.path) === c.text) this.inflight.delete(c.path)
    this.invalidate()
    this.onApplied()
  }

  /** Wait for edits already made to land (tests, and before opening a file just written). */
  settled(): Promise<void> {
    return this.queue
  }

  setEntity<T>(kind: KindDef<T>, id: string, value: T): void {
    this.edit([{ path: entityPath(kind as KindDef, id), text: entityText(kind, value) }])
  }

  squash(): void {}
  undo(): void {}
  redo(): void {}
  discard(): void {}

  async save(): Promise<string[]> {
    const d = this.dirty
    await vscode.workspace.saveAll(false)
    return d
  }
}
