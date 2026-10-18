import type { PantryItem } from '../../shared/types.ts'
import {
  isRecord,
  jsonError,
  readJsonBody,
  requireUser,
} from '../auth.ts'
import { db, newId } from '../db.ts'
import { requireMembership } from '../household.ts'

const LOCATIONS = ['fridge', 'freezer', 'cupboard', 'other'] as const
type PantryLocation = (typeof LOCATIONS)[number]

type PantryRow = {
  id: string
  household_id: string
  ingredient_id: string | null
  display_name: string
  quantity: number | null
  unit: string | null
  location: string | null
  expires_on: string | null
}

export async function handlePantryRoutes(
  req: Request,
  path: string,
): Promise<Response | null> {
  if (path === '/api/pantry' && req.method === 'GET') {
    return listPantry(req)
  }
  if (path === '/api/pantry' && req.method === 'POST') {
    return createPantryItem(req)
  }

  const detailMatch = path.match(/^\/api\/pantry\/([^/]+)$/)
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]!)
    if (req.method === 'PATCH') return patchPantryItem(req, id)
    if (req.method === 'DELETE') return deletePantryItem(req, id)
  }

  return null
}

function listPantry(req: Request): Response {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const rows = db
    .query(
      `SELECT id, household_id, ingredient_id, display_name, quantity, unit,
              location, expires_on
       FROM pantry_items
       WHERE household_id = ?
       ORDER BY
         CASE location
           WHEN 'fridge' THEN 0
           WHEN 'freezer' THEN 1
           WHEN 'cupboard' THEN 2
           WHEN 'other' THEN 3
           ELSE 4
         END,
         display_name COLLATE NOCASE`,
    )
    .all(member.membership.household_id) as PantryRow[]

  return Response.json({ items: rows.map(toView) })
}

async function createPantryItem(req: Request): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error
  if (!isRecord(body)) return jsonError('Expected object body')

  if (typeof body.display_name !== 'string' || !body.display_name.trim()) {
    return jsonError('display_name is required')
  }

  const parsed = parseOptionalFields(body)
  if ('error' in parsed) return parsed.error

  const id = newId()
  const householdId = member.membership.household_id

  db.query(
    `INSERT INTO pantry_items (
       id, household_id, ingredient_id, display_name, quantity, unit,
       location, expires_on
     ) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    householdId,
    body.display_name.trim(),
    parsed.quantity,
    parsed.unit,
    parsed.location,
  )

  const row = getRow(id, householdId)
  if (!row) return jsonError('Could not create pantry item', 500)
  return Response.json({ item: toView(row) }, { status: 201 })
}

async function patchPantryItem(req: Request, id: string): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const householdId = member.membership.household_id
  const existing = getRow(id, householdId)
  if (!existing) return jsonError('Pantry item not found', 404)

  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error
  if (!isRecord(body)) return jsonError('Expected object body')

  let displayName = existing.display_name
  if ('display_name' in body) {
    if (typeof body.display_name !== 'string' || !body.display_name.trim()) {
      return jsonError('display_name must be a non-empty string')
    }
    displayName = body.display_name.trim()
  }

  const parsed = parseOptionalFields(body, {
    quantity: existing.quantity,
    unit: existing.unit,
    location: existing.location,
  })
  if ('error' in parsed) return parsed.error

  db.query(
    `UPDATE pantry_items SET
       display_name = ?, quantity = ?, unit = ?, location = ?
     WHERE id = ? AND household_id = ?`,
  ).run(
    displayName,
    parsed.quantity,
    parsed.unit,
    parsed.location,
    id,
    householdId,
  )

  const row = getRow(id, householdId)
  if (!row) return jsonError('Pantry item not found', 404)
  return Response.json({ item: toView(row) })
}

function deletePantryItem(req: Request, id: string): Response {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response
  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const householdId = member.membership.household_id
  const existing = getRow(id, householdId)
  if (!existing) return jsonError('Pantry item not found', 404)

  db.query(`DELETE FROM pantry_items WHERE id = ? AND household_id = ?`).run(
    id,
    householdId,
  )
  return Response.json({ ok: true })
}

function parseOptionalFields(
  body: Record<string, unknown>,
  defaults?: {
    quantity: number | null
    unit: string | null
    location: string | null
  },
):
  | { quantity: number | null; unit: string | null; location: string | null }
  | { error: Response } {
  let quantity = defaults?.quantity ?? null
  if ('quantity' in body) {
    if (body.quantity === null || body.quantity === '') {
      quantity = null
    } else {
      const n = Number(body.quantity)
      if (!Number.isFinite(n) || n < 0) {
        return { error: jsonError('quantity must be a non-negative number or null') }
      }
      quantity = n
    }
  }

  let unit = defaults?.unit ?? null
  if ('unit' in body) {
    if (body.unit === null || body.unit === '') {
      unit = null
    } else if (typeof body.unit === 'string') {
      unit = body.unit.trim() || null
    } else {
      return { error: jsonError('unit must be a string or null') }
    }
  }

  let location = defaults?.location ?? null
  if ('location' in body) {
    if (body.location === null || body.location === '') {
      location = null
    } else if (
      typeof body.location === 'string' &&
      LOCATIONS.includes(body.location as PantryLocation)
    ) {
      location = body.location
    } else {
      return {
        error: jsonError(
          `location must be one of: ${LOCATIONS.join(', ')}, or null`,
        ),
      }
    }
  }

  return { quantity, unit, location }
}

function getRow(id: string, householdId: string): PantryRow | null {
  return db
    .query(
      `SELECT id, household_id, ingredient_id, display_name, quantity, unit,
              location, expires_on
       FROM pantry_items
       WHERE id = ? AND household_id = ?`,
    )
    .get(id, householdId) as PantryRow | null
}

function toView(row: PantryRow): PantryItem {
  return {
    id: row.id,
    household_id: row.household_id,
    ingredient_id: row.ingredient_id,
    display_name: row.display_name,
    quantity: row.quantity,
    unit: row.unit,
    location: row.location,
    expires_on: row.expires_on,
  }
}
