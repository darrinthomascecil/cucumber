import type { PlayerView } from '@cucumber/shared'

interface Props {
  view: PlayerView
  onReady: () => void
  onNextMatch: () => void
}

/**
 * The reveal, in the middle of the table.
 *
 * It does not show the final cards, because the table already does — each
 * player's last card is turned face up where they are sitting, and yours is
 * in your own hand. What belongs in the middle is what those cards did.
 */
export function Reveal({ view, onReady, onNextMatch }: Props) {
  const result = view.handResult
  if (!result) return null
  const over = view.phase === 'MATCH_OVER'
  const losers = view.losers
  const nameOf = (seat: number) =>
    view.players.find((player) => player.seat === seat)?.displayName ?? `Seat ${seat}`

  return (
    <div className="reveal">
      <h2>Final cards</h2>

      <div className="reveal-scores">
        {view.players.map((player) => (
          <span
            className={`reveal-score${losers.includes(player.seat) ? ' loser' : ''}`}
            key={player.seat}
          >
            <span className="reveal-name">
              {player.seat === view.you.seat ? 'You' : player.displayName}
            </span>
            <span className="score-move">
              {result.scoresBefore[player.seat]} → <b>{result.scoresAfter[player.seat]}</b>
            </span>
          </span>
        ))}
      </div>

      {result.instantLossSeats.length > 0 ? (
        <div className="banner instant">
          Instant loss — {result.instantLossSeats.map(nameOf).join(' and ')} finished on a 7 or a
          Joker.
        </div>
      ) : over ? (
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
  )
}
