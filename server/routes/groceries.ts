import type {
  GroceryItem,
  GroceryList,
  GrocerySourceType,
  MealPlanStatus,
} from '../../shared/types.ts'
import {
  isRecord,
  jsonError,
  readJsonBody,
  requireUser,
} from '../auth.ts'
import { db, newId, nowIso } from '../db.ts'
import {
  AISLE_ORDER,
  aggregateIngredients,
  decodeSourceNotes,
  encodeSourceNotes,
  formatQuantityLabel,
  identityKeyFromStored,
  normalizeNameKey,
  type AggregateSourceLine,
  type AggregatedGroceryLine,
} from '../groceryAggregate.ts'
import { broadcastGrocery, openGroceryStream } from '../groceryStream.ts'
import { requireMembership } from '../household.ts'
import {
  datesForWeek,
  isIsoDate,
  mondayOf,
  todayInTimezone,
} from '../week.ts'

const ITEM_COLS = `id, grocery_list_id, ingredient_id, display_name, quantity, unit,
  category, checked_at, source_type, source_recipe_id, manual, notes,
  updated_at, version`

type GroceryListRow = {
  id: string
  household_id: string
  name: string
  date_range_start: string | null
  date_range_end: string | null
}

type GroceryItemRow = {
  id: string
  grocery_list_id: string
  ingredient_id: string | null
  display_name: string
  quantity: number | null
  unit: string | null
  category: string | null
  checked_at: string | null
  source_type: GrocerySourceType
  source_recipe_id: string | null
  manual: number
  notes: string | null
  updated_at: string | null
  version: number
}

export type GroceryItemView = GroceryItem & {
  source_recipes: { id: string; title: string }[]
  already_have: boolean
  quantity_label: string
}

export type GroceryListDetail = GroceryList & {
  items: GroceryItemView[]
  aisle_order: string[]
  week_start: string | null
  plan_id: string | null
  plan_status: MealPlanStatus | null
}

export async function handleGroceryRoutes(
  req: Request,
  path: string,
): Promise<Response | null> {
  if (path === '/api/groceries/stream' && req.method === 'GET') {
    return groceryStream(req)
  }
  if (path === '/api/groceries/current' && req.method === 'GET') {
    return getCurrentList(req)
  }
  if (path === '/api/groceries/regenerate' && req.method === 'POST') {
    return regenerateList(req)
  }
  if (path === '/api/groceries/items' && req.method === 'POST') {
    return addManualItem(req)
  }

  const itemMatch = path.match(/^\/api\/groceries\/items\/([^/]+)$/)
  if (itemMatch) {
    const id = decodeURIComponent(itemMatch[1]!)
    if (req.method === 'PATCH') return patchItem(req, id)
    if (req.method === 'DELETE') return deleteItem(req, id)
  }

  return null
}

/**
 * Called when a meal plan is approved — build/refresh grocery list for
 * the plan week (preserve manual + checked / already-have rows).
 */
export function regenerateGroceryForPlan(
  planId: string,
  householdId: string,
): GroceryListDetail | null {
  const plan = db
    .query(
      `SELECT id, household_id, week_start, status, created_at, approved_at
       FROM meal_plans
       WHERE id = ? AND household_id = ?`,
    )
    .get(planId, householdId) as {
    id: string
    household_id: string
    week_start: string
    status: MealPlanStatus
  } | null

  if (!plan) return null

  const weekDates = datesForWeek(plan.week_start)
  const dateEnd = weekDates[6]!
  const list = ensureGroceryList(householdId, plan.week_start, dateEnd)
  const derived = collectDerivedLines(plan.id, householdId)
  applyDerivedToList(list.id, derived, householdId)

  const detail = loadListDetail(list.id, householdId)
  if (detail?.week_start) {
    broadcastGrocery(householdId, {
      type: 'list',
      week_start: detail.week_start,
      list: detail,
    })
  }
  return detail
}

/**
 * Entry edits on an approved plan should refresh recipe-derived lines.
 */
export function onPlanEntryChangedForGrocery(
  planId: string,
  _entryId: string,
  householdId: string,
  planStatus: MealPlanStatus,
): void {
  if (planStatus !== 'approved') return
  regenerateGroceryForPlan(planId, householdId)
}

export function onPlanApprovedForGrocery(
  planId: string,
  householdId: string,
): void {
  regenerateGroceryForPlan(planId, householdId)
}

function groceryStream(req: Request): Response {
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

  return openGroceryStream(member.membership.household_id, weekStart)
}

function getCurrentList(req: Request): Response {
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

  const weekDates = datesForWeek(weekStart)
  const dateEnd = weekDates[6]!

  let list = findListForWeek(householdId, weekStart)
  if (!list) {
    list = ensureGroceryList(householdId, weekStart, dateEnd)
  }

  const detail = loadListDetail(list.id, householdId)!
  return Response.json({ list: detail })
}

async function regenerateList(req: Request): Promise<Response> {
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
    return jsonError('No meal plan for that week', 404)
  }
  if (plan.status !== 'approved') {
    return jsonError(
      'Approve the meal plan before regenerating the grocery list',
      400,
    )
  }

  const detail = regenerateGroceryForPlan(plan.id, householdId)
  if (!detail) return jsonError('Could not regenerate grocery list', 500)
  // Broadcast already sent from regenerateGroceryForPlan.
  return Response.json({ list: detail })
}

async function addManualItem(req: Request): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const householdId = member.membership.household_id
  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error
  if (!isRecord(body)) return jsonError('Expected object body')

  if (typeof body.display_name !== 'string' || !body.display_name.trim()) {
    return jsonError('display_name is required')
  }

  let weekStart: string
  if (typeof body.week_start === 'string' && body.week_start.trim()) {
    const parsed = parseWeekStart(body.week_start.trim())
    if (typeof parsed !== 'string') return parsed.error
    weekStart = parsed
  } else {
    weekStart = mondayOf(todayInTimezone(householdTimezone(householdId)))
  }

  const weekDates = datesForWeek(weekStart)
  const list = ensureGroceryList(householdId, weekStart, weekDates[6]!)

  let quantity: number | null = null
  if ('quantity' in body && body.quantity !== undefined && body.quantity !== null) {
    const n = Number(body.quantity)
    if (!Number.isFinite(n) || n < 0) {
      return jsonError('quantity must be a non-negative number or null')
    }
    quantity = n
  }

  const unit =
    typeof body.unit === 'string' && body.unit.trim()
      ? body.unit.trim()
      : null
  const category =
    typeof body.category === 'string' && body.category.trim()
      ? body.category.trim()
      : 'Other'

  const id = newId()
  const ts = nowIso()
  db.query(
    `INSERT INTO grocery_items (
       id, grocery_list_id, ingredient_id, display_name, quantity, unit,
       category, checked_at, source_type, source_recipe_id, manual, notes,
       updated_at, version
     ) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, 'manual', NULL, 1, ?, ?, 1)`,
  ).run(
    id,
    list.id,
    body.display_name.trim(),
    quantity,
    unit,
    category,
    typeof body.notes === 'string' ? body.notes.trim() || null : null,
    ts,
  )

  const row = getItemRow(id)!
  const item = toItemView(row)
  broadcastGrocery(householdId, {
    type: 'item',
    week_start: weekStart,
    item,
  })
  return Response.json({ item }, { status: 201 })
}

async function patchItem(req: Request, itemId: string): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const householdId = member.membership.household_id
  const row = getItemForHousehold(itemId, householdId)
  if (!row) return jsonError('Item not found', 404)

  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error
  if (!isRecord(body)) return jsonError('Expected object body')

  let displayName = row.display_name
  let quantity = row.quantity
  let unit = row.unit
  let category = row.category
  let checkedAt = row.checked_at
  let sourceType = row.source_type
  let notes = row.notes
  let manual = row.manual

  if ('display_name' in body) {
    if (typeof body.display_name !== 'string' || !body.display_name.trim()) {
      return jsonError('display_name must be a non-empty string')
    }
    displayName = body.display_name.trim()
  }

  if ('quantity' in body) {
    if (body.quantity === null) {
      quantity = null
    } else {
      const n = Number(body.quantity)
      if (!Number.isFinite(n) || n < 0) {
        return jsonError('quantity must be a non-negative number or null')
      }
      quantity = n
    }
  }

  if ('unit' in body) {
    if (body.unit === null) {
      unit = null
    } else if (typeof body.unit === 'string') {
      unit = body.unit.trim() || null
    } else {
      return jsonError('unit must be a string or null')
    }
  }

  if ('category' in body) {
    if (body.category === null) {
      category = 'Other'
    } else if (typeof body.category === 'string' && body.category.trim()) {
      category = body.category.trim()
    } else {
      return jsonError('category must be a non-empty string or null')
    }
  }

  if ('checked' in body) {
    if (typeof body.checked !== 'boolean') {
      return jsonError('checked must be a boolean')
    }
    checkedAt = body.checked ? (checkedAt ?? nowIso()) : null
  }

  if ('checked_at' in body) {
    if (body.checked_at === null) {
      checkedAt = null
    } else if (typeof body.checked_at === 'string') {
      checkedAt = body.checked_at
    } else {
      return jsonError('checked_at must be a string or null')
    }
  }

  if ('already_have' in body) {
    if (typeof body.already_have !== 'boolean') {
      return jsonError('already_have must be a boolean')
    }
    if (body.already_have) {
      // Remove from shopping without deleting recipe provenance.
      sourceType = 'pantry_check'
      checkedAt = checkedAt ?? nowIso()
      const decoded = decodeSourceNotes(notes)
      notes = encodeSourceNotes(decoded.recipes, {
        text: decoded.text ?? 'Already have',
      })
    } else if (sourceType === 'pantry_check' && manual === 0) {
      // Restore to shopping; keep pantry_check for non-quantified (to taste).
      sourceType = quantity == null ? 'pantry_check' : 'recipe'
      checkedAt = null
      const decoded = decodeSourceNotes(notes)
      notes = encodeSourceNotes(decoded.recipes, { text: null })
    } else if (sourceType === 'pantry_check' && manual === 1) {
      sourceType = 'manual'
      checkedAt = null
    }
  }

  if ('notes' in body) {
    if (body.notes === null) {
      const decoded = decodeSourceNotes(notes)
      notes =
        decoded.recipes.length > 0
          ? encodeSourceNotes(decoded.recipes)
          : null
    } else if (typeof body.notes === 'string') {
      const decoded = decodeSourceNotes(notes)
      if (decoded.recipes.length > 0) {
        notes = encodeSourceNotes(decoded.recipes, { text: body.notes })
      } else {
        notes = body.notes.trim() || null
      }
    } else {
      return jsonError('notes must be a string or null')
    }
  }

  const ts = nowIso()
  db.query(
    `UPDATE grocery_items SET
       display_name = ?, quantity = ?, unit = ?, category = ?,
       checked_at = ?, source_type = ?, notes = ?,
       updated_at = ?, version = version + 1
     WHERE id = ?`,
  ).run(
    displayName,
    quantity,
    unit,
    category,
    checkedAt,
    sourceType,
    notes,
    ts,
    itemId,
  )

  const updated = getItemRow(itemId)!
  const item = toItemView(updated)
  const weekStart = weekStartForList(row.grocery_list_id)
  if (weekStart) {
    broadcastGrocery(householdId, {
      type: 'item',
      week_start: weekStart,
      item,
    })
  }
  return Response.json({ item })
}

function deleteItem(req: Request, itemId: string): Response {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const householdId = member.membership.household_id
  const row = getItemForHousehold(itemId, householdId)
  if (!row) return jsonError('Item not found', 404)

  const weekStart = weekStartForList(row.grocery_list_id)
  db.query(`DELETE FROM grocery_items WHERE id = ?`).run(itemId)
  if (weekStart) {
    broadcastGrocery(householdId, {
      type: 'item_deleted',
      week_start: weekStart,
      item_id: itemId,
      grocery_list_id: row.grocery_list_id,
    })
  }
  return Response.json({ ok: true })
}

// —— Regeneration helpers ————————————————————————————————————————————————

function collectDerivedLines(
  planId: string,
  householdId: string,
): AggregatedGroceryLine[] {
  const entries = db
    .query(
      `SELECT e.recipe_id, e.servings AS entry_servings,
              r.title AS recipe_title, r.servings AS recipe_servings
       FROM meal_plan_entries e
       JOIN recipes r ON r.id = e.recipe_id
       WHERE e.meal_plan_id = ?
         AND e.recipe_id IS NOT NULL
         AND e.status = 'planned'
         AND r.household_id = ?`,
    )
    .all(planId, householdId) as {
    recipe_id: string
    entry_servings: number | null
    recipe_title: string
    recipe_servings: number | null
  }[]

  const sourceLines: AggregateSourceLine[] = []

  for (const entry of entries) {
    const baseServings = entry.recipe_servings
    const target = entry.entry_servings
    const scaleFactor =
      baseServings != null &&
      baseServings > 0 &&
      target != null &&
      target > 0
        ? target / baseServings
        : 1

    const ings = db
      .query(
        `SELECT ri.display_name, ri.quantity, ri.unit, ri.preparation,
                ri.ingredient_id, ri.optional,
                i.category AS ing_category
         FROM recipe_ingredients ri
         LEFT JOIN ingredients i ON i.id = ri.ingredient_id
         WHERE ri.recipe_id = ?
         ORDER BY ri.sort_order ASC`,
      )
      .all(entry.recipe_id) as {
      display_name: string
      quantity: number | null
      unit: string | null
      preparation: string | null
      ingredient_id: string | null
      optional: number
      ing_category: string | null
    }[]

    for (const ing of ings) {
      // Optional ingredients still appear (user can already-have / uncheck).
      sourceLines.push({
        recipeId: entry.recipe_id,
        recipeTitle: entry.recipe_title,
        displayName: ing.display_name,
        quantity: ing.quantity,
        unit: ing.unit,
        preparation: ing.preparation,
        ingredientId: ing.ingredient_id,
        categoryHint: ing.ing_category,
        scaleFactor,
      })
    }
  }

  return aggregateIngredients(sourceLines)
}

/**
 * Shared pantry basics → grocery regen: when a derived line's normalized name
 * (or ingredient_id) matches a household pantry_items row, keep the item on the
 * list but pre-mark as already_have (pantry_check + checked + "In pantry" note)
 * so the shopper can undo. Manual rows are never touched.
 */
function applyDerivedToList(
  listId: string,
  derived: AggregatedGroceryLine[],
  householdId: string,
): void {
  const existing = db
    .query(
      `SELECT ${ITEM_COLS}
       FROM grocery_items
       WHERE grocery_list_id = ?`,
    )
    .all(listId) as GroceryItemRow[]

  const manualRows = existing.filter((r) => r.manual === 1)
  const derivedRows = existing.filter((r) => r.manual === 0)
  const pantry = loadPantryMatchIndex(householdId)

  const byKey = new Map<string, GroceryItemRow>()
  for (const row of derivedRows) {
    byKey.set(identityKeyFromStored(row), row)
  }

  const seenKeys = new Set<string>()

  db.exec('BEGIN')
  try {
    for (const line of derived) {
      seenKeys.add(line.identityKey)
      const prev = byKey.get(line.identityKey)
      const primaryRecipeId =
        line.sourceRecipes.length === 1
          ? line.sourceRecipes[0]!.id
          : line.sourceRecipes[0]?.id ?? null

      const inPantry = lineMatchesPantry(line, pantry)
      const ts = nowIso()
      if (prev) {
        // User "Already have" = pantry_check + checked. Aggregation pantry_check
        // alone (salt to taste) stays on the list unchecked unless pantry matches.
        const userAlreadyHave =
          prev.source_type === 'pantry_check' && Boolean(prev.checked_at)
        const alreadyHave = userAlreadyHave || inPantry
        const sourceType = alreadyHave ? 'pantry_check' : line.sourceType
        const checkedAt = alreadyHave
          ? (prev.checked_at ?? ts)
          : prev.checked_at
        const noteText = inPantry
          ? 'In pantry'
          : alreadyHave
            ? (decodeSourceNotes(prev.notes).text ?? 'Already have')
            : null
        const notes = encodeSourceNotes(line.sourceRecipes, {
          text: noteText,
        })

        db.query(
          `UPDATE grocery_items SET
             ingredient_id = ?, display_name = ?, quantity = ?, unit = ?,
             category = ?, checked_at = ?, source_type = ?,
             source_recipe_id = ?, manual = 0, notes = ?,
             updated_at = ?, version = version + 1
           WHERE id = ?`,
        ).run(
          line.ingredientId,
          line.displayName,
          alreadyHave && userAlreadyHave && !inPantry
            ? prev.quantity
            : line.quantity,
          alreadyHave && userAlreadyHave && !inPantry ? prev.unit : line.unit,
          line.category,
          checkedAt,
          sourceType,
          primaryRecipeId,
          notes,
          ts,
          prev.id,
        )
      } else {
        const sourceType = inPantry ? 'pantry_check' : line.sourceType
        const checkedAt = inPantry ? ts : null
        const notes = encodeSourceNotes(line.sourceRecipes, {
          text: inPantry ? 'In pantry' : null,
        })
        db.query(
          `INSERT INTO grocery_items (
             id, grocery_list_id, ingredient_id, display_name, quantity, unit,
             category, checked_at, source_type, source_recipe_id, manual, notes,
             updated_at, version
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1)`,
        ).run(
          newId(),
          listId,
          line.ingredientId,
          line.displayName,
          line.quantity,
          line.unit,
          line.category,
          checkedAt,
          sourceType,
          primaryRecipeId,
          notes,
          ts,
        )
      }
    }

    // Drop recipe-derived rows no longer needed (manual rows untouched).
    for (const row of derivedRows) {
      const key = identityKeyFromStored(row)
      if (!seenKeys.has(key)) {
        db.query(`DELETE FROM grocery_items WHERE id = ?`).run(row.id)
      }
    }

    // Manual rows are never deleted by regeneration.
    void manualRows

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

type PantryMatchIndex = {
  nameKeys: Set<string>
  ingredientIds: Set<string>
}

function loadPantryMatchIndex(householdId: string): PantryMatchIndex {
  const rows = db
    .query(
      `SELECT display_name, ingredient_id
       FROM pantry_items
       WHERE household_id = ?`,
    )
    .all(householdId) as {
    display_name: string
    ingredient_id: string | null
  }[]

  const nameKeys = new Set<string>()
  const ingredientIds = new Set<string>()
  for (const row of rows) {
    nameKeys.add(normalizeNameKey(row.display_name))
    if (row.ingredient_id) ingredientIds.add(row.ingredient_id)
  }
  return { nameKeys, ingredientIds }
}

function lineMatchesPantry(
  line: AggregatedGroceryLine,
  pantry: PantryMatchIndex,
): boolean {
  if (line.ingredientId && pantry.ingredientIds.has(line.ingredientId)) {
    return true
  }
  return pantry.nameKeys.has(normalizeNameKey(line.displayName))
}

function ensureGroceryList(
  householdId: string,
  weekStart: string,
  weekEnd: string,
): GroceryListRow {
  const existing = findListForWeek(householdId, weekStart)
  if (existing) {
    db.query(
      `UPDATE grocery_lists SET date_range_end = ?, name = ? WHERE id = ?`,
    ).run(weekEnd, `Week of ${weekStart}`, existing.id)
    return {
      ...existing,
      date_range_end: weekEnd,
      name: `Week of ${weekStart}`,
    }
  }

  const id = newId()
  db.query(
    `INSERT INTO grocery_lists (id, household_id, name, date_range_start, date_range_end)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, householdId, `Week of ${weekStart}`, weekStart, weekEnd)

  return {
    id,
    household_id: householdId,
    name: `Week of ${weekStart}`,
    date_range_start: weekStart,
    date_range_end: weekEnd,
  }
}

function findListForWeek(
  householdId: string,
  weekStart: string,
): GroceryListRow | null {
  return db
    .query(
      `SELECT id, household_id, name, date_range_start, date_range_end
       FROM grocery_lists
       WHERE household_id = ? AND date_range_start = ?
       ORDER BY id ASC
       LIMIT 1`,
    )
    .get(householdId, weekStart) as GroceryListRow | null
}

function findPlanForWeek(
  householdId: string,
  weekStart: string,
): { id: string; status: MealPlanStatus; week_start: string } | null {
  return db
    .query(
      `SELECT id, status, week_start FROM meal_plans
       WHERE household_id = ? AND week_start = ?
         AND status != 'archived'
       ORDER BY
         CASE status WHEN 'approved' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
         created_at DESC
       LIMIT 1`,
    )
    .get(householdId, weekStart) as {
    id: string
    status: MealPlanStatus
    week_start: string
  } | null
}

function loadListDetail(
  listId: string,
  householdId: string,
): GroceryListDetail | null {
  const list = db
    .query(
      `SELECT id, household_id, name, date_range_start, date_range_end
       FROM grocery_lists
       WHERE id = ? AND household_id = ?`,
    )
    .get(listId, householdId) as GroceryListRow | null
  if (!list) return null

  const rows = db
    .query(
      `SELECT ${ITEM_COLS}
       FROM grocery_items
       WHERE grocery_list_id = ?
       ORDER BY
         CASE WHEN checked_at IS NULL THEN 0 ELSE 1 END,
         display_name COLLATE NOCASE`,
    )
    .all(listId) as GroceryItemRow[]

  const weekStart = list.date_range_start
  const plan = weekStart ? findPlanForWeek(householdId, weekStart) : null

  return {
    id: list.id,
    household_id: list.household_id,
    name: list.name,
    date_range_start: list.date_range_start,
    date_range_end: list.date_range_end,
    items: rows.map(toItemView),
    aisle_order: [...AISLE_ORDER],
    week_start: weekStart,
    plan_id: plan?.id ?? null,
    plan_status: plan?.status ?? null,
  }
}

function getItemRow(id: string): GroceryItemRow | null {
  return db
    .query(`SELECT ${ITEM_COLS} FROM grocery_items WHERE id = ?`)
    .get(id) as GroceryItemRow | null
}

function getItemForHousehold(
  itemId: string,
  householdId: string,
): GroceryItemRow | null {
  return db
    .query(
      `SELECT gi.id, gi.grocery_list_id, gi.ingredient_id, gi.display_name,
              gi.quantity, gi.unit, gi.category, gi.checked_at, gi.source_type,
              gi.source_recipe_id, gi.manual, gi.notes,
              gi.updated_at, gi.version
       FROM grocery_items gi
       JOIN grocery_lists gl ON gl.id = gi.grocery_list_id
       WHERE gi.id = ? AND gl.household_id = ?`,
    )
    .get(itemId, householdId) as GroceryItemRow | null
}

function weekStartForList(listId: string): string | null {
  const row = db
    .query(`SELECT date_range_start FROM grocery_lists WHERE id = ?`)
    .get(listId) as { date_range_start: string | null } | null
  return row?.date_range_start ?? null
}

function toItemView(row: GroceryItemRow): GroceryItemView {
  const decoded = decodeSourceNotes(row.notes)
  let sourceRecipes = decoded.recipes

  // Fallback: single source_recipe_id when notes lack structured recipes.
  if (sourceRecipes.length === 0 && row.source_recipe_id) {
    const recipe = db
      .query(`SELECT id, title FROM recipes WHERE id = ?`)
      .get(row.source_recipe_id) as { id: string; title: string } | null
    if (recipe) sourceRecipes = [recipe]
  }

  return {
    id: row.id,
    grocery_list_id: row.grocery_list_id,
    ingredient_id: row.ingredient_id,
    display_name: row.display_name,
    quantity: row.quantity,
    unit: row.unit,
    category: row.category,
    checked_at: row.checked_at,
    source_type: row.source_type,
    source_recipe_id: row.source_recipe_id,
    manual: row.manual === 1,
    notes: decoded.text,
    updated_at: row.updated_at ?? nowIso(),
    version: row.version ?? 1,
    source_recipes: sourceRecipes,
    // User/pantry "already have" = pantry_check + checked. Aggregation-only
    // pantry_check (e.g. salt to taste) stays on the list unchecked.
    already_have:
      row.source_type === 'pantry_check' && Boolean(row.checked_at),
    quantity_label: formatQuantityLabel(row.quantity, row.unit),
  }
}

function parseWeekStart(
  raw: string,
): string | { error: Response } {
  if (!isIsoDate(raw)) {
    return { error: jsonError('week_start must be YYYY-MM-DD') }
  }
  return mondayOf(raw)
}

function householdTimezone(householdId: string): string {
  const row = db
    .query(`SELECT timezone FROM households WHERE id = ?`)
    .get(householdId) as { timezone: string } | null
  return row?.timezone ?? 'America/Los_Angeles'
}
