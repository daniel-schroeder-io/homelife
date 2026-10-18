import type {
  HouseholdPreferencesView,
  MealPlanEntryStatus,
  RecipeStatus,
} from '../shared/types.ts'
import { db } from './db.ts'

export type { HouseholdPreferencesView }

/** Default cooked dinners when household_preferences has no override. */
export const DEFAULT_COOKED_DINNERS = 5

/** Active minutes at or above this → busy-night flag. */
export const DEFAULT_BUSY_THRESHOLD_MINUTES = 40

/** Prefer not repeating a main dish cooked/planned within this many days. */
const RECENT_REPEAT_DAYS = 21

const ELIGIBLE_STATUSES: RecipeStatus[] = ['favorite', 'tried', 'active']

export type DraftRecipe = {
  id: string
  title: string
  servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  status: RecipeStatus
  tags_json: string | null
}

export type DraftSlot = {
  date: string
  sort_order: number
  status: MealPlanEntryStatus
  recipe_id: string | null
  servings: number | null
  notes: string | null
}

/**
 * Household prefs that drive draft generation.
 *
 * Allergy matching is intentionally simple: case-insensitive substring
 * against ingredient display names and recipe tags. It will miss aliases
 * ("shellfish" vs "shrimp"), cross-contamination, and hidden allergens in
 * sauces — not a medical safety guarantee.
 */
export type PlanDraftPrefs = {
  cooked_dinners: number
  max_active_minutes: number | null
  busy_threshold_minutes: number
  default_servings: number
  /** Free-text cuisine preferences (soft tag/title boost). */
  cuisine_notes: string
  /** Free-text avoid notes (soft tag/title penalty). */
  avoid_notes: string
  /** Structured allergen strings; hard-exclude matching recipes. */
  allergies: string[]
}

/** Keys stored in household_preferences and exposed via GET/PATCH prefs. */
export const PREFERENCE_KEYS = [
  'cooked_dinners_per_week',
  'max_active_minutes',
  'busy_day_threshold_minutes',
  'default_servings',
  'cuisine_notes',
  'avoid_notes',
  'allergies',
] as const

export type PreferenceKey = (typeof PREFERENCE_KEYS)[number]

type PrefRow = { key: string; value_json: string }

export function loadPlanPrefs(householdId: string): PlanDraftPrefs {
  const map = loadPrefMap(householdId)

  return {
    cooked_dinners: clampInt(
      parsePrefNumber(map.get('cooked_dinners_per_week'), DEFAULT_COOKED_DINNERS),
      1,
      7,
    ),
    max_active_minutes: parsePrefNumberOrNull(
      map.get('max_active_minutes') ?? map.get('max_cook_minutes'),
    ),
    busy_threshold_minutes: clampInt(
      parsePrefNumber(
        map.get('busy_day_threshold_minutes'),
        DEFAULT_BUSY_THRESHOLD_MINUTES,
      ),
      15,
      180,
    ),
    default_servings: clampInt(
      parsePrefNumber(map.get('default_servings'), 4),
      1,
      24,
    ),
    cuisine_notes: parsePrefString(map.get('cuisine_notes')),
    avoid_notes: parsePrefString(map.get('avoid_notes')),
    allergies: parsePrefStringList(map.get('allergies')),
  }
}

/** Decoded prefs for the Settings API (stable keys + defaults). */
export function getHouseholdPreferencesView(
  householdId: string,
): HouseholdPreferencesView {
  const prefs = loadPlanPrefs(householdId)
  return {
    cooked_dinners_per_week: prefs.cooked_dinners,
    max_active_minutes: prefs.max_active_minutes,
    busy_day_threshold_minutes: prefs.busy_threshold_minutes,
    default_servings: prefs.default_servings,
    cuisine_notes: prefs.cuisine_notes,
    avoid_notes: prefs.avoid_notes,
    allergies: prefs.allergies,
  }
}

function loadPrefMap(householdId: string): Map<string, string> {
  const rows = db
    .query(
      `SELECT key, value_json FROM household_preferences WHERE household_id = ?`,
    )
    .all(householdId) as PrefRow[]
  return new Map(rows.map((r) => [r.key, r.value_json]))
}

export function listEligibleRecipes(householdId: string): DraftRecipe[] {
  const placeholders = ELIGIBLE_STATUSES.map(() => '?').join(', ')
  return db
    .query(
      `SELECT id, title, servings, prep_minutes, cook_minutes, status, tags_json
       FROM recipes
       WHERE household_id = ?
         AND status IN (${placeholders})
       ORDER BY title COLLATE NOCASE`,
    )
    .all(householdId, ...ELIGIBLE_STATUSES) as DraftRecipe[]
}

/**
 * Drop recipes whose tags or ingredient display names contain an allergen
 * substring. Limits: no synonym expansion, no quantity/context awareness.
 */
export function filterRecipesByAllergies(
  recipes: DraftRecipe[],
  allergies: string[],
): DraftRecipe[] {
  const needles = allergies
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a.length > 0)
  if (!needles.length) return recipes

  const hayByRecipe = recipeAllergyHaystacks(recipes.map((r) => r.id))
  return recipes.filter((r) => {
    const hay = hayByRecipe.get(r.id) ?? recipeLocalHaystack(r)
    return !needles.some((n) => hay.includes(n))
  })
}

function recipeLocalHaystack(r: {
  title: string
  tags_json: string | null
}): string {
  const tags = parseTags(r.tags_json).join(' ')
  return `${r.title} ${tags}`.toLowerCase()
}

function recipeAllergyHaystacks(
  recipeIds: string[],
): Map<string, string> {
  const out = new Map<string, string>()
  if (!recipeIds.length) return out

  const placeholders = recipeIds.map(() => '?').join(', ')
  const recipes = db
    .query(
      `SELECT id, title, tags_json FROM recipes WHERE id IN (${placeholders})`,
    )
    .all(...recipeIds) as {
    id: string
    title: string
    tags_json: string | null
  }[]

  for (const r of recipes) {
    out.set(r.id, recipeLocalHaystack(r))
  }

  const ingredients = db
    .query(
      `SELECT recipe_id, display_name
       FROM recipe_ingredients
       WHERE recipe_id IN (${placeholders})`,
    )
    .all(...recipeIds) as { recipe_id: string; display_name: string }[]

  for (const row of ingredients) {
    const prev = out.get(row.recipe_id) ?? ''
    out.set(row.recipe_id, `${prev} ${row.display_name}`.toLowerCase())
  }

  return out
}

/** Dates of recent cooks + recent planned recipe slots (for repeat avoidance). */
export function recentRecipeUsage(
  householdId: string,
  beforeDate: string,
): Map<string, string> {
  const lastByRecipe = new Map<string, string>()

  const history = db
    .query(
      `SELECT recipe_id, cooked_at
       FROM cook_history
       WHERE household_id = ?
         AND date(cooked_at) >= date(?, ?)
         AND date(cooked_at) < date(?)
       ORDER BY cooked_at DESC`,
    )
    .all(
      householdId,
      beforeDate,
      `-${RECENT_REPEAT_DAYS} days`,
      beforeDate,
    ) as { recipe_id: string; cooked_at: string }[]

  for (const row of history) {
    if (!lastByRecipe.has(row.recipe_id)) {
      lastByRecipe.set(row.recipe_id, row.cooked_at.slice(0, 10))
    }
  }

  const planned = db
    .query(
      `SELECT e.recipe_id, e.date
       FROM meal_plan_entries e
       JOIN meal_plans p ON p.id = e.meal_plan_id
       WHERE p.household_id = ?
         AND e.recipe_id IS NOT NULL
         AND e.status IN ('planned', 'cooked', 'swapped')
         AND e.date >= date(?, ?)
         AND e.date < date(?)
       ORDER BY e.date DESC`,
    )
    .all(
      householdId,
      beforeDate,
      `-${RECENT_REPEAT_DAYS} days`,
      beforeDate,
    ) as { recipe_id: string; date: string }[]

  for (const row of planned) {
    const prev = lastByRecipe.get(row.recipe_id)
    if (!prev || row.date > prev) {
      lastByRecipe.set(row.recipe_id, row.date)
    }
  }

  return lastByRecipe
}

/**
 * Deterministic draft for one week: N cooked dinners + filler slots
 * (leftovers / eating out / quick / undecided). No LLM.
 */
export function generateWeekDraft(opts: {
  householdId: string
  weekDates: string[]
  cookedDinners?: number
  excludeRecipeIds?: Set<string>
}): DraftSlot[] {
  const prefs = loadPlanPrefs(opts.householdId)
  const cookedTarget = clampInt(
    opts.cookedDinners ?? prefs.cooked_dinners,
    1,
    opts.weekDates.length,
  )

  const recipes = filterRecipesByAllergies(
    listEligibleRecipes(opts.householdId).filter(
      (r) => !opts.excludeRecipeIds?.has(r.id),
    ),
    prefs.allergies,
  )
  const weekStart = opts.weekDates[0]!
  const recent = recentRecipeUsage(opts.householdId, weekStart)

  const scored = recipes
    .map((r) => ({
      recipe: r,
      score: scoreRecipe(r, recent, prefs),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.recipe.title.localeCompare(b.recipe.title)
    })

  const cookDayIndexes = pickCookDayIndexes(
    opts.weekDates.length,
    Math.min(cookedTarget, scored.length),
  )

  const picked: DraftRecipe[] = []
  const usedIds = new Set<string>()
  for (let i = 0; i < cookDayIndexes.length; i++) {
    const dayIdx = cookDayIndexes[i]!
    const preferQuick = isLikelyBusyIndex(dayIdx, opts.weekDates.length)
    const next = pickNextRecipe(scored, usedIds, prefs, recent, preferQuick)
    if (!next) break
    usedIds.add(next.id)
    picked.push(next)
  }

  let pickIdx = 0
  const slots: DraftSlot[] = opts.weekDates.map((date, sort_order) => {
    if (cookDayIndexes.includes(sort_order) && pickIdx < picked.length) {
      const recipe = picked[pickIdx++]!
      return {
        date,
        sort_order,
        status: 'planned' as const,
        recipe_id: recipe.id,
        servings: recipe.servings ?? prefs.default_servings,
        notes: null,
      }
    }
    return fillerSlot(date, sort_order, cookDayIndexes)
  })

  // If we planned a cooked dinner the day before a filler, bias that filler to leftovers.
  for (let i = 1; i < slots.length; i++) {
    const prev = slots[i - 1]!
    const cur = slots[i]!
    if (
      prev.status === 'planned' &&
      prev.recipe_id &&
      cur.status !== 'planned'
    ) {
      // First non-cook after a cook → leftovers once per week max.
      const alreadyLeftovers = slots.some((s) => s.status === 'leftovers')
      if (!alreadyLeftovers && (i === 1 || i === 3 || i === 4)) {
        cur.status = 'leftovers'
        cur.notes = 'Use leftovers from yesterday'
        cur.recipe_id = null
        cur.servings = null
      }
    }
  }

  return slots
}

/** ~3 alternative recipes for a slot, excluding current. */
export function swapOptionsForSlot(opts: {
  householdId: string
  weekStart: string
  excludeRecipeId: string | null
  preferQuick?: boolean
  limit?: number
}): DraftRecipe[] {
  const prefs = loadPlanPrefs(opts.householdId)
  const recent = recentRecipeUsage(opts.householdId, opts.weekStart)
  const scored = filterRecipesByAllergies(
    listEligibleRecipes(opts.householdId).filter(
      (r) => r.id !== opts.excludeRecipeId,
    ),
    prefs.allergies,
  )
    .map((r) => ({
      recipe: r,
      score: scoreRecipe(r, recent, prefs, opts.preferQuick),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.recipe.title.localeCompare(b.recipe.title)
    })

  return scored.slice(0, opts.limit ?? 3).map((s) => s.recipe)
}

export function activeMinutes(
  prep: number | null,
  cook: number | null,
): number | null {
  if (prep != null && prep > 0) return prep
  if (cook != null && cook > 0) return cook
  return null
}

export function totalMinutes(
  prep: number | null,
  cook: number | null,
): number | null {
  const p = prep ?? 0
  const c = cook ?? 0
  const t = p + c
  return t > 0 ? t : null
}

function scoreRecipe(
  r: DraftRecipe,
  recent: Map<string, string>,
  prefs: PlanDraftPrefs,
  preferQuick = false,
): number {
  let score = 0
  if (r.status === 'favorite') score += 100
  else if (r.status === 'tried') score += 60
  else if (r.status === 'active') score += 40

  const active = activeMinutes(r.prep_minutes, r.cook_minutes)
  if (prefs.max_active_minutes != null && active != null) {
    if (active > prefs.max_active_minutes) score -= 50
    else score += 10
  }

  if (preferQuick && active != null) {
    if (active <= 25) score += 25
    else if (active <= 40) score += 10
    else score -= 15
  }

  if (recent.has(r.id)) score -= 80

  // Light tag boosts for freezer/quick meals when preferring quick nights.
  const tags = parseTags(r.tags_json)
  if (preferQuick) {
    if (tags.some((t) => /quick|freezer|sheet.?pan|one.?pot/i.test(t))) {
      score += 20
    }
  }

  const hay = `${r.title} ${tags.join(' ')}`.toLowerCase()
  for (const token of noteTokens(prefs.cuisine_notes)) {
    if (hay.includes(token)) score += 15
  }
  for (const token of noteTokens(prefs.avoid_notes)) {
    if (hay.includes(token)) score -= 40
  }

  return score
}

/** Split free-text notes into lowercase tokens (words ≥ 3 chars). */
function noteTokens(notes: string): string[] {
  return notes
    .toLowerCase()
    .split(/[^a-z0-9+]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
}

function pickNextRecipe(
  scored: { recipe: DraftRecipe; score: number }[],
  usedIds: Set<string>,
  prefs: PlanDraftPrefs,
  recent: Map<string, string>,
  preferQuick: boolean,
): DraftRecipe | null {
  const pool = scored.filter((s) => !usedIds.has(s.recipe.id))
  if (!pool.length) return null

  if (!preferQuick) return pool[0]?.recipe ?? null

  // Re-rank remaining pool with a quick-night bias (still deterministic).
  const resorted = [...pool].sort((a, b) => {
    const da = scoreRecipe(a.recipe, recent, prefs, true)
    const db = scoreRecipe(b.recipe, recent, prefs, true)
    if (db !== da) return db - da
    return a.recipe.title.localeCompare(b.recipe.title)
  })
  return resorted[0]?.recipe ?? null
}

/**
 * Spread cook days across the week instead of packing Mon–Thu.
 * e.g. 5 of 7 → [0, 1, 2, 4, 5] (Mon Tue Wed Fri Sat), leave Thu+Sun fillers.
 */
function pickCookDayIndexes(weekLength: number, cooked: number): number[] {
  if (cooked >= weekLength) {
    return Array.from({ length: weekLength }, (_, i) => i)
  }
  if (cooked <= 0) return []

  const indexes: number[] = []
  for (let i = 0; i < cooked; i++) {
    const idx = Math.round((i * (weekLength - 1)) / Math.max(cooked - 1, 1))
    indexes.push(idx)
  }
  // Deduplicate while preserving order; fill gaps forward if collision.
  const out: number[] = []
  const used = new Set<number>()
  for (const raw of indexes) {
    let idx = raw
    while (used.has(idx) && idx < weekLength - 1) idx++
    while (used.has(idx) && idx > 0) idx--
    if (!used.has(idx)) {
      used.add(idx)
      out.push(idx)
    }
  }
  // If collisions left us short, fill remaining earliest free days.
  for (let i = 0; i < weekLength && out.length < cooked; i++) {
    if (!used.has(i)) {
      used.add(i)
      out.push(i)
    }
  }
  return out.sort((a, b) => a - b)
}

function isLikelyBusyIndex(dayIndex: number, weekLength: number): boolean {
  // Tue (1) and Thu (3) often busier for school/activities; keep heuristic light.
  return dayIndex === 1 || dayIndex === 3 || dayIndex === weekLength - 1
}

function fillerSlot(
  date: string,
  sort_order: number,
  cookIndexes: number[],
): DraftSlot {
  // Rotate filler kinds by position so the week isn't all "undecided".
  const fillers: MealPlanEntryStatus[] = [
    'undecided',
    'leftovers',
    'eating_out',
    'quick',
    'undecided',
  ]
  const fillerPos = sort_order
  let status = fillers[fillerPos % fillers.length]!

  // Prefer undecided on weekend if no cook assigned.
  if (!cookIndexes.includes(sort_order) && (sort_order === 5 || sort_order === 6)) {
    status = sort_order === 5 ? 'eating_out' : 'undecided'
  }

  return {
    date,
    sort_order,
    status,
    recipe_id: null,
    servings: null,
    notes:
      status === 'quick'
        ? 'Quick / freezer meal'
        : status === 'eating_out'
          ? 'Eating out'
          : null,
  }
}

function parseTags(tagsJson: string | null): string[] {
  if (!tagsJson) return []
  try {
    const parsed = JSON.parse(tagsJson) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t): t is string => typeof t === 'string')
  } catch {
    return []
  }
}

function parsePrefNumber(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback
  try {
    const v = JSON.parse(raw) as unknown
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : fallback
  } catch {
    const n = Number(raw)
    return Number.isFinite(n) ? n : fallback
  }
}

function parsePrefNumberOrNull(raw: string | undefined): number | null {
  if (raw == null) return null
  try {
    const v = JSON.parse(raw) as unknown
    if (v == null) return null
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : null
  } catch {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
}

function parsePrefString(raw: string | undefined): string {
  if (raw == null) return ''
  try {
    const v = JSON.parse(raw) as unknown
    if (typeof v === 'string') return v
    if (v == null) return ''
    return String(v)
  } catch {
    return raw
  }
}

function parsePrefStringList(raw: string | undefined): string[] {
  if (raw == null) return []
  try {
    const v = JSON.parse(raw) as unknown
    if (Array.isArray(v)) {
      return v
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
    }
    if (typeof v === 'string') {
      return v
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    }
    return []
  } catch {
    return raw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)))
}
