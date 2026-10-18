import { db } from './db.ts'
import { getHouseholdPreferencesView } from './planDraft.ts'
import { getHouseholdWithMembers } from './household.ts'
import type { HouseholdMemberRole } from '../shared/types.ts'

/**
 * Full household JSON dump for privacy/export.
 * Shape: { exported_at, household, preferences, recipes, plans, groceries,
 *          pantry, prep, cook_history }
 */
export function buildHouseholdExport(
  householdId: string,
  viewerRole: HouseholdMemberRole,
) {
  const household = getHouseholdWithMembers(householdId, viewerRole)
  if (!household) return null

  const preferences = getHouseholdPreferencesView(householdId)

  const recipes = db
    .query(
      `SELECT id, household_id, title, source_url, servings, prep_minutes,
              cook_minutes, instructions, notes, tags_json, status, created_by
       FROM recipes WHERE household_id = ?
       ORDER BY title COLLATE NOCASE`,
    )
    .all(householdId) as Record<string, unknown>[]

  const recipeIds = recipes.map((r) => r.id as string)
  const ingredientsByRecipe = new Map<string, Record<string, unknown>[]>()
  if (recipeIds.length) {
    const placeholders = recipeIds.map(() => '?').join(', ')
    const rows = db
      .query(
        `SELECT id, recipe_id, ingredient_id, display_name, quantity, unit,
                preparation, optional, sort_order
         FROM recipe_ingredients
         WHERE recipe_id IN (${placeholders})
         ORDER BY sort_order, display_name COLLATE NOCASE`,
      )
      .all(...recipeIds) as (Record<string, unknown> & {
      recipe_id: string
      optional: number
      tags_json?: never
    })[]

    for (const row of rows) {
      const list = ingredientsByRecipe.get(row.recipe_id) ?? []
      list.push({
        id: row.id,
        ingredient_id: row.ingredient_id,
        display_name: row.display_name,
        quantity: row.quantity,
        unit: row.unit,
        preparation: row.preparation,
        optional: Boolean(row.optional),
        sort_order: row.sort_order,
      })
      ingredientsByRecipe.set(row.recipe_id, list)
    }
  }

  const recipesOut = recipes.map((r) => ({
    id: r.id,
    title: r.title,
    source_url: r.source_url,
    servings: r.servings,
    prep_minutes: r.prep_minutes,
    cook_minutes: r.cook_minutes,
    instructions: r.instructions,
    notes: r.notes,
    tags: parseJsonArray(r.tags_json as string | null),
    status: r.status,
    created_by: r.created_by,
    ingredients: ingredientsByRecipe.get(r.id as string) ?? [],
  }))

  const plans = db
    .query(
      `SELECT id, household_id, week_start, status, created_at, approved_at
       FROM meal_plans WHERE household_id = ?
       ORDER BY week_start DESC`,
    )
    .all(householdId) as Record<string, unknown>[]

  const planIds = plans.map((p) => p.id as string)
  const entriesByPlan = new Map<string, Record<string, unknown>[]>()
  const prepByPlan = new Map<string, Record<string, unknown>[]>()

  if (planIds.length) {
    const placeholders = planIds.map(() => '?').join(', ')
    const entries = db
      .query(
        `SELECT id, meal_plan_id, date, meal_type, recipe_id, servings, notes,
                status, sort_order
         FROM meal_plan_entries
         WHERE meal_plan_id IN (${placeholders})
         ORDER BY date, sort_order`,
      )
      .all(...planIds) as (Record<string, unknown> & { meal_plan_id: string })[]

    for (const e of entries) {
      const list = entriesByPlan.get(e.meal_plan_id) ?? []
      list.push({
        id: e.id,
        date: e.date,
        meal_type: e.meal_type,
        recipe_id: e.recipe_id,
        servings: e.servings,
        notes: e.notes,
        status: e.status,
        sort_order: e.sort_order,
      })
      entriesByPlan.set(e.meal_plan_id, list)
    }

    const prepRows = db
      .query(
        `SELECT id, meal_plan_id, title, scheduled_for, duration_minutes, status,
                linked_recipe_ids_json, notes, effort
         FROM prep_tasks
         WHERE meal_plan_id IN (${placeholders})
         ORDER BY scheduled_for, title`,
      )
      .all(...planIds) as (Record<string, unknown> & {
      meal_plan_id: string
      linked_recipe_ids_json: string | null
    })[]

    for (const t of prepRows) {
      const list = prepByPlan.get(t.meal_plan_id) ?? []
      list.push({
        id: t.id,
        title: t.title,
        scheduled_for: t.scheduled_for,
        duration_minutes: t.duration_minutes,
        status: t.status,
        linked_recipe_ids: parseJsonArray(t.linked_recipe_ids_json),
        notes: t.notes,
        effort: t.effort,
      })
      prepByPlan.set(t.meal_plan_id, list)
    }
  }

  const plansOut = plans.map((p) => ({
    id: p.id,
    week_start: p.week_start,
    status: p.status,
    created_at: p.created_at,
    approved_at: p.approved_at,
    entries: entriesByPlan.get(p.id as string) ?? [],
    prep_tasks: prepByPlan.get(p.id as string) ?? [],
  }))

  const groceryLists = db
    .query(
      `SELECT id, household_id, name, date_range_start, date_range_end
       FROM grocery_lists WHERE household_id = ?
       ORDER BY name COLLATE NOCASE`,
    )
    .all(householdId) as Record<string, unknown>[]

  const listIds = groceryLists.map((g) => g.id as string)
  const itemsByList = new Map<string, Record<string, unknown>[]>()
  if (listIds.length) {
    const placeholders = listIds.map(() => '?').join(', ')
    const items = db
      .query(
        `SELECT id, grocery_list_id, ingredient_id, display_name, quantity, unit,
                category, checked_at, source_type, source_recipe_id, manual,
                notes, updated_at, version
         FROM grocery_items
         WHERE grocery_list_id IN (${placeholders})
         ORDER BY category, display_name COLLATE NOCASE`,
      )
      .all(...listIds) as (Record<string, unknown> & {
      grocery_list_id: string
      manual: number
    })[]

    for (const item of items) {
      const list = itemsByList.get(item.grocery_list_id) ?? []
      list.push({
        id: item.id,
        ingredient_id: item.ingredient_id,
        display_name: item.display_name,
        quantity: item.quantity,
        unit: item.unit,
        category: item.category,
        checked_at: item.checked_at,
        source_type: item.source_type,
        source_recipe_id: item.source_recipe_id,
        manual: Boolean(item.manual),
        notes: item.notes,
        updated_at: item.updated_at,
        version: item.version,
      })
      itemsByList.set(item.grocery_list_id, list)
    }
  }

  const groceriesOut = groceryLists.map((g) => ({
    id: g.id,
    name: g.name,
    date_range_start: g.date_range_start,
    date_range_end: g.date_range_end,
    items: itemsByList.get(g.id as string) ?? [],
  }))

  const pantry = db
    .query(
      `SELECT id, ingredient_id, display_name, quantity, unit, location, expires_on
       FROM pantry_items WHERE household_id = ?
       ORDER BY display_name COLLATE NOCASE`,
    )
    .all(householdId)

  const cook_history = db
    .query(
      `SELECT id, recipe_id, cooked_at, rating, feedback
       FROM cook_history WHERE household_id = ?
       ORDER BY cooked_at DESC`,
    )
    .all(householdId)

  return {
    exported_at: new Date().toISOString(),
    household: {
      id: household.id,
      name: household.name,
      timezone: household.timezone,
      created_at: household.created_at,
      members: household.members,
    },
    preferences,
    recipes: recipesOut,
    plans: plansOut,
    groceries: groceriesOut,
    pantry,
    cook_history,
  }
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}
