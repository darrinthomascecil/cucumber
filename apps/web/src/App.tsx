import { useCallback, useEffect, useState } from 'react'
import { api, type Me } from './api.ts'
import { useAdvisor } from './useAdvisor.ts'
import { useAutoplay } from './useAutoplay.ts'
import { useCalibration } from './useCalibration.ts'
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
  const [advisorOn, setAdvisorOn] = useState(
    () => window.localStorage.getItem('cucumber.advisor') === 'on',
  )
  const [autoplayOn, setAutoplayOn] = useState(
    () => window.localStorage.getItem('cucumber.autoplay') === 'on',
  )

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
  const ADVISOR_WORLDS = 256
  // Autoplay needs the advisor's opinion even when the panel is hidden.
  const advisor = useAdvisor(game.view, game.discarded, advisorOn || autoplayOn, ADVISOR_WORLDS)
  const { calibration, reset: resetCalibration } = useCalibration(
    game.view,
    advisor.advice,
    advisor.version,
  )
  useAutoplay(game.view, advisor.advice, advisor.version, autoplayOn, game.send)

  const toggleAdvisor = (on: boolean) => {
    setAdvisorOn(on)
    window.localStorage.setItem('cucumber.advisor', on ? 'on' : 'off')
  }

  const toggleAutoplay = (on: boolean) => {
    setAutoplayOn(on)
    window.localStorage.setItem('cucumber.autoplay', on ? 'on' : 'off')
  }

  // Two tabs on the same game used to disagree. The toggles live in React
  // state, so turning autoplay off in one tab left another open tab happily
  // playing your seat — and nothing on screen said why. localStorage is the
  // shared truth between tabs, so follow it when another tab changes it.
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === 'cucumber.advisor') setAdvisorOn(event.newValue === 'on')
      if (event.key === 'cucumber.autoplay') setAutoplayOn(event.newValue === 'on')
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

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
          <label className="toggle" title="Odds and suggested plays, worked out in your browser">
            <input
              type="checkbox"
              checked={advisorOn}
              onChange={(event) => toggleAdvisor(event.target.checked)}
            />
            Advisor
          </label>
          <label className="toggle" title="Play your seat automatically, taking the advisor's first choice">
            <input
              type="checkbox"
              checked={autoplayOn}
              onChange={(event) => toggleAutoplay(event.target.checked)}
            />
            Autoplay
          </label>
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
          advice={advisorOn ? advisor.advice : null}
          advisorThinking={advisor.thinking}
          advisorMilliseconds={advisor.milliseconds}
          advisorWorlds={ADVISOR_WORLDS}
          calibration={calibration}
          onResetCalibration={resetCalibration}
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
