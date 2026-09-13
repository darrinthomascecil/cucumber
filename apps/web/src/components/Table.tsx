import { useEffect, useMemo, useState } from 'react'
import { beatsTarget, leadGroup, sortByTrickStrength } from '@cucumber/game-engine'
import type { CardId, PlayerView, Seat } from '@cucumber/shared'
import { CardButton, CardFace } from './Card.tsx'
import { Reveal } from './Reveal.tsx'

interface Props {
  view: PlayerView
  connected: boolean
  onCommand: (command: Command) => void
}

type Command =
  | { type: 'READY'; ready: boolean }
  | { type: 'SELECT_EXCHANGE_SIZE'; size: number }
  | { type: 'SELECT_EXCHANGE'; size: number }
  | { type: 'SUBMIT_DISCARDS'; cards: CardId[] }
  | { type: 'PLAY_CARDS'; cards: CardId[] }
  | { type: 'START_NEXT_MATCH' }

export function Table({ view, connected, onCommand }: Props) {
  const [selected, setSelected] = useState<CardId[]>([])

  // Any change of turn or hand invalidates a half-made selection.
  useEffect(() => {
    setSelected([])
  }, [view.version, view.prompt.kind])

  const hand = useMemo(() => sortByTrickStrength(view.you.hand), [view.you.hand])
  const prompt = view.prompt
  const target = view.trick?.targetCards ?? []

  const toggle = (id: CardId) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((card) => card !== id) : [...current, id],
    )

  const limit = selectionLimit(view)
  const isDisabled = (id: CardId): boolean => {
    if (!isSelectable(view, id)) return true
    if (selected.includes(id)) return false
    if (limit !== null && selected.length >= limit) return true
    // A lead must be all one rank, so once a rank is chosen the rest go dim.
    if (prompt.kind === 'LEAD' && selected.length > 0) {
      return leadGroup(id) !== leadGroup(selected[0] as CardId)
    }
    return false
  }

  const others = view.players.filter((player) => player.seat !== view.you.seat)
  const revealing = view.phase === 'FINAL_REVEAL' || view.phase === 'MATCH_OVER'

  return (
    <div className="table">
      <div className="opponents">
        {others.map((player) => (
          <div
            className={`opponent${view.actionSeat === player.seat ? ' acting' : ''}`}
            key={player.seat}
          >
            <div className="opponent-head">
              <span className={`dot${player.connected === 'ONLINE' ? '' : ' off'}`} />
              <span className="opponent-name">{player.displayName}</span>
              {view.dealerSeat === player.seat ? <span className="tag">Deals</span> : null}
              {player.ready && view.phase === 'LOBBY' ? <span className="tag ready">Ready</span> : null}
            </div>
            <div className="opponent-meta">
              <span>
                {player.cardCount} card{player.cardCount === 1 ? '' : 's'}
              </span>
              <span>Score {player.score}</span>
            </div>
          </div>
        ))}
      </div>

      {revealing ? (
        <Reveal
          view={view}
          onReady={() => onCommand({ type: 'READY', ready: true })}
          onNextMatch={() => onCommand({ type: 'START_NEXT_MATCH' })}
        />
      ) : (
        <div className="felt">
          <div className="felt-title">
            {view.phase === 'LOBBY'
              ? 'Waiting to start'
              : `Hand ${view.handNumber} · ${view.stockCount} in stock`}
          </div>

          {view.trick && view.trick.plays.length > 0 ? (
            <div className="plays">
              {view.trick.plays.map((play, index) => {
                const isTarget = view.trick?.successfulSeat === play.seat && play.successful
                return (
                  <div
                    className={`play-row${isTarget ? ' target' : ''}${play.successful ? '' : ' failed'}`}
                    key={`${play.seat}-${index}`}
                  >
                    <span className="play-who">
                      {nameOf(view, play.seat)}
                      {play.successful ? '' : ' · could not meet'}
                    </span>
                    {play.cards.map((card) => (
                      <CardFace key={card} id={card} small />
                    ))}
                  </div>
                )
              })}
            </div>
          ) : (
            <p style={{ margin: 0, color: 'var(--ink-dim)' }}>
              {view.phase === 'TRICK_PLAY' ? leadLine(view) : 'No cards on the table yet.'}
            </p>
          )}

          {view.lastTrick && view.phase === 'TRICK_PLAY' ? (
            <div className="last-trick">
              <span className="felt-title">Last trick</span>
              {view.lastTrick.plays.map((play, index) => (
                <span className="last-play" key={`${play.seat}-${index}`}>
                  <span>{nameOf(view, play.seat)}</span>
                  {play.cards.map((card) => (
                    <CardFace key={card} id={card} small />
                  ))}
                </span>
              ))}
            </div>
          ) : null}

          <div className={`prompt${prompt.kind === 'FORCED_LOW' ? ' forced' : ''}`}>
            {prompt.message}
          </div>
        </div>
      )}

      <div className="hand-area">
        <div className="you-line">
          <span>
            You · {view.you.displayName}
            {view.dealerSeat === view.you.seat ? ' · dealing' : ''}
          </span>
          <span>Score {view.you.score}</span>
          {connected ? null : <span style={{ color: 'var(--danger)' }}>Reconnecting…</span>}
        </div>

        {hand.length > 0 ? (
          <div className="hand">
            {hand.map((card) =>
              // While it is not your move the hand is for reading, not
              // clicking — show it plainly rather than greyed out.
              takesCards(prompt.kind) ? (
                <CardButton
                  key={card}
                  id={card}
                  selected={selected.includes(card)}
                  disabled={isDisabled(card)}
                  onToggle={toggle}
                />
              ) : (
                <CardFace key={card} id={card} />
              ),
            )}
          </div>
        ) : null}

        {/* During the reveal the only control belongs to the reveal itself. */}
        {revealing ? null : (
          <Actions
            view={view}
            selected={selected}
            target={target}
            onCommand={(command) => {
              setSelected([])
              onCommand(command)
            }}
          />
        )}
      </div>
    </div>
  )
}

function Actions({
  view,
  selected,
  target,
  onCommand,
}: {
  view: PlayerView
  selected: CardId[]
  target: CardId[]
  onCommand: (command: Command) => void
}) {
  const prompt = view.prompt

  switch (prompt.kind) {
    case 'READY':
      return (
        <div className="actions">
          <button
            className="button"
            type="button"
            disabled={view.you.ready}
            onClick={() => onCommand({ type: 'READY', ready: true })}
          >
            {view.you.ready ? 'Ready — waiting for the others' : 'Ready'}
          </button>
          {view.you.ready ? (
            <button
              className="button ghost"
              type="button"
              onClick={() => onCommand({ type: 'READY', ready: false })}
            >
              Not yet
            </button>
          ) : null}
        </div>
      )

    case 'SELECT_EXCHANGE_SIZE':
      return (
        <div className="count-choice">
          {(prompt.options ?? []).map((size) => (
            <button
              className="button ghost"
              type="button"
              key={size}
              onClick={() => onCommand({ type: 'SELECT_EXCHANGE_SIZE', size })}
            >
              {size === 0 ? 'No exchange' : `${size} card${size === 1 ? '' : 's'}`}
            </button>
          ))}
        </div>
      )

    case 'SELECT_EXCHANGE':
      return (
        <div className="count-choice">
          {(prompt.options ?? []).map((size) => (
            <button
              className={size === 0 ? 'button ghost' : 'button'}
              type="button"
              key={size}
              onClick={() => onCommand({ type: 'SELECT_EXCHANGE', size })}
            >
              {size === 0 ? 'Stand pat' : `Exchange ${size}`}
            </button>
          ))}
        </div>
      )

    case 'SUBMIT_DISCARDS': {
      const required = prompt.requiredCards ?? 0
      return (
        <div className="actions">
          <button
            className="button"
            type="button"
            disabled={selected.length !== required}
            onClick={() => onCommand({ type: 'SUBMIT_DISCARDS', cards: selected })}
          >
            Discard {selected.length}/{required}
          </button>
        </div>
      )
    }

    case 'LEAD': {
      const max = prompt.maxCards ?? 1
      return (
        <div className="actions">
          <button
            className="button"
            type="button"
            disabled={selected.length < 1 || selected.length > max}
            onClick={() => onCommand({ type: 'PLAY_CARDS', cards: selected })}
          >
            Lead {selected.length || ''} {selected.length === 1 ? 'card' : 'cards'}
          </button>
        </div>
      )
    }

    case 'FOLLOW': {
      const required = prompt.requiredCards ?? 0
      const complete = selected.length === required
      // A hint, not a gate — the server decides, and the player picks which
      // qualifying combination to spend (spec §51).
      const wins = complete && beatsTarget(selected, target)
      return (
        <div className="actions">
          <button
            className="button"
            type="button"
            disabled={!complete}
            onClick={() => onCommand({ type: 'PLAY_CARDS', cards: selected })}
          >
            Play {selected.length}/{required}
          </button>
          {complete && !wins ? (
            <span style={{ color: 'var(--warn)', fontSize: '0.85rem' }}>
              That does not meet the current play.
            </span>
          ) : null}
        </div>
      )
    }

    case 'FORCED_LOW': {
      const required = prompt.requiredCards ?? 0
      return (
        <div className="actions">
          <button
            className="button"
            type="button"
            disabled={selected.length !== required}
            onClick={() => onCommand({ type: 'PLAY_CARDS', cards: selected })}
          >
            Surrender {selected.length}/{required}
          </button>
        </div>
      )
    }

    default:
      return null
  }
}

function leadLine(view: PlayerView): string {
  const leader = view.trick?.leaderSeat ?? view.you.seat
  return leader === view.you.seat ? 'You lead.' : `${nameOf(view, leader)} leads.`
}

function nameOf(view: PlayerView, seat: Seat): string {
  const player = view.players.find((candidate) => candidate.seat === seat)
  if (!player) return `Seat ${seat}`
  return player.seat === view.you.seat ? 'You' : player.displayName
}

function takesCards(kind: PlayerView['prompt']['kind']): boolean {
  return kind === 'SUBMIT_DISCARDS' || kind === 'LEAD' || kind === 'FOLLOW' || kind === 'FORCED_LOW'
}

function isSelectable(view: PlayerView, id: CardId): boolean {
  const allowed = view.prompt.selectableCards
  return !allowed || allowed.includes(id)
}

function selectionLimit(view: PlayerView): number | null {
  const prompt = view.prompt
  if (prompt.kind === 'LEAD') return prompt.maxCards ?? null
  if (prompt.requiredCards !== undefined) return prompt.requiredCards
  return null
}
