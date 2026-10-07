import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getUser, handleAuthCallback, logout as identityLogout } from '@netlify/identity'
import type { MeResponse } from '#shared'
import { hasPermission, type Action, type ModuleKey } from '#shared'
import { ApiError, api, setUnauthorizedHandler } from '../lib/api'
import { devLogout, devToken } from './devAuth'
import { sessionShouldEnd } from './remember'

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'invite'; token: string }
  | { status: 'recovery' }
  | { status: 'denied'; code: string }
  | { status: 'mfa-setup'; me: MeResponse }
  | { status: 'mfa-verify'; me: MeResponse }
  | { status: 'ready'; me: MeResponse }

interface AuthContextValue {
  state: AuthState
  refresh: () => Promise<void>
  logout: () => Promise<void>
  can: (module: ModuleKey, action: Action) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function loadMe(): Promise<AuthState> {
  const identityUser = devToken() ? true : await getUser()
  if (!identityUser) return { status: 'anonymous' }
  try {
    const me = await api<MeResponse>('/me')
    if (me.mfa.required && !me.mfa.verified) return { status: me.mfa.enrolled ? 'mfa-verify' : 'mfa-setup', me }
    return { status: 'ready', me }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { status: 'anonymous' }
    if (e instanceof ApiError && e.status === 403) return { status: 'denied', code: e.code ?? 'forbidden' }
    throw e
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  const refresh = useCallback(async () => {
    setState(await loadMe())
  }, [])

  useEffect(() => {
    void (async () => {
      // Obowiązkowe: obsługa linków z e-maili (zaproszenie, reset hasła, potwierdzenie).
      const callback = await handleAuthCallback().catch(() => null)
      if (callback?.type === 'invite' && callback.token) return setState({ status: 'invite', token: callback.token })
      if (callback?.type === 'recovery') return setState({ status: 'recovery' })
      // „Zapamiętaj mnie” odznaczone, a przeglądarka była zamknięta → wylogowanie.
      if (sessionShouldEnd()) {
        devLogout()
        await identityLogout().catch(() => undefined)
        return setState({ status: 'anonymous' })
      }
      await refresh()
    })()
  }, [refresh])

  // Sesja Identity lub 2FA wygasła w trakcie pracy → ponowne ustalenie stanu (ekran logowania / weryfikacji 2FA).
  useEffect(() => {
    setUnauthorizedHandler(() => void refresh())
    return () => setUnauthorizedHandler(null)
  }, [refresh])

  const logout = useCallback(async () => {
    await api('/mfa/logout', { method: 'POST' }).catch(() => undefined)
    devLogout()
    await identityLogout().catch(() => undefined)
    setState({ status: 'anonymous' })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      refresh,
      logout,
      can: (module, action) => state.status === 'ready' && hasPermission(state.me.permissions, module, action),
    }),
    [state, refresh, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}

export function useMe(): MeResponse {
  const { state } = useAuth()
  if (state.status !== 'ready') throw new Error('useMe requires ready session')
  return state.me
}
