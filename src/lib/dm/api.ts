'use client'

import type { AuthUser, ChatUser } from './types'

/**
 * REST helpers for the accounts service (mini-service on port 3004,
 * reached through the gateway with the XTransformPort query param).
 */

export interface AuthResult {
  token: string
  user: AuthUser
}

export type AuthErrorCode =
  | 'invalid_username'
  | 'invalid_display_name'
  | 'invalid_password'
  | 'username_taken'
  | 'bad_credentials'
  | 'unauthorized'
  | 'request_failed'

export class ApiError extends Error {
  code: AuthErrorCode
  constructor(code: AuthErrorCode) {
    super(code)
    this.code = code
  }
}

const PORT = 3004

async function request<T>(
  path: string,
  opts: { method?: string; body?: string; token?: string; query?: Record<string, string> } = {}
): Promise<T> {
  const { method, body, token, query } = opts
  const params = new URLSearchParams({ XTransformPort: String(PORT), ...(query ?? {}) })
  let res: Response
  try {
    res = await fetch(`${path}?${params.toString()}`, {
      method: method ?? 'GET',
      body,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  } catch {
    throw new ApiError('request_failed')
  }
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) {
    const code = (data as { error?: string } | null)?.error as AuthErrorCode | undefined
    throw new ApiError(code ?? 'request_failed')
  }
  return data as T
}

export function apiRegister(payload: { username: string; displayName: string; password: string }) {
  return request<AuthResult>('/auth/register', { method: 'POST', body: JSON.stringify(payload) })
}

export function apiLogin(payload: { username: string; password: string }) {
  return request<AuthResult>('/auth/login', { method: 'POST', body: JSON.stringify(payload) })
}

/** search accounts by username or display name (token required) */
export function apiSearch(q: string, token: string) {
  return request<{ users: ChatUser[] }>('/users/search', { token, query: { q } })
}
