export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type ApiOptions = Omit<RequestInit, 'body'> & {
  body?: unknown
}

/** Fetch JSON from `/api/*` with credentials (session cookie). */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...rest,
  })

  const data = (await res.json().catch(() => ({}))) as {
    error?: string
  } & T

  if (!res.ok) {
    throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status)
  }

  return data as T
}
