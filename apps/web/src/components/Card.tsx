import { parseCard } from '@cucumber/game-engine'
import type { CardId } from '@cucumber/shared'

const PIPS = { S: '♠', H: '♥', D: '♦', C: '♣' } as const

interface Props {
  id: CardId
  small?: boolean
  /** Position in a fan, used to stagger the dealing animation. */
  index?: number
  /** Degrees of tilt in the fan, and how far the card dips at the edges. */
  tilt?: number
  lift?: number
  /** Horizontal distance back to where the deal started, in pixels. */
  dealFrom?: number
}

export function CardFace({ id, small, index = 0, tilt = 0, lift = 0, dealFrom = 0 }: Props) {
  const card = parseCard(id)
  const red = card.suit === 'H' || card.suit === 'D'
  const classes = ['card', small ? 'small' : '', red ? 'red' : '', card.suit ? '' : 'joker']
  return (
    <div
      className={classes.filter(Boolean).join(' ')}
      style={
        {
          '--i': index,
          '--tilt': `${tilt}deg`,
          '--lift': `${lift}px`,
          '--dx': `${dealFrom}px`,
        } as React.CSSProperties
      }
      aria-label={label(id)}
    >
      <span className="rank">{card.suit ? card.rank : 'JOKER'}</span>
      <span className="suit">{card.suit ? PIPS[card.suit] : '★'}</span>
    </div>
  )
}

interface ButtonProps extends Props {
  selected: boolean
  disabled: boolean
  /** Marked by the advisor as its first choice. */
  advised?: boolean
  /**
   * Not your move. Still a button, so the element never changes type and the
   * card is never torn down and rebuilt — it just stops responding.
   */
  plain?: boolean
  onToggle: (id: CardId) => void
}

export function CardButton({
  id,
  selected,
  disabled,
  advised,
  plain,
  index = 0,
  tilt = 0,
  lift = 0,
  dealFrom = 0,
  onToggle,
}: ButtonProps) {
  const card = parseCard(id)
  const red = card.suit === 'H' || card.suit === 'D'
  const classes = [
    'card',
    red ? 'red' : '',
    card.suit ? '' : 'joker',
    selected ? 'selected' : '',
    advised && !disabled ? 'advised' : '',
    plain ? 'plain' : '',
  ]
  return (
    <button
      type="button"
      className={classes.filter(Boolean).join(' ')}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={label(id)}
      style={
        {
          '--i': index,
          '--tilt': `${tilt}deg`,
          '--lift': `${lift}px`,
          '--dx': `${dealFrom}px`,
        } as React.CSSProperties
      }
      onClick={() => onToggle(id)}
    >
      <span className="rank">{card.suit ? card.rank : 'JOKER'}</span>
      <span className="suit">{card.suit ? PIPS[card.suit] : '★'}</span>
    </button>
  )
}

/** A card held by somebody else: you know it exists, not what it is. */
export function CardBack({
  index = 0,
  small,
  tilt = 0,
  lift = 0,
}: {
  index?: number
  small?: boolean
  tilt?: number
  lift?: number
}) {
  return (
    <div
      className={`card back${small ? ' small' : ''}`}
      style={
        {
          '--i': index,
          '--tilt': `${tilt}deg`,
          '--lift': `${lift}px`,
          '--dx': `${-tilt * 4}px`,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      <span className="back-pattern" />
    </div>
  )
}

const SUIT_NAMES = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' } as const

export function label(id: CardId): string {
  const card = parseCard(id)
  if (!card.suit) return 'Joker'
  return `${card.rank} of ${SUIT_NAMES[card.suit]}`
}
