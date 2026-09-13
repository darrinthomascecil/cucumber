import { useCallback, useEffect, useState } from 'react'
import { api, type Me } from './api.ts'
import { useGame } from './useGame.ts'
import { Admin } from './components/Admin.tsx'
import { Lobby } from './components/Lobby.tsx'
import { Login, extractToken } from './components/Login.tsx'
import { Table } from './components/Table.tsx'

export function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdmin, setShowAdmin] = useState(false)

  const signIn = useCallback(async (token: string) => {
    setError(null)
    try {
      await api.redeem(token)
      const user = await api.me()
      await api.joinRoom().catch(() => undefined)
      setMe(user)
      window.history.replaceState(null, '', '/')
    } catch (issue) {
      setError((issue as Error).message)
    }
  }, [])

  // An invitation link signs you in on arrival; otherwise pick up the session.
  useEffect(() => {
    const path = window.location.pathname
    const fromLink = path.startsWith('/invite/') ? extractToken(path) : null
    const boot = async () => {
      if (fromLink) {
        await signIn(fromLink)
        setChecked(true)
        return
      }
      try {
        const user = await api.me()
        await api.joinRoom().catch(() => undefined)
        setMe(user)
      } catch {
        setMe(null)
      }
      setChecked(true)
    }
    void boot()
  }, [signIn])

  const game = useGame(me !== null)

  const signOut = async () => {
    await api.logout().catch(() => undefined)
    setMe(null)
    setShowAdmin(false)
  }

  if (!checked) {
    return (
      <div className="shell">
        <div className="center">
          <p style={{ color: 'var(--ink-dim)' }}>Loading…</p>
        </div>
      </div>
    )
  }

  if (!me) {
    return (
      <div className="shell">
        <Login error={error} onRedeem={signIn} />
      </div>
    )
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          Cucumber
          {game.view ? <small>Hand {game.view.handNumber}</small> : null}
        </div>
        <div className="topbar-actions">
          <span>{me.displayName}</span>
          {me.isAdmin ? (
            <button className="link-button" type="button" onClick={() => setShowAdmin((on) => !on)}>
              {showAdmin ? 'Table' : 'Invitations'}
            </button>
          ) : null}
          <button className="link-button" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {game.rejection ? (
        <div style={{ padding: '0.75rem 1.25rem 0' }}>
          <div className="notice error" role="alert">
            {game.rejection.reason}{' '}
            <button className="link-button" type="button" onClick={game.dismiss}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {showAdmin ? (
        <Admin onClose={() => setShowAdmin(false)} />
      ) : game.view ? (
        <Table
          view={game.view}
          connected={game.connected}
          onCommand={(command) => game.send(command)}
        />
      ) : game.room ? (
        <Lobby room={game.room} youId={me.id} />
      ) : (
        <div className="center">
          <p style={{ color: 'var(--ink-dim)' }}>
            {game.connected ? 'Finding your seat…' : 'Connecting…'}
          </p>
        </div>
      )}
    </div>
  )
}
