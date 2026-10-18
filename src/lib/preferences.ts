import type { HouseholdPreferencesView } from '../../shared/types'
import { api } from './api'

export type HouseholdPreferences = HouseholdPreferencesView

export async function fetchPreferences(): Promise<HouseholdPreferences> {
  const res = await api<{ preferences: HouseholdPreferences }>(
    '/api/households/preferences',
  )
  return res.preferences
}

export async function patchPreferences(
  patch: Partial<HouseholdPreferences>,
): Promise<HouseholdPreferences> {
  const res = await api<{ preferences: HouseholdPreferences }>(
    '/api/households/preferences',
    { method: 'PATCH', body: patch },
  )
  return res.preferences
}

export async function deleteHousehold(confirm: string): Promise<void> {
  await api('/api/households/current', {
    method: 'DELETE',
    body: { confirm },
  })
}

export async function deleteAccount(): Promise<void> {
  await api('/api/auth/me', {
    method: 'DELETE',
    body: { confirm: 'DELETE' },
  })
}

/** Trigger a JSON file download of the household export. */
export async function downloadExport(): Promise<void> {
  const res = await fetch('/api/export', { credentials: 'include' })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? `Export failed (${res.status})`)
  }

  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = /filename="([^"]+)"/.exec(disposition)
  const filename = match?.[1] ?? 'homelife-export.json'

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
