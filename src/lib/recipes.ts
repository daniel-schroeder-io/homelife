import type {
  RecipeIngredient,
  RecipeIngredientInput,
  RecipeStatus,
} from '../../shared/types'

export const RECIPE_STATUS_LABELS: Record<RecipeStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  favorite: 'Favorite',
  tried: 'Tried',
  not_for_us: 'Not for us',
  archived: 'Archived',
}

export const RECIPE_STATUS_OPTIONS: RecipeStatus[] = [
  'draft',
  'active',
  'favorite',
  'tried',
  'not_for_us',
  'archived',
]

export function formatMinutes(
  prep: number | null | undefined,
  cook: number | null | undefined,
): string {
  const p = prep ?? 0
  const c = cook ?? 0
  const total = p + c
  const parts: string[] = []
  if (p > 0) parts.push(`${p} min prep`)
  if (c > 0) parts.push(`${c} min cook`)
  if (total > 0 && parts.length) {
    return `${parts.join(' · ')} · ${total} min total`
  }
  if (total > 0) return `${total} min`
  return 'Time not set'
}

export function scaleQuantity(
  quantity: number | null,
  baseServings: number | null | undefined,
  targetServings: number,
): number | null {
  if (quantity == null || !Number.isFinite(quantity)) return quantity
  if (baseServings == null || baseServings <= 0) return quantity
  return Math.round(quantity * (targetServings / baseServings) * 1000) / 1000
}

export function formatIngredientLine(
  ing: Pick<
    RecipeIngredient | RecipeIngredientInput,
    'display_name' | 'quantity' | 'unit' | 'preparation' | 'optional'
  >,
  scaledQty?: number | null,
): string {
  const qty = scaledQty !== undefined ? scaledQty : ing.quantity
  const parts: string[] = []
  if (qty != null) parts.push(String(qty))
  if (ing.unit) parts.push(ing.unit)
  parts.push(ing.display_name)
  let line = parts.join(' ')
  if (ing.preparation) line += `, ${ing.preparation}`
  if (ing.optional) line += ' (optional)'
  return line
}

export type RecipeFormState = {
  title: string
  source_url: string
  servings: string
  prep_minutes: string
  cook_minutes: string
  instructions: string
  notes: string
  tags: string
  status: RecipeStatus
  ingredientsText: string
}

export function emptyRecipeForm(
  overrides: Partial<RecipeFormState> = {},
): RecipeFormState {
  return {
    title: '',
    source_url: '',
    servings: '4',
    prep_minutes: '',
    cook_minutes: '',
    instructions: '',
    notes: '',
    tags: '',
    status: 'active',
    ingredientsText: '',
    ...overrides,
  }
}

/** One ingredient per line; keeps display text, best-effort qty/unit parse. */
export function parseIngredientsText(text: string): RecipeIngredientInput[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => parseClientIngredientLine(line, i))
}

function parseClientIngredientLine(
  line: string,
  sortOrder: number,
): RecipeIngredientInput {
  let rest = line
  let quantity: number | null = null
  let unit: string | null = null

  const qtyMatch = rest.match(/^((?:\d+\s+)?\d+\/\d+|\d+\.\d+|\d+)\s*/)
  if (qtyMatch) {
    quantity = parseFraction(qtyMatch[1]!)
    rest = rest.slice(qtyMatch[0].length)
  }

  const unitMatch = rest.match(
    /^(tbsp|tsp|cups?|oz|lbs?|lb|g|kg|ml|l|cloves?|cans?|heads?)\b\.?\s*/i,
  )
  if (unitMatch) {
    unit = unitMatch[1]!.toLowerCase()
    rest = rest.slice(unitMatch[0].length)
  }

  let preparation: string | null = null
  const comma = rest.indexOf(',')
  let display_name = rest.trim()
  if (comma > 0) {
    display_name = rest.slice(0, comma).trim()
    preparation = rest.slice(comma + 1).trim() || null
  }

  return {
    display_name: display_name || line,
    quantity,
    unit,
    preparation,
    optional: /\boptional\b/i.test(line),
    sort_order: sortOrder,
  }
}

function parseFraction(raw: string): number | null {
  const mixed = raw.trim().match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  const frac = raw.trim().match(/^(\d+)\/(\d+)$/)
  if (frac) return Number(frac[1]) / Number(frac[2])
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function ingredientsToText(
  ingredients: Array<
    Pick<
      RecipeIngredient | RecipeIngredientInput,
      'display_name' | 'quantity' | 'unit' | 'preparation' | 'optional'
    >
  >,
): string {
  return ingredients.map((ing) => formatIngredientLine(ing)).join('\n')
}

export function formToPayload(form: RecipeFormState) {
  const servings = form.servings.trim() ? Number(form.servings) : null
  const prep = form.prep_minutes.trim() ? Number(form.prep_minutes) : null
  const cook = form.cook_minutes.trim() ? Number(form.cook_minutes) : null
  return {
    title: form.title.trim(),
    source_url: form.source_url.trim() || null,
    servings: servings != null && Number.isFinite(servings) ? servings : null,
    prep_minutes: prep != null && Number.isFinite(prep) ? Math.round(prep) : null,
    cook_minutes: cook != null && Number.isFinite(cook) ? Math.round(cook) : null,
    instructions: form.instructions.trim() || null,
    notes: form.notes.trim() || null,
    tags: form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    status: form.status,
    ingredients: parseIngredientsText(form.ingredientsText),
  }
}
