import { db, newId, nowIso } from '../db.ts'
import {
  clearSessionCookie,
  isRecord,
  jsonError,
  parseCookies,
  readJsonBody,
  requireUser,
  SESSION_COOKIE,
  deleteSessionByToken,
} from '../auth.ts'
import {
  generateInviteCode,
  getHouseholdWithMembers,
  getMembership,
  requireMembership,
} from '../household.ts'
import { buildHouseholdExport } from '../exportHousehold.ts'
import {
  getHouseholdPreferencesView,
  parsePreferencesPatch,
  PrefValidationError,
  upsertPreferences,
} from '../preferences.ts'

const INVITE_DAYS = 14

export async function handleHouseholdRoutes(
  req: Request,
  path: string,
): Promise<Response | null> {
  if (path === '/api/households' && req.method === 'POST') {
    return createHousehold(req)
  }
  if (path === '/api/households/current' && req.method === 'GET') {
    return getCurrentHousehold(req)
  }
  if (path === '/api/households/current' && req.method === 'DELETE') {
    return deleteCurrentHousehold(req)
  }
  if (
    (path === '/api/households/preferences' || path === '/api/preferences') &&
    req.method === 'GET'
  ) {
    return getPreferences(req)
  }
  if (
    (path === '/api/households/preferences' || path === '/api/preferences') &&
    req.method === 'PATCH'
  ) {
    return patchPreferences(req)
  }
  if (path === '/api/export' && req.method === 'GET') {
    return exportHousehold(req)
  }
  if (path === '/api/households/invite' && req.method === 'POST') {
    return createInvite(req)
  }
  if (path === '/api/households/accept' && req.method === 'POST') {
    return acceptInvite(req)
  }
  return null
}

async function createHousehold(req: Request): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response

  if (getMembership(auth.user.id)) {
    return jsonError('Already in a household', 409)
  }

  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error
  if (!isRecord(body)) return jsonError('Expected object body')

  const nameRaw = body.name
  if (typeof nameRaw !== 'string' || nameRaw.trim().length < 1) {
    return jsonError('Household name is required')
  }

  const timezone =
    typeof body.timezone === 'string' && body.timezone.trim()
      ? body.timezone.trim()
      : 'America/Los_Angeles'

  const id = newId()
  const created_at = nowIso()

  db.exec('BEGIN')
  try {
    db.query(
      `INSERT INTO households (id, name, timezone, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(id, nameRaw.trim(), timezone, created_at)

    db.query(
      `INSERT INTO household_members (household_id, user_id, role, preferences_json)
       VALUES (?, ?, ?, ?)`,
    ).run(id, auth.user.id, 'owner', null)

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const household = getHouseholdWithMembers(id, 'owner')
  return Response.json({ household }, { status: 201 })
}

function getCurrentHousehold(req: Request): Response {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response

  const membership = getMembership(auth.user.id)
  if (!membership) {
    return Response.json({ household: null })
  }

  const household = getHouseholdWithMembers(
    membership.household_id,
    membership.role,
  )
  if (!household) {
    return jsonError('Household not found', 404)
  }

  return Response.json({ household })
}

async function createInvite(req: Request): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response

  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  // Any household member can mint a shareable code (2-person MVP).
  const id = newId()
  const code = generateInviteCode()
  const created_at = nowIso()
  const expires = new Date()
  expires.setDate(expires.getDate() + INVITE_DAYS)

  db.query(
    `INSERT INTO household_invites (
       id, household_id, code, created_by, created_at, expires_at, used_by, used_at
     ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(
    id,
    member.membership.household_id,
    code,
    auth.user.id,
    created_at,
    expires.toISOString(),
  )

  return Response.json(
    {
      invite: {
        id,
        code,
        household_id: member.membership.household_id,
        expires_at: expires.toISOString(),
      },
    },
    { status: 201 },
  )
}

async function acceptInvite(req: Request): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response

  if (getMembership(auth.user.id)) {
    return jsonError('Already in a household', 409)
  }

  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error
  if (!isRecord(body)) return jsonError('Expected object body')

  const codeRaw = body.code
  if (typeof codeRaw !== 'string' || codeRaw.trim().length < 1) {
    return jsonError('Invite code is required')
  }

  const code = codeRaw.trim().toUpperCase()
  const invite = db
    .query(
      `SELECT id, household_id, code, expires_at, used_by
       FROM household_invites WHERE code = ?`,
    )
    .get(code) as {
    id: string
    household_id: string
    code: string
    expires_at: string | null
    used_by: string | null
  } | null

  if (!invite) {
    return jsonError('Invalid invite code', 404)
  }
  if (invite.used_by) {
    return jsonError('Invite code already used', 410)
  }
  if (
    invite.expires_at &&
    new Date(invite.expires_at).getTime() <= Date.now()
  ) {
    return jsonError('Invite code expired', 410)
  }

  const memberCount = db
    .query(
      `SELECT COUNT(*) AS n FROM household_members WHERE household_id = ?`,
    )
    .get(invite.household_id) as { n: number }

  // Soft cap for 2-person household MVP.
  if (memberCount.n >= 2) {
    return jsonError('Household is full', 409)
  }

  const used_at = nowIso()

  db.exec('BEGIN')
  try {
    db.query(
      `INSERT INTO household_members (household_id, user_id, role, preferences_json)
       VALUES (?, ?, ?, ?)`,
    ).run(invite.household_id, auth.user.id, 'member', null)

    db.query(
      `UPDATE household_invites SET used_by = ?, used_at = ? WHERE id = ?`,
    ).run(auth.user.id, used_at, invite.id)

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const household = getHouseholdWithMembers(invite.household_id, 'member')
  return Response.json({ household })
}

function getPreferences(req: Request): Response {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response

  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const preferences = getHouseholdPreferencesView(
    member.membership.household_id,
  )
  return Response.json({ preferences })
}

async function patchPreferences(req: Request): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response

  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error

  const patch = parsePreferencesPatch(body)
  if (patch instanceof PrefValidationError) {
    return jsonError(patch.message)
  }

  try {
    const preferences = upsertPreferences(
      member.membership.household_id,
      patch,
    )
    return Response.json({ preferences })
  } catch (err) {
    if (err instanceof PrefValidationError) {
      return jsonError(err.message)
    }
    throw err
  }
}

function exportHousehold(req: Request): Response {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response

  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const payload = buildHouseholdExport(
    member.membership.household_id,
    member.membership.role,
  )
  if (!payload) return jsonError('Household not found', 404)

  const slug = payload.household.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const filename = `homelife-${slug || 'household'}-export.json`

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

/**
 * Wipe the current household and all household-scoped rows (FK cascade).
 * Requires `{ confirm: "<household name>" }`. Clears sessions for every
 * member so clients drop to the register/onboarding flow.
 */
async function deleteCurrentHousehold(req: Request): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response

  const member = requireMembership(auth.user)
  if ('response' in member) return member.response

  const householdId = member.membership.household_id
  const household = db
    .query(`SELECT id, name FROM households WHERE id = ?`)
    .get(householdId) as { id: string; name: string } | null

  if (!household) return jsonError('Household not found', 404)

  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error
  if (!isRecord(body)) return jsonError('Expected object body')

  const confirm =
    typeof body.confirm === 'string' ? body.confirm.trim() : ''
  if (!confirm || confirm !== household.name) {
    return jsonError(
      `Type the household name ("${household.name}") to confirm deletion`,
    )
  }

  const memberUserIds = (
    db
      .query(`SELECT user_id FROM household_members WHERE household_id = ?`)
      .all(householdId) as { user_id: string }[]
  ).map((r) => r.user_id)

  db.exec('BEGIN')
  try {
    // Explicit wipe of household-scoped data; CASCADE covers children.
    db.query(`DELETE FROM households WHERE id = ?`).run(householdId)

    for (const userId of memberUserIds) {
      db.query(`DELETE FROM sessions WHERE user_id = ?`).run(userId)
    }

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const cookies = parseCookies(req.headers.get('cookie'))
  const token = cookies[SESSION_COOKIE]
  if (token) deleteSessionByToken(token)

  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': clearSessionCookie() } },
  )
}
