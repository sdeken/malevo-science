/**
 * String ordering by UTF-16 code unit. Unlike localeCompare, the result never
 * depends on the machine's locale or ICU version, so anything sorted with it
 * (file lists, ids, generator inputs) comes out the same everywhere.
 */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
