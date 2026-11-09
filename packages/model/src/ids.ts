/**
 * Ids that come from names. Files are named after ids, so an entity created as
 * "New event" lives in new-event.json until its id follows a new name.
 */

/** A readable id from a name: "Federated Stellar Nations" → "federated-stellar-nations". */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'item'
  )
}

/** The slug of a name, unique among `taken`: "accord-charter", then "accord-charter-2". */
export function uniqueSlug(name: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = slugify(name)
  if (!used.has(base)) return base
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`
}

/** Whether an id was made from this name (its slug, maybe with a "-2" on the end), so it should follow a rename. */
export function idFromName(id: string, name: string): boolean {
  const base = slugify(name)
  return id === base || new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`).test(id)
}
