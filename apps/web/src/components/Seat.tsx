import type { PublicPlayer } from '@cucumber/shared'
import { CardBack, CardFace } from './Card.tsx'

interface Props {
  player: PublicPlayer
  /** Where around the table this seat sits. */
  place: 'left' | 'right'
  acting: boolean
  dealing: boolean
  /** Revealed only at the end of the hand. */
  finalCard: string | null
  /** Stagger the fan when a fresh hand is being dealt. */
  dealAnimation: boolean
}

/**
 * Somebody else at the table. You see what everyone at a real table sees:
 * how many cards they are holding, not which ones.
 */
export function Seat({ player, place, acting, dealing, finalCard, dealAnimation }: Props) {
  const count = player.cardCount
  return (
    <div className={`seat seat-${place}${acting ? ' acting' : ''}`}>
      <div className="seat-cards" aria-label={`${player.displayName} holds ${count} cards`}>
        {finalCard ? (
          <CardFace id={finalCard} small />
        ) : (
          Array.from({ length: count }, (_, index) => {
            // Held in a fan, as anybody holds thirteen cards.
            const step = Math.min(3.4, 42 / Math.max(1, count))
            const tilt = (index - (count - 1) / 2) * step
            return (
              <CardBack
                key={index}
                index={dealAnimation ? index : 0}
                tilt={tilt}
                lift={Math.abs(tilt) * 0.7}
                small
              />
            )
          })
        )}
      </div>
      <div className="seat-plate">
        <span className={`dot${player.connected === 'ONLINE' ? '' : ' off'}`} />
        <span className="seat-name">{player.displayName}</span>
        <span className="seat-score">{player.score}</span>
      </div>

      {/* The dealer button sits on the felt in front of them, as it would. */}
      {dealing ? (
        <span className="dealer-button" title={`${player.displayName} deals`} aria-label="Dealer">
          D
        </span>
      ) : null}
    </div>
  )
}
