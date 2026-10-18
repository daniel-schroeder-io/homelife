/** Shared domain types for Recipe & Grocery Autopilot (SQLite-backed). */

export type HouseholdMemberRole = 'owner' | 'member'

export type RecipeStatus =
  | 'draft'
  | 'active'
  | 'favorite'
  | 'tried'
  | 'not_for_us'
  | 'archived'

export type MealPlanStatus = 'draft' | 'approved' | 'archived'

export type MealType = 'dinner' | 'lunch' | 'breakfast' | 'snack' | 'other'

export type MealPlanEntryStatus =
  | 'planned'
  | 'cooked'
  | 'skipped'
  | 'swapped'
  | 'eating_out'
  | 'leftovers'
  | 'quick'
  | 'undecided'

/** Dinner-slot kinds used by the weekly planner UI. */
export type DinnerSlotKind =
  | 'planned'
  | 'leftovers'
  | 'eating_out'
  | 'quick'
  | 'undecided'

/** Provenance for grocery rows; plan changes update derived items only. */
export type GrocerySourceType = 'recipe' | 'manual' | 'pantry_check'

export type PrepTaskStatus = 'pending' | 'done' | 'skipped'

/** Light-touch post-cook rating from design §6. */
export type CookRating = 'loved' | 'okay' | 'dont_suggest'

export interface User {
  id: string
  email: string
  name: string
  password_hash: string
  created_at: string
}

/** User fields safe to return to the client (no password hash). */
export interface PublicUser {
  id: string
  email: string
  name: string
  created_at: string
}

export interface Session {
  id: string
  user_id: string
  token: string
  expires_at: string
  created_at: string
}

export interface Household {
  id: string
  name: string
  timezone: string
  created_at: string
}

export interface HouseholdMember {
  household_id: string
  user_id: string
  role: HouseholdMemberRole
  preferences_json: string | null
}

export interface HouseholdInvite {
  id: string
  household_id: string
  code: string
  created_by: string
  created_at: string
  expires_at: string | null
  used_by: string | null
  used_at: string | null
}

export interface HouseholdMemberView {
  user_id: string
  name: string
  email: string
  role: HouseholdMemberRole
}

export interface HouseholdWithMembers extends Household {
  members: HouseholdMemberView[]
  role: HouseholdMemberRole
}

export interface Recipe {
  id: string
  household_id: string
  title: string
  source_url: string | null
  servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  instructions: string | null
  notes: string | null
  /** JSON-encoded string[] of tags; prefer `tags` on API views. */
  tags_json: string | null
  status: RecipeStatus
  created_by: string | null
}

/** Recipe as returned by /api/recipes* (tags decoded). */
export interface RecipeView {
  id: string
  household_id: string
  title: string
  source_url: string | null
  servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  instructions: string | null
  notes: string | null
  tags: string[]
  status: RecipeStatus
  created_by: string | null
}

export interface RecipeIngredientInput {
  display_name: string
  quantity?: number | null
  unit?: string | null
  preparation?: string | null
  optional?: boolean
  sort_order?: number
  ingredient_id?: string | null
}

/** Unsaved recipe payload from URL import (client reviews, then POSTs). */
export interface RecipeDraft {
  title: string
  source_url: string | null
  servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  instructions: string | null
  notes: string | null
  tags: string[]
  status: RecipeStatus
  ingredients: RecipeIngredientInput[]
}

export interface RecipeDetail extends RecipeView {
  ingredients: RecipeIngredient[]
  /** Present when GET /api/recipes/:id?servings=N scaled quantities. */
  base_servings?: number | null
  scaled_to?: number | null
  scale_factor?: number | null
}

export interface Ingredient {
  id: string
  canonical_name: string
  category: string | null
  aliases_json: string | null
  default_unit: string | null
}

export interface RecipeIngredient {
  id: string
  recipe_id: string
  ingredient_id: string | null
  display_name: string
  quantity: number | null
  unit: string | null
  preparation: string | null
  optional: boolean
  sort_order: number
}

export interface MealPlan {
  id: string
  household_id: string
  week_start: string
  status: MealPlanStatus
  created_at: string
  approved_at: string | null
}

export interface MealPlanEntry {
  id: string
  meal_plan_id: string
  date: string
  meal_type: MealType
  recipe_id: string | null
  servings: number | null
  notes: string | null
  status: MealPlanEntryStatus
  sort_order: number
}

/** Recipe summary embedded on plan entries. */
export interface MealPlanRecipeSummary {
  id: string
  title: string
  servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  status: RecipeStatus
  tags: string[]
}

/** Meal plan entry as returned by /api/plans*. */
export interface MealPlanEntryView extends MealPlanEntry {
  recipe: MealPlanRecipeSummary | null
  active_minutes: number | null
  total_minutes: number | null
  busy: boolean
}

/** Meal plan with entries as returned by /api/plans*. */
export interface MealPlanDetail extends MealPlan {
  entries: MealPlanEntryView[]
  cooked_dinners: number
  busy_day_threshold_minutes: number
}

export interface GroceryList {
  id: string
  household_id: string
  name: string
  date_range_start: string | null
  date_range_end: string | null
}

export interface GroceryItem {
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
  manual: boolean
  notes: string | null
  /** ISO timestamp; bumped on every write for per-item conflict hints. */
  updated_at: string
  /** Monotonic per-item revision; prefer merging independent edits over LWW list. */
  version: number
}

/** Grocery item as returned by /api/groceries* (enriched provenance). */
export interface GroceryItemView extends GroceryItem {
  source_recipes: { id: string; title: string }[]
  already_have: boolean
  quantity_label: string
}

/** Grocery list with items as returned by /api/groceries*. */
export interface GroceryListDetail extends GroceryList {
  items: GroceryItemView[]
  aisle_order: string[]
  week_start: string | null
  plan_id: string | null
  plan_status: MealPlanStatus | null
}

export interface PantryItem {
  id: string
  household_id: string
  ingredient_id: string | null
  display_name: string
  quantity: number | null
  unit: string | null
  location: string | null
  expires_on: string | null
}

export interface PrepTask {
  id: string
  meal_plan_id: string
  title: string
  scheduled_for: string | null
  duration_minutes: number | null
  status: PrepTaskStatus
  linked_recipe_ids_json: string | null
  notes: string | null
  /** active = hands-on; passive = oven/simmer wait when known. */
  effort: 'active' | 'passive' | null
}

/** Prep task as returned by /api/prep* (linked recipes decoded). */
export interface PrepTaskView {
  id: string
  meal_plan_id: string
  title: string
  scheduled_for: string | null
  duration_minutes: number | null
  status: PrepTaskStatus
  linked_recipe_ids: string[]
  linked_recipes: { id: string; title: string }[]
  notes: string | null
  effort: 'active' | 'passive' | null
}

/** Prep checklist for a week as returned by /api/prep*. */
export interface PrepWeek {
  week_start: string
  plan_id: string | null
  plan_status: MealPlanStatus | null
  tasks: PrepTaskView[]
}

export interface CookHistory {
  id: string
  household_id: string
  recipe_id: string
  cooked_at: string
  rating: CookRating | null
  feedback: string | null
}

/** Cook history row as returned by /api/cook-history*. */
export interface CookHistoryView {
  id: string
  household_id: string
  recipe_id: string
  recipe_title: string | null
  cooked_at: string
  rating: CookRating | null
  feedback: string | null
}

export interface HouseholdPreference {
  id: string
  household_id: string
  key: string
  value_json: string
}

/** Decoded household prefs as returned by GET/PATCH /api/households/preferences. */
export interface HouseholdPreferencesView {
  cooked_dinners_per_week: number
  max_active_minutes: number | null
  busy_day_threshold_minutes: number
  default_servings: number
  cuisine_notes: string
  avoid_notes: string
  allergies: string[]
}
