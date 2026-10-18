import type { GroceryItemView, GroceryListDetail } from '../../shared/types'
import { api } from './api'

export async function fetchCurrentGroceryList(
  weekStart?: string,
): Promise<GroceryListDetail> {
  const q = weekStart
    ? `?week_start=${encodeURIComponent(weekStart)}`
    : ''
  const res = await api<{ list: GroceryListDetail }>(
    `/api/groceries/current${q}`,
  )
  return res.list
}

export async function regenerateGroceryList(
  weekStart?: string,
): Promise<GroceryListDetail> {
  const res = await api<{ list: GroceryListDetail }>(
    '/api/groceries/regenerate',
    {
      method: 'POST',
      body: weekStart ? { week_start: weekStart } : {},
    },
  )
  return res.list
}

export async function addGroceryItem(body: {
  display_name: string
  quantity?: number | null
  unit?: string | null
  category?: string
  week_start?: string
  notes?: string | null
}): Promise<GroceryItemView> {
  const res = await api<{ item: GroceryItemView }>('/api/groceries/items', {
    method: 'POST',
    body,
  })
  return res.item
}

export async function patchGroceryItem(
  id: string,
  body: {
    display_name?: string
    quantity?: number | null
    unit?: string | null
    category?: string | null
    checked?: boolean
    checked_at?: string | null
    already_have?: boolean
    notes?: string | null
  },
): Promise<GroceryItemView> {
  const res = await api<{ item: GroceryItemView }>(
    `/api/groceries/items/${encodeURIComponent(id)}`,
    { method: 'PATCH', body },
  )
  return res.item
}

export async function deleteGroceryItem(id: string): Promise<void> {
  await api<{ ok: boolean }>(
    `/api/groceries/items/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export function sourceLabel(item: GroceryItemView): string {
  if (item.already_have) {
    const inPantry = item.notes?.toLowerCase() === 'in pantry'
    const label = inPantry ? 'In pantry' : 'Already have'
    const recipes = item.source_recipes.map((r) => r.title).filter(Boolean)
    if (recipes.length) return `${label} · ${recipes.join(', ')}`
    return label
  }
  if (item.manual || item.source_type === 'manual') return 'Added by you'
  if (item.source_recipes.length === 0) return 'From plan'
  if (item.source_recipes.length === 1) {
    return item.source_recipes[0]!.title
  }
  return item.source_recipes.map((r) => r.title).join(', ')
}

export function mondayOfLocal(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d))
  const day = dt.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  dt.setUTCDate(dt.getUTCDate() + diff)
  return dt.toISOString().slice(0, 10)
}
