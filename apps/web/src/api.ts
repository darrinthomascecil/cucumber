import type { Room } from '@cucumber/shared'

export interface Me {
  id: string
  email: string
  displayName: string
  isAdmin: boolean
  status: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed (${response.status})`)
  }
  return (await response.json()) as T
}

export const api = {
  me: () => request<Me>('/api/me'),
  redeem: (token: string) =>
    request<{ id: string }>('/api/auth/redeem', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  joinRoom: () => request<Room>('/api/room/join', { method: 'POST' }),
  invite: (email: string, displayName: string) =>
    request<{ email: string; displayName: string; inviteUrl: string }>('/api/admin/invites', {
      method: 'POST',
      body: JSON.stringify({ email, displayName }),
    }),
  users: () =>
    request<
      {
        id: string
        email: string
        displayName: string
        status: string
        isAdmin: boolean
        hasPendingInvite: boolean
      }[]
    >('/api/admin/users'),
}
