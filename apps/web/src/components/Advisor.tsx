import type { CardId } from '@cucumber/shared'
import type { Advice } from '@cucumber/strategy'
import { CardFace } from './Card.tsx'

interface Props {
  advice: Advice | null
  thinking: boolean
  milliseconds: number
  worlds: number
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

/**
 * Odds and a recommendation, computed in this browser from this player's own
 * view. "Odds" here means the probability of not losing the match — the only
 * thing Cucumber actually decides.
 */
export function Advisor({ advice, thinking, milliseconds, worlds }: Props) {
  if (!advice || advice.kind === 'NONE') return null

  const odds = advice.winProbability
  const best = advice.suggestions[0]
  const alternatives = advice.suggestions.slice(1, 4)

  return (
    <section className="advisor" aria-live="polite">
      <header className="advisor-head">
        <span className="advisor-title">Advisor</span>
        <span className="advisor-meta">
          {thinking ? 'thinking…' : `${worlds} deals · ${Math.round(milliseconds)}ms`}
        </span>
      </header>

      <div className="odds">
        <div className="odds-bar" role="img" aria-label={`${percent(odds)} chance of surviving the match`}>
          <span className="odds-fill" style={{ width: percent(odds) }} />
        </div>
        <div className="odds-number">
          <strong>{percent(odds)}</strong>
          <span>chance you don’t lose this match</span>
        </div>
      </div>

      {best ? (
        <div className="advice-best">
          <span className="advice-label">
            {advice.kind === 'DISCARD' ? 'Throw' : 'Play'}
          </span>
          <span className="advice-cards">
            {best.cards.map((card: CardId) => (
              <CardFace key={card} id={card} small />
            ))}
          </span>
          <span className="advice-odds">{percent(best.winProbability)}</span>
        </div>
      ) : null}

      {alternatives.length > 0 ? (
        <div className="advice-list">
          <span className="advice-label">Else</span>
          {alternatives.map((suggestion) => (
            <span className="advice-alt" key={suggestion.cards.join('-')}>
              {suggestion.cards.map((card: CardId) => (
                <CardFace key={card} id={card} small />
              ))}
              <span className="advice-cost">−{percent(suggestion.cost)}</span>
            </span>
          ))}
        </div>
      ) : null}

      {advice.note ? <p className="advisor-note">{advice.note}</p> : null}
    </section>
  )
}
