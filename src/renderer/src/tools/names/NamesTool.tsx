import { useEffect, useMemo, useState } from 'react'
import { LEX_FILES, LINK_GROUP_NAMES, newNaming, type LinkGroup, type NamingFile, type Sense } from '@malevo/model'
import type { WorldSnapshot } from '../../../../shared/types'
import { NumberField, TextField } from '../../components/fields'
import { slugId, useWorldPref } from '../../state'
import type { ToolDefinition, ToolProps } from '../registry'

/**
 * The Names tool: a brainstorm with no smarts. It shows twelve names a round:
 * words from the word list, or people's names and made-up names by sound.
 * The person rates each (hate, neutral, like, love), and the ratings tip the
 * odds of the next round toward names like the liked ones and away from the
 * hated ones (packages/model/src/namegen.ts). It never writes, combines or
 * picks a name. The person settles on a name, from the rounds or not, and
 * namings/<id>.json keeps the transcript: each round as shown, with its
 * ratings, and the name settled on.
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
            const chosen = (n.value?.chosen as { text?: string } | undefined)?.text
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
                          ? `${rounds} round${rounds === 1 ? '' : 's'}`
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
              Twelve names a round. Rate each one (hate it, like it, love it, or leave it be) and the next twelve lean toward names like the ones
              you liked and away from the ones you hated. Words come from a dictionary, by meaning; people’s names come from lists of real
              given and family names and from made-up names, by sound. The tool never writes or picks a name; you settle on one, from the
              rounds or not, and the session keeps a transcript of every round and your ratings.
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
  const [mode, setMode] = useState<'words' | 'sounds'>('words')
  return (
    <form
      className="new-naming"
      onSubmit={(e) => {
        e.preventDefault()
        const id = slugId(
          name,
          snapshot.namings.map((s) => s.id)
        )
        void window.malevo.world.setEntity('naming', id, newNaming(name.trim(), mode)).then(() => onMade(id))
        setName('')
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Something to name…" id="newNamingName" />
      <div className="field-row tight">
        <select value={mode} onChange={(e) => setMode(e.target.value as 'words' | 'sounds')} id="newNamingMode">
          <option value="words">Words</option>
          <option value="sounds">People’s names</option>
        </select>
        <button type="submit" disabled={!name.trim()} id="newNaming">
          Start
        </button>
      </div>
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
  return what === 'all' || what === 'Tops'
    ? `${pos} (general)`
    : what === 'pert'
      ? 'relational (adj)'
      : what === 'ppl'
        ? 'participle (adj)'
        : `${what}`
}
const POS_OF_FILE: Record<string, Pos> = { noun: 'n', verb: 'v', adj: 'a', adv: 'r' }

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
    ['city', snapshot.cities]
  ]
  for (const [kind, list] of kinds) for (const e of list) add(e.value?.name, `${kind} ${e.id}`)
  for (const r of snapshot.routes) add((r as unknown as { name?: string }).name, `route ${r.id}`)
  for (const c of snapshot.characters) {
    add(c.name, `character ${c.id}`)
    for (const n of c.names) add(n.name, `character ${c.id}`)
  }
  return out
}

type Save = (next: NamingFile) => void

function Naming({ id, file, snapshot }: { id: string; file: NamingFile; snapshot: WorldSnapshot }): React.JSX.Element {
  const save: Save = (next) => {
    const clean = JSON.parse(JSON.stringify(next)) as NamingFile
    void window.malevo.world.setEntity('naming', id, clean)
  }
  const [setupOpen, setSetupOpen] = useState(!file.rounds.length)
  /** What each shown name is (a definition, "given name · German"): for this sitting only, not stored. */
  const [notes, setNotes] = useState<Record<string, string>>({})
  return (
    <section className="naming" id="naming">
      <div className="field-row">
        <TextField label="Naming" value={file.name} onCommit={(v) => v.trim() && save({ ...file, name: v.trim() })} id="namingName" />
        <label className="field">
          Draw
          <select value={file.mode} onChange={(e) => save({ ...file, mode: e.target.value as 'words' | 'sounds' })} id="namingMode">
            <option value="words">Words, by meaning</option>
            <option value="sounds">People’s names, by sound</option>
          </select>
        </label>
      </div>
      <details className="naming-setup" open={setupOpen} onToggle={(e) => setSetupOpen((e.target as HTMLDetailsElement).open)}>
        <summary>Where names come from</summary>
        {file.mode === 'words' ? <WordsSetup file={file} save={save} /> : <SoundsSetup file={file} save={save} />}
        <Slider
          label="Lean"
          left="wander"
          right="stay close to what I liked"
          value={file.focus}
          onCommit={(focus) => save({ ...file, focus })}
          id="namingFocus"
        />
      </details>
      <Round file={file} save={save} snapshot={snapshot} notes={notes} setNotes={setNotes} />
      <Settle file={file} save={save} />
      <Transcript file={file} />
    </section>
  )
}

function Slider({
  label,
  left,
  right,
  value,
  onCommit,
  id
}: {
  label: string
  left: string
  right: string
  value: number
  onCommit(v: number): void
  id?: string
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = (): void => {
    if (draft !== value) onCommit(draft)
  }
  return (
    <label className="field slider-field">
      {label}
      <span className="slider">
        <span className="muted small">{left}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={draft}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          id={id}
        />
        <span className="muted small">{right}</span>
      </span>
    </label>
  )
}

function WordsSetup({ file, save }: { file: NamingFile; save: Save }): React.JSX.Element {
  const w = file.words
  const set = (patch: Partial<NamingFile['words']>): void => save({ ...file, words: { ...w, ...patch } })
  const categories = LEX_FILES.filter((c) => {
    const p = POS_OF_FILE[c.split('.')[0]]
    return (!w.pos.length || w.pos.includes(p)) && c !== 'noun.Tops'
  })
  return (
    <div className="words-setup">
      <Concepts file={file} set={set} />
      <div className="checks">
        <span>Follow:</span>
        <span className="muted small">synonyms always</span>
        {LINK_GROUP_NAMES.map((g) => (
          <label key={g}>
            <input
              type="checkbox"
              checked={w.links.includes(g)}
              onChange={(e) => set({ links: e.target.checked ? [...w.links, g] : w.links.filter((x) => x !== g) })}
              data-link={g}
            />
            {LINK_LABELS[g]}
          </label>
        ))}
        <label title="Words whose definition uses a word you looked up">
          <input type="checkbox" checked={w.defined} onChange={(e) => set({ defined: e.target.checked })} data-link="defined" />
          Defined using
        </label>
        <NumberField
          label="Links out"
          value={w.depth}
          onCommit={(x) => x !== undefined && x >= 1 && x <= 3 && set({ depth: Math.round(x) })}
          id="linkDepth"
        />
      </div>
      <div className="checks">
        <span>Only:</span>
        {(Object.keys(POS_LABELS) as Pos[]).map((p) => (
          <label key={p}>
            <input
              type="checkbox"
              checked={w.pos.includes(p)}
              onChange={(e) => set({ pos: e.target.checked ? [...w.pos, p] : w.pos.filter((x) => x !== p) })}
              data-pos={p}
            />
            {POS_LABELS[p]}
          </label>
        ))}
        <label>
          <input type="checkbox" checked={w.singleWords} onChange={(e) => set({ singleWords: e.target.checked })} id="singleWords" />
          single words
        </label>
      </div>
      <details className="categories">
        <summary>Kinds of thing{w.categories.length ? `: ${w.categories.map(categoryLabel).join(', ')}` : ' (any)'}</summary>
        <div className="checks">
          {categories.map((c) => (
            <label key={c}>
              <input
                type="checkbox"
                checked={w.categories.includes(c)}
                onChange={(e) => set({ categories: e.target.checked ? [...w.categories, c] : w.categories.filter((x) => x !== c) })}
                data-category={c}
              />
              {categoryLabel(c)}
            </label>
          ))}
        </div>
      </details>
      <div className="field-row">
        <NumberField
          label="Letters, at least"
          value={w.minLetters}
          optional
          onCommit={(x) => set({ minLetters: x && x > 0 ? Math.round(x) : undefined })}
        />
        <NumberField
          label="at most"
          value={w.maxLetters}
          optional
          onCommit={(x) => set({ maxLetters: x && x > 0 ? Math.round(x) : undefined })}
        />
        <Slider label="Liked by" left="meaning" right="sound" value={w.sound} onCommit={(sound) => set({ sound })} id="wordsSound" />
      </div>
      <p className="muted small">
        With no word looked up, every word that passes these filters is in play. Rating a word pulls in the words near it in the dictionary.
      </p>
    </div>
  )
}

function Concepts({ file, set }: { file: NamingFile; set(patch: Partial<NamingFile['words']>): void }): React.JSX.Element {
  const concepts = file.words.concepts
  const [word, setWord] = useState('')
  const [senses, setSenses] = useState<Record<string, Sense[] | string>>({})
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    for (const c of concepts)
      if (!senses[c.word])
        void window.malevo.names.senses(c.word).then((r) => setSenses((s) => ({ ...s, [c.word]: 'error' in r ? r.error : r.senses })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concepts.length])
  return (
    <div className="naming-concepts">
      <form
        className="field-row tight"
        onSubmit={(e) => {
          e.preventDefault()
          const w = word.trim().toLowerCase()
          if (!w || concepts.some((c) => c.word === w)) return
          void window.malevo.names.senses(w).then((r) => {
            setSenses((s) => ({ ...s, [w]: 'error' in r ? r.error : r.senses }))
            set({ concepts: [...concepts, { word: w, senses: [] }] })
            setOpen(w)
          })
          setWord('')
        }}
      >
        <label className="field grow">
          Words for what it means (optional)
          <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="slow, dumb, sweet…" id="conceptWord" />
        </label>
        <button type="submit" disabled={!word.trim()} id="addConcept">
          Look up
        </button>
      </form>
      {concepts.map((c, ci) => {
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
              <button className="small" onClick={() => set({ concepts: concepts.filter((_, i) => i !== ci) })}>
                Remove
              </button>
            </div>
            {isOpen &&
              (typeof list === 'string' ? (
                <p className="muted small">{list}</p>
              ) : !list ? (
                <p className="muted small">…</p>
              ) : !list.length ? (
                <p className="muted small">Not in the dictionary.</p>
              ) : (
                <ul className="senses">
                  {list.map((s) => (
                    <li key={s.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={chosen.has(s.id)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...c.senses, { id: s.id, words: s.words, gloss: s.gloss }]
                              : c.senses.filter((x) => x.id !== s.id)
                            set({ concepts: concepts.map((x, i) => (i === ci ? { ...x, senses: next } : x)) })
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

type Locale = { id: string; label: string; given: number; family: number }

function SoundsSetup({ file, save }: { file: NamingFile; save: Save }): React.JSX.Element {
  const s = file.sounds
  const set = (patch: Partial<NamingFile['sounds']>): void => save({ ...file, sounds: { ...s, ...patch } })
  const [locales, setLocales] = useState<Locale[] | string | null>(null)
  useEffect(() => {
    void window.malevo.names.locales().then((r) => setLocales('error' in r ? r.error : r.locales))
  }, [])
  return (
    <div className="sounds-setup">
      <div className="checks">
        <span>Names:</span>
        <label>
          <input type="checkbox" checked={s.given} onChange={(e) => set({ given: e.target.checked })} id="soundsGiven" />
          given
        </label>
        <label>
          <input type="checkbox" checked={s.family} onChange={(e) => set({ family: e.target.checked })} id="soundsFamily" />
          family
        </label>
        <select value={s.gender} onChange={(e) => set({ gender: e.target.value as 'any' | 'female' | 'male' })} id="soundsGender">
          <option value="any">any given names</option>
          <option value="female">feminine given names</option>
          <option value="male">masculine given names</option>
        </select>
      </div>
      <details className="categories" open={!s.locales.length}>
        <summary>
          Languages:{' '}
          {s.locales.length
            ? s.locales.map((id) => (Array.isArray(locales) ? (locales.find((l) => l.id === id)?.label ?? id) : id)).join(', ')
            : 'none'}
        </summary>
        {typeof locales === 'string' ? (
          <p className="error small">{locales}</p>
        ) : !locales ? (
          <p className="muted small">…</p>
        ) : (
          <div className="checks">
            {locales.map((l) => (
              <label key={l.id} title={`${l.given} given, ${l.family} family names`}>
                <input
                  type="checkbox"
                  checked={s.locales.includes(l.id)}
                  onChange={(e) => set({ locales: e.target.checked ? [...s.locales, l.id] : s.locales.filter((x) => x !== l.id) })}
                  data-locale={l.id}
                />
                {l.label}
              </label>
            ))}
          </div>
        )}
      </details>
      <div className="field-row">
        <NumberField
          label="Letters, at least"
          value={s.minLetters}
          optional
          onCommit={(x) => set({ minLetters: x && x > 0 ? Math.round(x) : undefined })}
        />
        <NumberField
          label="at most"
          value={s.maxLetters}
          optional
          onCommit={(x) => set({ maxLetters: x && x > 0 ? Math.round(x) : undefined })}
        />
        <Slider label="Made up" left="none" right="all" value={s.invented} onCommit={(invented) => set({ invented })} id="soundsInvented" />
      </div>
      <p className="muted small">
        Made-up names follow the letter patterns of the names in play and of the ones you liked. Likeness is in the letters (pairs of
        letters, how a name starts and ends, its vowels and consonants, its length), not in meaning.
      </p>
    </div>
  )
}

const RATE_BUTTONS: { rating: 'hate' | 'like' | 'love'; label: string; title: string }[] = [
  { rating: 'hate', label: '✕ Hate', title: 'Fewer like this' },
  { rating: 'like', label: '+ Like', title: 'More like this' },
  { rating: 'love', label: '♥ Love', title: 'A real candidate: many more like this' }
]

function Round({
  file,
  save,
  snapshot,
  notes,
  setNotes
}: {
  file: NamingFile
  save: Save
  snapshot: WorldSnapshot
  notes: Record<string, string>
  setNotes(f: (n: Record<string, string>) => Record<string, string>): void
}): React.JSX.Element {
  const round = file.rounds[file.rounds.length - 1] ?? null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inUse = useMemo(() => namesInUse(snapshot), [snapshot])

  const next = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    const w = file.words
    const made = await window.malevo.names.round({
      mode: file.mode,
      count: 12,
      seed: Math.floor(Math.random() * 2 ** 31),
      focus: file.focus,
      words: { ...w, concepts: w.concepts.map((c) => ({ word: c.word, senses: c.senses.map((s) => s.id) })) },
      sounds: file.sounds,
      rated: file.rounds.flatMap((r) => r.names)
    })
    setBusy(false)
    if ('error' in made) return setError(made.error)
    if (!made.length)
      return setError(
        file.mode === 'words'
          ? 'No words pass these settings: loosen the filters, or tick a sense of a word you looked up.'
          : 'No names pass these settings: pick a language, or allow more letters.'
      )
    setNotes((n) => ({ ...n, ...Object.fromEntries(made.map((x) => [x.text, x.note])) }))
    save({
      ...file,
      rounds: [...file.rounds, { at: now(), mode: file.mode, names: made.map((x) => ({ text: x.text, rating: 'neutral' as const })) }]
    })
  }
  const rate = (i: number, rating: NamingFile['rounds'][number]['names'][number]['rating']): void => {
    const names = round!.names.map((x, j) => (j === i ? { ...x, rating } : x))
    save({ ...file, rounds: [...file.rounds.slice(0, -1), { ...round!, names }] })
  }

  return (
    <div className="naming-round">
      <h3>{round ? `Round ${file.rounds.length}` : 'Names'}</h3>
      {round && (
        <div className="batch" id="batch">
          {round.names.map((x, i) => {
            const used = inUse.get(x.text.toLowerCase())
            return (
              <div className={`name-card ${x.rating}`} key={x.text} data-name={x.text}>
                <div className="name-text">{x.text}</div>
                {notes[x.text] && (
                  <div className="muted small name-note" title={notes[x.text]}>
                    {notes[x.text]}
                  </div>
                )}
                {used && <div className="warn small">also: {used.join(', ')}</div>}
                <div className="card-actions">
                  {RATE_BUTTONS.map((b) => (
                    <button
                      key={b.rating}
                      className={`rate-${b.rating}${x.rating === b.rating ? ' on' : ''}`}
                      title={b.title}
                      data-rate={b.rating}
                      onClick={() => rate(i, x.rating === b.rating ? 'neutral' : b.rating)}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div className="field-row batch-row">
        <button className="primary" onClick={() => void next()} disabled={busy} id="nextRound">
          {busy ? 'Drawing…' : round ? 'Next twelve' : 'First twelve'}
        </button>
        <span className="muted small">
          {round
            ? 'Every rating so far tips the next twelve: love pulls hardest, hate pushes away, unrated names do nothing.'
            : 'Set up where names come from, then draw the first twelve.'}
        </span>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  )
}

function Settle({ file, save }: { file: NamingFile; save: Save }): React.JSX.Element {
  const loved = file.rounds.flatMap((r) => r.names.filter((x) => x.rating === 'love').map((x) => x.text))
  const [text, setText] = useState('')
  return (
    <div className="naming-settle" id="settle">
      <h3>Settle on a name</h3>
      {file.chosen ? (
        <p id="namingChosen">
          Settled on <strong>{file.chosen.text}</strong> <span className="muted small">{new Date(file.chosen.at).toLocaleString()}</span>{' '}
          <button className="link" onClick={() => save({ ...file, chosen: undefined })}>
            unsettle
          </button>
        </p>
      ) : (
        <>
          {loved.length > 0 && (
            <div className="loved">
              <span className="muted small">Loved:</span>
              {loved.map((t) => (
                <button key={t} className="link" onClick={() => setText(t)}>
                  {t}
                </button>
              ))}
            </div>
          )}
          <form
            className="field-row tight"
            onSubmit={(e) => {
              e.preventDefault()
              if (text.trim()) save({ ...file, chosen: { text: text.trim(), at: now() } })
              setText('')
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Any name, from the rounds or not…" id="chosenText" />
            <button type="submit" disabled={!text.trim()} id="settleName">
              Settle on it
            </button>
          </form>
        </>
      )}
    </div>
  )
}

const MARK: Record<string, string> = { neutral: '', hate: ' ✕', like: ' +', love: ' ♥' }

/** The transcript as plain text: each round with its ratings, and the name settled on. */
function transcriptText(file: NamingFile): string {
  const lines = [`# ${file.name}`, '']
  file.rounds.forEach((r, i) => {
    lines.push(
      `Round ${i + 1} (${r.mode === 'words' ? 'words' : 'people’s names'}, ${r.at}): ${r.names.map((x) => x.text + MARK[x.rating]).join(', ')}`
    )
  })
  lines.push('', file.chosen ? `Settled on: ${file.chosen.text} (${file.chosen.at})` : 'Not settled yet.', '', '✕ hate · + like · ♥ love')
  return lines.join('\n')
}

function Transcript({ file }: { file: NamingFile }): React.JSX.Element | null {
  if (!file.rounds.length) return null
  return (
    <details className="naming-transcript" id="namingTranscript">
      <summary>
        Transcript ({file.rounds.length} round{file.rounds.length === 1 ? '' : 's'})
      </summary>
      <ol>
        {file.rounds.map((r, i) => (
          <li key={i}>
            <span className="muted small">{new Date(r.at).toLocaleString()}</span>{' '}
            {r.names.map((x, j) => (
              <span key={x.text} className={`rated-${x.rating}`}>
                {j ? ', ' : ''}
                {x.text}
                {MARK[x.rating]}
              </span>
            ))}
          </li>
        ))}
      </ol>
      <p>
        {file.chosen ? (
          <>
            Settled on <strong>{file.chosen.text}</strong>.
          </>
        ) : (
          <span className="muted">Not settled yet.</span>
        )}
      </p>
      <button onClick={() => void navigator.clipboard.writeText(transcriptText(file))} id="copyTranscript">
        Copy transcript
      </button>
    </details>
  )
}

export const namesTool: ToolDefinition = {
  id: 'names',
  title: 'Names',
  description: 'Rounds of twelve names, tipped by your ratings; a transcript of how you got to one',
  View: NamesView
}
