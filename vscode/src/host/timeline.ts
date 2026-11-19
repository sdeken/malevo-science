/**
 * Scene timelines (`*.timeline.json`): the file is an ordinary text document, and the screen edits it as
 * one. Changes become VS Code edits (so unsaved changes, undo and Save are VS Code's); nothing here writes the
 * file itself. They don't need a world: a timeline can sit anywhere.
 */
import * as path from 'node:path'
import * as vscode from 'vscode'

export const TIMELINE_VIEW = 'malevo.sceneTimeline'

export class TimelineEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist')
    panel.webview.options = { enableScripts: true, localResourceRoots: [dist] }
    panel.webview.html = timelineHtml(panel.webview, dist)
    const send = (): void => void panel.webview.postMessage({ type: 'doc', text: document.getText() })
    const sub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length) send()
    })
    panel.onDidDispose(() => sub.dispose())
    panel.webview.onDidReceiveMessage(async (m: { type: string; text?: string; message?: string; then?: unknown }) => {
      switch (m.type) {
        case 'ready':
          send()
          break
        case 'edit':
          if (m.text !== undefined && m.text !== document.getText()) {
            const we = new vscode.WorkspaceEdit()
            we.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), m.text)
            await vscode.workspace.applyEdit(we)
          }
          break
        case 'copy':
          if (m.text !== undefined) {
            await vscode.env.clipboard.writeText(m.text)
            void vscode.window.showInformationMessage('Copied the timeline as a Markdown table.')
          }
          break
        case 'export':
          if (m.text !== undefined) await exportMarkdown(document.uri, m.text)
          break
        case 'confirm':
          if ((await vscode.window.showWarningMessage(m.message ?? 'Are you sure?', { modal: true }, 'Delete')) === 'Delete')
            void panel.webview.postMessage(m.then)
          break
      }
    })
  }
}

/** Save the table as a Markdown file: next to the timeline by default, after asking where. */
async function exportMarkdown(timeline: vscode.Uri, text: string): Promise<void> {
  const base = path
    .basename(timeline.fsPath)
    .replace(/\.timeline\.json$/i, '')
    .replace(/\.json$/i, '')
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(timeline, '..', `${base}.md`),
    filters: { Markdown: ['md'] },
    saveLabel: 'Save the table'
  })
  if (!target) return
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text))
  const open = await vscode.window.showInformationMessage(`Saved ${path.basename(target.fsPath)}.`, 'Open it')
  if (open) await vscode.window.showTextDocument(target)
}

/** A new, nearly empty timeline in the folder of the file open now (or the workspace's first folder). */
export async function newTimelineCommand(): Promise<void> {
  const active = vscode.window.activeTextEditor?.document.uri
  const folder = active?.scheme === 'file' ? vscode.Uri.file(path.dirname(active.fsPath)) : vscode.workspace.workspaceFolders?.[0]?.uri
  if (!folder) {
    void vscode.window.showInformationMessage('Open a folder first: the timeline is a file in it.')
    return
  }
  const name = await vscode.window.showInputBox({
    prompt: 'A name for the timeline (the file will be <name>.timeline.json)',
    placeHolder: 'down-to-bluff',
    validateInput: (v) => (/^[^\\/:*?"<>|]+$/.test(v.trim()) ? null : 'A file name, without slashes')
  })
  if (!name?.trim()) return
  const uri = vscode.Uri.joinPath(folder, `${name.trim().replace(/\.timeline\.json$/i, '')}.timeline.json`)
  try {
    await vscode.workspace.fs.stat(uri)
    void vscode.window.showErrorMessage(`${path.basename(uri.fsPath)} is already there.`)
    return
  } catch {
    // Not there yet: good.
  }
  const we = new vscode.WorkspaceEdit()
  we.createFile(uri, { ignoreIfExists: false })
  we.insert(
    uri,
    new vscode.Position(0, 0),
    `${JSON.stringify(
      {
        format: 1,
        title: name.trim(),
        clocks: [{ id: 'ship', name: 'Ship time', kind: 'ship', start: '0d 0h 0m 0s' }],
        events: [{ id: 'e1', name: 'First event', duration: '0d 0h 10m 0s' }]
      },
      null,
      2
    )}\n`
  )
  await vscode.workspace.applyEdit(we)
  await vscode.commands.executeCommand('vscode.openWith', uri, TIMELINE_VIEW)
}

function timelineHtml(webview: vscode.Webview, dist: vscode.Uri): string {
  const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'timeline.js'))
  const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'))
  const nonce = Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="${style}" />
</head>
<body class="vscode-host">
<div id="root"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`
}
