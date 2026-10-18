/**
 * Deterministic prep checklist from a week's planned recipes.
 *
 * Heuristics (design §5.F): shared chop / grain / sauce / marinate from
 * ingredient overlap + preparation text + tags. No LLM. No storage-duration
 * recommendations.
 */

export type PrepEffort = 'active' | 'passive'

export type PrepRecipeInput = {
  id: string
  title: string
  date: string
  tags: string[]
  prep_minutes: number | null
  cook_minutes: number | null
  ingredients: {
    display_name: string
    preparation: string | null
    ingredient_id: string | null
  }[]
}

export type GeneratedPrepTask = {
  title: string
  scheduled_for: string | null
  duration_minutes: number | null
  linked_recipe_ids: string[]
  notes: string | null
  effort: PrepEffort
}

const CHOP_PREP =
  /\b(chop(?:ped)?|dice(?:d)?|mince(?:d)?|slice(?:d)?|julienne|cube(?:d)?|shred(?:ded)?)\b/i

const PRODUCE_NAMES =
  /\b(onion|onions|garlic|shallot|shallots|pepper|peppers|bell pepper|carrot|carrots|celery|broccoli|kale|spinach|cabbage|lettuce|tomato|tomatoes|zucchini|cucumber|potato|potatoes|sweet potato|mushroom|mushrooms|scallion|scallions|green onion|cilantro|parsley|basil|ginger|lemon|lime|avocado|corn|bean|beans|chickpea|chickpeas)\b/i

const GRAIN_NAMES =
  /\b(rice|quinoa|farro|couscous|barley|bulgur|polenta|oat|oats|pasta|noodle|noodles)\b/i

const SAUCE_HINT =
  /\b(sauce|dressing|pesto|salsa|aioli|gravy|marinara|vinaigrette)\b/i

const MARINATE_HINT = /\b(marinat(?:e|ed|ing)|brine|brined)\b/i

const PASSIVE_HINT =
  /\b(roast|bake|simmer|boil|steam|soak|proof|rise|rest|oven)\b/i

function normalizeKey(name: string): string {
  let key = name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\d./\s]+/, '')
    .trim()
  if (key.length > 3 && key.endsWith('ies')) {
    key = `${key.slice(0, -3)}y`
  } else if (
    key.length > 3 &&
    key.endsWith('s') &&
    !key.endsWith('ss') &&
    !key.endsWith('us') &&
    !key.endsWith('is')
  ) {
    key = key.slice(0, -1)
  }
  return key
}

function displayLabel(name: string): string {
  return name.replace(/\s+/g, ' ').trim()
}

function uniqueTitles(recipes: PrepRecipeInput[]): string {
  const titles = recipes.map((r) => r.title)
  if (titles.length <= 2) return titles.join(' & ')
  return `${titles.slice(0, -1).join(', ')} & ${titles[titles.length - 1]}`
}

function earliestDate(recipes: PrepRecipeInput[]): string | null {
  const dates = recipes.map((r) => r.date).filter(Boolean).sort()
  return dates[0] ?? null
}

/**
 * Build a short practical prep checklist for the week's planned recipes.
 * Caps output so the list stays actionable (shared batch work first).
 */
export function generatePrepTasks(
  recipes: PrepRecipeInput[],
): GeneratedPrepTask[] {
  if (recipes.length === 0) return []

  const tasks: GeneratedPrepTask[] = []
  const coveredRecipeIds = new Set<string>()

  // —— Shared chop / dice produce ————————————————————————————————
  type ChopHit = {
    key: string
    label: string
    recipes: PrepRecipeInput[]
  }
  const chopMap = new Map<string, ChopHit>()

  for (const recipe of recipes) {
    for (const ing of recipe.ingredients) {
      const prep = ing.preparation ?? ''
      const name = ing.display_name
      // Produce appearing across meals, or anything explicitly chopped/diced.
      const candidate =
        PRODUCE_NAMES.test(name) ||
        CHOP_PREP.test(prep) ||
        CHOP_PREP.test(name)
      if (!candidate) continue

      const key = normalizeKey(name)
      if (!key) continue
      const existing = chopMap.get(key)
      if (existing) {
        if (!existing.recipes.some((r) => r.id === recipe.id)) {
          existing.recipes.push(recipe)
        }
      } else {
        chopMap.set(key, {
          key,
          label: displayLabel(name),
          recipes: [recipe],
        })
      }
    }
  }

  const sharedChops = [...chopMap.values()]
    .filter((h) => h.recipes.length >= 2)
    .sort((a, b) => b.recipes.length - a.recipes.length || a.label.localeCompare(b.label))

  if (sharedChops.length > 0) {
    const top = sharedChops.slice(0, 4)
    const labels = top.map((h) => h.label)
    const linked = new Map<string, PrepRecipeInput>()
    for (const hit of top) {
      for (const r of hit.recipes) linked.set(r.id, r)
    }
    const linkedList = [...linked.values()]
    const title =
      labels.length === 1
        ? `Chop ${labels[0]} once for the week`
        : `Chop ${labels.slice(0, 3).join(', ')}${labels.length > 3 ? '…' : ''} once`
    tasks.push({
      title,
      scheduled_for: earliestDate(linkedList),
      duration_minutes: Math.min(5 + labels.length * 4, 25),
      linked_recipe_ids: linkedList.map((r) => r.id),
      notes: `Shared across ${uniqueTitles(linkedList)}`,
      effort: 'active',
    })
    for (const r of linkedList) coveredRecipeIds.add(r.id)
  }

  // —— Shared grain batch ————————————————————————————————————————
  type GrainHit = {
    key: string
    label: string
    recipes: PrepRecipeInput[]
  }
  const grainMap = new Map<string, GrainHit>()
  for (const recipe of recipes) {
    const tagGrain = recipe.tags.some((t) =>
      /\b(grain|bowl|rice|quinoa)\b/i.test(t),
    )
    for (const ing of recipe.ingredients) {
      if (!GRAIN_NAMES.test(ing.display_name) && !tagGrain) continue
      if (!GRAIN_NAMES.test(ing.display_name)) continue
      const key = normalizeKey(ing.display_name)
      const existing = grainMap.get(key)
      if (existing) {
        if (!existing.recipes.some((r) => r.id === recipe.id)) {
          existing.recipes.push(recipe)
        }
      } else {
        grainMap.set(key, {
          key,
          label: displayLabel(ing.display_name),
          recipes: [recipe],
        })
      }
    }
  }

  for (const hit of [...grainMap.values()].sort(
    (a, b) => b.recipes.length - a.recipes.length,
  )) {
    if (hit.recipes.length < 2 && hit.recipes.length === 1) {
      // Single-recipe grain still worth a passive cook-ahead when cook time is long.
      const r = hit.recipes[0]!
      if ((r.cook_minutes ?? 0) < 20 && (r.prep_minutes ?? 0) < 15) continue
      tasks.push({
        title: `Cook ${hit.label} for ${r.title}`,
        scheduled_for: r.date,
        duration_minutes: Math.min(r.cook_minutes ?? 20, 45),
        linked_recipe_ids: [r.id],
        notes: 'Mostly passive simmer/steam time',
        effort: 'passive',
      })
      coveredRecipeIds.add(r.id)
      break
    }
    if (hit.recipes.length >= 2) {
      tasks.push({
        title: `Cook a batch of ${hit.label}`,
        scheduled_for: earliestDate(hit.recipes),
        duration_minutes: 25,
        linked_recipe_ids: hit.recipes.map((r) => r.id),
        notes: `For ${uniqueTitles(hit.recipes)} · mostly passive`,
        effort: 'passive',
      })
      for (const r of hit.recipes) coveredRecipeIds.add(r.id)
      break
    }
  }

  // —— Sauce / dressing mix ——————————————————————————————————————
  const sauceRecipes: PrepRecipeInput[] = []
  for (const recipe of recipes) {
    const tagHit = recipe.tags.some((t) => SAUCE_HINT.test(t))
    const ingHit = recipe.ingredients.some(
      (ing) =>
        SAUCE_HINT.test(ing.display_name) ||
        SAUCE_HINT.test(ing.preparation ?? ''),
    )
    if (tagHit || ingHit) sauceRecipes.push(recipe)
  }
  if (sauceRecipes.length >= 2) {
    tasks.push({
      title: 'Mix sauce / dressing once for shared meals',
      scheduled_for: earliestDate(sauceRecipes),
      duration_minutes: 15,
      linked_recipe_ids: sauceRecipes.map((r) => r.id),
      notes: uniqueTitles(sauceRecipes),
      effort: 'active',
    })
    for (const r of sauceRecipes) coveredRecipeIds.add(r.id)
  } else if (sauceRecipes.length === 1) {
    const r = sauceRecipes[0]!
    tasks.push({
      title: `Mix sauce for ${r.title}`,
      scheduled_for: r.date,
      duration_minutes: 10,
      linked_recipe_ids: [r.id],
      notes: null,
      effort: 'active',
    })
    coveredRecipeIds.add(r.id)
  }

  // —— Marinate protein ——————————————————————————————————————————
  for (const recipe of recipes) {
    const tagHit = recipe.tags.some((t) => MARINATE_HINT.test(t))
    const prepHit = recipe.ingredients.some(
      (ing) =>
        MARINATE_HINT.test(ing.preparation ?? '') ||
        MARINATE_HINT.test(ing.display_name),
    )
    if (!tagHit && !prepHit) continue
    tasks.push({
      title: `Marinate protein for ${recipe.title}`,
      scheduled_for: recipe.date,
      duration_minutes: 10,
      linked_recipe_ids: [recipe.id],
      notes: 'Active setup; resting time is passive (no storage guidance)',
      effort: 'active',
    })
    coveredRecipeIds.add(recipe.id)
  }

  // —— Per-recipe light prep for leftovers without a shared task ———
  for (const recipe of recipes) {
    if (coveredRecipeIds.has(recipe.id)) continue
    const prepMin = recipe.prep_minutes ?? 0
    if (prepMin < 10 && recipe.ingredients.length < 4) continue

    const chopNames = recipe.ingredients
      .filter(
        (ing) =>
          CHOP_PREP.test(ing.preparation ?? '') ||
          PRODUCE_NAMES.test(ing.display_name),
      )
      .map((ing) => displayLabel(ing.display_name))
      .slice(0, 3)

    const passive =
      PASSIVE_HINT.test(recipe.title) ||
      recipe.tags.some((t) => PASSIVE_HINT.test(t)) ||
      (recipe.cook_minutes ?? 0) >= 30

    if (chopNames.length > 0) {
      tasks.push({
        title: `Prep ${chopNames.join(', ')} for ${recipe.title}`,
        scheduled_for: recipe.date,
        duration_minutes: Math.min(Math.max(prepMin || 10, 8), 20),
        linked_recipe_ids: [recipe.id],
        notes: null,
        effort: 'active',
      })
    } else if (passive) {
      tasks.push({
        title: `Start ${recipe.title} early (oven / simmer)`,
        scheduled_for: recipe.date,
        duration_minutes: Math.min(recipe.cook_minutes ?? 25, 40),
        linked_recipe_ids: [recipe.id],
        notes: 'Mostly passive time',
        effort: 'passive',
      })
    } else if (prepMin >= 15) {
      tasks.push({
        title: `Do mise en place for ${recipe.title}`,
        scheduled_for: recipe.date,
        duration_minutes: Math.min(prepMin, 25),
        linked_recipe_ids: [recipe.id],
        notes: null,
        effort: 'active',
      })
    }
  }

  // Cap checklist length; prefer shared tasks already at the front.
  return tasks.slice(0, 8)
}
