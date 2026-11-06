import { useEffect, useMemo, useState } from 'react'
import {
  LINK_GROUP_NAMES,
  newNaming,
  type ExploreResult,
  type LinkGroup,
  type NamingFile,
  type NamingStep,
  type Sense,
  type WordHit
} from '@malevo/model'
import type { WorldSnapshot } from '../../../../shared/types'
import { NumberField, TextField } from '../../components/fields'
import { slugId, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'

/**
 * The Names tool: a brainstorm, not an oracle. The person looks up words,
 * ticks the senses they mean, chooses which links to follow, narrows what
 * comes back, keeps and drops words, shuffles kept words together and writes
 * candidates. The tool never ranks or suggests; it records every step, with
 * the time, in namings/<id>.json.
 */
function NamesView({ world, snapshot }: ToolProps): React.JSX.Element {
  const [namingId, setNamingId] = useWorldPref<string | null>(world.root, 'naming', null)
  const naming = snapshot.namings.find((n) => n.id === namingId) ?? snapshot.namings[0] ?? null
  return (
    <div className="split-tool names">
      <nav className="split-list">
        <h2>Names</h2>
        <ul>
          {snapshot.namings.map((n) => {
            const chosen = (n.value?.candidates as NamingFile['candidates'] | undefined)?.find((c) => c.status === 'chosen')
            return (
              <li key={n.id}>
                <button
                  className={n.id === naming?.id ? 'list-item is-current' : 'list-item'}
                  onClick={() => setNamingId(n.id)}
                  data-naming={n.id}
                >
                  <span>{String(n.value?.name ?? n.id)}</span>
                  <span className="muted small">{n.value ? (chosen ? `→ ${chosen.text}` : 'open') : 'has errors'}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <NewNaming snapshot={snapshot} onMade={setNamingId} />
      </nav>
      <div className="tool-page wide">
        {!naming?.value ? (
          <>
            <h1>Names</h1>
            <p className="muted">
              A brainstorm for a name. Look up words that say what the thing is like, tick the senses you mean, and follow the word list’s
              links (similar, derived, broader, narrower …) to related words. Keep the ones that catch your ear, shuffle them together,
              write candidates. Nothing here is ranked or suggested; every step you take is recorded with the name. Start one for whatever
              needs naming.
            </p>
          </>
        ) : (
          <Naming key={naming.id} id={naming.id} file={naming.value as unknown as NamingFile} snapshot={snapshot} />
        )}
      </div>
    </div>
  )
}

const now = (): string => new Date().toISOString()

function NewNaming({ snapshot, onMade }: { snapshot: WorldSnapshot; onMade(id: string): void }): React.JSX.Element {
  const [name, setName] = useState('')
  return (
    <form
      className="field-row tight"
      onSubmit={(e) => {
        e.preventDefault()
        const id = slugId(
          name,
          snapshot.namings.map((s) => s.id)
        )
        void window.malevo.names.senses('').then((r) => {
          const source = 'source' in r ? r.source : undefined
          void window.malevo.world.setEntity('naming', id, newNaming(name.trim(), source, now())).then(() => onMade(id))
        })
        setName('')
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Something to name…" id="newNamingName" />
      <button type="submit" disabled={!name.trim()} id="newNaming">
        Start
      </button>
    </form>
  )
}

const LINK_LABELS: Record<LinkGroup, string> = {
  similar: 'Similar',
  derived: 'Derived forms',
  broader: 'Broader',
  narrower: 'Narrower (kinds of)',
  parts: 'Parts and wholes',
  topic: 'Topic and region',
  opposite: 'Opposites',
  cause: 'Causes and entails'
}
const POS_LABELS = { n: 'nouns', v: 'verbs', a: 'adjectives', r: 'adverbs' } as const
type Pos = keyof typeof POS_LABELS
const posOf = (s: Sense): Pos => (s.pos === 's' ? 'a' : s.pos)
const categoryLabel = (c: string): string => {
  const [pos, what] = c.split('.')
  return what === 'all' || what === 'Tops' ? `${pos} (general)` : `${what} (${pos})`
}

/** Every name already used in the world, lowercased, with what uses it. */
function namesInUse(snapshot: WorldSnapshot): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const add = (name: unknown, what: string): void => {
    if (typeof name !== 'string' || !name.trim()) return
    const key = name.trim().toLowerCase()
    out.set(key, [...(out.get(key) ?? []), what])
  }
  for (const s of snapshot.systems) {
    add(s.name, `system ${s.id}`)
    for (const b of (s as unknown as { bodies?: { id: string; name: string }[] }).bodies ?? []) add(b.name, `body ${b.id}`)
  }
  const kinds: [string, { id: string; value: Record<string, unknown> | null }[]][] = [
    ['ship', snapshot.ships],
    ['station', snapshot.stations],
    ['nebula', snapshot.nebulae],
    ['culture', snapshot.cultures],
    ['polity', snapshot.polities],
    ['city', snapshot.cities],
    ['naming', snapshot.namings]
  ]
  for (const [kind, list] of kinds) for (const e of list) add(e.value?.name, `${kind} ${e.id}`)
  for (const r of snapshot.routes) add((r as unknown as { name?: string }).name, `route ${r.id}`)
  for (const c of snapshot.characters) {
    add(c.name, `character ${c.id}`)
    for (const n of c.names) add(n.name, `character ${c.id}`)
  }
  return out
}

function Naming({ id, file, snapshot }: { id: string; file: NamingFile; snapshot: WorldSnapshot }): React.JSX.Element {
  /** Every change goes through here, with the line it adds to the record. */
  const change = (patch: Partial<NamingFile>, step: NamingStep, text: string): void => {
    const next = { ...file, ...patch, log: [...file.log, { at: now(), step, text }] } as Record<string, unknown>
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    void window.malevo.world.setEntity('naming', id, next)
  }
  const [result, setResult] = useState<ExploreResult | { error: string } | null>(null)
  const active = file.concepts.filter((c) => c.senses.length)
  const query = JSON.stringify({ concepts: active.map((c) => ({ word: c.word, senses: c.senses.map((s) => s.id) })), ...file.links })
  useEffect(() => {
    if (!active.length) {
      setResult(null)
      return
    }
    let live = true
    const q = JSON.parse(query) as { concepts: { word: string; senses: string[] }[]; groups: LinkGroup[]; depth: number; defined: boolean }
    void window.malevo.names
      .explore({ concepts: q.concepts, links: q.groups, depth: q.depth, defined: q.defined })
      .then((r) => live && setResult(r))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  return (
    <section className="naming" id="naming">
      <div className="field-row">
        <TextField
          label="Naming"
          value={file.name}
          onCommit={(v) => v.trim() && change({ name: v.trim() }, 'brief', `Renamed the brainstorm “${v.trim()}”.`)}
          id="namingName"
        />
      </div>
      <Brief file={file} change={change} />
      <Concepts file={file} change={change} />
      <Links file={file} change={change} />
      <Words file={file} change={change} result={result} activeCount={active.length} />
      <Kept file={file} change={change} />
      <Candidates file={file} change={change} snapshot={snapshot} />
      <Record file={file} />
    </section>
  )
}

type Change = (patch: Partial<NamingFile>, step: NamingStep, text: string) => void

function Brief({ file, change }: { file: NamingFile; change: Change }): React.JSX.Element {
  const [draft, setDraft] = useState(file.brief ?? '')
  useEffect(() => setDraft(file.brief ?? ''), [file.brief])
  return (
    <label className="field">
      What should the name carry? (your words)
      <textarea
        id="namingBrief"
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() =>
          draft.trim() !== (file.brief ?? '') && change({ brief: draft.trim() || undefined }, 'brief', `Brief: “${draft.trim()}”`)
        }
      />
    </label>
  )
}

function Concepts({ file, change }: { file: NamingFile; change: Change }): React.JSX.Element {
  const [word, setWord] = useState('')
  const [senses, setSenses] = useState<Record<string, Sense[] | string>>({})
  const [open, setOpen] = useState<string | null>(null)
  const fetchSenses = (w: string): void => {
    if (senses[w]) return
    void window.malevo.names.senses(w).then((r) => setSenses((s) => ({ ...s, [w]: 'error' in r ? r.error : r.senses })))
  }
  useEffect(() => {
    for (const c of file.concepts) fetchSenses(c.word)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.concepts.length])
  return (
    <div className="naming-concepts">
      <h3>Words for what it’s like</h3>
      <form
        className="field-row tight"
        onSubmit={(e) => {
          e.preventDefault()
          const w = word.trim().toLowerCase()
          if (!w || file.concepts.some((c) => c.word === w)) return
          void window.malevo.names.senses(w).then((r) => {
            const list = 'error' in r ? [] : r.senses
            setSenses((s) => ({ ...s, [w]: 'error' in r ? r.error : list }))
            change(
              { concepts: [...file.concepts, { word: w, senses: [] }] },
              'look-up',
              list.length
                ? `Looked up “${w}”: ${list.length} sense${list.length === 1 ? '' : 's'}.`
                : `Looked up “${w}”: not in the word list.`
            )
            setOpen(w)
          })
          setWord('')
        }}
      >
        <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="slow, lumbering, patient…" id="conceptWord" />
        <button type="submit" disabled={!word.trim()} id="addConcept">
          Look up
        </button>
      </form>
      {file.concepts.map((c, ci) => {
        const list = senses[c.word]
        const chosen = new Set(c.senses.map((s) => s.id))
        const isOpen = open === c.word || !c.senses.length
        return (
          <div className="concept" key={c.word} data-concept={c.word}>
            <div className="concept-head">
              <button className="link" onClick={() => setOpen(isOpen ? null : c.word)}>
                <strong>{c.word}</strong>
              </button>
              <span className="muted small">
                {c.senses.length ? `${c.senses.length} sense${c.senses.length === 1 ? '' : 's'} ticked` : 'tick the senses you mean'}
              </span>
              <button
                className="small"
                onClick={() => change({ concepts: file.concepts.filter((_, i) => i !== ci) }, 'remove-word', `Set aside “${c.word}”.`)}
              >
                Remove
              </button>
            </div>
            {isOpen &&
              (typeof list === 'string' ? (
                <p className="muted small">{list}</p>
              ) : !list ? (
                <p className="muted small">…</p>
              ) : !list.length ? (
                <p className="muted small">Not in the word list.</p>
              ) : (
                <ul className="senses">
                  {list.map((s) => (
                    <li key={s.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={chosen.has(s.id)}
                          onChange={(e) => {
                            const senses = e.target.checked
                              ? [...c.senses, { id: s.id, words: s.words, gloss: s.gloss }]
                              : c.senses.filter((x) => x.id !== s.id)
                            change(
                              { concepts: file.concepts.map((x, i) => (i === ci ? { ...x, senses } : x)) },
                              e.target.checked ? 'sense' : 'unsense',
                              `${e.target.checked ? 'Meant' : 'Did not mean'} “${c.word}” as ${s.words.join(', ')}: ${s.gloss.split(/;\s*"/)[0]}`
                            )
                          }}
                        />
                        <span className="muted small">{POS_LABELS[posOf(s)].slice(0, -1)}</span> <strong>{s.words.join(', ')}</strong> —{' '}
                        {s.gloss}
                      </label>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        )
      })}
    </div>
  )
}

function Links({ file, change }: { file: NamingFile; change: Change }): React.JSX.Element {
  const l = file.links
  const describe = (x: NamingFile['links']): string =>
    `${x.groups.map((g) => LINK_LABELS[g].toLowerCase()).join(', ') || 'synonyms only'}${x.defined ? ', defined using' : ''}; ${x.depth} link${x.depth === 1 ? '' : 's'} out`
  const set = (x: NamingFile['links']): void => change({ links: x }, 'links', `Followed ${describe(x)}.`)
  return (
    <div className="naming-links">
      <h3>Links to follow</h3>
      <div className="checks">
        <span className="muted small">Synonyms always.</span>
        {LINK_GROUP_NAMES.map((g) => (
          <label key={g}>
            <input
              type="checkbox"
              checked={l.groups.includes(g)}
              onChange={(e) => set({ ...l, groups: e.target.checked ? [...l.groups, g] : l.groups.filter((x) => x !== g) })}
              data-link={g}
            />
            {LINK_LABELS[g]}
          </label>
        ))}
        <label title="Senses whose definition uses one of the chosen words (one step; not followed further)">
          <input type="checkbox" checked={l.defined} onChange={(e) => set({ ...l, defined: e.target.checked })} data-link="defined" />
          Defined using
        </label>
        <NumberField
          label="Links out"
          value={l.depth}
          onCommit={(x) => x !== undefined && x >= 1 && x <= 3 && set({ ...l, depth: Math.round(x) })}
          id="linkDepth"
        />
      </div>
    </div>
  )
}

function Words({
  file,
  change,
  result,
  activeCount
}: {
  file: NamingFile
  change: Change
  result: ExploreResult | { error: string } | null
  activeCount: number
}): React.JSX.Element {
  const [order, setOrder] = useState<'alpha' | 'steps'>('alpha')
  const [showDropped, setShowDropped] = useState(false)
  const [limit, setLimit] = useState(400)
  const n = file.narrow
  const kept = new Set(file.kept.map((k) => k.word.toLowerCase()))
  const dropped = new Set(file.dropped.map((d) => d.toLowerCase()))
  const words = useMemo(() => (result && !('error' in result) ? result.words : []), [result])
  const categories = useMemo(() => [...new Set(words.flatMap((w) => w.senses.map((s) => s.category)))].sort(), [words])
  const setNarrow = (x: NamingFile['narrow'], text: string): void => {
    const clean = { ...x } as Record<string, unknown>
    for (const k of Object.keys(clean))
      if (clean[k] === undefined || (Array.isArray(clean[k]) && !(clean[k] as unknown[]).length)) delete clean[k]
    change({ narrow: clean as NamingFile['narrow'] }, 'narrow', text)
  }
  const shown = words.filter((w) => {
    const key = w.word.toLowerCase()
    if (!showDropped && dropped.has(key)) return false
    if (n.match === 'all' && w.reached.length < activeCount) return false
    if (n.pos?.length && !w.senses.some((s) => n.pos!.includes(posOf(s)))) return false
    if (n.categories?.length && !w.senses.some((s) => n.categories!.includes(s.category))) return false
    if (n.maxLetters && w.word.replace(/[^A-Za-z]/g, '').length > n.maxLetters) return false
    if (n.singleWords && /[\s-]/.test(w.word)) return false
    if (n.contains && !key.includes(n.contains.toLowerCase())) return false
    return true
  })
  const steps = (w: WordHit): number => w.reached.reduce((a, r) => a + r.steps, 0) + (activeCount - w.reached.length) * 10
  if (order === 'steps') shown.sort((a, b) => steps(a) - steps(b))
  return (
    <div className="naming-words">
      <h3>Words reached</h3>
      <div className="field-row narrow-row">
        <label className="field">
          Reached from
          <select
            value={n.match}
            onChange={(e) =>
              setNarrow(
                { ...n, match: e.target.value as 'all' | 'any' },
                `Narrowed to words reached from ${e.target.value === 'all' ? 'every word' : 'any word'}.`
              )
            }
            id="narrowMatch"
          >
            <option value="any">any word</option>
            <option value="all">every word</option>
          </select>
        </label>
        <div className="checks">
          {(Object.keys(POS_LABELS) as Pos[]).map((p) => (
            <label key={p}>
              <input
                type="checkbox"
                checked={n.pos?.includes(p) ?? false}
                onChange={(e) => {
                  const pos = e.target.checked ? [...(n.pos ?? []), p] : (n.pos ?? []).filter((x) => x !== p)
                  setNarrow({ ...n, pos }, pos.length ? `Narrowed to ${pos.map((x) => POS_LABELS[x]).join(', ')}.` : 'Any part of speech.')
                }}
                data-pos={p}
              />
              {POS_LABELS[p]}
            </label>
          ))}
          <label>
            <input
              type="checkbox"
              checked={n.singleWords ?? false}
              onChange={(e) =>
                setNarrow({ ...n, singleWords: e.target.checked || undefined }, e.target.checked ? 'Single words only.' : 'Phrases too.')
              }
            />
            single words
          </label>
        </div>
        <NumberField
          label="At most letters"
          value={n.maxLetters}
          optional
          onCommit={(x) =>
            setNarrow({ ...n, maxLetters: x && x > 0 ? Math.round(x) : undefined }, x ? `At most ${Math.round(x)} letters.` : 'Any length.')
          }
          id="narrowLetters"
        />
        <TextField
          label="Contains"
          value={n.contains ?? ''}
          onCommit={(v) =>
            setNarrow({ ...n, contains: v.trim() || undefined }, v.trim() ? `Containing “${v.trim()}”.` : 'Containing anything.')
          }
          id="narrowContains"
        />
      </div>
      {categories.length > 1 && (
        <details className="categories">
          <summary>Kinds of thing{n.categories?.length ? `: ${n.categories.map(categoryLabel).join(', ')}` : ' (any)'}</summary>
          <div className="checks">
            {categories.map((c) => (
              <label key={c}>
                <input
                  type="checkbox"
                  checked={n.categories?.includes(c) ?? false}
                  onChange={(e) => {
                    const categories = e.target.checked ? [...(n.categories ?? []), c] : (n.categories ?? []).filter((x) => x !== c)
                    setNarrow(
                      { ...n, categories },
                      categories.length ? `Narrowed to kinds: ${categories.map(categoryLabel).join(', ')}.` : 'Any kind of thing.'
                    )
                  }}
                  data-category={c}
                />
                {categoryLabel(c)}
              </label>
            ))}
          </div>
        </details>
      )}
      {!activeCount ? (
        <p className="muted small">Tick a sense of a word above to see the words it leads to.</p>
      ) : !result ? (
        <p className="muted small">Exploring… (the first time takes a few seconds)</p>
      ) : 'error' in result ? (
        <p className="error">{result.error}</p>
      ) : (
        <>
          <p className="muted small" id="wordCount">
            {shown.length} of {words.length} words
            {result.capped.length ? ' (some neighbourhoods were too big and were cut short: fewer links out?)' : ''}. Click a word to keep
            it, × to drop it. Order:{' '}
            <button className="link" onClick={() => setOrder(order === 'alpha' ? 'steps' : 'alpha')} id="wordOrder">
              {order === 'alpha' ? 'alphabetical' : 'fewest links first'}
            </button>
            {' · '}
            <button className="link" onClick={() => setShowDropped(!showDropped)}>
              {showDropped ? 'hide dropped' : `show dropped (${file.dropped.length})`}
            </button>
          </p>
          <div className="word-chips" id="wordChips">
            {shown.slice(0, limit).map((w) => {
              const key = w.word.toLowerCase()
              const how = w.reached.map((r) => r.path).join('\n')
              const means = w.senses.map((s) => `${s.words.join(', ')} (${categoryLabel(s.category)}): ${s.gloss}`).join('\n')
              const cls = kept.has(key) ? 'word-chip kept' : dropped.has(key) ? 'word-chip dropped' : 'word-chip'
              return (
                <span className={cls} key={key} title={`${how}\n\n${means}`} data-word={w.word}>
                  <button
                    className="word"
                    onClick={() =>
                      kept.has(key)
                        ? undefined
                        : change(
                            { kept: [...file.kept, { word: w.word }], dropped: file.dropped.filter((d) => d.toLowerCase() !== key) },
                            'keep',
                            `Kept “${w.word}” (${w.reached[0]?.path ?? ''}).`
                          )
                    }
                  >
                    {w.word}
                  </button>
                  {!kept.has(key) &&
                    (dropped.has(key) ? (
                      <button
                        className="x"
                        title="Bring back"
                        onClick={() =>
                          change({ dropped: file.dropped.filter((d) => d.toLowerCase() !== key) }, 'restore', `Brought back “${w.word}”.`)
                        }
                      >
                        ↺
                      </button>
                    ) : (
                      <button
                        className="x"
                        title="Drop"
                        onClick={() => change({ dropped: [...file.dropped, w.word] }, 'drop', `Dropped “${w.word}”.`)}
                      >
                        ×
                      </button>
                    ))}
                </span>
              )
            })}
            {shown.length > limit && (
              <button className="link" onClick={() => setLimit(limit + 400)}>
                {shown.length - limit} more…
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Kept({ file, change }: { file: NamingFile; change: Change }): React.JSX.Element {
  const [shuffled, setShuffled] = useState<string[]>([])
  const pattern = file.pattern ?? '{word} {word}'
  const [draft, setDraft] = useState(pattern)
  useEffect(() => setDraft(pattern), [pattern])
  const shuffle = (): void => {
    const words = file.kept.map((k) => k.word)
    const slots = (pattern.match(/\{word\}/g) ?? []).length
    if (!words.length || !slots) return setShuffled([])
    const out = new Set<string>()
    for (let tries = 0; out.size < 12 && tries < 200; tries++) {
      const pool = [...words]
      const text = pattern.replace(/\{word\}/g, () => {
        const i = Math.floor(Math.random() * pool.length)
        const w = pool.length ? pool.splice(i, 1)[0] : words[Math.floor(Math.random() * words.length)]
        return w.replace(/^./, (c) => c.toUpperCase())
      })
      out.add(text)
    }
    setShuffled([...out])
    change({}, 'shuffle', `Shuffled kept words into “${pattern}”: ${[...out].join(' · ')}`)
  }
  const addCandidate = (text: string, how: string): void => {
    if (file.candidates.some((c) => c.text.toLowerCase() === text.toLowerCase())) return
    change({ candidates: [...file.candidates, { text, status: 'maybe' }] }, 'candidate', `Wrote down “${text}” ${how}.`)
  }
  return (
    <div className="naming-kept" id="keptWords">
      <h3>Kept</h3>
      {!file.kept.length ? (
        <p className="muted small">Nothing kept yet.</p>
      ) : (
        <ul className="kept-list">
          {file.kept.map((k, i) => (
            <li key={k.word} data-kept={k.word}>
              <button
                className="link"
                title="Write down as a candidate"
                onClick={() =>
                  addCandidate(
                    k.word.replace(/^./, (c) => c.toUpperCase()),
                    'from a kept word'
                  )
                }
              >
                {k.word}
              </button>
              <NoteField
                value={k.note}
                onCommit={(note) =>
                  change(
                    { kept: file.kept.map((x, j) => (j === i ? { ...x, note } : x)) },
                    'note',
                    `Note on “${k.word}”: ${note ?? '(removed)'}`
                  )
                }
              />
              <button
                className="x"
                title="Un-keep"
                onClick={() => change({ kept: file.kept.filter((_, j) => j !== i) }, 'unkeep', `Un-kept “${k.word}”.`)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="field-row tight">
        <label className="field">
          Pattern
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => draft.trim() && draft !== pattern && change({ pattern: draft.trim() }, 'shuffle', `Pattern “${draft.trim()}”.`)}
            id="shufflePattern"
          />
        </label>
        <button onClick={shuffle} disabled={!file.kept.length} id="shuffle" title="Kept words dropped into the pattern at random">
          Shuffle
        </button>
      </div>
      {shuffled.length > 0 && (
        <div className="word-chips" id="shuffled">
          {shuffled.map((s) => (
            <span className="word-chip" key={s}>
              <button className="word" onClick={() => addCandidate(s, 'from a shuffle')}>
                {s}
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function NoteField({ value, onCommit }: { value: string | undefined; onCommit(v: string | undefined): void }): React.JSX.Element {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  return (
    <input
      className="note"
      value={draft}
      placeholder="note…"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== (value ?? '') && onCommit(draft.trim() || undefined)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

function Candidates({ file, change, snapshot }: { file: NamingFile; change: Change; snapshot: WorldSnapshot }): React.JSX.Element {
  const [text, setText] = useState('')
  const inUse = useMemo(() => namesInUse(snapshot), [snapshot])
  return (
    <div className="naming-candidates" id="candidates">
      <h3>Candidates</h3>
      <form
        className="field-row tight"
        onSubmit={(e) => {
          e.preventDefault()
          const t = text.trim()
          if (t && !file.candidates.some((c) => c.text.toLowerCase() === t.toLowerCase()))
            change({ candidates: [...file.candidates, { text: t, status: 'maybe' }] }, 'candidate', `Wrote down “${t}”.`)
          setText('')
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write one down…" id="candidateText" />
        <button type="submit" disabled={!text.trim()} id="addCandidate">
          Add
        </button>
      </form>
      <table className="data small">
        <tbody>
          {file.candidates.map((c, i) => {
            const used = inUse.get(c.text.toLowerCase())
            return (
              <tr key={c.text} className={`candidate ${c.status}`} data-candidate={c.text}>
                <td>
                  <strong>{c.text}</strong>
                  {used && <div className="muted small">also: {used.join(', ')}</div>}
                </td>
                <td>
                  <select
                    value={c.status}
                    onChange={(e) => {
                      const status = e.target.value as 'maybe' | 'no' | 'chosen'
                      const candidates = file.candidates.map((x, j) =>
                        j === i ? { ...x, status } : status === 'chosen' && x.status === 'chosen' ? { ...x, status: 'maybe' as const } : x
                      )
                      change(
                        { candidates },
                        'status',
                        status === 'chosen'
                          ? `Chose “${c.text}”.`
                          : status === 'no'
                            ? `Ruled out “${c.text}”.`
                            : `“${c.text}” back to maybe.`
                      )
                    }}
                    data-status-of={c.text}
                  >
                    <option value="maybe">maybe</option>
                    <option value="no">no</option>
                    <option value="chosen">chosen</option>
                  </select>
                </td>
                <td>
                  <NoteField
                    value={c.note}
                    onCommit={(note) =>
                      change(
                        { candidates: file.candidates.map((x, j) => (j === i ? { ...x, note } : x)) },
                        'note',
                        `Note on “${c.text}”: ${note ?? '(removed)'}`
                      )
                    }
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Record({ file }: { file: NamingFile }): React.JSX.Element {
  return (
    <details className="naming-record" id="namingRecord">
      <summary>
        The record: {file.log.length} step{file.log.length === 1 ? '' : 's'}
        {file.log.length
          ? `, ${new Date(file.log[0].at).toLocaleDateString()} – ${new Date(file.log[file.log.length - 1].at).toLocaleDateString()}`
          : ''}
      </summary>
      <ol>
        {file.log.map((l, i) => (
          <li key={i}>
            <span className="muted small">{new Date(l.at).toLocaleString()}</span> {l.text}
          </li>
        ))}
      </ol>
    </details>
  )
}

export const namesTool: ToolDefinition = {
  id: 'names',
  title: 'Names',
  description: 'Brainstorm a name from related words, and keep a record of how you got there',
  View: NamesView
}
