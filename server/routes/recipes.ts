import type {
  RecipeDetail,
  RecipeIngredient,
  RecipeIngredientInput,
  RecipeStatus,
  RecipeView,
} from '../../shared/types.ts'
import {
  isRecord,
  jsonError,
  readJsonBody,
  requireUser,
} from '../auth.ts'
import { db, newId } from '../db.ts'
import { requireMembership } from '../household.ts'
import { importRecipeFromUrl } from '../recipeImport.ts'

const RECIPE_STATUSES: RecipeStatus[] = [
  'draft',
  'active',
  'favorite',
  'tried',
  'not_for_us',
  'archived',
]

type RecipeRow = {
  id: string
  household_id: string
  title: string
  source_url: string | null
  servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  instructions: string | null
  notes: string | null
  tags_json: string | null
  status: RecipeStatus
  created_by: string | null
}

type IngredientRow = {
  id: string
  recipe_id: string
  ingredient_id: string | null
  display_name: string
  quantity: number | null
  unit: string | null
  preparation: string | null
  optional: number
  sort_order: number
}

export async function handleRecipeRoutes(
  req: Request,
  path: string,
): Promise<Response | null> {
  if (path === '/api/recipes' && req.method === 'GET') {
    return listRecipes(req)
  }
  if (path === '/api/recipes' && req.method === 'POST') {
    return createRecipe(req)
  }
  if (path === '/api/recipes/import' && req.method === 'POST') {
    return importRecipe(req)
  }

  const detailMatch = path.match(/^\/api\/recipes\/([^/]+)$/)
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]!)
    if (req.method === 'GET') return getRecipe(req, id)
    if (req.method === 'PATCH') return updateRecipe(req, id)
    if (req.method === 'DELETE') return deleteRecipe(req, id)
  }

  return null
}

function listRecipes(req: Request): Response {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const householdId = member.membership.household_id

  let rows: RecipeRow[]
  if (!q) {
    rows = db
      .query(
        `SELECT id, household_id, title, source_url, servings,
                prep_minutes, cook_minutes, instructions, notes,
                tags_json, status, created_by
         FROM recipes
         WHERE household_id = ?
         ORDER BY
           CASE status
             WHEN 'favorite' THEN 0
             WHEN 'active' THEN 1
             WHEN 'tried' THEN 2
             WHEN 'draft' THEN 3
             WHEN 'not_for_us' THEN 4
             ELSE 5
           END,
           title COLLATE NOCASE`,
      )
      .all(householdId) as RecipeRow[]
  } else {
    const like = `%${q}%`
    rows = db
      .query(
        `SELECT DISTINCT r.id, r.household_id, r.title, r.source_url, r.servings,
                r.prep_minutes, r.cook_minutes, r.instructions, r.notes,
                r.tags_json, r.status, r.created_by
         FROM recipes r
         LEFT JOIN recipe_ingredients ri ON ri.recipe_id = r.id
         WHERE r.household_id = ?
           AND (
             LOWER(r.title) LIKE ?
             OR LOWER(COALESCE(r.tags_json, '')) LIKE ?
             OR LOWER(ri.display_name) LIKE ?
             OR LOWER(COALESCE(ri.preparation, '')) LIKE ?
           )
         ORDER BY r.title COLLATE NOCASE`,
      )
      .all(householdId, like, like, like, like) as RecipeRow[]
  }

  return Response.json({ recipes: rows.map(toRecipeView) })
}

function getRecipe(req: Request, id: string): Response {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const recipe = getHouseholdRecipe(id, member.membership.household_id)
  if (!recipe) return jsonError('Recipe not found', 404)

  const ingredients = listIngredients(id)
  const url = new URL(req.url)
  const servingsParam = url.searchParams.get('servings')

  const detail: RecipeDetail = {
    ...toRecipeView(recipe),
    ingredients: ingredients.map(toIngredient),
  }

  // Scale helper: ?servings=N multiplies quantity by (N / base servings).
  // Base recipe servings and original display_name are preserved in the payload.
  if (servingsParam != null && servingsParam !== '') {
    const scaledTo = Number(servingsParam)
    const base = recipe.servings
    if (!Number.isFinite(scaledTo) || scaledTo <= 0) {
      return jsonError('servings must be a positive number')
    }
    if (base != null && base > 0) {
      const factor = scaledTo / base
      detail.base_servings = base
      detail.scaled_to = scaledTo
      detail.scale_factor = factor
      detail.servings = scaledTo
      detail.ingredients = detail.ingredients.map((ing) => ({
        ...ing,
        quantity:
          ing.quantity != null && Number.isFinite(ing.quantity)
            ? roundQty(ing.quantity * factor)
            : ing.quantity,
      }))
    } else {
      detail.base_servings = base
      detail.scaled_to = scaledTo
      detail.scale_factor = null
    }
  }

  return Response.json({ recipe: detail })
}

async function createRecipe(req: Request): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error
  if (!isRecord(body)) return jsonError('Expected object body')

  const parsed = parseRecipeBody(body, { requireTitle: true })
  if ('error' in parsed) return parsed.error

  const id = newId()
  const householdId = member.membership.household_id

  db.exec('BEGIN')
  try {
    db.query(
      `INSERT INTO recipes (
         id, household_id, title, source_url, servings,
         prep_minutes, cook_minutes, instructions, notes,
         tags_json, status, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      householdId,
      parsed.title,
      parsed.source_url,
      parsed.servings,
      parsed.prep_minutes,
      parsed.cook_minutes,
      parsed.instructions,
      parsed.notes,
      parsed.tags_json,
      parsed.status,
      auth.user.id,
    )

    insertIngredients(id, parsed.ingredients)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const recipe = getHouseholdRecipe(id, householdId)!
  const detail: RecipeDetail = {
    ...toRecipeView(recipe),
    ingredients: listIngredients(id).map(toIngredient),
  }
  return Response.json({ recipe: detail }, { status: 201 })
}

async function updateRecipe(req: Request, id: string): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const existing = getHouseholdRecipe(id, member.membership.household_id)
  if (!existing) return jsonError('Recipe not found', 404)

  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error
  if (!isRecord(body)) return jsonError('Expected object body')

  const parsed = parseRecipeBody(body, { requireTitle: false })
  if ('error' in parsed) return parsed.error

  const title = parsed.title ?? existing.title
  const source_url =
    'source_url' in body ? parsed.source_url : existing.source_url
  const servings =
    'servings' in body ? parsed.servings : existing.servings
  const prep_minutes =
    'prep_minutes' in body ? parsed.prep_minutes : existing.prep_minutes
  const cook_minutes =
    'cook_minutes' in body ? parsed.cook_minutes : existing.cook_minutes
  const instructions =
    'instructions' in body ? parsed.instructions : existing.instructions
  const notes = 'notes' in body ? parsed.notes : existing.notes
  const tags_json =
    'tags' in body || 'tags_json' in body
      ? parsed.tags_json
      : existing.tags_json
  const status = parsed.status ?? existing.status

  db.exec('BEGIN')
  try {
    db.query(
      `UPDATE recipes SET
         title = ?, source_url = ?, servings = ?,
         prep_minutes = ?, cook_minutes = ?, instructions = ?,
         notes = ?, tags_json = ?, status = ?
       WHERE id = ? AND household_id = ?`,
    ).run(
      title,
      source_url,
      servings,
      prep_minutes,
      cook_minutes,
      instructions,
      notes,
      tags_json,
      status,
      id,
      member.membership.household_id,
    )

    if (parsed.ingredients !== undefined) {
      db.query(`DELETE FROM recipe_ingredients WHERE recipe_id = ?`).run(id)
      insertIngredients(id, parsed.ingredients)
    }

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const recipe = getHouseholdRecipe(id, member.membership.household_id)!
  const detail: RecipeDetail = {
    ...toRecipeView(recipe),
    ingredients: listIngredients(id).map(toIngredient),
  }
  return Response.json({ recipe: detail })
}

function deleteRecipe(req: Request, id: string): Response {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const existing = getHouseholdRecipe(id, member.membership.household_id)
  if (!existing) return jsonError('Recipe not found', 404)

  db.query(`DELETE FROM recipes WHERE id = ? AND household_id = ?`).run(
    id,
    member.membership.household_id,
  )
  return Response.json({ ok: true })
}

async function importRecipe(req: Request): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error
  if (!isRecord(body)) return jsonError('Expected object body')

  const urlRaw = body.url
  if (typeof urlRaw !== 'string' || !urlRaw.trim()) {
    return jsonError('url is required')
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(urlRaw.trim())
  } catch {
    return jsonError('url must be a valid absolute URL')
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return jsonError('url must be http or https')
  }

  const result = await importRecipeFromUrl(parsedUrl.toString())
  return Response.json(result)
}

function getHouseholdRecipe(
  id: string,
  householdId: string,
): RecipeRow | null {
  return db
    .query(
      `SELECT id, household_id, title, source_url, servings,
              prep_minutes, cook_minutes, instructions, notes,
              tags_json, status, created_by
       FROM recipes
       WHERE id = ? AND household_id = ?`,
    )
    .get(id, householdId) as RecipeRow | null
}

function listIngredients(recipeId: string): IngredientRow[] {
  return db
    .query(
      `SELECT id, recipe_id, ingredient_id, display_name, quantity, unit,
              preparation, optional, sort_order
       FROM recipe_ingredients
       WHERE recipe_id = ?
       ORDER BY sort_order ASC, rowid ASC`,
    )
    .all(recipeId) as IngredientRow[]
}

function insertIngredients(
  recipeId: string,
  ingredients: RecipeIngredientInput[],
): void {
  const stmt = db.query(
    `INSERT INTO recipe_ingredients (
       id, recipe_id, ingredient_id, display_name, quantity, unit,
       preparation, optional, sort_order
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  ingredients.forEach((ing, index) => {
    stmt.run(
      newId(),
      recipeId,
      ing.ingredient_id ?? null,
      ing.display_name,
      ing.quantity ?? null,
      ing.unit ?? null,
      ing.preparation ?? null,
      ing.optional ? 1 : 0,
      ing.sort_order ?? index,
    )
  })
}

function toRecipeView(row: RecipeRow): RecipeView {
  return {
    id: row.id,
    household_id: row.household_id,
    title: row.title,
    source_url: row.source_url,
    servings: row.servings,
    prep_minutes: row.prep_minutes,
    cook_minutes: row.cook_minutes,
    instructions: row.instructions,
    notes: row.notes,
    tags: parseTags(row.tags_json),
    status: row.status,
    created_by: row.created_by,
  }
}

function toIngredient(row: IngredientRow): RecipeIngredient {
  return {
    id: row.id,
    recipe_id: row.recipe_id,
    ingredient_id: row.ingredient_id,
    display_name: row.display_name,
    quantity: row.quantity,
    unit: row.unit,
    preparation: row.preparation,
    optional: Boolean(row.optional),
    sort_order: row.sort_order,
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

function encodeTags(tags: string[]): string | null {
  const cleaned = [
    ...new Set(tags.map((t) => t.trim()).filter(Boolean)),
  ].slice(0, 40)
  return cleaned.length ? JSON.stringify(cleaned) : null
}

type ParsedBody = {
  title?: string
  source_url: string | null
  servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  instructions: string | null
  notes: string | null
  tags_json: string | null
  status?: RecipeStatus
  ingredients?: RecipeIngredientInput[]
}

function parseRecipeBody(
  body: Record<string, unknown>,
  opts: { requireTitle: boolean },
): ParsedBody | { error: Response } {
  let title: string | undefined
  if ('title' in body) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return { error: jsonError('title is required') }
    }
    title = body.title.trim()
  } else if (opts.requireTitle) {
    return { error: jsonError('title is required') }
  }

  const source_url =
    body.source_url === null || body.source_url === undefined
      ? null
      : typeof body.source_url === 'string'
        ? body.source_url.trim() || null
        : null
  if (
    'source_url' in body &&
    body.source_url != null &&
    typeof body.source_url !== 'string'
  ) {
    return { error: jsonError('source_url must be a string or null') }
  }

  const servings = optionalNumber(body.servings, 'servings')
  if (servings && 'error' in servings) return servings
  const prep_minutes = optionalInt(body.prep_minutes, 'prep_minutes')
  if (prep_minutes && 'error' in prep_minutes) return prep_minutes
  const cook_minutes = optionalInt(body.cook_minutes, 'cook_minutes')
  if (cook_minutes && 'error' in cook_minutes) return cook_minutes

  const instructions = optionalString(body.instructions)
  const notes = optionalString(body.notes)

  let tags_json: string | null = null
  if ('tags' in body) {
    if (!Array.isArray(body.tags)) {
      return { error: jsonError('tags must be an array of strings') }
    }
    const tags = body.tags.filter((t): t is string => typeof t === 'string')
    tags_json = encodeTags(tags)
  } else if ('tags_json' in body && typeof body.tags_json === 'string') {
    tags_json = encodeTags(parseTags(body.tags_json))
  }

  let status: RecipeStatus | undefined
  if ('status' in body) {
    if (
      typeof body.status !== 'string' ||
      !RECIPE_STATUSES.includes(body.status as RecipeStatus)
    ) {
      return {
        error: jsonError(
          `status must be one of: ${RECIPE_STATUSES.join(', ')}`,
        ),
      }
    }
    status = body.status as RecipeStatus
  } else if (opts.requireTitle) {
    status = 'active'
  }

  let ingredients: RecipeIngredientInput[] | undefined
  if ('ingredients' in body) {
    if (!Array.isArray(body.ingredients)) {
      return { error: jsonError('ingredients must be an array') }
    }
    const parsed: RecipeIngredientInput[] = []
    for (let i = 0; i < body.ingredients.length; i++) {
      const raw = body.ingredients[i]
      if (!isRecord(raw)) {
        return { error: jsonError(`ingredients[${i}] must be an object`) }
      }
      if (typeof raw.display_name !== 'string' || !raw.display_name.trim()) {
        return {
          error: jsonError(`ingredients[${i}].display_name is required`),
        }
      }
      const qty = optionalNumber(raw.quantity, `ingredients[${i}].quantity`)
      if (qty && 'error' in qty) return qty
      parsed.push({
        display_name: raw.display_name.trim(),
        quantity: qty && 'value' in qty ? qty.value : null,
        unit:
          typeof raw.unit === 'string' ? raw.unit.trim() || null : null,
        preparation:
          typeof raw.preparation === 'string'
            ? raw.preparation.trim() || null
            : null,
        optional: Boolean(raw.optional),
        sort_order:
          typeof raw.sort_order === 'number' ? raw.sort_order : i,
        ingredient_id:
          typeof raw.ingredient_id === 'string' ? raw.ingredient_id : null,
      })
    }
    ingredients = parsed
  } else if (opts.requireTitle) {
    ingredients = []
  }

  return {
    title,
    source_url: 'source_url' in body ? source_url : null,
    servings: servings && 'value' in servings ? servings.value : null,
    prep_minutes:
      prep_minutes && 'value' in prep_minutes ? prep_minutes.value : null,
    cook_minutes:
      cook_minutes && 'value' in cook_minutes ? cook_minutes.value : null,
    instructions: 'instructions' in body ? instructions : null,
    notes: 'notes' in body ? notes : null,
    tags_json,
    status,
    ingredients,
  }
}

function optionalString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string') return null
  return value.trim() || null
}

function optionalNumber(
  value: unknown,
  field: string,
): { value: number | null } | { error: Response } | null {
  if (value === undefined) return null
  if (value === null || value === '') return { value: null }
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) {
    return { error: jsonError(`${field} must be a number`) }
  }
  return { value: n }
}

function optionalInt(
  value: unknown,
  field: string,
): { value: number | null } | { error: Response } | null {
  const n = optionalNumber(value, field)
  if (!n || 'error' in n) return n
  if (n.value == null) return n
  return { value: Math.round(n.value) }
}

function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000
}
