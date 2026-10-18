import { db, newId, nowIso } from './db.ts'

/**
 * Inserts a demo household with two members and a couple of stub recipes.
 * Not wired to the client — call manually (e.g. `bun server/seed.ts`) when useful.
 */
export function seedDemoHousehold(): {
  householdId: string
  userIds: [string, string]
} {
  const existing = db
    .query(`SELECT id FROM households WHERE name = ?`)
    .get('Demo Household') as { id: string } | null

  if (existing) {
    const members = db
      .query(`SELECT user_id FROM household_members WHERE household_id = ?`)
      .all(existing.id) as { user_id: string }[]
    return {
      householdId: existing.id,
      userIds: [members[0]?.user_id ?? '', members[1]?.user_id ?? ''],
    }
  }

  const now = nowIso()
  const householdId = newId()
  const userA = newId()
  const userB = newId()

  db.exec('BEGIN')
  try {
    db.query(
      `INSERT INTO users (id, email, name, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(userA, 'alex@example.com', 'Alex', 'dev-placeholder-hash', now)

    db.query(
      `INSERT INTO users (id, email, name, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(userB, 'sam@example.com', 'Sam', 'dev-placeholder-hash', now)

    db.query(
      `INSERT INTO households (id, name, timezone, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(householdId, 'Demo Household', 'America/Los_Angeles', now)

    db.query(
      `INSERT INTO household_members (household_id, user_id, role, preferences_json)
       VALUES (?, ?, ?, ?)`,
    ).run(householdId, userA, 'owner', null)

    db.query(
      `INSERT INTO household_members (household_id, user_id, role, preferences_json)
       VALUES (?, ?, ?, ?)`,
    ).run(householdId, userB, 'member', null)

    const recipeId = newId()
    db.query(
      `INSERT INTO recipes (
         id, household_id, title, source_url, servings,
         prep_minutes, cook_minutes, instructions, notes, tags_json,
         status, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      recipeId,
      householdId,
      'Sheet-Pan Chicken & Broccoli',
      null,
      4,
      15,
      30,
      '1. Toss chicken and broccoli with oil and seasoning.\n2. Roast at 425°F until done.',
      null,
      JSON.stringify(['weeknight', 'sheet-pan']),
      'favorite',
      userA,
    )

    db.query(
      `INSERT INTO recipe_ingredients (
         id, recipe_id, ingredient_id, display_name, quantity, unit,
         preparation, optional, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId(),
      recipeId,
      null,
      'chicken thighs',
      1.5,
      'lb',
      'boneless',
      0,
      0,
    )

    db.query(
      `INSERT INTO recipe_ingredients (
         id, recipe_id, ingredient_id, display_name, quantity, unit,
         preparation, optional, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId(), recipeId, null, 'broccoli', 2, 'heads', null, 0, 1)

    db.query(
      `INSERT INTO household_preferences (id, household_id, key, value_json)
       VALUES (?, ?, ?, ?)`,
    ).run(
      newId(),
      householdId,
      'cooked_dinners_per_week',
      JSON.stringify(4),
    )

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return { householdId, userIds: [userA, userB] }
}

if (import.meta.main) {
  const result = seedDemoHousehold()
  console.log('Seeded demo household:', result)
}
