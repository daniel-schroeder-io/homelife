import type { PublicUser } from '../shared/types.ts'
import { db, newId, nowIso } from './db.ts'

export const SESSION_COOKIE = 'homelife_session'
const SESSION_DAYS = 30

type UserRow = {
  id: string
  email: string
  name: string
  password_hash: string
  created_at: string
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: row.created_at,
  }
}

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status })
}

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key) out[key] = decodeURIComponent(value)
  }
  return out
}

function sessionCookieValue(token: string, maxAgeSec: number): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ]
  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure')
  }
  return parts.join('; ')
}

export function setSessionCookie(token: string): string {
  return sessionCookieValue(token, SESSION_DAYS * 24 * 60 * 60)
}

export function clearSessionCookie(): string {
  return sessionCookieValue('', 0)
}

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 })
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return Bun.password.verify(password, hash)
}

export function createSession(userId: string): string {
  const id = newId()
  const token = crypto.randomUUID() + crypto.randomUUID()
  const now = nowIso()
  const expires = new Date()
  expires.setDate(expires.getDate() + SESSION_DAYS)

  db.query(
    `INSERT INTO sessions (id, user_id, token, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, userId, token, expires.toISOString(), now)

  return token
}

export function deleteSessionByToken(token: string): void {
  db.query(`DELETE FROM sessions WHERE token = ?`).run(token)
}

export function getUserByEmail(email: string): UserRow | null {
  return db
    .query(
      `SELECT id, email, name, password_hash, created_at
       FROM users WHERE email = ?`,
    )
    .get(email.toLowerCase()) as UserRow | null
}

export function getUserById(id: string): UserRow | null {
  return db
    .query(
      `SELECT id, email, name, password_hash, created_at
       FROM users WHERE id = ?`,
    )
    .get(id) as UserRow | null
}

/**
 * Resolve the logged-in user from the session cookie.
 * Returns null when missing/expired (caller decides 401).
 */
export function resolveUser(req: Request): PublicUser | null {
  const cookies = parseCookies(req.headers.get('cookie'))
  const token = cookies[SESSION_COOKIE]
  if (!token) return null

  const row = db
    .query(
      `SELECT u.id, u.email, u.name, u.password_hash, u.created_at, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
    )
    .get(token) as (UserRow & { expires_at: string }) | null

  if (!row) return null

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    deleteSessionByToken(token)
    return null
  }

  return toPublicUser(row)
}

/** Require auth; returns user or a 401 Response. */
export function requireUser(
  req: Request,
): { user: PublicUser } | { response: Response } {
  const user = resolveUser(req)
  if (!user) {
    return { response: jsonError('Unauthorized', 401) }
  }
  return { user }
}

export async function readJsonBody<T>(
  req: Request,
): Promise<T | { error: Response }> {
  try {
    const body = (await req.json()) as T
    return body
  } catch {
    return { error: jsonError('Invalid JSON body') }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
