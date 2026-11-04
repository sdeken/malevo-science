/**
 * Script calendars run here (docs/PLAN.md §5.2), in a node:vm context:
 *
 * - no require, process, file, network or timer access: the context starts
 *   with only JavaScript's built-ins;
 * - no clock or randomness: Date is removed and Math.random throws, so a
 *   script is as deterministic as a generator;
 * - no eval or new Function inside the context;
 * - every call has a time limit, and its result crosses back as JSON text,
 *   so no sandbox object (or getter) ever runs outside the time limit.
 *
 * vm is not a security boundary against hostile code; it does not need to
 * be. These are the author's own scripts, and the point is that a calendar
 * cannot accidentally depend on anything but its input.
 *
 * A script assigns its functions to `module.exports`:
 *
 *   module.exports = {
 *     toFields(t, h) { ... return { year, month, day, hour, minute, second } },
 *     fromFields(f, h) { ... return t },
 *     yearLabel(year, h) { return `${year} PE` },        // optional
 *     parseYearLabel(text, h) { ... return year | null } // optional
 *   }
 *
 * `t` is seconds since J2000.0. `h` offers helpers: DAY, floorDiv,
 * daysFromCivil, civilFromDays, and gregorian.toFields / fromFields, so a
 * calendar can be "Gregorian, but counted our way" in a few lines.
 */
import vm from 'node:vm'
import type { Fields, ScriptCalendarImpl } from '@malevo/core'

export interface SandboxOptions {
  /** Time limit per call, ms. */
  timeoutMs?: number
}

export class ScriptError extends Error {}

// Helpers defined *inside* the context, as source, so nothing from the host realm is reachable from a script.
const PRELUDE = `
'use strict';
Object.defineProperty(Math, 'random', { value: function () { throw new Error('Math.random is not available in a calendar script; calendars must be deterministic.') } });
delete globalThis.Date;
var module = { exports: {} };
var exports = module.exports;
var __h = (function () {
  var DAY = 86400;
  function floorDiv(a, b) { return Math.floor(a / b); }
  function daysFromCivil(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    var era = floorDiv(y, 400), yoe = y - era * 400;
    var doy = floorDiv(153 * (m + (m > 2 ? -3 : 9)) + 2, 5) + d - 1;
    var doe = yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy;
    return era * 146097 + doe - 719468;
  }
  function civilFromDays(z) {
    z += 719468;
    var era = floorDiv(z, 146097), doe = z - era * 146097;
    var yoe = floorDiv(doe - floorDiv(doe, 1460) + floorDiv(doe, 36524) - floorDiv(doe, 146096), 365);
    var doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100));
    var mp = floorDiv(5 * doy + 2, 153), d = doy - floorDiv(153 * mp + 2, 5) + 1, m = mp + (mp < 10 ? 3 : -9);
    return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
  }
  var gregorian = Object.freeze({
    toFields: function (t) {
      var s = t + DAY / 2, di = Math.floor(s / DAY), sec = s - di * DAY, c = civilFromDays(10957 + di);
      var hour = Math.floor(sec / 3600), minute = Math.floor((sec - hour * 3600) / 60);
      return { year: c[0], month: c[1], day: c[2], hour: hour, minute: minute, second: sec - hour * 3600 - minute * 60 };
    },
    fromFields: function (f) {
      var m0 = (f.month == null ? 1 : f.month) - 1, y = (f.year || 0) + floorDiv(m0, 12), m = m0 - floorDiv(m0, 12) * 12 + 1;
      var days = daysFromCivil(y, m, 1) + (f.day == null ? 1 : f.day) - 1 - 10957;
      return days * DAY + (f.hour || 0) * 3600 + (f.minute || 0) * 60 + (f.second || 0) - DAY / 2;
    }
  });
  return Object.freeze({ DAY: DAY, floorDiv: floorDiv, daysFromCivil: daysFromCivil, civilFromDays: civilFromDays, gregorian: gregorian });
})();
function __call(op, argJson) {
  try {
    var impl = module.exports;
    if (!impl || typeof impl[op] !== 'function') return JSON.stringify({ missing: true });
    var value = impl[op](JSON.parse(argJson), __h);
    return JSON.stringify({ value: value === undefined ? null : value });
  } catch (e) {
    var msg;
    try { msg = String(e && e.message !== undefined ? e.message : e); } catch (_) { msg = 'the script threw an error'; }
    return JSON.stringify({ error: msg });
  }
}
`

const CALL = new vm.Script('__out = __call(__op, __arg)')

/** Compile a script calendar. Throws ScriptError if the script does not load or lacks toFields/fromFields. */
export function sandboxedCalendar(code: string, filename: string, opts: SandboxOptions = {}): ScriptCalendarImpl {
  const timeout = opts.timeoutMs ?? 100
  const ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false }, name: filename })
  vm.runInContext(PRELUDE, ctx, { timeout })
  try {
    vm.runInContext(code, ctx, { filename, timeout })
  } catch (err) {
    throw new ScriptError(`${filename} failed to load: ${describeError(err)}`)
  }
  const call = (op: string, arg: unknown): unknown => {
    const box = ctx as Record<string, unknown>
    box.__op = op
    box.__arg = JSON.stringify(arg)
    try {
      CALL.runInContext(ctx, { timeout })
    } catch (err) {
      throw new ScriptError(`${filename}: ${op}() ${describeError(err)}`)
    }
    const out = JSON.parse(String(box.__out)) as { value?: unknown; error?: string; missing?: boolean }
    if (out.error !== undefined) throw new ScriptError(`${filename}: ${op}() threw: ${out.error}`)
    if (out.missing) return undefined
    return out.value
  }
  const has = (op: string): boolean => {
    const box = ctx as Record<string, unknown>
    box.__probe = op
    return vm.runInContext('typeof (module.exports && module.exports[__probe]) === "function"', ctx, { timeout }) === true
  }
  for (const op of ['toFields', 'fromFields']) if (!has(op)) throw new ScriptError(`${filename} must define module.exports.${op}(…).`)
  const impl: ScriptCalendarImpl = {
    toFields: (t) => call('toFields', t) as Fields,
    fromFields: (f) => call('fromFields', f) as number
  }
  if (has('yearLabel')) impl.yearLabel = (y) => call('yearLabel', y) as string
  if (has('parseYearLabel')) impl.parseYearLabel = (s) => call('parseYearLabel', s) as number | null
  return impl
}

function describeError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  return /timed out/i.test(m) ? 'took too long (the time limit is there to catch endless loops)' : m.split('\n')[0]
}
