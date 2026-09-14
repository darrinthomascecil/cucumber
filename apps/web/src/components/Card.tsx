import { parseCard } from '@cucumber/game-engine'
import type { CardId } from '@cucumber/shared'

const PIPS = { S: '♠', H: '♥', D: '♦', C: '♣' } as const

interface Props {
  id: CardId
  small?: boolean
}

export function CardFace({ id, small }: Props) {
  const card = parseCard(id)
  const red = card.suit === 'H' || card.suit === 'D'
  const classes = ['card', small ? 'small' : '', red ? 'red' : '', card.suit ? '' : 'joker']
  return (
    <div className={classes.filter(Boolean).join(' ')} aria-label={label(id)}>
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
  onToggle: (id: CardId) => void
}

export function CardButton({ id, selected, disabled, advised, onToggle }: ButtonProps) {
  const card = parseCard(id)
  const red = card.suit === 'H' || card.suit === 'D'
  const classes = [
    'card',
    red ? 'red' : '',
    card.suit ? '' : 'joker',
    selected ? 'selected' : '',
    advised && !disabled ? 'advised' : '',
  ]
  return (
    <button
      type="button"
      className={classes.filter(Boolean).join(' ')}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={label(id)}
      onClick={() => onToggle(id)}
    >
      <span className="rank">{card.suit ? card.rank : 'JOKER'}</span>
      <span className="suit">{card.suit ? PIPS[card.suit] : '★'}</span>
    </button>
  )
}

const SUIT_NAMES = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' } as const

export function label(id: CardId): string {
  const card = parseCard(id)
  if (!card.suit) return 'Joker'
  return `${card.rank} of ${SUIT_NAMES[card.suit]}`
}
