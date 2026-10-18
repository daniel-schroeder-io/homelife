import type {
  HouseholdMemberRole,
  HouseholdWithMembers,
  PublicUser,
} from '../shared/types.ts'
import { db } from './db.ts'
import { jsonError } from './auth.ts'

type MembershipRow = {
  household_id: string
  role: HouseholdMemberRole
}

export function getMembership(
  userId: string,
): MembershipRow | null {
  return db
    .query(
      `SELECT household_id, role
       FROM household_members
       WHERE user_id = ?
       LIMIT 1`,
    )
    .get(userId) as MembershipRow | null
}

export function requireMembership(
  user: PublicUser,
):
  | { membership: MembershipRow }
  | { response: Response } {
  const membership = getMembership(user.id)
  if (!membership) {
    return { response: jsonError('No household membership', 403) }
  }
  return { membership }
}

/**
 * Load household + members for a member. Use after requireMembership.
 * For recipe/grocery agents: call requireUser + requireMembership, then
 * use membership.household_id and user.id.
 */
export function getHouseholdWithMembers(
  householdId: string,
  viewerRole: HouseholdMemberRole,
): HouseholdWithMembers | null {
  const household = db
    .query(
      `SELECT id, name, timezone, created_at FROM households WHERE id = ?`,
    )
    .get(householdId) as {
    id: string
    name: string
    timezone: string
    created_at: string
  } | null

  if (!household) return null

  const members = db
    .query(
      `SELECT hm.user_id, hm.role, u.name, u.email
       FROM household_members hm
       JOIN users u ON u.id = hm.user_id
       WHERE hm.household_id = ?
       ORDER BY CASE hm.role WHEN 'owner' THEN 0 ELSE 1 END, u.name`,
    )
    .all(householdId) as {
    user_id: string
    role: HouseholdMemberRole
    name: string
    email: string
  }[]

  return {
    ...household,
    role: viewerRole,
    members: members.map((m) => ({
      user_id: m.user_id,
      name: m.name,
      email: m.email,
      role: m.role,
    })),
  }
}

/** Short shareable invite code (no email). */
export function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let code = ''
  for (const b of bytes) {
    code += alphabet[b % alphabet.length]
  }
  return code
}
