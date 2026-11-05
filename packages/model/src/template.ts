/**
 * The files every new world starts with (packages/model/template/). They are
 * validated against their schemas and written in canonical form.
 */
import gregorian from '../template/calendars/gregorian.json'
import physics from '../template/settings/physics.json'
import stars from '../template/settings/stars.json'
import { calendarKind, entityPath, physicsKind, starfieldKind, type KindDef } from './kinds'
import { serializeEntity } from './load'
import { parseWith } from './schema'

const TEMPLATE: { kind: KindDef; id: string; value: unknown }[] = [
  { kind: physicsKind as KindDef, id: 'physics', value: physics },
  { kind: starfieldKind as KindDef, id: 'starfield', value: stars },
  { kind: calendarKind as KindDef, id: 'gregorian', value: gregorian }
]

/** The template's files, canonical. Throws if a template file does not match its schema (a build error, caught by tests). */
export function templateFiles(): { path: string; text: string }[] {
  return TEMPLATE.map(({ kind, id, value }) => {
    const parsed = parseWith(kind.schema, value)
    if (parsed.value === undefined || parsed.issues.some((i) => i.severity === 'error')) {
      throw new Error(`Template file ${entityPath(kind, id)} does not match its schema: ${parsed.issues.map((i) => i.message).join(' ')}`)
    }
    return { path: entityPath(kind, id), text: serializeEntity(kind, parsed.value) }
  })
}
