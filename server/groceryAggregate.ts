/**
 * Pure-ish grocery aggregation from meal-plan recipe ingredients.
 *
 * Rules (design §5.D / §11):
 * - Combine ONLY when identity + unit are compatible (no invented conversions).
 * - "to taste" / "for the pan" → pantry_check / non-quantified, never fabricated qty.
 * - Ambiguous or incompatible units stay as separate lines.
 */

export type AggregateSourceLine = {
  recipeId: string
  recipeTitle: string
  displayName: string
  quantity: number | null
  unit: string | null
  preparation: string | null
  ingredientId: string | null
  /** From ingredients.category when linked; otherwise guessed. */
  categoryHint: string | null
  /** entry.servings / recipe.servings (1 when unknown). */
  scaleFactor: number
}

export type AggregatedGroceryLine = {
  /** Stable key for regenerate matching (name + unit family + quantified?). */
  identityKey: string
  displayName: string
  quantity: number | null
  unit: string | null
  ingredientId: string | null
  category: string
  sourceType: 'recipe' | 'pantry_check'
  sourceRecipes: { id: string; title: string }[]
}

/** Display order for aisle groups. */
export const AISLE_ORDER = [
  'Produce',
  'Meat',
  'Seafood',
  'Dairy',
  'Bakery',
  'Frozen',
  'Pantry',
  'Spices',
  'Other',
] as const

export type AisleCategory = (typeof AISLE_ORDER)[number]

const UNIT_ALIASES: Record<string, string> = {
  '': '',
  g: 'g',
  gram: 'g',
  grams: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  l: 'l',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  tsp: 'tsp',
  tsps: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tbsp: 'tbsp',
  tbsps: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  cup: 'cup',
  cups: 'cup',
  clove: 'clove',
  cloves: 'clove',
  pinch: 'pinch',
  pinches: 'pinch',
  bunch: 'bunch',
  bunches: 'bunch',
  can: 'can',
  cans: 'can',
  package: 'package',
  packages: 'package',
  pkg: 'package',
  piece: 'piece',
  pieces: 'piece',
  slice: 'slice',
  slices: 'slice',
  stalk: 'stalk',
  stalks: 'stalk',
  head: 'head',
  heads: 'head',
  each: 'each',
  ea: 'each',
}

/** Phrases that mean "don't invent a purchase quantity". */
const PANTRY_PHRASE =
  /\b(to taste|as needed|for the pan|for greasing|for frying|for cooking|for serving|optional|garnish)\b/i

/**
 * Aggregate recipe ingredient lines into grocery list lines.
 * Does not touch the database.
 */
export function aggregateIngredients(
  lines: AggregateSourceLine[],
): AggregatedGroceryLine[] {
  type Bucket = {
    displayName: string
    quantity: number | null
    unit: string | null
    ingredientId: string | null
    category: string
    sourceType: 'recipe' | 'pantry_check'
    recipes: Map<string, string>
    identityKey: string
  }

  const buckets = new Map<string, Bucket>()

  for (const line of lines) {
    const cleanedName = cleanDisplayName(line.displayName)
    if (!cleanedName) continue

    const pantryStyle = isPantryStyle(line)
    const rawQty =
      line.quantity == null ? null : line.quantity * line.scaleFactor
    const quantity =
      pantryStyle || rawQty == null || !Number.isFinite(rawQty)
        ? null
        : roundQty(rawQty)
    const unit = pantryStyle ? null : normalizeUnit(line.unit)
    const sourceType: 'recipe' | 'pantry_check' = pantryStyle
      ? 'pantry_check'
      : 'recipe'

    const identityKey = makeIdentityKey({
      ingredientId: line.ingredientId,
      displayName: cleanedName,
      unit,
      quantified: quantity != null,
    })

    const existing = buckets.get(identityKey)
    if (!existing) {
      buckets.set(identityKey, {
        displayName: preferTitleCase(cleanedName),
        quantity,
        unit,
        ingredientId: line.ingredientId,
        category: guessCategory(
          cleanedName,
          line.categoryHint,
          line.preparation,
        ),
        sourceType,
        recipes: new Map([[line.recipeId, line.recipeTitle]]),
        identityKey,
      })
      continue
    }

    // Compatible bucket: same identity key already implies compatible unit.
    existing.recipes.set(line.recipeId, line.recipeTitle)
    if (line.ingredientId && !existing.ingredientId) {
      existing.ingredientId = line.ingredientId
    }
    // Prefer recipe over pantry_check if any contribution is a real qty.
    if (sourceType === 'recipe') existing.sourceType = 'recipe'

    if (quantity != null && existing.quantity != null) {
      existing.quantity = roundQty(existing.quantity + quantity)
    } else if (quantity != null && existing.quantity == null) {
      existing.quantity = quantity
      existing.unit = unit
    }
    // If both null (pantry-style), stay non-quantified.
  }

  return [...buckets.values()]
    .map((b) => ({
      identityKey: b.identityKey,
      displayName: b.displayName,
      quantity: b.quantity,
      unit: b.unit,
      ingredientId: b.ingredientId,
      category: b.category,
      sourceType: b.sourceType,
      sourceRecipes: [...b.recipes.entries()].map(([id, title]) => ({
        id,
        title,
      })),
    }))
    .sort((a, b) => {
      const ai = AISLE_ORDER.indexOf(a.category as AisleCategory)
      const bi = AISLE_ORDER.indexOf(b.category as AisleCategory)
      const aOrder = ai === -1 ? AISLE_ORDER.length : ai
      const bOrder = bi === -1 ? AISLE_ORDER.length : bi
      if (aOrder !== bOrder) return aOrder - bOrder
      return a.displayName.localeCompare(b.displayName, undefined, {
        sensitivity: 'base',
      })
    })
}

export function makeIdentityKey(opts: {
  ingredientId: string | null
  displayName: string
  unit: string | null
  quantified: boolean
}): string {
  const nameKey = normalizeNameKey(opts.displayName)
  const idPart = opts.ingredientId ? `id:${opts.ingredientId}` : `name:${nameKey}`
  // Identity ignores source_type so "already have" / checked state can change
  // without breaking regenerate matching.
  const unitPart = opts.quantified
    ? `unit:${opts.unit ?? 'each'}`
    : `noqty:${opts.unit ?? ''}`
  return `${idPart}|${unitPart}`
}

export function identityKeyFromStored(item: {
  ingredient_id: string | null
  display_name: string
  quantity: number | null
  unit: string | null
}): string {
  return makeIdentityKey({
    ingredientId: item.ingredient_id,
    displayName: cleanDisplayName(item.display_name),
    unit: normalizeUnit(item.unit),
    quantified: item.quantity != null,
  })
}

export function normalizeUnit(unit: string | null | undefined): string | null {
  if (unit == null) return null
  const raw = unit.trim().toLowerCase().replace(/\./g, '')
  if (!raw) return null
  if (raw in UNIT_ALIASES) return UNIT_ALIASES[raw]!
  // Strip trailing s for unknown plurals (cups already handled).
  if (raw.endsWith('s') && raw.length > 2) {
    const singular = raw.slice(0, -1)
    if (singular in UNIT_ALIASES) return UNIT_ALIASES[singular]!
  }
  return raw
}

export function cleanDisplayName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/^[\d./\s]+/, '') // leading qty fragments if any
    .trim()
}

/** Normalized ingredient name for pantry ↔ grocery matching. */
export function normalizeNameKey(name: string): string {
  let key = cleanDisplayName(name).toLowerCase()
  // Light plural fold: onions → onion (skip short / s-ending words).
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

export function isPantryStyle(line: {
  displayName: string
  quantity: number | null
  unit: string | null
  preparation: string | null
}): boolean {
  const hay = `${line.displayName} ${line.preparation ?? ''} ${line.unit ?? ''}`
  if (PANTRY_PHRASE.test(hay)) return true
  // Explicit "pinch of salt" with no real purchase qty intent stays pantry-ish
  // only when quantity is absent and unit looks non-purchase.
  if (line.quantity == null) {
    const u = (line.unit ?? '').toLowerCase()
    if (/taste|needed|dash|splash/.test(u)) return true
  }
  return false
}

export function guessCategory(
  displayName: string,
  hint: string | null,
  preparation: string | null,
): string {
  if (hint) {
    const normalized = normalizeCategoryHint(hint)
    if (normalized) return normalized
  }

  const text = `${displayName} ${preparation ?? ''}`.toLowerCase()

  if (
    /\b(chicken|beef|pork|turkey|lamb|bacon|sausage|thigh|breast|ground meat|steak)\b/.test(
      text,
    )
  ) {
    return 'Meat'
  }
  if (/\b(salmon|shrimp|tuna|cod|fish|seafood|clam|mussel)\b/.test(text)) {
    return 'Seafood'
  }
  if (
    /\b(milk|cream|butter|cheese|yogurt|yoghurt|egg|eggs|sour cream)\b/.test(
      text,
    )
  ) {
    return 'Dairy'
  }
  if (/\b(bread|bun|buns|bagel|tortilla|pita|roll|rolls)\b/.test(text)) {
    return 'Bakery'
  }
  if (/\b(frozen|ice cream)\b/.test(text)) return 'Frozen'
  if (
    /\b(salt|pepper|cumin|paprika|chili|oregano|basil|thyme|garlic powder|cinnamon|spice)\b/.test(
      text,
    )
  ) {
    return 'Spices'
  }
  if (
    /\b(onion|garlic|tomato|lettuce|kale|spinach|carrot|celery|pepper|lemon|lime|potato|avocado|cilantro|parsley|ginger|broccoli|cabbage|cucumber|zucchini|mushroom|apple|banana|berry|berries|herb)\b/.test(
      text,
    )
  ) {
    return 'Produce'
  }
  if (
    /\b(oil|vinegar|flour|sugar|rice|pasta|bean|beans|broth|stock|sauce|soy|can|canned|honey|mustard|mayo|ketchup)\b/.test(
      text,
    )
  ) {
    return 'Pantry'
  }
  return 'Other'
}

function normalizeCategoryHint(hint: string): string | null {
  const h = hint.trim().toLowerCase()
  for (const aisle of AISLE_ORDER) {
    if (aisle.toLowerCase() === h) return aisle
  }
  if (/\bproduce|vegetable|fruit\b/.test(h)) return 'Produce'
  if (/\bmeat|poultry\b/.test(h)) return 'Meat'
  if (/\bseafood|fish\b/.test(h)) return 'Seafood'
  if (/\bdairy\b/.test(h)) return 'Dairy'
  if (/\bbakery|bread\b/.test(h)) return 'Bakery'
  if (/\bfrozen\b/.test(h)) return 'Frozen'
  if (/\bspice|seasoning\b/.test(h)) return 'Spices'
  if (/\bpantry|dry|canned\b/.test(h)) return 'Pantry'
  return null
}

function preferTitleCase(name: string): string {
  if (!name) return name
  // Keep all-lowercase recipe strings readable on the list.
  return name.replace(/\b\w/g, (c) => c.toUpperCase())
}

function roundQty(n: number): number {
  // Avoid long floats from serving scale (e.g. 1.333…).
  const rounded = Math.round(n * 1000) / 1000
  return Object.is(rounded, -0) ? 0 : rounded
}

/** Encode multi-recipe provenance into grocery_items.notes */
export function encodeSourceNotes(
  recipes: { id: string; title: string }[],
  extra?: { text?: string | null },
): string | null {
  const payload: {
    recipes: { id: string; title: string }[]
    text?: string
  } = { recipes }
  if (extra?.text?.trim()) payload.text = extra.text.trim()
  return JSON.stringify(payload)
}

export function decodeSourceNotes(notes: string | null): {
  recipes: { id: string; title: string }[]
  text: string | null
} {
  if (!notes) return { recipes: [], text: null }
  const trimmed = notes.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        recipes?: { id?: string; title?: string }[]
        text?: string
      }
      const recipes = Array.isArray(parsed.recipes)
        ? parsed.recipes
            .filter(
              (r): r is { id: string; title: string } =>
                typeof r?.id === 'string' && typeof r?.title === 'string',
            )
            .map((r) => ({ id: r.id, title: r.title }))
        : []
      return {
        recipes,
        text: typeof parsed.text === 'string' ? parsed.text : null,
      }
    } catch {
      // fall through to plain text
    }
  }
  return { recipes: [], text: notes }
}

export function formatQuantityLabel(
  quantity: number | null,
  unit: string | null,
): string {
  if (quantity == null) return ''
  const q =
    Number.isInteger(quantity) || Math.abs(quantity - Math.round(quantity)) < 1e-9
      ? String(Math.round(quantity))
      : String(quantity)
  return unit ? `${q} ${unit}` : q
}
