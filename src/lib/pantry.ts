import type { PantryItem } from '../../shared/types'
import { api } from './api'

export type PantryLocation = 'fridge' | 'freezer' | 'cupboard' | 'other'

export const PANTRY_LOCATIONS: { value: PantryLocation; label: string }[] = [
  { value: 'fridge', label: 'Fridge' },
  { value: 'freezer', label: 'Freezer' },
  { value: 'cupboard', label: 'Cupboard' },
  { value: 'other', label: 'Other' },
]

export async function fetchPantry(): Promise<PantryItem[]> {
  const res = await api<{ items: PantryItem[] }>('/api/pantry')
  return res.items
}

export async function addPantryItem(body: {
  display_name: string
  quantity?: number | null
  unit?: string | null
  location?: PantryLocation | null
}): Promise<PantryItem> {
  const res = await api<{ item: PantryItem }>('/api/pantry', {
    method: 'POST',
    body,
  })
  return res.item
}

export async function patchPantryItem(
  id: string,
  body: {
    display_name?: string
    quantity?: number | null
    unit?: string | null
    location?: PantryLocation | null
  },
): Promise<PantryItem> {
  const res = await api<{ item: PantryItem }>(
    `/api/pantry/${encodeURIComponent(id)}`,
    { method: 'PATCH', body },
  )
  return res.item
}

export async function deletePantryItem(id: string): Promise<void> {
  await api<{ ok: boolean }>(`/api/pantry/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function locationLabel(location: string | null): string {
  if (!location) return 'Unspecified'
  const found = PANTRY_LOCATIONS.find((l) => l.value === location)
  return found?.label ?? location
}
