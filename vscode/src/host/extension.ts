/**
 * Malevo Science in VS Code: a world folder's systems and bodies open in editors of their own (the app's
 * screens, in a webview), over VS Code's documents. One world session per world folder (the folder with
 * world.json), with one current date that every editor of that world follows, shown in the status bar.
 */
import { existsSync } from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { TIMELINE_VIEW, TimelineEditorProvider, newTimelineCommand } from './timeline'
import { bodyKind, slugify, systemKind, uniqueSlug, type WorldEnv } from '@malevo/model'
import { loadCatalog, nodeEnvWith, openWorld } from '@malevo/model/node'
import { WorldSession } from '../../../src/main/world'
import { makeDispatch, type Dispatch } from './dispatch'
import { VsEditor } from './editor'

interface Panel {
  world: OpenWorldState
  webview: vscode.Webview
  kind: 'system' | 'body'
  id: string
}

interface OpenWorldState {
  root: string
  session: WorldSession
  editor: VsEditor
  panels: Set<Panel>
  dispatch: Dispatch
}

let env: WorldEnv = {}
const worlds = new Map<string, Promise<OpenWorldState>>()
let context: vscode.ExtensionContext
let status: vscode.StatusBarItem
let activeWorld: OpenWorldState | null = null

/** The world folder a file belongs to: the nearest folder above it with a world.json. */
function worldRootOf(file: string): string | null {
  let dir = path.dirname(file)
  for (;;) {
    if (existsSync(path.join(dir, 'world.json'))) return dir
    const up = path.dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

const nowKey = (root: string): string => `malevo.now:${root}`
const calKey = (root: string): string => `malevo.displayCal:${root}`

function state(w: OpenWorldState): { now: number; displayCal: string | null } {
  const snap = w.session.snapshot()
  const usable = (snap?.calendars ?? []).filter((c) => !c.error).map((c) => c.id)
  const stored = context.workspaceState.get<string | null>(calKey(w.root), null)
  const displayCal = stored && usable.includes(stored) ? stored : usable.includes('gregorian') ? 'gregorian' : (usable[0] ?? null)
  const firstStory = snap?.events.find((e) => e.value?.type === 'story' && e.start)?.start?.t
  const now = context.workspaceState.get<number | null>(nowKey(w.root), null) ?? firstStory ?? 0
  return { now, displayCal }
}

function broadcast(w: OpenWorldState, name: string, payload: unknown): void {
  for (const p of w.panels) void p.webview.postMessage({ type: 'event', name, payload })
}

async function setNow(w: OpenWorldState, t: number): Promise<void> {
  await context.workspaceState.update(nowKey(w.root), t)
  broadcast(w, 'host.state', state(w))
  updateStatus()
}

async function worldFor(file: string): Promise<OpenWorldState | null> {
  const root = worldRootOf(file)
  if (!root) return null
  let w = worlds.get(root)
  if (!w) {
    w = (async () => {
      const opened = await openWorld(root)
      const session = new WorldSession(env)
      // Snapshots are pushed a moment after a burst of changes (typing in the JSON, a run of edits).
      let timer: NodeJS.Timeout | null = null
      const state0: OpenWorldState = {
        root,
        session,
        editor: null as unknown as VsEditor,
        panels: new Set(),
        dispatch: null as unknown as Dispatch
      }
      const refresh = (): void => {
        state0.editor.invalidate()
        session.refresh()
      }
      const editor = new VsEditor(root, refresh)
      await editor.load()
      state0.editor = editor
      session.attach(opened, editor)
      session.on('snapshot', () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          const snap = session.snapshot()
          broadcast(state0, 'world.snapshot', snap)
          updateStatus()
        }, 60)
      })
      session.on('renamed', (r: { kind: string; from: string; to: string }) => {
        broadcast(state0, 'world.renamed', r)
        // An open editor follows its file to its new name.
        for (const p of [...state0.panels])
          if (p.kind === r.kind && p.id === r.from) void openEntity(state0, p.kind, r.to).then(() => closeTabFor(state0, p.kind, r.from))
      })
      state0.dispatch = makeDispatch(session, {
        confirm: async (message) => (await vscode.window.showWarningMessage(message, { modal: true }, 'Delete')) === 'Delete',
        openBody: (id) => openEntity(state0, 'body', id),
        openSystem: (id) => openEntity(state0, 'system', id),
        navigate: (tool) =>
          void vscode.window.showInformationMessage(`The ${tool} tool isn't in VS Code yet; it's still in the Malevo Science app.`),
        state: () => state(state0),
        setNow: (t) => void setNow(state0, t),
        setDisplayCal: (cal) => {
          void context.workspaceState.update(calKey(root), cal).then(() => {
            broadcast(state0, 'host.state', state(state0))
            updateStatus()
          })
        }
      })
      // Disk changes (saves, git, other programs) and typing in the files' text editors.
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), '**/*'))
      let reload: NodeJS.Timeout | null = null
      const onDisk = (): void => {
        if (reload) clearTimeout(reload)
        reload = setTimeout(() => void editor.load().then(() => session.refresh()), 150)
      }
      context.subscriptions.push(
        watcher,
        watcher.onDidChange(onDisk),
        watcher.onDidCreate(onDisk),
        watcher.onDidDelete(onDisk),
        vscode.workspace.onDidChangeTextDocument((e) => {
          if (editor.rel(e.document.uri)) refresh()
        }),
        vscode.workspace.onDidCloseTextDocument((d) => {
          if (editor.rel(d.uri)) onDisk()
        })
      )
      return state0
    })()
    worlds.set(root, w)
    w.catch(() => worlds.delete(root))
  }
  return w
}

const folderOf = (kind: 'system' | 'body'): string => (kind === 'system' ? (systemKind.folder as string) : (bodyKind.folder as string))
const viewTypeOf = (kind: 'system' | 'body'): string => (kind === 'system' ? 'malevo.system' : 'malevo.body')

/** Open a system or body in its own tab (a built-in one gets its file first, if you agree). */
async function openEntity(w: OpenWorldState, kind: 'system' | 'body', id: string): Promise<void> {
  await w.editor.settled()
  const p = `${folderOf(kind)}/${id}.json`
  const uri = w.editor.uri(p)
  const hasFile = w.editor.files().some((f) => f.path === p)
  if (!hasFile) {
    const e = w.editor.world().entities.get(`${kind}/${id}`)
    if (!e || e.value === undefined) {
      void vscode.window.showErrorMessage(`There is no ${kind} "${id}".`)
      return
    }
    const choice = await vscode.window.showInformationMessage(
      `${(e.value as { name?: string }).name ?? id} is built in (real astronomy), so it has no file. Give it one to edit it?`,
      'Give it a file'
    )
    if (choice !== 'Give it a file') return
    w.session.setEntity(kind, id, e.value)
    await w.editor.settled()
  }
  await vscode.commands.executeCommand('vscode.openWith', uri, viewTypeOf(kind), { preview: false })
}

async function closeTabFor(w: OpenWorldState, kind: 'system' | 'body', id: string): Promise<void> {
  const want = w.editor.uri(`${folderOf(kind)}/${id}.json`).toString()
  for (const g of vscode.window.tabGroups.all)
    for (const t of g.tabs) {
      const input = t.input as { uri?: vscode.Uri } | undefined
      if (input?.uri?.toString() === want) await vscode.window.tabGroups.close(t)
    }
}

function webviewHtml(webview: vscode.Webview, boot: object): string {
  const dist = vscode.Uri.joinPath(context.extensionUri, 'dist')
  const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'))
  const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'))
  const nonce = Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="${style}" />
</head>
<body class="vscode-host">
<div id="root"></div>
<script nonce="${nonce}" id="boot" type="application/json">${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`
}

class EntityEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly kind: 'system' | 'body') {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const w = await worldFor(document.uri.fsPath)
    const id = path.basename(document.uri.fsPath, '.json')
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')] }
    if (!w) {
      panel.webview.html = `<p style="padding:1em">This file isn't in a Malevo Science world (no world.json above it). Reopen it with the text editor.</p>`
      return
    }
    const p: Panel = { world: w, webview: panel.webview, kind: this.kind, id }
    w.panels.add(p)
    activeWorld = w
    updateStatus()
    panel.webview.html = webviewHtml(panel.webview, { kind: this.kind, id, root: w.root })
    panel.onDidChangeViewState(() => {
      if (panel.active) {
        activeWorld = w
        updateStatus()
      }
    })
    panel.onDidDispose(() => w.panels.delete(p))
    panel.webview.onDidReceiveMessage(async (m: { type: string; id: number; method: string; args: unknown[] }) => {
      if (m.type !== 'call') return
      try {
        const value = await w.dispatch(m.method, m.args ?? [])
        void panel.webview.postMessage({ type: 'result', id: m.id, value })
      } catch (err) {
        void panel.webview.postMessage({ type: 'result', id: m.id, error: (err as Error).message ?? String(err) })
      }
    })
  }
}

function updateStatus(): void {
  const w = activeWorld
  if (!w) {
    status.hide()
    return
  }
  const { now, displayCal } = state(w)
  const text = displayCal ? w.session.format(displayCal, [{ t: now, precision: 'minute' }])[0] : null
  status.text = `$(clock) ${text ?? `${Math.round(now)} s`}`
  status.tooltip = 'The current date in this world: every system and body editor follows it. Click to change it.'
  status.show()
}

async function setDateCommand(): Promise<void> {
  const w = activeWorld
  if (!w) {
    void vscode.window.showInformationMessage('Open a system or body first.')
    return
  }
  const { now, displayCal } = state(w)
  if (!displayCal) return
  const current = w.session.format(displayCal, [{ t: now, precision: 'minute' }])[0] ?? ''
  const text = await vscode.window.showInputBox({
    title: 'The current date',
    value: current,
    prompt: `A date in the ${displayCal} calendar`,
    validateInput: (v) => (w.session.parse(displayCal, v) ? null : 'Not a date in this calendar.')
  })
  const parsed = text ? w.session.parse(displayCal, text) : null
  if (parsed) await setNow(w, parsed.t)
}

/** A new system: detached with its own star, or on a star (perhaps a stand-in). */
async function newSystemCommand(): Promise<void> {
  const folder = vscode.window.activeTextEditor?.document.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  const roots = folder ? [worldRootOf(path.join(folder, 'x'))] : []
  let root = roots[0] ?? (folder && existsSync(path.join(folder, 'world.json')) ? folder : null)
  if (!root) {
    const found = await vscode.workspace.findFiles('**/world.json', '**/node_modules/**', 5)
    root = found[0] ? path.dirname(found[0].fsPath) : null
  }
  if (!root) {
    void vscode.window.showErrorMessage('No Malevo Science world here (a folder with world.json).')
    return
  }
  const w = await worldFor(path.join(root, 'world.json'))
  if (!w) return
  const name = await vscode.window.showInputBox({ title: 'New system', prompt: 'Its name', value: '' })
  if (!name?.trim()) return
  const how = await vscode.window.showQuickPick(
    [
      { label: 'Detached', description: 'Its own star, by type; placed among the stars later', value: 'detached' },
      { label: 'On a star', description: 'A real star, or a generated one', value: 'star' }
    ],
    { title: 'Where is it?' }
  )
  if (!how) return
  let value: Record<string, unknown> = { name: name.trim() }
  if (how.value === 'detached') {
    const spect = await vscode.window.showInputBox({
      title: 'Its star',
      prompt: 'Spectral type, like G2V (the Sun), K1V or M4.5V',
      value: 'G2V',
      validateInput: (v) => (/^[OBAFGKM]\d(\.\d)?V?$/.test(v.trim()) ? null : 'A main-sequence type, like K1V.')
    })
    if (!spect) return
    value = { ...value, spect: spect.trim() }
  } else {
    const q = await vscode.window.showInputBox({ title: 'Which star?', prompt: 'A name or id (Proxima, hip.70890, g.0_1_-2.4)' })
    if (!q) return
    const hits = w.session.searchStars(q)
    const pick = await vscode.window.showQuickPick(
      hits.map((h) => ({ label: h.name || h.id, description: `${h.id} · ${h.distance.toFixed(1)} ly from Sol`, id: h.id })),
      { title: 'Which star?' }
    )
    if (!pick) return
    value = { ...value, star: pick.id }
  }
  const taken = w.session.snapshot()?.systems.map((s) => s.id) ?? []
  const id = uniqueSlug(name.trim(), taken) || slugify(name)
  w.session.setEntity('system', id, value)
  await openEntity(w, 'system', id)
}

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  context = ctx
  try {
    env = nodeEnvWith(await loadCatalog(ctx.asAbsolutePath(path.join('dist', 'hyg-stars.json'))))
  } catch {
    env = nodeEnvWith()
  }
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50)
  status.command = 'malevo.setDate'
  ctx.subscriptions.push(
    status,
    vscode.window.registerCustomEditorProvider('malevo.system', new EntityEditorProvider('system'), {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.window.registerCustomEditorProvider('malevo.body', new EntityEditorProvider('body'), {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('malevo.setDate', setDateCommand),
    vscode.commands.registerCommand('malevo.newSystem', newSystemCommand),
    vscode.window.registerCustomEditorProvider(TIMELINE_VIEW, new TimelineEditorProvider(ctx), {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('malevo.newTimeline', newTimelineCommand)
  )
}

export function deactivate(): void {}
