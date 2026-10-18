import { db, newId } from './db.ts'
import {
  getHouseholdPreferencesView,
  type HouseholdPreferencesView,
  type PreferenceKey,
  PREFERENCE_KEYS,
} from './planDraft.ts'
import { isRecord } from './auth.ts'

export { getHouseholdPreferencesView, PREFERENCE_KEYS }
export type { HouseholdPreferencesView, PreferenceKey }

const KEY_SET = new Set<string>(PREFERENCE_KEYS)

export function upsertPreferences(
  householdId: string,
  patch: Record<string, unknown>,
): HouseholdPreferencesView {
  for (const [key, value] of Object.entries(patch)) {
    if (!KEY_SET.has(key)) continue
    const encoded = encodePreferenceValue(key as PreferenceKey, value)
    if (encoded === undefined) continue

    const existing = db
      .query(
        `SELECT id FROM household_preferences
         WHERE household_id = ? AND key = ?`,
      )
      .get(householdId, key) as { id: string } | null

    if (existing) {
      db.query(
        `UPDATE household_preferences SET value_json = ? WHERE id = ?`,
      ).run(encoded, existing.id)
    } else {
      db.query(
        `INSERT INTO household_preferences (id, household_id, key, value_json)
         VALUES (?, ?, ?, ?)`,
      ).run(newId(), householdId, key, encoded)
    }
  }

  return getHouseholdPreferencesView(householdId)
}

/**
 * Validate + JSON-encode a preference value. Returns undefined to skip.
 */
export function encodePreferenceValue(
  key: PreferenceKey,
  value: unknown,
): string | undefined {
  switch (key) {
    case 'cooked_dinners_per_week': {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 1 || n > 7) {
        throw new PrefValidationError(
          'cooked_dinners_per_week must be an integer 1–7',
        )
      }
      return JSON.stringify(Math.round(n))
    }
    case 'busy_day_threshold_minutes': {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 15 || n > 180) {
        throw new PrefValidationError(
          'busy_day_threshold_minutes must be 15–180',
        )
      }
      return JSON.stringify(Math.round(n))
    }
    case 'default_servings': {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 1 || n > 24) {
        throw new PrefValidationError('default_servings must be 1–24')
      }
      return JSON.stringify(Math.round(n))
    }
    case 'max_active_minutes': {
      if (value == null || value === '') return JSON.stringify(null)
      const n = Number(value)
      if (!Number.isFinite(n) || n < 5 || n > 240) {
        throw new PrefValidationError(
          'max_active_minutes must be 5–240, or null',
        )
      }
      return JSON.stringify(Math.round(n))
    }
    case 'cuisine_notes':
    case 'avoid_notes': {
      if (typeof value !== 'string') {
        throw new PrefValidationError(`${key} must be a string`)
      }
      return JSON.stringify(value.trim().slice(0, 500))
    }
    case 'allergies': {
      const list = normalizeAllergyList(value)
      return JSON.stringify(list)
    }
    default:
      return undefined
  }
}

export function normalizeAllergyList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 40)
  }
  if (typeof value === 'string') {
    return value
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 40)
  }
  throw new PrefValidationError(
    'allergies must be a string list or comma-separated string',
  )
}

export class PrefValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrefValidationError'
  }
}

export function parsePreferencesPatch(
  body: unknown,
): Record<string, unknown> | PrefValidationError {
  if (!isRecord(body)) {
    return new PrefValidationError('Expected object body')
  }

  const patch: Record<string, unknown> = {}
  for (const key of PREFERENCE_KEYS) {
    if (key in body) patch[key] = body[key]
  }

  // Also accept nested { preferences: { ... } }
  if (isRecord(body.preferences)) {
    for (const key of PREFERENCE_KEYS) {
      if (key in body.preferences) patch[key] = body.preferences[key]
    }
  }

  if (!Object.keys(patch).length) {
    return new PrefValidationError('No recognized preference keys in body')
  }

  return patch
}
