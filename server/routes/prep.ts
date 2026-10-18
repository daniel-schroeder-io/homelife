import type {
  MealPlanStatus,
  PrepTaskStatus,
  PrepTaskView,
  PrepWeek,
} from '../../shared/types.ts'
import {
  isRecord,
  jsonError,
  readJsonBody,
  requireUser,
} from '../auth.ts'
import { db, newId } from '../db.ts'
import { requireMembership } from '../household.ts'
import { broadcastPlan } from '../planStream.ts'
import {
  generatePrepTasks,
  type PrepEffort,
  type PrepRecipeInput,
} from '../prepGenerate.ts'
import { isIsoDate, mondayOf, todayInTimezone } from '../week.ts'

const PREP_STATUSES: PrepTaskStatus[] = ['pending', 'done', 'skipped']
const EFFORTS: PrepEffort[] = ['active', 'passive']

type PrepRow = {
  id: string
  meal_plan_id: string
  title: string
  scheduled_for: string | null
  duration_minutes: number | null
  status: PrepTaskStatus
  linked_recipe_ids_json: string | null
  notes: string | null
  effort: string | null
}

type PlanRow = {
  id: string
  household_id: string
  week_start: string
  status: MealPlanStatus
}

export async function handlePrepRoutes(
  req: Request,
  path: string,
): Promise<Response | null> {
  if (path === '/api/prep' && req.method === 'GET') {
    return getPrep(req)
  }
  if (path === '/api/prep/generate' && req.method === 'POST') {
    return generatePrep(req)
  }

  const taskMatch = path.match(/^\/api\/prep\/([^/]+)$/)
  if (taskMatch) {
    const id = decodeURIComponent(taskMatch[1]!)
    if (req.method === 'PATCH') return patchPrep(req, id)
    if (req.method === 'DELETE') return deletePrep(req, id)
  }

  return null
}

function getPrep(req: Request): Response {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const householdId = member.membership.household_id
  const url = new URL(req.url)
  const weekStartParam = url.searchParams.get('week_start')
  const weekStart = weekStartParam
    ? parseWeekStart(weekStartParam)
    : mondayOf(todayInTimezone(householdTimezone(householdId)))

  if (typeof weekStart !== 'string') return weekStart.error

  const plan = findPlanForWeek(householdId, weekStart)
  if (!plan) {
    const empty: PrepWeek = {
      week_start: weekStart,
      plan_id: null,
      plan_status: null,
      tasks: [],
    }
    return Response.json({ prep: empty })
  }

  return Response.json({ prep: toPrepWeek(plan) })
}

async function generatePrep(req: Request): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const householdId = member.membership.household_id
  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error

  let weekStart: string
  if (isRecord(body) && typeof body.week_start === 'string' && body.week_start.trim()) {
    const parsed = parseWeekStart(body.week_start.trim())
    if (typeof parsed !== 'string') return parsed.error
    weekStart = parsed
  } else {
    weekStart = mondayOf(todayInTimezone(householdTimezone(householdId)))
  }

  const plan = findPlanForWeek(householdId, weekStart)
  if (!plan) {
    return jsonError('No meal plan for this week — create a plan first', 400)
  }

  const recipes = loadPlannedRecipes(plan.id)
  const generated = generatePrepTasks(recipes)

  db.exec('BEGIN')
  try {
    // Keep user-completed tasks; replace open ones so regenerate is safe.
    db.query(
      `DELETE FROM prep_tasks
       WHERE meal_plan_id = ? AND status != 'done'`,
    ).run(plan.id)

    const insert = db.query(
      `INSERT INTO prep_tasks (
         id, meal_plan_id, title, scheduled_for, duration_minutes,
         status, linked_recipe_ids_json, notes, effort
       ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )

    for (const task of generated) {
      insert.run(
        newId(),
        plan.id,
        task.title,
        task.scheduled_for,
        task.duration_minutes,
        JSON.stringify(task.linked_recipe_ids),
        task.notes,
        task.effort,
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  broadcastPlan(householdId, { type: 'prep', week_start: weekStart })
  return Response.json({ prep: toPrepWeek(plan) })
}

async function patchPrep(req: Request, taskId: string): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const task = getTaskForHousehold(taskId, member.membership.household_id)
  if (!task) return jsonError('Prep task not found', 404)

  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error
  if (!isRecord(body)) return jsonError('Expected object body')

  let title = task.title
  let status = task.status
  let notes = task.notes
  let duration = task.duration_minutes
  let scheduledFor = task.scheduled_for
  let effort = task.effort

  if ('title' in body) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return jsonError('title must be a non-empty string')
    }
    title = body.title.trim()
  }

  if ('status' in body) {
    if (
      typeof body.status !== 'string' ||
      !PREP_STATUSES.includes(body.status as PrepTaskStatus)
    ) {
      return jsonError(`status must be one of: ${PREP_STATUSES.join(', ')}`)
    }
    status = body.status as PrepTaskStatus
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

  if ('duration_minutes' in body) {
    if (body.duration_minutes === null) {
      duration = null
    } else {
      const n = Number(body.duration_minutes)
      if (!Number.isFinite(n) || n < 0) {
        return jsonError('duration_minutes must be a non-negative number or null')
      }
      duration = Math.round(n)
    }
  }

  if ('scheduled_for' in body) {
    if (body.scheduled_for === null) {
      scheduledFor = null
    } else if (
      typeof body.scheduled_for === 'string' &&
      isIsoDate(body.scheduled_for)
    ) {
      scheduledFor = body.scheduled_for
    } else {
      return jsonError('scheduled_for must be YYYY-MM-DD or null')
    }
  }

  if ('effort' in body) {
    if (body.effort === null) {
      effort = null
    } else if (
      typeof body.effort === 'string' &&
      EFFORTS.includes(body.effort as PrepEffort)
    ) {
      effort = body.effort
    } else {
      return jsonError('effort must be active, passive, or null')
    }
  }

  db.query(
    `UPDATE prep_tasks SET
       title = ?, status = ?, notes = ?, duration_minutes = ?,
       scheduled_for = ?, effort = ?
     WHERE id = ?`,
  ).run(title, status, notes, duration, scheduledFor, effort, taskId)

  const updated = getTaskForHousehold(taskId, member.membership.household_id)!
  const weekStart = weekStartForPlan(updated.meal_plan_id)
  if (weekStart) {
    broadcastPlan(member.membership.household_id, {
      type: 'prep',
      week_start: weekStart,
    })
  }
  return Response.json({ task: toPrepView(updated) })
}

function deletePrep(req: Request, taskId: string): Response {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const task = getTaskForHousehold(taskId, member.membership.household_id)
  if (!task) return jsonError('Prep task not found', 404)

  const weekStart = weekStartForPlan(task.meal_plan_id)
  db.query(`DELETE FROM prep_tasks WHERE id = ?`).run(taskId)
  if (weekStart) {
    broadcastPlan(member.membership.household_id, {
      type: 'prep',
      week_start: weekStart,
    })
  }
  return Response.json({ ok: true })
}

// —— Helpers ——————————————————————————————————————————————————————

function weekStartForPlan(planId: string): string | null {
  const row = db
    .query(`SELECT week_start FROM meal_plans WHERE id = ?`)
    .get(planId) as { week_start: string } | null
  return row?.week_start ?? null
}

function findPlanForWeek(
  householdId: string,
  weekStart: string,
): PlanRow | null {
  return db
    .query(
      `SELECT id, household_id, week_start, status
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

function loadPlannedRecipes(planId: string): PrepRecipeInput[] {
  const entries = db
    .query(
      `SELECT e.date, r.id, r.title, r.tags_json, r.prep_minutes, r.cook_minutes
       FROM meal_plan_entries e
       JOIN recipes r ON r.id = e.recipe_id
       WHERE e.meal_plan_id = ?
         AND e.recipe_id IS NOT NULL
         AND e.status IN ('planned', 'cooked', 'swapped')
       ORDER BY e.sort_order ASC, e.date ASC`,
    )
    .all(planId) as {
    date: string
    id: string
    title: string
    tags_json: string | null
    prep_minutes: number | null
    cook_minutes: number | null
  }[]

  const ingStmt = db.query(
    `SELECT display_name, preparation, ingredient_id
     FROM recipe_ingredients
     WHERE recipe_id = ?
     ORDER BY sort_order ASC`,
  )

  return entries.map((e) => {
    const ings = ingStmt.all(e.id) as {
      display_name: string
      preparation: string | null
      ingredient_id: string | null
    }[]
    return {
      id: e.id,
      title: e.title,
      date: e.date,
      tags: parseTags(e.tags_json),
      prep_minutes: e.prep_minutes,
      cook_minutes: e.cook_minutes,
      ingredients: ings,
    }
  })
}

function getTaskForHousehold(
  taskId: string,
  householdId: string,
): PrepRow | null {
  return db
    .query(
      `SELECT t.id, t.meal_plan_id, t.title, t.scheduled_for, t.duration_minutes,
              t.status, t.linked_recipe_ids_json, t.notes, t.effort
       FROM prep_tasks t
       JOIN meal_plans p ON p.id = t.meal_plan_id
       WHERE t.id = ? AND p.household_id = ?`,
    )
    .get(taskId, householdId) as PrepRow | null
}

function listTasks(planId: string): PrepRow[] {
  return db
    .query(
      `SELECT id, meal_plan_id, title, scheduled_for, duration_minutes,
              status, linked_recipe_ids_json, notes, effort
       FROM prep_tasks
       WHERE meal_plan_id = ?
       ORDER BY
         CASE status WHEN 'pending' THEN 0 WHEN 'skipped' THEN 1 ELSE 2 END,
         scheduled_for IS NULL, scheduled_for ASC,
         title COLLATE NOCASE`,
    )
    .all(planId) as PrepRow[]
}

function toPrepWeek(plan: PlanRow): PrepWeek {
  return {
    week_start: plan.week_start,
    plan_id: plan.id,
    plan_status: plan.status,
    tasks: listTasks(plan.id).map(toPrepView),
  }
}

function toPrepView(row: PrepRow): PrepTaskView {
  const linkedIds = parseLinkedIds(row.linked_recipe_ids_json)
  const linkedRecipes = linkedIds
    .map((id) => {
      const r = db
        .query(`SELECT id, title FROM recipes WHERE id = ?`)
        .get(id) as { id: string; title: string } | null
      return r
    })
    .filter((r): r is { id: string; title: string } => r != null)

  const effort =
    row.effort === 'active' || row.effort === 'passive' ? row.effort : null

  return {
    id: row.id,
    meal_plan_id: row.meal_plan_id,
    title: row.title,
    scheduled_for: row.scheduled_for,
    duration_minutes: row.duration_minutes,
    status: row.status,
    linked_recipe_ids: linkedIds,
    linked_recipes: linkedRecipes,
    notes: row.notes,
    effort,
  }
}

function parseLinkedIds(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter(Boolean)
  } catch {
    return []
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

function householdTimezone(householdId: string): string {
  const row = db
    .query(`SELECT timezone FROM households WHERE id = ?`)
    .get(householdId) as { timezone: string } | null
  return row?.timezone ?? 'America/Los_Angeles'
}

function parseWeekStart(
  raw: string,
): string | { error: Response } {
  if (!isIsoDate(raw)) {
    return { error: jsonError('week_start must be YYYY-MM-DD') }
  }
  return mondayOf(raw)
}
