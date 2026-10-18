import type { CookHistoryView, CookRating } from '../../shared/types'
import { api } from './api'

export async function recordCookHistory(body: {
  recipe_id: string
  rating?: CookRating | null
  feedback?: string | null
}): Promise<CookHistoryView> {
  const res = await api<{ entry: CookHistoryView }>('/api/cook-history', {
    method: 'POST',
    body,
  })
  return res.entry
}

export async function fetchRecentCookHistory(
  limit = 20,
): Promise<CookHistoryView[]> {
  const res = await api<{ entries: CookHistoryView[] }>(
    `/api/cook-history?limit=${encodeURIComponent(String(limit))}`,
  )
  return res.entries
}

export const COOK_RATING_LABELS: Record<CookRating, string> = {
  loved: 'Loved it',
  okay: 'Okay',
  dont_suggest: "Don't suggest again",
}
