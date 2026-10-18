import { useEffect, useState } from 'react'

type WelcomePayload = {
  name: string
  message: string
}

export function Welcome() {
  const [data, setData] = useState<WelcomePayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch('/api/welcome')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<WelcomePayload>
      })
      .then((payload) => {
        if (!cancelled) setData(payload)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="welcome">
      <p className="brand">{data?.name ?? 'HomeLife'}</p>
      <h1>{data?.message ?? 'Welcome to HomeLife'}</h1>
      <p className="lede">
        Plan dinners, build the grocery list, and keep the household in sync —
        powered by Bun and SQLite.
      </p>
      {error ? (
        <p className="status error" role="alert">
          Could not reach the API ({error}). Is the Bun server running?
        </p>
      ) : data ? (
        <p className="status ok">Connected to SQLite via Bun</p>
      ) : (
        <p className="status">Connecting…</p>
      )}
    </main>
  )
}
