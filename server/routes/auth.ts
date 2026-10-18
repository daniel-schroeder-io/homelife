import { db, newId, nowIso } from '../db.ts'
import {
  clearSessionCookie,
  createSession,
  deleteSessionByToken,
  getUserByEmail,
  hashPassword,
  isRecord,
  jsonError,
  parseCookies,
  readJsonBody,
  requireUser,
  SESSION_COOKIE,
  setSessionCookie,
  toPublicUser,
  verifyPassword,
} from '../auth.ts'
import { getMembership } from '../household.ts'

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function handleAuthRoutes(
  req: Request,
  path: string,
): Promise<Response | null> {
  if (path === '/api/auth/register' && req.method === 'POST') {
    return register(req)
  }
  if (path === '/api/auth/login' && req.method === 'POST') {
    return login(req)
  }
  if (path === '/api/auth/logout' && req.method === 'POST') {
    return logout(req)
  }
  if (path === '/api/auth/me' && req.method === 'GET') {
    return me(req)
  }
  if (path === '/api/auth/me' && req.method === 'DELETE') {
    return deleteMe(req)
  }
  return null
}

async function register(req: Request): Promise<Response> {
  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error

  if (!isRecord(body)) return jsonError('Expected object body')

  const emailRaw = body.email
  const nameRaw = body.name
  const passwordRaw = body.password

  if (typeof emailRaw !== 'string' || !emailRaw.includes('@')) {
    return jsonError('Valid email is required')
  }
  if (typeof nameRaw !== 'string' || nameRaw.trim().length < 1) {
    return jsonError('Name is required')
  }
  if (typeof passwordRaw !== 'string' || passwordRaw.length < 6) {
    return jsonError('Password must be at least 6 characters')
  }

  const email = normalizeEmail(emailRaw)
  if (getUserByEmail(email)) {
    return jsonError('Email already registered', 409)
  }

  const id = newId()
  const password_hash = await hashPassword(passwordRaw)
  const created_at = nowIso()

  db.query(
    `INSERT INTO users (id, email, name, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, email, nameRaw.trim(), password_hash, created_at)

  const token = createSession(id)
  const user = toPublicUser({
    id,
    email,
    name: nameRaw.trim(),
    password_hash,
    created_at,
  })

  return Response.json(
    { user, household: null },
    {
      status: 201,
      headers: { 'Set-Cookie': setSessionCookie(token) },
    },
  )
}

async function login(req: Request): Promise<Response> {
  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error

  if (!isRecord(body)) return jsonError('Expected object body')

  const emailRaw = body.email
  const passwordRaw = body.password

  if (typeof emailRaw !== 'string' || typeof passwordRaw !== 'string') {
    return jsonError('Email and password are required')
  }

  const row = getUserByEmail(normalizeEmail(emailRaw))
  if (!row || !(await verifyPassword(passwordRaw, row.password_hash))) {
    return jsonError('Invalid email or password', 401)
  }

  const token = createSession(row.id)
  const membership = getMembership(row.id)

  return Response.json(
    {
      user: toPublicUser(row),
      householdId: membership?.household_id ?? null,
    },
    { headers: { 'Set-Cookie': setSessionCookie(token) } },
  )
}

function logout(req: Request): Response {
  const cookies = parseCookies(req.headers.get('cookie'))
  const token = cookies[SESSION_COOKIE]
  if (token) deleteSessionByToken(token)

  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': clearSessionCookie() } },
  )
}

function me(req: Request): Response {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response

  const membership = getMembership(auth.user.id)
  return Response.json({
    user: auth.user,
    householdId: membership?.household_id ?? null,
  })
}

/**
 * Delete the current user account when they are alone (no household, or
 * solo household member). If solo in a household, the household is wiped
 * first (cascade). Requires `{ confirm: "DELETE" }`.
 */
async function deleteMe(req: Request): Promise<Response> {
  const auth = requireUser(req)
  if ('response' in auth) return auth.response

  const body = await readJsonBody<unknown>(req)
  if ('error' in body) return body.error
  if (!isRecord(body)) return jsonError('Expected object body')

  const confirm =
    typeof body.confirm === 'string' ? body.confirm.trim() : ''
  if (confirm !== 'DELETE') {
    return jsonError('Type DELETE to confirm account deletion')
  }

  const membership = getMembership(auth.user.id)
  if (membership) {
    const count = db
      .query(
        `SELECT COUNT(*) AS n FROM household_members WHERE household_id = ?`,
      )
      .get(membership.household_id) as { n: number }

    if (count.n > 1) {
      return jsonError(
        'Leave or delete the shared household before deleting your account',
        409,
      )
    }
  }

  db.exec('BEGIN')
  try {
    if (membership) {
      db.query(`DELETE FROM households WHERE id = ?`).run(
        membership.household_id,
      )
    }
    db.query(`DELETE FROM sessions WHERE user_id = ?`).run(auth.user.id)
    db.query(`DELETE FROM users WHERE id = ?`).run(auth.user.id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': clearSessionCookie() } },
  )
}
