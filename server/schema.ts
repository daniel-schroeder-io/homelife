import type { Database } from 'bun:sqlite'

/**
 * Creates Recipe & Grocery Autopilot tables (design §9) plus users.
 * Idempotent: safe to run on every server start.
 */
export function migrate(db: Database): void {
  db.exec('PRAGMA foreign_keys = ON;')

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS households (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS household_members (
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      preferences_json TEXT,
      PRIMARY KEY (household_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions (token);
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

    CREATE TABLE IF NOT EXISTS household_invites (
      id TEXT PRIMARY KEY NOT NULL,
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      used_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      used_at TEXT
    );

    CREATE INDEX IF NOT EXISTS household_invites_code_idx
      ON household_invites (code);
    CREATE INDEX IF NOT EXISTS household_invites_household_id_idx
      ON household_invites (household_id);

    CREATE TABLE IF NOT EXISTS ingredients (
      id TEXT PRIMARY KEY NOT NULL,
      canonical_name TEXT NOT NULL,
      category TEXT,
      aliases_json TEXT,
      default_unit TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ingredients_canonical_name_uq
      ON ingredients (canonical_name);

    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY NOT NULL,
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      source_url TEXT,
      servings REAL,
      prep_minutes INTEGER,
      cook_minutes INTEGER,
      instructions TEXT,
      notes TEXT,
      tags_json TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS recipes_household_id_idx
      ON recipes (household_id);

    CREATE TABLE IF NOT EXISTS recipe_ingredients (
      id TEXT PRIMARY KEY NOT NULL,
      recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      ingredient_id TEXT REFERENCES ingredients(id) ON DELETE SET NULL,
      display_name TEXT NOT NULL,
      quantity REAL,
      unit TEXT,
      preparation TEXT,
      optional INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS recipe_ingredients_recipe_id_idx
      ON recipe_ingredients (recipe_id);

    CREATE TABLE IF NOT EXISTS meal_plans (
      id TEXT PRIMARY KEY NOT NULL,
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      week_start TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      approved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS meal_plans_household_id_idx
      ON meal_plans (household_id);

    CREATE TABLE IF NOT EXISTS meal_plan_entries (
      id TEXT PRIMARY KEY NOT NULL,
      meal_plan_id TEXT NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      meal_type TEXT NOT NULL DEFAULT 'dinner',
      recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
      servings REAL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'planned',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS meal_plan_entries_meal_plan_id_idx
      ON meal_plan_entries (meal_plan_id);

    CREATE TABLE IF NOT EXISTS grocery_lists (
      id TEXT PRIMARY KEY NOT NULL,
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      date_range_start TEXT,
      date_range_end TEXT
    );

    CREATE INDEX IF NOT EXISTS grocery_lists_household_id_idx
      ON grocery_lists (household_id);

    CREATE TABLE IF NOT EXISTS grocery_items (
      id TEXT PRIMARY KEY NOT NULL,
      grocery_list_id TEXT NOT NULL REFERENCES grocery_lists(id) ON DELETE CASCADE,
      ingredient_id TEXT REFERENCES ingredients(id) ON DELETE SET NULL,
      display_name TEXT NOT NULL,
      quantity REAL,
      unit TEXT,
      category TEXT,
      checked_at TEXT,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
      manual INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      updated_at TEXT,
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS grocery_items_grocery_list_id_idx
      ON grocery_items (grocery_list_id);

    CREATE TABLE IF NOT EXISTS pantry_items (
      id TEXT PRIMARY KEY NOT NULL,
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      ingredient_id TEXT REFERENCES ingredients(id) ON DELETE SET NULL,
      display_name TEXT NOT NULL,
      quantity REAL,
      unit TEXT,
      location TEXT,
      expires_on TEXT
    );

    CREATE INDEX IF NOT EXISTS pantry_items_household_id_idx
      ON pantry_items (household_id);

    CREATE TABLE IF NOT EXISTS prep_tasks (
      id TEXT PRIMARY KEY NOT NULL,
      meal_plan_id TEXT NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      scheduled_for TEXT,
      duration_minutes INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      linked_recipe_ids_json TEXT,
      notes TEXT,
      effort TEXT
    );

    CREATE INDEX IF NOT EXISTS prep_tasks_meal_plan_id_idx
      ON prep_tasks (meal_plan_id);

    CREATE TABLE IF NOT EXISTS cook_history (
      id TEXT PRIMARY KEY NOT NULL,
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      cooked_at TEXT NOT NULL,
      rating TEXT,
      feedback TEXT
    );

    CREATE INDEX IF NOT EXISTS cook_history_household_id_idx
      ON cook_history (household_id);

    CREATE INDEX IF NOT EXISTS cook_history_recipe_id_idx
      ON cook_history (recipe_id);

    CREATE TABLE IF NOT EXISTS household_preferences (
      id TEXT PRIMARY KEY NOT NULL,
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      UNIQUE (household_id, key)
    );

    CREATE INDEX IF NOT EXISTS household_preferences_household_id_idx
      ON household_preferences (household_id);
  `)

  // Additive migrations for existing DBs created before tags_json / effort existed.
  ensureColumn(db, 'recipes', 'tags_json', 'TEXT')
  ensureColumn(db, 'prep_tasks', 'effort', 'TEXT')
  ensureColumn(db, 'grocery_items', 'updated_at', 'TEXT')
  ensureColumn(db, 'grocery_items', 'version', 'INTEGER NOT NULL DEFAULT 1')

  // Backfill timestamps for rows created before versioning existed.
  db.exec(`
    UPDATE grocery_items
    SET updated_at = COALESCE(updated_at, checked_at, datetime('now'))
    WHERE updated_at IS NULL
  `)
}

function ensureColumn(
  db: Database,
  table: string,
  column: string,
  typeSql: string,
): void {
  const cols = db
    .query(`PRAGMA table_info(${table})`)
    .all() as { name: string }[]
  if (cols.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`)
}
