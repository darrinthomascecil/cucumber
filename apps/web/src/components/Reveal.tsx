import type { PlayerView } from '@cucumber/shared'
import { CardFace } from './Card.tsx'

interface Props {
  view: PlayerView
  onReady: () => void
  onNextMatch: () => void
}

/** The three final cards, then what they did to the scores (spec §52). */
export function Reveal({ view, onReady, onNextMatch }: Props) {
  const result = view.handResult
  if (!result) return null
  const over = view.phase === 'MATCH_OVER'
  const losers = view.losers
  const nameOf = (seat: number) =>
    view.players.find((player) => player.seat === seat)?.displayName ?? `Seat ${seat}`

  return (
    <div className="felt">
      <div className="reveal">
        <h2>Final cards</h2>
        <div className="reveal-cards">
          {view.players.map((player) => (
            <div className="reveal-seat" key={player.seat}>
              <CardFace id={result.finalCards[player.seat]} />
              <span className="reveal-name">
                {player.displayName}
                {player.seat === view.you.seat ? ' (you)' : ''}
              </span>
              <span className="score-move">
                {result.scoresBefore[player.seat]} → <b>{result.scoresAfter[player.seat]}</b>
              </span>
            </div>
          ))}
        </div>

        {result.instantLossSeats.length > 0 ? (
          <div className="banner instant">
            Instant loss — {result.instantLossSeats.map(nameOf).join(' and ')} finished on a 7 or a
            Joker.
          </div>
        ) : null}

        {over && result.instantLossSeats.length === 0 ? (
          <div className="banner loss">
            {losers.map(nameOf).join(' and ')} {losers.length > 1 ? 'tie for the loss' : 'loses'} at{' '}
            {result.scoresAfter[losers[0] ?? 1]} points.
          </div>
        ) : null}

        {over ? (
          <button className="button" type="button" onClick={onNextMatch}>
            Start another match
          </button>
        ) : (
          <button className="button" type="button" onClick={onReady} disabled={view.you.ready}>
            {view.you.ready ? 'Waiting for the others…' : 'Ready for the next hand'}
          </button>
        )}
      </div>
    </div>
  )
}
