import type { CookHistoryView, CookRating, RecipeStatus } from '../../shared/types.ts'
import {
  isRecord,
  jsonError,
  readJsonBody,
  requireUser,
} from '../auth.ts'
import { db, newId, nowIso } from '../db.ts'
import { requireMembership } from '../household.ts'

const RATINGS: CookRating[] = ['loved', 'okay', 'dont_suggest']

export async function handleCookHistoryRoutes(
  req: Request,
  path: string,
): Promise<Response | null> {
  if (path === '/api/cook-history' && req.method === 'POST') {
    return createCookHistory(req)
  }
  if (path === '/api/cook-history' && req.method === 'GET') {
    return listCookHistory(req)
  }
  return null
}

async function createCookHistory(req: Request): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error
  if (!isRecord(body)) return jsonError('Expected object body')

  const householdId = member.membership.household_id

  if (typeof body.recipe_id !== 'string' || !body.recipe_id.trim()) {
    return jsonError('recipe_id is required')
  }
  const recipeId = body.recipe_id.trim()

  const recipe = db
    .query(
      `SELECT id, title, status FROM recipes
       WHERE id = ? AND household_id = ?`,
    )
    .get(recipeId, householdId) as {
    id: string
    title: string
    status: RecipeStatus
  } | null
  if (!recipe) return jsonError('Recipe not found', 404)

  let rating: CookRating | null = null
  if ('rating' in body && body.rating != null) {
    if (
      typeof body.rating !== 'string' ||
      !RATINGS.includes(body.rating as CookRating)
    ) {
      return jsonError(`rating must be one of: ${RATINGS.join(', ')}`)
    }
    rating = body.rating as CookRating
  }

  let feedback: string | null = null
  if ('feedback' in body && body.feedback != null) {
    if (typeof body.feedback !== 'string') {
      return jsonError('feedback must be a string or null')
    }
    feedback = body.feedback.trim() || null
  }

  const id = newId()
  const cookedAt = nowIso()

  db.query(
    `INSERT INTO cook_history (id, household_id, recipe_id, cooked_at, rating, feedback)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, householdId, recipeId, cookedAt, rating, feedback)

  // Light status side-effects from dinner-time ratings (§6).
  if (rating === 'loved' && recipe.status !== 'favorite') {
    db.query(`UPDATE recipes SET status = 'favorite' WHERE id = ?`).run(recipeId)
  } else if (rating === 'dont_suggest') {
    db.query(`UPDATE recipes SET status = 'not_for_us' WHERE id = ?`).run(recipeId)
  } else if (
    rating === 'okay' &&
    (recipe.status === 'draft' || recipe.status === 'active')
  ) {
    db.query(`UPDATE recipes SET status = 'tried' WHERE id = ?`).run(recipeId)
  }

  // Mark today's planned entry as cooked when it matches this recipe.
  markTodayEntryCooked(householdId, recipeId)

  const entry: CookHistoryView = {
    id,
    household_id: householdId,
    recipe_id: recipeId,
    recipe_title: recipe.title,
    cooked_at: cookedAt,
    rating,
    feedback,
  }
  return Response.json({ entry }, { status: 201 })
}

function listCookHistory(req: Request): Response {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const url = new URL(req.url)
  const limitRaw = Number(url.searchParams.get('limit') ?? 20)
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.round(limitRaw), 1), 100)
    : 20

  const rows = db
    .query(
      `SELECT h.id, h.household_id, h.recipe_id, h.cooked_at, h.rating, h.feedback,
              r.title AS recipe_title
       FROM cook_history h
       LEFT JOIN recipes r ON r.id = h.recipe_id
       WHERE h.household_id = ?
       ORDER BY h.cooked_at DESC
       LIMIT ?`,
    )
    .all(member.membership.household_id, limit) as {
    id: string
    household_id: string
    recipe_id: string
    cooked_at: string
    rating: CookRating | null
    feedback: string | null
    recipe_title: string | null
  }[]

  const entries: CookHistoryView[] = rows.map((row) => ({
    id: row.id,
    household_id: row.household_id,
    recipe_id: row.recipe_id,
    recipe_title: row.recipe_title,
    cooked_at: row.cooked_at,
    rating: row.rating,
    feedback: row.feedback,
  }))

  return Response.json({ entries })
}

function markTodayEntryCooked(householdId: string, recipeId: string): void {
  const tzRow = db
    .query(`SELECT timezone FROM households WHERE id = ?`)
    .get(householdId) as { timezone: string } | null
  const tz = tzRow?.timezone ?? 'America/Los_Angeles'

  let today: string
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const y = parts.find((p) => p.type === 'year')?.value
    const mo = parts.find((p) => p.type === 'month')?.value
    const da = parts.find((p) => p.type === 'day')?.value
    today = y && mo && da ? `${y}-${mo}-${da}` : new Date().toISOString().slice(0, 10)
  } catch {
    today = new Date().toISOString().slice(0, 10)
  }

  db.query(
    `UPDATE meal_plan_entries
     SET status = 'cooked'
     WHERE recipe_id = ?
       AND date = ?
       AND status IN ('planned', 'swapped')
       AND meal_plan_id IN (
         SELECT id FROM meal_plans
         WHERE household_id = ? AND status != 'archived'
       )`,
  ).run(recipeId, today, householdId)
}
