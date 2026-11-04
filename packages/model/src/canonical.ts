/**
 * Canonical JSON text for world files (docs/PLAN.md §3.5).
 *
 * Phase 0 needs only the basics: keys in the order the caller built the
 * object (callers build objects in schema order), two-space indent, LF line
 * endings and a trailing newline. Per-field numeric precision and compact
 * number arrays arrive with the schemas in Phase 1.
 */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}
