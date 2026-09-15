import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Me } from './api.ts'
import { useAdvisor } from './useAdvisor.ts'
import { useAutoplay } from './useAutoplay.ts'
import { useCalibration } from './useCalibration.ts'
import { useGame } from './useGame.ts'
import { useReview } from './useReview.ts'
import { ADVISOR_VERSION } from '@cucumber/strategy'
import { Admin } from './components/Admin.tsx'
import { Lobby } from './components/Lobby.tsx'
import { Review } from './components/Review.tsx'
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
  /*
   * Autoplay deliberately does NOT persist.
   *
   * It used to be remembered like the other toggles, and twice that cost
   * hours: a tab left open with it on plays your seat silently, and because
   * the setting survives reloads, closing and reopening the game does not
   * clear it. You end up watching a hand play itself with no visible cause.
   * Nothing else on this screen acts on your behalf, so nothing else has this
   * failure mode. It starts off every session and you turn it on when you want
   * it, which costs one click and removes the whole class of problem.
   */
  const [autoplayOn, setAutoplayOn] = useState(false)
  // Blind: the advisor still thinks, and is still recorded, but says nothing
  // until the match is over. Playing with the answer on screen is a different
  // game from playing and finding out afterwards how close you came.
  const [blindOn, setBlindOn] = useState(
    () => window.localStorage.getItem('cucumber.blind') === 'on',
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
  const advisor = useAdvisor(
    game.view,
    game.discarded,
    advisorOn || autoplayOn || blindOn,
    ADVISOR_WORLDS,
  )
  const reviewer = useReview(game.view, advisor.advice, advisor.version)
  // Shown once the match is over, and only for a match played blind — with the
  // advisor on screen throughout there is nothing to find out afterwards.
  const [reviewDismissed, setReviewDismissed] = useState<string | null>(null)
  const matchOver = game.view?.phase === 'MATCH_OVER'
  const showReview =
    blindOn && matchOver && game.view !== null && reviewDismissed !== game.view.matchId

  // Keep the review once the match is over. The advisor runs in this tab, so
  // this is the only place these evaluations exist; a closed tab would take
  // them with it. Idempotent server-side, so a reload does not duplicate.
  const savedMatch = useRef<string | null>(null)
  const finishedMatchId = matchOver && game.view ? game.view.matchId : null
  useEffect(() => {
    if (!blindOn || !finishedMatchId) return
    if (savedMatch.current === finishedMatchId) return
    if (reviewer.decisions.length === 0) return
    savedMatch.current = finishedMatchId
    void fetch('/api/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        matchId: finishedMatchId,
        advisor: ADVISOR_VERSION,
        summary: {
          accuracy: reviewer.summary.accuracy,
          decisions: reviewer.summary.decisions,
          unscored: reviewer.summary.unscored,
          totalCost: reviewer.summary.totalCost,
          judged: reviewer.summary.judged.map((j) => ({
            handNumber: j.handNumber,
            played: j.played,
            best: j.best?.cards ?? null,
            cost: j.cost,
            withinNoise: j.withinNoise,
          })),
        },
      }),
    }).catch(() => {
      // Losing a review is not worth interrupting a game for.
      savedMatch.current = null
    })
  }, [blindOn, finishedMatchId, reviewer.decisions.length, reviewer.summary])
  const { calibration, reset: resetCalibration } = useCalibration(
    game.view,
    advisor.advice,
    advisor.version,
  )
  // Autoplay would be playing the very decisions the review is about.
  useAutoplay(game.view, advisor.advice, advisor.version, autoplayOn && !blindOn, game.send)

  const toggleAdvisor = (on: boolean) => {
    setAdvisorOn(on)
    window.localStorage.setItem('cucumber.advisor', on ? 'on' : 'off')
  }

  const toggleAutoplay = (on: boolean) => {
    setAutoplayOn(on)
    // Still broadcast to other tabs, so turning it off in one turns it off
    // everywhere — it is just never read back at startup.
    window.localStorage.setItem('cucumber.autoplay', on ? 'on' : 'off')
  }

  const toggleBlind = (on: boolean) => {
    setBlindOn(on)
    window.localStorage.setItem('cucumber.blind', on ? 'on' : 'off')
  }

  // Two tabs on the same game used to disagree. The toggles live in React
  // state, so turning autoplay off in one tab left another open tab happily
  // playing your seat — and nothing on screen said why. localStorage is the
  // shared truth between tabs, so follow it when another tab changes it.
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === 'cucumber.advisor') setAdvisorOn(event.newValue === 'on')
      if (event.key === 'cucumber.autoplay') setAutoplayOn(event.newValue === 'on')
      if (event.key === 'cucumber.blind') setBlindOn(event.newValue === 'on')
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
          <label className="toggle" title="Hide the advisor until the match ends, then score how you played">
            <input
              type="checkbox"
              checked={blindOn}
              onChange={(event) => toggleBlind(event.target.checked)}
            />
            Blind
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

      {showReview && game.view ? (
        <Review summary={reviewer.summary} onDismiss={() => setReviewDismissed(game.view!.matchId)} />
      ) : null}

      {showAdmin ? (
        <Admin onClose={() => setShowAdmin(false)} />
      ) : game.view ? (
        <Table
          view={game.view}
          connected={game.connected}
          advice={advisorOn && !blindOn ? advisor.advice : null}
          advisorThinking={advisor.thinking}
          advisorMilliseconds={advisor.milliseconds}
          advisorWorlds={ADVISOR_WORLDS}
          calibration={calibration}
          onResetCalibration={resetCalibration}
          onCommand={(command) => {
            // Recorded before sending: once the command lands the view moves
            // on, and the advice on hand is about the position after the play.
            if (command.type === 'PLAY_CARDS' || command.type === 'SUBMIT_DISCARDS') {
              reviewer.note(command.cards)
            }
            game.send(command)
          }}
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
