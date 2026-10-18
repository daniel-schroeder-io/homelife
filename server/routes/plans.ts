import type {
  MealPlan,
  MealPlanDetail,
  MealPlanEntryStatus,
  MealPlanEntryView,
  MealPlanRecipeSummary,
  MealPlanStatus,
  MealType,
  RecipeStatus,
} from '../../shared/types.ts'
import {
  isRecord,
  jsonError,
  readJsonBody,
  requireUser,
} from '../auth.ts'
import { db, newId, nowIso } from '../db.ts'
import { requireMembership } from '../household.ts'
import {
  onPlanApprovedForGrocery,
  onPlanEntryChangedForGrocery,
} from './groceries.ts'
import {
  DEFAULT_BUSY_THRESHOLD_MINUTES,
  activeMinutes,
  generateWeekDraft,
  loadPlanPrefs,
  swapOptionsForSlot,
  totalMinutes,
} from '../planDraft.ts'
import { broadcastPlan, openPlanStream } from '../planStream.ts'
import {
  datesForWeek,
  isIsoDate,
  mondayOf,
  todayInTimezone,
} from '../week.ts'

const PLAN_STATUSES: MealPlanStatus[] = ['draft', 'approved', 'archived']
const ENTRY_STATUSES: MealPlanEntryStatus[] = [
  'planned',
  'cooked',
  'skipped',
  'swapped',
  'eating_out',
  'leftovers',
  'quick',
  'undecided',
]
const MEAL_TYPES: MealType[] = [
  'dinner',
  'lunch',
  'breakfast',
  'snack',
  'other',
]

type PlanRow = {
  id: string
  household_id: string
  week_start: string
  status: MealPlanStatus
  created_at: string
  approved_at: string | null
}

type EntryRow = {
  id: string
  meal_plan_id: string
  date: string
  meal_type: MealType
  recipe_id: string | null
  servings: number | null
  notes: string | null
  status: MealPlanEntryStatus
  sort_order: number
}

type RecipeJoinRow = {
  id: string
  title: string
  servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  status: RecipeStatus
  tags_json: string | null
}

export async function handlePlanRoutes(
  req: Request,
  path: string,
): Promise<Response | null> {
  if (path === '/api/plans/stream' && req.method === 'GET') {
    return planStream(req)
  }
  if (path === '/api/plans/current' && req.method === 'GET') {
    return getCurrentPlan(req)
  }
  if (path === '/api/plans/generate' && req.method === 'POST') {
    return generatePlan(req)
  }

  const planMatch = path.match(/^\/api\/plans\/([^/]+)$/)
  if (planMatch && req.method === 'PATCH') {
    return patchPlan(req, decodeURIComponent(planMatch[1]!))
  }

  const entryMatch = path.match(/^\/api\/plans\/([^/]+)\/entries\/([^/]+)$/)
  if (entryMatch && req.method === 'PATCH') {
    return patchEntry(
      req,
      decodeURIComponent(entryMatch[1]!),
      decodeURIComponent(entryMatch[2]!),
    )
  }

  const swapMatch = path.match(
    /^\/api\/plans\/([^/]+)\/entries\/([^/]+)\/swap-options$/,
  )
  if (swapMatch && req.method === 'POST') {
    return swapOptions(
      req,
      decodeURIComponent(swapMatch[1]!),
      decodeURIComponent(swapMatch[2]!),
    )
  }

  const regenMatch = path.match(
    /^\/api\/plans\/([^/]+)\/entries\/([^/]+)\/regenerate$/,
  )
  if (regenMatch && req.method === 'POST') {
    return regenerateEntry(
      req,
      decodeURIComponent(regenMatch[1]!),
      decodeURIComponent(regenMatch[2]!),
    )
  }

  return null
}

function planStream(req: Request): Response {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const url = new URL(req.url)
  const weekStartParam = url.searchParams.get('week_start')
  let weekStart: string | null = null
  if (weekStartParam) {
    const parsed = parseWeekStart(weekStartParam)
    if (typeof parsed !== 'string') return parsed.error
    weekStart = parsed
  }

  return openPlanStream(member.membership.household_id, weekStart)
}

function getCurrentPlan(req: Request): Response {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const url = new URL(req.url)
  const weekStartParam = url.searchParams.get('week_start')
  const weekStart = weekStartParam
    ? parseWeekStart(weekStartParam)
    : mondayOf(todayInTimezone(householdTimezone(member.membership.household_id)))

  // parseWeekStart returns a string on success — cannot use `in` on primitives
  if (typeof weekStart !== 'string') return weekStart.error

  const householdId = member.membership.household_id
  let plan = findPlanForWeek(householdId, weekStart)

  if (!plan) {
    plan = createEmptyDraft(householdId, weekStart)
  }

  return Response.json({ plan: toPlanDetail(plan) })
}

async function generatePlan(req: Request): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error
  if (!isRecord(body)) return jsonError('Expected object body')

  const householdId = member.membership.household_id
  const prefs = loadPlanPrefs(householdId)

  let weekStart: string
  if (typeof body.week_start === 'string' && body.week_start.trim()) {
    const parsed = parseWeekStart(body.week_start.trim())
    if (typeof parsed !== 'string') return parsed.error
    weekStart = parsed
  } else {
    weekStart = mondayOf(
      todayInTimezone(householdTimezone(householdId)),
    )
  }

  let cookedDinners = prefs.cooked_dinners
  if ('cooked_dinners' in body) {
    const n = Number(body.cooked_dinners)
    if (!Number.isFinite(n) || n < 1 || n > 7) {
      return jsonError('cooked_dinners must be an integer 1–7')
    }
    cookedDinners = Math.round(n)
  }

  const existing = findPlanForWeek(householdId, weekStart)
  // Never silently mutate an approved plan: explicit generate moves it to draft.
  if (existing?.status === 'approved') {
    db.query(
      `UPDATE meal_plans SET status = 'draft', approved_at = NULL WHERE id = ?`,
    ).run(existing.id)
  }

  const planId = existing?.id ?? newId()
  const weekDates = datesForWeek(weekStart)
  const slots = generateWeekDraft({
    householdId,
    weekDates,
    cookedDinners,
  })

  db.exec('BEGIN')
  try {
    if (!existing) {
      db.query(
        `INSERT INTO meal_plans (id, household_id, week_start, status, created_at, approved_at)
         VALUES (?, ?, ?, 'draft', ?, NULL)`,
      ).run(planId, householdId, weekStart, nowIso())
    } else {
      db.query(
        `UPDATE meal_plans SET status = 'draft', approved_at = NULL WHERE id = ?`,
      ).run(planId)
      db.query(`DELETE FROM meal_plan_entries WHERE meal_plan_id = ?`).run(planId)
    }

    insertSlots(planId, slots)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const plan = getPlanRow(planId, householdId)!
  broadcastPlan(householdId, { type: 'plan', week_start: weekStart })
  return Response.json({ plan: toPlanDetail(plan) })
}

async function patchPlan(req: Request, planId: string): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const plan = getPlanRow(planId, member.membership.household_id)
  if (!plan) return jsonError('Plan not found', 404)

  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error
  if (!isRecord(body)) return jsonError('Expected object body')

  if (!('status' in body)) {
    return jsonError('status is required')
  }
  if (
    typeof body.status !== 'string' ||
    !PLAN_STATUSES.includes(body.status as MealPlanStatus)
  ) {
    return jsonError(`status must be one of: ${PLAN_STATUSES.join(', ')}`)
  }

  const nextStatus = body.status as MealPlanStatus
  const approvedAt =
    nextStatus === 'approved'
      ? nowIso()
      : nextStatus === 'draft'
        ? null
        : plan.approved_at

  db.query(
    `UPDATE meal_plans SET status = ?, approved_at = ? WHERE id = ?`,
  ).run(nextStatus, approvedAt, planId)

  if (nextStatus === 'approved') {
    onPlanApprovedForGrocery(planId, member.membership.household_id)
  }

  const updated = getPlanRow(planId, member.membership.household_id)!
  broadcastPlan(member.membership.household_id, {
    type: 'plan',
    week_start: updated.week_start,
  })
  return Response.json({ plan: toPlanDetail(updated) })
}

async function patchEntry(
  req: Request,
  planId: string,
  entryId: string,
): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const householdId = member.membership.household_id
  const plan = getPlanRow(planId, householdId)
  if (!plan) return jsonError('Plan not found', 404)

  const entry = getEntryRow(entryId, planId)
  if (!entry) return jsonError('Entry not found', 404)

  // Approved plans may still get intentional edits (swap/leftovers); do not
  // silently rewrite the whole plan. Entry patches are explicit user actions.
  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error
  if (!isRecord(body)) return jsonError('Expected object body')

  let recipeId = entry.recipe_id
  let status = entry.status
  let mealType = entry.meal_type
  let servings = entry.servings
  let notes = entry.notes
  let date = entry.date
  let sortOrder = entry.sort_order

  if ('recipe_id' in body) {
    if (body.recipe_id === null) {
      recipeId = null
    } else if (typeof body.recipe_id === 'string') {
      const recipe = getHouseholdRecipe(body.recipe_id, householdId)
      if (!recipe) return jsonError('Recipe not found', 404)
      recipeId = recipe.id
      if (!('status' in body)) status = 'planned'
    } else {
      return jsonError('recipe_id must be a string or null')
    }
  }

  if ('status' in body) {
    if (
      typeof body.status !== 'string' ||
      !ENTRY_STATUSES.includes(body.status as MealPlanEntryStatus)
    ) {
      return jsonError(`status must be one of: ${ENTRY_STATUSES.join(', ')}`)
    }
    status = body.status as MealPlanEntryStatus
    if (
      status === 'leftovers' ||
      status === 'eating_out' ||
      status === 'undecided' ||
      status === 'quick'
    ) {
      if (!('recipe_id' in body)) recipeId = null
    }
  }

  if ('meal_type' in body) {
    if (
      typeof body.meal_type !== 'string' ||
      !MEAL_TYPES.includes(body.meal_type as MealType)
    ) {
      return jsonError(`meal_type must be one of: ${MEAL_TYPES.join(', ')}`)
    }
    mealType = body.meal_type as MealType
  }

  if ('servings' in body) {
    if (body.servings === null) {
      servings = null
    } else {
      const n = Number(body.servings)
      if (!Number.isFinite(n) || n <= 0) {
        return jsonError('servings must be a positive number or null')
      }
      servings = n
    }
  }

  if ('notes' in body) {
    if (body.notes === null) {
      notes = null
    } else if (typeof body.notes === 'string') {
      notes = body.notes.trim() || null
    } else {
      return jsonError('notes must be a string or null')
    }
  }

  if ('date' in body) {
    if (typeof body.date !== 'string' || !isIsoDate(body.date)) {
      return jsonError('date must be YYYY-MM-DD')
    }
    const weekDates = new Set(datesForWeek(plan.week_start))
    if (!weekDates.has(body.date)) {
      return jsonError('date must fall within the plan week')
    }
    // Moving to another day: swap dates with the entry already on that day.
    if (body.date !== entry.date) {
      const other = db
        .query(
          `SELECT id, date, sort_order FROM meal_plan_entries
           WHERE meal_plan_id = ? AND date = ? AND id != ?`,
        )
        .get(planId, body.date, entryId) as {
        id: string
        date: string
        sort_order: number
      } | null

      if (other) {
        db.query(
          `UPDATE meal_plan_entries SET date = ?, sort_order = ? WHERE id = ?`,
        ).run(entry.date, entry.sort_order, other.id)
        sortOrder = other.sort_order
      } else {
        sortOrder = datesForWeek(plan.week_start).indexOf(body.date)
      }
      date = body.date
    }
  }

  db.query(
    `UPDATE meal_plan_entries SET
       date = ?, meal_type = ?, recipe_id = ?, servings = ?,
       notes = ?, status = ?, sort_order = ?
     WHERE id = ? AND meal_plan_id = ?`,
  ).run(
    date,
    mealType,
    recipeId,
    servings,
    notes,
    status,
    sortOrder,
    entryId,
    planId,
  )

  onPlanEntryChangedForGrocery(planId, entryId, householdId, plan.status)

  const updated = getPlanRow(planId, householdId)!
  broadcastPlan(householdId, {
    type: 'plan',
    week_start: updated.week_start,
  })
  return Response.json({ plan: toPlanDetail(updated) })
}

async function swapOptions(
  req: Request,
  planId: string,
  entryId: string,
): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const plan = getPlanRow(planId, member.membership.household_id)
  if (!plan) return jsonError('Plan not found', 404)
  const entry = getEntryRow(entryId, planId)
  if (!entry) return jsonError('Entry not found', 404)

  let preferQuick = false
  try {
    const text = await req.text()
    if (text.trim()) {
      const parsed = JSON.parse(text) as unknown
      if (isRecord(parsed) && parsed.prefer_quick) preferQuick = true
    }
  } catch {
    return jsonError('Invalid JSON body')
  }

  const options = swapOptionsForSlot({
    householdId: member.membership.household_id,
    weekStart: plan.week_start,
    excludeRecipeId: entry.recipe_id,
    preferQuick,
    limit: 3,
  })

  return Response.json({
    options: options.map((r) => toRecipeSummary(r)),
  })
}

async function regenerateEntry(
  req: Request,
  planId: string,
  entryId: string,
): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const householdId = member.membership.household_id
  const plan = getPlanRow(planId, householdId)
  if (!plan) return jsonError('Plan not found', 404)
  const entry = getEntryRow(entryId, planId)
  if (!entry) return jsonError('Entry not found', 404)

  // Regenerating a single slot on an approved plan demotes to draft.
  if (plan.status === 'approved') {
    db.query(
      `UPDATE meal_plans SET status = 'draft', approved_at = NULL WHERE id = ?`,
    ).run(planId)
  }

  const options = swapOptionsForSlot({
    householdId,
    weekStart: plan.week_start,
    excludeRecipeId: entry.recipe_id,
    preferQuick: false,
    limit: 1,
  })
  const pick = options[0]
  if (!pick) {
    return jsonError('No alternative recipes available', 400)
  }

  const prefs = loadPlanPrefs(householdId)
  db.query(
    `UPDATE meal_plan_entries SET
       recipe_id = ?, status = 'planned', servings = ?, notes = NULL
     WHERE id = ? AND meal_plan_id = ?`,
  ).run(pick.id, pick.servings ?? prefs.default_servings, entryId, planId)

  onPlanEntryChangedForGrocery(planId, entryId, householdId, 'draft')

  const updated = getPlanRow(planId, householdId)!
  broadcastPlan(householdId, {
    type: 'plan',
    week_start: updated.week_start,
  })
  return Response.json({ plan: toPlanDetail(updated) })
}

// —— Persistence helpers ————————————————————————————————————————————————

function findPlanForWeek(
  householdId: string,
  weekStart: string,
): PlanRow | null {
  return db
    .query(
      `SELECT id, household_id, week_start, status, created_at, approved_at
       FROM meal_plans
       WHERE household_id = ? AND week_start = ?
         AND status != 'archived'
       ORDER BY
         CASE status WHEN 'approved' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
         created_at DESC
       LIMIT 1`,
    )
    .get(householdId, weekStart) as PlanRow | null
}

function getPlanRow(planId: string, householdId: string): PlanRow | null {
  return db
    .query(
      `SELECT id, household_id, week_start, status, created_at, approved_at
       FROM meal_plans
       WHERE id = ? AND household_id = ?`,
    )
    .get(planId, householdId) as PlanRow | null
}

function getEntryRow(entryId: string, planId: string): EntryRow | null {
  return db
    .query(
      `SELECT id, meal_plan_id, date, meal_type, recipe_id, servings,
              notes, status, sort_order
       FROM meal_plan_entries
       WHERE id = ? AND meal_plan_id = ?`,
    )
    .get(entryId, planId) as EntryRow | null
}

function createEmptyDraft(householdId: string, weekStart: string): PlanRow {
  const id = newId()
  const created = nowIso()
  const dates = datesForWeek(weekStart)

  db.exec('BEGIN')
  try {
    db.query(
      `INSERT INTO meal_plans (id, household_id, week_start, status, created_at, approved_at)
       VALUES (?, ?, ?, 'draft', ?, NULL)`,
    ).run(id, householdId, weekStart, created)

    insertSlots(
      id,
      dates.map((date, sort_order) => ({
        date,
        sort_order,
        status: 'undecided' as const,
        recipe_id: null,
        servings: null,
        notes: null,
      })),
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return {
    id,
    household_id: householdId,
    week_start: weekStart,
    status: 'draft',
    created_at: created,
    approved_at: null,
  }
}

function insertSlots(
  planId: string,
  slots: {
    date: string
    sort_order: number
    status: MealPlanEntryStatus
    recipe_id: string | null
    servings: number | null
    notes: string | null
  }[],
): void {
  const stmt = db.query(
    `INSERT INTO meal_plan_entries (
       id, meal_plan_id, date, meal_type, recipe_id, servings,
       notes, status, sort_order
     ) VALUES (?, ?, ?, 'dinner', ?, ?, ?, ?, ?)`,
  )
  for (const slot of slots) {
    stmt.run(
      newId(),
      planId,
      slot.date,
      slot.recipe_id,
      slot.servings,
      slot.notes,
      slot.status,
      slot.sort_order,
    )
  }
}

function getHouseholdRecipe(
  id: string,
  householdId: string,
): RecipeJoinRow | null {
  return db
    .query(
      `SELECT id, title, servings, prep_minutes, cook_minutes, status, tags_json
       FROM recipes WHERE id = ? AND household_id = ?`,
    )
    .get(id, householdId) as RecipeJoinRow | null
}

function householdTimezone(householdId: string): string {
  const row = db
    .query(`SELECT timezone FROM households WHERE id = ?`)
    .get(householdId) as { timezone: string } | null
  return row?.timezone ?? 'America/Los_Angeles'
}

function toPlanDetail(plan: PlanRow): MealPlanDetail {
  const prefs = loadPlanPrefs(plan.household_id)
  const threshold = prefs.busy_threshold_minutes || DEFAULT_BUSY_THRESHOLD_MINUTES

  const rows = db
    .query(
      `SELECT e.id, e.meal_plan_id, e.date, e.meal_type, e.recipe_id, e.servings,
              e.notes, e.status, e.sort_order,
              r.id AS r_id, r.title AS r_title, r.servings AS r_servings,
              r.prep_minutes AS r_prep, r.cook_minutes AS r_cook,
              r.status AS r_status, r.tags_json AS r_tags
       FROM meal_plan_entries e
       LEFT JOIN recipes r ON r.id = e.recipe_id
       WHERE e.meal_plan_id = ?
       ORDER BY e.sort_order ASC, e.date ASC`,
    )
    .all(plan.id) as (EntryRow & {
    r_id: string | null
    r_title: string | null
    r_servings: number | null
    r_prep: number | null
    r_cook: number | null
    r_status: RecipeStatus | null
    r_tags: string | null
  })[]

  const entries: MealPlanEntryView[] = rows.map((row) => {
    const recipe: MealPlanRecipeSummary | null = row.r_id
      ? {
          id: row.r_id,
          title: row.r_title!,
          servings: row.r_servings,
          prep_minutes: row.r_prep,
          cook_minutes: row.r_cook,
          status: row.r_status!,
          tags: parseTags(row.r_tags),
        }
      : null

    const active = recipe
      ? activeMinutes(recipe.prep_minutes, recipe.cook_minutes)
      : null
    const total = recipe
      ? totalMinutes(recipe.prep_minutes, recipe.cook_minutes)
      : null

    return {
      id: row.id,
      meal_plan_id: row.meal_plan_id,
      date: row.date,
      meal_type: row.meal_type,
      recipe_id: row.recipe_id,
      servings: row.servings,
      notes: row.notes,
      status: row.status,
      sort_order: row.sort_order,
      recipe,
      active_minutes: active,
      total_minutes: total,
      busy: active != null && active >= threshold,
    }
  })

  const cooked = entries.filter(
    (e) => e.status === 'planned' && e.recipe_id,
  ).length

  const base: MealPlan = {
    id: plan.id,
    household_id: plan.household_id,
    week_start: plan.week_start,
    status: plan.status,
    created_at: plan.created_at,
    approved_at: plan.approved_at,
  }

  return {
    ...base,
    entries,
    cooked_dinners: cooked,
    busy_day_threshold_minutes: threshold,
  }
}

function toRecipeSummary(r: {
  id: string
  title: string
  servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  status: RecipeStatus
  tags_json: string | null
}): MealPlanRecipeSummary {
  return {
    id: r.id,
    title: r.title,
    servings: r.servings,
    prep_minutes: r.prep_minutes,
    cook_minutes: r.cook_minutes,
    status: r.status,
    tags: parseTags(r.tags_json),
  }
}

function parseTags(tagsJson: string | null): string[] {
  if (!tagsJson) return []
  try {
    const parsed = JSON.parse(tagsJson) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function parseWeekStart(
  raw: string,
): string | { error: Response } {
  if (!isIsoDate(raw)) {
    return { error: jsonError('week_start must be YYYY-MM-DD') }
  }
  // Normalize to Monday of that week.
  return mondayOf(raw)
}

export { datesForWeek, mondayOf } from '../week.ts'
