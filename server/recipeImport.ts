import type { RecipeDraft, RecipeIngredientInput } from '../shared/types.ts'

export type ImportOk = {
  status: 'ok'
  draft: RecipeDraft
}

export type ImportNeedsReview = {
  status: 'needs_review'
  url: string
  extracted: Partial<RecipeDraft>
  message: string
}

export type ImportResult = ImportOk | ImportNeedsReview

const COMMON_UNITS = [
  'tablespoons?',
  'teaspoons?',
  'tbsp',
  'tsp',
  'cups?',
  'ounces?',
  'oz',
  'pounds?',
  'lbs?',
  'lb',
  'grams?',
  'g',
  'kilograms?',
  'kg',
  'milliliters?',
  'ml',
  'liters?',
  'l',
  'cloves?',
  'cans?',
  'packages?',
  'pkg',
  'slices?',
  'pinches?',
  'bunches?',
  'heads?',
  'pieces?',
  'whole',
]

const UNIT_RE = new RegExp(`^(${COMMON_UNITS.join('|')})\\b\\.?`, 'i')

/**
 * Best-effort URL import: JSON-LD Recipe first, then HTML heuristics.
 * Never invents a complete recipe from nothing.
 */
export async function importRecipeFromUrl(url: string): Promise<ImportResult> {
  let html: string
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'HomeLifeRecipeBot/1.0 (+https://railway.app)',
      },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) {
      return {
        status: 'needs_review',
        url,
        extracted: { source_url: url, tags: [], ingredients: [], status: 'draft' },
        message: `Could not fetch URL (HTTP ${res.status})`,
      }
    }
    const contentType = res.headers.get('content-type') ?? ''
    if (
      !contentType.includes('html') &&
      !contentType.includes('text/') &&
      !contentType.includes('xml')
    ) {
      return {
        status: 'needs_review',
        url,
        extracted: { source_url: url, tags: [], ingredients: [], status: 'draft' },
        message: 'URL did not return HTML',
      }
    }
    html = await res.text()
  } catch (error) {
    return {
      status: 'needs_review',
      url,
      extracted: { source_url: url, tags: [], ingredients: [], status: 'draft' },
      message:
        error instanceof Error ? error.message : 'Failed to fetch URL',
    }
  }

  const fromLd = extractFromJsonLd(html)
  const fromHeuristics = extractFromHeuristics(html)
  const merged = mergeExtracted(fromLd, fromHeuristics, url)

  if (isGoodExtract(merged)) {
    return {
      status: 'ok',
      draft: toDraft(merged, url),
    }
  }

  return {
    status: 'needs_review',
    url,
    extracted: {
      title: merged.title ?? '',
      source_url: url,
      servings: merged.servings ?? null,
      prep_minutes: merged.prep_minutes ?? null,
      cook_minutes: merged.cook_minutes ?? null,
      instructions: merged.instructions ?? null,
      notes: null,
      tags: merged.tags ?? [],
      status: 'draft',
      ingredients: merged.ingredients ?? [],
    },
    message: reviewMessage(merged),
  }
}

type PartialExtract = {
  title?: string
  servings?: number | null
  prep_minutes?: number | null
  cook_minutes?: number | null
  instructions?: string | null
  tags?: string[]
  ingredients?: RecipeIngredientInput[]
}

function isGoodExtract(e: PartialExtract): boolean {
  const title = e.title?.trim()
  const ingredients = e.ingredients ?? []
  const instructions = e.instructions?.trim()
  return Boolean(title && ingredients.length >= 2 && instructions)
}

function reviewMessage(e: PartialExtract): string {
  const missing: string[] = []
  if (!e.title?.trim()) missing.push('title')
  if ((e.ingredients?.length ?? 0) < 2) missing.push('ingredients')
  if (!e.instructions?.trim()) missing.push('instructions')
  if (missing.length === 0) {
    return 'Extraction incomplete — please review before saving'
  }
  return `Could not reliably extract ${missing.join(', ')}. Review and fill in before saving.`
}

function toDraft(e: PartialExtract, url: string): RecipeDraft {
  return {
    title: e.title!.trim(),
    source_url: url,
    servings: e.servings ?? null,
    prep_minutes: e.prep_minutes ?? null,
    cook_minutes: e.cook_minutes ?? null,
    instructions: e.instructions?.trim() || null,
    notes: null,
    tags: e.tags ?? [],
    status: 'draft',
    ingredients: e.ingredients ?? [],
  }
}

function mergeExtracted(
  a: PartialExtract,
  b: PartialExtract,
  _url: string,
): PartialExtract {
  const ingredients =
    (a.ingredients?.length ?? 0) >= (b.ingredients?.length ?? 0)
      ? a.ingredients
      : b.ingredients
  const instructions =
    (a.instructions?.length ?? 0) >= (b.instructions?.length ?? 0)
      ? a.instructions
      : b.instructions
  return {
    title: a.title || b.title,
    servings: a.servings ?? b.servings ?? null,
    prep_minutes: a.prep_minutes ?? b.prep_minutes ?? null,
    cook_minutes: a.cook_minutes ?? b.cook_minutes ?? null,
    instructions: instructions ?? null,
    tags: (a.tags?.length ? a.tags : b.tags) ?? [],
    ingredients: ingredients ?? [],
  }
}

function extractFromJsonLd(html: string): PartialExtract {
  const scripts = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ]
  for (const match of scripts) {
    const raw = match[1]?.trim()
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as unknown
      const nodes = flattenLd(parsed)
      for (const node of nodes) {
        if (!isRecipeNode(node)) continue
        return recipeNodeToExtract(node)
      }
    } catch {
      // ignore bad JSON-LD blocks
    }
  }
  return {}
}

function flattenLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((v) => flattenLd(v))
  }
  if (!isObj(value)) return []
  const out: Record<string, unknown>[] = [value]
  if (Array.isArray(value['@graph'])) {
    out.push(...flattenLd(value['@graph']))
  }
  return out
}

function isRecipeNode(node: Record<string, unknown>): boolean {
  const t = node['@type']
  if (typeof t === 'string') {
    return t.toLowerCase() === 'recipe'
  }
  if (Array.isArray(t)) {
    return t.some(
      (x) => typeof x === 'string' && x.toLowerCase() === 'recipe',
    )
  }
  return false
}

function recipeNodeToExtract(node: Record<string, unknown>): PartialExtract {
  const title =
    typeof node.name === 'string'
      ? decodeHtml(node.name)
      : typeof node.headline === 'string'
        ? decodeHtml(node.headline)
        : undefined

  const ingredientLines = normalizeStringList(node.recipeIngredient)
  const ingredients = ingredientLines.map((line, i) =>
    parseIngredientLine(line, i),
  )

  const instructions = instructionsFromLd(node.recipeInstructions)
  const servings = parseServings(node.recipeYield ?? node.yield)
  const prep_minutes = parseIsoDurationMinutes(node.prepTime)
  const cook_minutes = parseIsoDurationMinutes(node.cookTime)
  const tags = normalizeStringList(node.keywords).flatMap((k) =>
    k.split(',').map((s) => s.trim()).filter(Boolean),
  )
  const cuisine = normalizeStringList(node.recipeCuisine)
  const category = normalizeStringList(node.recipeCategory)

  return {
    title,
    servings,
    prep_minutes,
    cook_minutes,
    instructions,
    tags: [...tags, ...cuisine, ...category].slice(0, 20),
    ingredients,
  }
}

function instructionsFromLd(value: unknown): string | null {
  if (typeof value === 'string') return decodeHtml(value).trim() || null
  if (!Array.isArray(value)) return null

  const steps: string[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      steps.push(decodeHtml(item).trim())
      continue
    }
    if (!isObj(item)) continue
    const type = item['@type']
    if (
      typeof type === 'string' &&
      type.toLowerCase() === 'howtoSection' &&
      Array.isArray(item.itemListElement)
    ) {
      const nested = instructionsFromLd(item.itemListElement)
      if (nested) steps.push(nested)
      continue
    }
    if (typeof item.text === 'string') {
      steps.push(decodeHtml(item.text).trim())
    } else if (typeof item.name === 'string') {
      steps.push(decodeHtml(item.name).trim())
    }
  }

  const cleaned = steps.filter(Boolean)
  if (cleaned.length === 0) return null
  return cleaned.map((s, i) => `${i + 1}. ${s.replace(/^\d+\.\s*/, '')}`).join('\n')
}

function extractFromHeuristics(html: string): PartialExtract {
  const title =
    matchMeta(html, 'og:title') ||
    matchMeta(html, 'twitter:title') ||
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '') ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]

  const ingredients = extractIngredientList(html)
  const instructions = extractInstructions(html)

  return {
    title: title ? decodeHtml(stripTags(title)).trim() : undefined,
    ingredients,
    instructions,
  }
}

function extractIngredientList(html: string): RecipeIngredientInput[] {
  // Prefer wprm / tasty / common recipe plugin lists, then generic <li> under ingredient headings.
  const patterns = [
    /class=["'][^"']*wprm-recipe-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class=["'][^"']*ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /itemprop=["']recipeIngredient["'][^>]*>([\s\S]*?)<\/(?:li|span|p|div)>/gi,
  ]

  for (const re of patterns) {
    const lines: string[] = []
    for (const m of html.matchAll(re)) {
      const text = decodeHtml(stripTags(m[1] ?? '')).trim()
      if (text && text.length < 200) lines.push(text)
    }
    if (lines.length >= 2) {
      return lines.map((line, i) => parseIngredientLine(line, i))
    }
  }

  // Heading + following list heuristic
  const section = html.match(
    /<(?:h2|h3|h4)[^>]*>\s*ingredients?\s*<\/(?:h2|h3|h4)>([\s\S]{0,8000}?)<(?:h2|h3|h4|section|\/article)/i,
  )
  if (section?.[1]) {
    const lines: string[] = []
    for (const m of section[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
      const text = decodeHtml(stripTags(m[1] ?? '')).trim()
      if (text && text.length < 200) lines.push(text)
    }
    if (lines.length >= 2) {
      return lines.map((line, i) => parseIngredientLine(line, i))
    }
  }

  return []
}

function extractInstructions(html: string): string | null {
  const itempropSteps: string[] = []
  for (const m of html.matchAll(
    /itemprop=["']recipeInstructions["'][^>]*>([\s\S]*?)<\/(?:div|ol|ul|section|li)/gi,
  )) {
    const text = decodeHtml(stripTags(m[1] ?? '')).trim()
    if (text) itempropSteps.push(text)
  }
  if (itempropSteps.length) {
    return itempropSteps.join('\n')
  }

  const section = html.match(
    /<(?:h2|h3|h4)[^>]*>\s*(?:instructions?|directions?|method)\s*<\/(?:h2|h3|h4)>([\s\S]{0,12000}?)<(?:h2|h3|h4|section|\/article)/i,
  )
  if (!section?.[1]) return null

  const steps: string[] = []
  for (const m of section[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = decodeHtml(stripTags(m[1] ?? '')).trim()
    if (text) steps.push(text)
  }
  if (steps.length) {
    return steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
  }

  const paras: string[] = []
  for (const m of section[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = decodeHtml(stripTags(m[1] ?? '')).trim()
    if (text) paras.push(text)
  }
  return paras.length ? paras.map((s, i) => `${i + 1}. ${s}`).join('\n') : null
}

/** Parse "1 1/2 cups flour, sifted" into quantity/unit/name/preparation. */
export function parseIngredientLine(
  line: string,
  sortOrder = 0,
): RecipeIngredientInput {
  const display = line.replace(/\s+/g, ' ').trim()
  let rest = display
  let quantity: number | null = null
  let unit: string | null = null
  let preparation: string | null = null

  const qtyMatch = rest.match(
    /^((?:\d+\s+)?\d+\/\d+|\d+\.\d+|\d+)\s*/,
  )
  if (qtyMatch) {
    quantity = parseFraction(qtyMatch[1]!)
    rest = rest.slice(qtyMatch[0].length)
  }

  const unitMatch = rest.match(UNIT_RE)
  if (unitMatch) {
    unit = normalizeUnit(unitMatch[1]!)
    rest = rest.slice(unitMatch[0].length).trim()
  }

  // Split trailing preparation after comma when present
  const comma = rest.indexOf(',')
  let name = rest
  if (comma > 0 && comma < rest.length - 1) {
    name = rest.slice(0, comma).trim()
    preparation = rest.slice(comma + 1).trim() || null
  }

  return {
    display_name: name || display,
    quantity,
    unit,
    preparation,
    optional: /\boptional\b/i.test(display),
    sort_order: sortOrder,
  }
}

function parseFraction(raw: string): number | null {
  const s = raw.trim()
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) {
    return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  }
  const frac = s.match(/^(\d+)\/(\d+)$/)
  if (frac) return Number(frac[1]) / Number(frac[2])
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function normalizeUnit(unit: string): string {
  const u = unit.toLowerCase().replace(/\.$/, '')
  const map: Record<string, string> = {
    tablespoon: 'tbsp',
    tablespoons: 'tbsp',
    teaspoon: 'tsp',
    teaspoons: 'tsp',
    cup: 'cup',
    cups: 'cup',
    ounce: 'oz',
    ounces: 'oz',
    pound: 'lb',
    pounds: 'lb',
    lbs: 'lb',
    gram: 'g',
    grams: 'g',
    kilogram: 'kg',
    kilograms: 'kg',
    milliliter: 'ml',
    milliliters: 'ml',
    liter: 'l',
    liters: 'l',
    package: 'pkg',
    packages: 'pkg',
  }
  return map[u] ?? u
}

function parseServings(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const m = value.match(/(\d+(?:\.\d+)?)/)
    if (m) return Number(m[1])
  }
  if (Array.isArray(value) && value.length) return parseServings(value[0])
  return null
}

function parseIsoDurationMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null
  // PT1H30M / PT45M / P0DT1H
  const m = value.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i)
  if (!m) {
    const mins = value.match(/(\d+)\s*min/i)
    return mins ? Number(mins[1]) : null
  }
  const days = Number(m[1] ?? 0)
  const hours = Number(m[2] ?? 0)
  const minutes = Number(m[3] ?? 0)
  const seconds = Number(m[4] ?? 0)
  const total = days * 24 * 60 + hours * 60 + minutes + Math.round(seconds / 60)
  return total > 0 ? total : null
}

function normalizeStringList(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []
  return value
    .map((v) => {
      if (typeof v === 'string') return v
      if (isObj(v) && typeof v.text === 'string') return v.text
      if (isObj(v) && typeof v.name === 'string') return v.name
      return null
    })
    .filter((v): v is string => Boolean(v))
}

function matchMeta(html: string, property: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    'i',
  )
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    'i',
  )
  return html.match(re)?.[1] ?? html.match(re2)?.[1]
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
}

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(Number.parseInt(h, 16)),
    )
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
