import { useEffect, useMemo, useState } from 'react'
import {
  LINK_GROUP_NAMES,
  NAME_SOURCES,
  newNaming,
  passesNarrow,
  type ExploreResult,
  type LinkGroup,
  type NameSource,
  type NamingFile,
  type NamingStep,
  type Sense
} from '@malevo/model'
import type { WorldSnapshot } from '../../../../shared/types'
import { NumberField, TextField } from '../../components/fields'
import { slugId, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'

/**
 * The Names tool: a brainstorm, not an oracle. It shows ten names at a time;
 * the person likes some and locks the ones they really like, and the next ten
 * are drawn from those (packages/model/src/namegen.ts), until something fits.
 * The tool never ranks or suggests; every batch, like, lock and choice is
 * recorded with the time in namings/<id>.json.
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
            const chosen = n.value?.chosen as string | undefined
            const rounds = (n.value?.rounds as unknown[] | undefined)?.length ?? 0
            return (
              <li key={n.id}>
                <button
                  className={n.id === naming?.id ? 'list-item is-current' : 'list-item'}
                  onClick={() => setNamingId(n.id)}
                  data-naming={n.id}
                >
                  <span>{String(n.value?.name ?? n.id)}</span>
                  <span className="muted small">
                    {n.value
                      ? chosen
                        ? `→ ${chosen}`
                        : rounds
                          ? `${rounds} batch${rounds === 1 ? '' : 'es'}`
                          : 'not started'
                      : 'has errors'}
                  </span>
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
              A brainstorm for a name, ten at a time. Like the ones that are close, lock the ones you love, and the next ten are drawn from
              them: words near the ones you liked, new names built from their sounds, and pairs of them. A few rounds in, something should
              fit. Nothing is ranked or suggested, and every round is recorded with the name. Start one for whatever needs naming.
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
  const [explored, setExplored] = useState<ExploreResult | { error: string } | null>(null)
  const active = file.concepts.filter((c) => c.senses.length)
  const query = JSON.stringify({ concepts: active.map((c) => ({ word: c.word, senses: c.senses.map((s) => s.id) })), ...file.links })
  useEffect(() => {
    if (!active.length) {
      setExplored(null)
      return
    }
    let live = true
    const q = JSON.parse(query) as { concepts: { word: string; senses: string[] }[]; groups: LinkGroup[]; depth: number; defined: boolean }
    void window.malevo.names
      .explore({ concepts: q.concepts, links: q.groups, depth: q.depth, defined: q.defined })
      .then((r) => live && setExplored(r))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])
  const [setupOpen, setSetupOpen] = useState(!file.rounds.length)

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
      <details className="naming-setup" open={setupOpen} onToggle={(e) => setSetupOpen((e.target as HTMLDetailsElement).open)}>
        <summary>Where names come from</summary>
        <Sources file={file} change={change} />
        {file.sources.includes('words') && (
          <>
            <Concepts file={file} change={change} />
            <Links file={file} change={change} />
            <Narrow file={file} change={change} explored={explored} />
          </>
        )}
        {file.sources.includes('sounds') && <Examples file={file} change={change} />}
      </details>
      <Batch file={file} change={change} snapshot={snapshot} />
      <Rounds file={file} />
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

const SOURCE_LABELS: Record<NameSource, { label: string; hint: string }> = {
  words: { label: 'Words', hint: 'Words from the word list, near the senses you tick and near the names you like' },
  sounds: { label: 'Invented', hint: 'New names built from the letters of names you like and your example names' },
  pairs: { label: 'Pairs', hint: 'Two names you liked together: “A B”, “A of B”, “The A B”' }
}

function Sources({ file, change }: { file: NamingFile; change: Change }): React.JSX.Element {
  return (
    <div className="checks naming-sources">
      <span>Draw from:</span>
      {NAME_SOURCES.map((src) => (
        <label key={src} title={SOURCE_LABELS[src].hint}>
          <input
            type="checkbox"
            checked={file.sources.includes(src)}
            onChange={(e) => {
              const sources = e.target.checked
                ? NAME_SOURCES.filter((x) => x === src || file.sources.includes(x))
                : file.sources.filter((x) => x !== src)
              change(
                { sources },
                'sources',
                `Drawing from: ${sources.map((x) => SOURCE_LABELS[x].label.toLowerCase()).join(', ') || 'nothing'}.`
              )
            }}
            data-source={src}
          />
          {SOURCE_LABELS[src].label}
        </label>
      ))}
    </div>
  )
}

function Narrow({
  file,
  change,
  explored
}: {
  file: NamingFile
  change: Change
  explored: ExploreResult | { error: string } | null
}): React.JSX.Element {
  const n = file.narrow
  const words = useMemo(() => (explored && !('error' in explored) ? explored.words : []), [explored])
  const categories = useMemo(() => [...new Set(words.flatMap((w) => w.senses.map((s) => s.category)))].sort(), [words])
  const inReach = words.filter((w) => passesNarrow(w, n)).length
  const setNarrow = (x: NamingFile['narrow'], text: string): void => {
    const clean = { ...x } as Record<string, unknown>
    for (const k of Object.keys(clean))
      if (clean[k] === undefined || clean[k] === false || (Array.isArray(clean[k]) && !(clean[k] as unknown[]).length)) delete clean[k]
    change({ narrow: clean as NamingFile['narrow'] }, 'narrow', text)
  }
  return (
    <div className="naming-narrow">
      <h3>Which words</h3>
      <div className="field-row narrow-row">
        <div className="checks">
          {(Object.keys(POS_LABELS) as Pos[]).map((p) => (
            <label key={p}>
              <input
                type="checkbox"
                checked={n.pos?.includes(p) ?? false}
                onChange={(e) => {
                  const pos = e.target.checked ? [...(n.pos ?? []), p] : (n.pos ?? []).filter((x) => x !== p)
                  setNarrow({ ...n, pos }, pos.length ? `Only ${pos.map((x) => POS_LABELS[x]).join(', ')}.` : 'Any part of speech.')
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
              onChange={(e) => setNarrow({ ...n, singleWords: e.target.checked }, e.target.checked ? 'Single words only.' : 'Phrases too.')}
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
                      categories.length ? `Only kinds: ${categories.map(categoryLabel).join(', ')}.` : 'Any kind of thing.'
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
      <p className="muted small" id="wordsInReach">
        {!file.concepts.some((c) => c.senses.length)
          ? 'Tick a sense of a word above for words to draw on.'
          : !explored
            ? 'Looking… (the first time takes a few seconds)'
            : 'error' in explored
              ? explored.error
              : `${inReach} of ${words.length} words in reach${explored.capped.length ? ' (some neighbourhoods were cut short: fewer links out?)' : ''}.`}
      </p>
    </div>
  )
}

function Examples({ file, change }: { file: NamingFile; change: Change }): React.JSX.Element {
  const shown = (file.examples ?? []).join(', ')
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])
  return (
    <label className="field">
      Names that sound right, for invented names (optional, comma-separated)
      <input
        id="namingExamples"
        value={draft}
        placeholder="Aldren, Corvane, Mirel…"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const list = draft
            .split(/[,\n]/)
            .map((x) => x.trim())
            .filter(Boolean)
          if (list.join(', ') === shown) return
          change(
            { examples: list.length ? list : undefined },
            'examples',
            list.length ? `Example names: ${list.join(', ')}.` : 'No example names.'
          )
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  )
}

const sourceTag = (s: string): string => (s === 'locked' ? 'locked' : (SOURCE_LABELS[s as NameSource]?.label.toLowerCase() ?? s))

function Batch({ file, change, snapshot }: { file: NamingFile; change: Change; snapshot: WorldSnapshot }): React.JSX.Element {
  const round = file.rounds[file.rounds.length - 1] ?? null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inUse = useMemo(() => namesInUse(snapshot), [snapshot])

  const next = async (): Promise<void> => {
    setError(null)
    const locked = round?.locked ?? []
    const liked = round ? [...new Set([...round.locked, ...round.liked])] : []
    const earlier = [...new Set(file.rounds.slice(0, -1).flatMap((r) => [...r.locked, ...r.liked]))].filter((x) => !liked.includes(x))
    const seed = Math.floor(Math.random() * 2 ** 31)
    setBusy(true)
    const made = await window.malevo.names.batch({
      count: Math.max(5, 10 - locked.length),
      sources: file.sources,
      seed,
      concepts: file.concepts.filter((c) => c.senses.length).map((c) => ({ word: c.word, senses: c.senses.map((s) => s.id) })),
      links: file.links.groups,
      depth: file.links.depth,
      defined: file.links.defined,
      narrow: file.narrow,
      examples: file.examples ?? [],
      liked,
      earlier,
      exclude: file.rounds.flatMap((r) => r.names.map((x) => x.text))
    })
    setBusy(false)
    if ('error' in made) return setError(made.error)
    if (!made.length)
      return setError(
        'Nothing to draw from yet: tick a sense of a word (for words), write a few example names (for invented names), or like a couple of names (for pairs).'
      )
    const carried = locked.map((text) => {
      const prev = round?.names.find((x) => x.text === text)
      return {
        text,
        source: 'locked' as const,
        from: prev ? (prev.source === 'locked' ? prev.from : `${sourceTag(prev.source)}: ${prev.from}`) : ''
      }
    })
    const k = file.rounds.length + 1
    change(
      { rounds: [...file.rounds, { at: now(), seed, names: [...carried, ...made], liked: [], locked }] },
      'batch',
      `Batch ${k}: ${made.map((x) => x.text).join(', ')}.` +
        (liked.length ? ` Drawn from ${liked.join(', ')}.` : '') +
        (locked.length ? ` Locked: ${locked.join(', ')}.` : '')
    )
  }

  const setRound = (patch: Partial<NamingFile['rounds'][number]>, step: NamingStep, text: string): void =>
    change({ rounds: [...file.rounds.slice(0, -1), { ...round!, ...patch }] }, step, text)

  return (
    <div className="naming-batch">
      <h3>{round ? `Batch ${file.rounds.length}` : 'Names'}</h3>
      {file.chosen && (
        <div className="naming-chosen" id="namingChosen">
          <span>
            Chosen: <strong>{file.chosen}</strong>
          </span>
          <NoteField
            value={file.note}
            placeholder="why…"
            onCommit={(note) => change({ note }, 'note', note ? `Note: ${note}` : 'Note removed.')}
          />
        </div>
      )}
      {round && (
        <div className="batch" id="batch">
          {round.names.map((x) => {
            const liked = round.liked.includes(x.text)
            const locked = round.locked.includes(x.text)
            const chosen = file.chosen === x.text
            const used = inUse.get(x.text.toLowerCase())
            return (
              <div
                className={`name-card${liked ? ' liked' : ''}${locked ? ' locked' : ''}${chosen ? ' chosen' : ''}`}
                key={x.text}
                data-name={x.text}
              >
                <div className="name-text">{x.text}</div>
                <div className="muted small name-from" title={x.from}>
                  {sourceTag(x.source)}: {x.from}
                </div>
                {used && <div className="warn small">also: {used.join(', ')}</div>}
                <div className="card-actions">
                  <button
                    className={liked ? 'on' : ''}
                    data-act="like"
                    title="Draw the next batch from this"
                    onClick={() =>
                      setRound(
                        { liked: liked ? round.liked.filter((t) => t !== x.text) : [...round.liked, x.text] },
                        liked ? 'unlike' : 'like',
                        `${liked ? 'Un-liked' : 'Liked'} “${x.text}”.`
                      )
                    }
                  >
                    ♥ Like
                  </button>
                  <button
                    className={locked ? 'on' : ''}
                    data-act="lock"
                    title="Keep this in every batch from now on"
                    onClick={() =>
                      setRound(
                        { locked: locked ? round.locked.filter((t) => t !== x.text) : [...round.locked, x.text] },
                        locked ? 'unlock' : 'lock',
                        `${locked ? 'Unlocked' : 'Locked'} “${x.text}”.`
                      )
                    }
                  >
                    🔒 Lock
                  </button>
                  <button
                    className={chosen ? 'on' : ''}
                    data-act="choose"
                    title="This is the name"
                    onClick={() =>
                      change({ chosen: chosen ? undefined : x.text }, 'choose', chosen ? `Un-chose “${x.text}”.` : `Chose “${x.text}”.`)
                    }
                  >
                    ✓ Choose
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div className="field-row batch-row">
        <button className="primary" onClick={() => void next()} disabled={busy || !file.sources.length} id="nextBatch">
          {busy ? 'Drawing…' : round ? 'Next ten' : 'First ten'}
        </button>
        <span className="muted small">
          {round
            ? `${round.liked.length} liked, ${round.locked.length} locked: the next batch keeps the locked ones and draws on both.`
            : 'Set up where names come from above, then draw the first ten.'}
        </span>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  )
}

function Rounds({ file }: { file: NamingFile }): React.JSX.Element | null {
  const earlier = file.rounds.slice(0, -1)
  if (!earlier.length) return null
  return (
    <details className="naming-rounds" id="namingRounds">
      <summary>Earlier batches ({earlier.length})</summary>
      <ol>
        {earlier.map((r, i) => (
          <li key={i}>
            <span className="muted small">{new Date(r.at).toLocaleString()}</span>{' '}
            {r.names.map((x, j) => (
              <span key={x.text} className={r.locked.includes(x.text) ? 'locked' : r.liked.includes(x.text) ? 'liked' : ''}>
                {j ? ', ' : ''}
                {x.text}
                {r.locked.includes(x.text) ? ' 🔒' : r.liked.includes(x.text) ? ' ♥' : ''}
              </span>
            ))}
          </li>
        ))}
      </ol>
    </details>
  )
}

function NoteField({
  value,
  onCommit,
  placeholder
}: {
  value: string | undefined
  onCommit(v: string | undefined): void
  placeholder?: string
}): React.JSX.Element {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  return (
    <input
      className="note"
      value={draft}
      placeholder={placeholder ?? 'note…'}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== (value ?? '') && onCommit(draft.trim() || undefined)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
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
