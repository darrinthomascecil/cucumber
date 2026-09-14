import { useEffect, useMemo, useState } from 'react'
import { beatsTarget, leadGroup, sortByTrickStrength } from '@cucumber/game-engine'
import { leftOf, type CardId, type PlayerView, type Seat as SeatNumber } from '@cucumber/shared'
import type { Advice } from '@cucumber/strategy'
import type { Calibration as CalibrationStats } from '../useCalibration.ts'
import { Advisor } from './Advisor.tsx'
import { Calibration } from './Calibration.tsx'
import { CardBack, CardButton, CardFace } from './Card.tsx'
import { Reveal } from './Reveal.tsx'
import { Seat } from './Seat.tsx'

interface Props {
  view: PlayerView
  connected: boolean
  advice: Advice | null
  advisorThinking: boolean
  advisorMilliseconds: number
  advisorWorlds: number
  calibration: CalibrationStats
  onResetCalibration: () => void
  onCommand: (command: Command) => void
}

type Command =
  | { type: 'READY'; ready: boolean }
  | { type: 'SELECT_EXCHANGE_SIZE'; size: number }
  | { type: 'SELECT_EXCHANGE'; size: number }
  | { type: 'SUBMIT_DISCARDS'; cards: CardId[] }
  | { type: 'PLAY_CARDS'; cards: CardId[] }
  | { type: 'START_NEXT_MATCH' }

type Place = 'me' | 'left' | 'right'

/**
 * How long a won trick stays on the felt before it is gathered up.
 *
 * It has to be there at all — the engine sweeps a trick the instant the third
 * card lands, so without this the last player's card is never drawn once. But
 * it should not still be sitting there while you think about your lead, so it
 * holds briefly and then fades rather than waiting to be replaced.
 */
const TRICK_HOLD_MS = 250
const TRICK_FADE_MS = 300

export function Table({
  view,
  connected,
  advice,
  advisorThinking,
  advisorMilliseconds,
  advisorWorlds,
  calibration,
  onResetCalibration,
  onCommand,
}: Props) {
  const [selected, setSelected] = useState<CardId[]>([])

  useEffect(() => {
    setSelected([])
  }, [view.version, view.prompt.kind])

  const hand = useMemo(() => sortByTrickStrength(view.you.hand), [view.you.hand])
  const prompt = view.prompt
  const target = view.trick?.targetCards ?? []

  // You always sit at the bottom. The player who acts after you — the one the
  // rules call your left — sits on your left, so the turn travels the way the
  // game describes it.
  const mySeat = view.you.seat
  const leftSeat = leftOf(mySeat)
  const rightSeat = leftOf(leftSeat)
  const playerAt = (seat: SeatNumber) => view.players.find((player) => player.seat === seat)!
  const placeOf = (seat: SeatNumber): Place =>
    seat === mySeat ? 'me' : seat === leftSeat ? 'left' : 'right'

  const revealing = view.phase === 'FINAL_REVEAL' || view.phase === 'MATCH_OVER'

  /*
   * A finished trick is swept the instant the third card lands, so the client
   * never sees a state containing all three plays — the last player's card
   * went straight from unplayed to gone. At a real table the trick sits where
   * it fell until somebody leads the next one, so show it that way: while the
   * new trick is empty, the felt still holds the one just finished.
   */
  const finished =
    view.phase === 'TRICK_PLAY' && view.trick?.plays.length === 0 ? view.lastTrick : null
  const finishedAt = finished ? view.version : null
  const [gatheredAt, setGatheredAt] = useState<number | null>(null)

  useEffect(() => {
    if (finishedAt === null) return
    const timer = window.setTimeout(
      () => setGatheredAt(finishedAt),
      TRICK_HOLD_MS + TRICK_FADE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [finishedAt])

  const settled = finished && gatheredAt !== finishedAt ? finished : null
  const onFelt = settled ?? view.trick
  const winner = settled?.successfulSeat ?? view.trick?.successfulSeat ?? null
  // A fresh hand fans out across the table; cards drawn later just appear.
  // Opponents' cards stagger on a fresh deal; a drawn card just arrives.
  const dealing = !revealing && hand.length === 13 && view.handNumber > 0

  const toggle = (id: CardId) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((card) => card !== id) : [...current, id],
    )

  const limit = selectionLimit(view)
  const isDisabled = (id: CardId): boolean => {
    if (!isSelectable(view, id)) return true
    if (selected.includes(id)) return false
    if (limit !== null && selected.length >= limit) return true
    if (prompt.kind === 'LEAD' && selected.length > 0) {
      return leadGroup(id) !== leadGroup(selected[0] as CardId)
    }
    return false
  }

  const advised = new Set(selected.length === 0 ? (advice?.suggestions[0]?.cards ?? []) : [])
  const interactive = takesCards(prompt.kind)

  // Cards fan around an arc, as they would in a hand held up in front of you.
  const step = Math.min(3.2, 40 / Math.max(1, hand.length))
  /** Roughly how far apart the cards sit once fanned, in pixels. */
  const PITCH = 43
  const fan = (index: number) => {
    const offset = index - (hand.length - 1) / 2
    return {
      tilt: offset * step,
      lift: Math.abs(offset * step) * 1.1,
      // Where this card has to travel from, so they all start together.
      dealFrom: -offset * PITCH,
    }
  }

  return (
    <div className="table">
      <aside className="rail rail-left">
        {view.lastTrick && view.phase === 'TRICK_PLAY' ? (
          <div className="last-trick">
            <span className="felt-title">Last trick</span>
            {view.lastTrick.plays.map((play, index) => (
              <span
                className={`last-play${play.successful ? '' : ' failed'}${
                  view.lastTrick?.successfulSeat === play.seat && play.successful ? ' won' : ''
                }`}
                key={`${play.seat}-${index}`}
              >
                <span className="last-who">{nameOf(view, play.seat)}</span>
                <span className="last-cards">
                  {play.cards.map((card) => (
                    <CardFace key={card} id={card} small />
                  ))}
                </span>
              </span>
            ))}
          </div>
        ) : null}

        <Calibration stats={calibration} onReset={onResetCalibration} />
      </aside>

      <div className="tabletop">
        <div className="felt-rim" />
        <Seat
          player={playerAt(leftSeat)}
          place="left"
          acting={view.actionSeat === leftSeat}
          dealing={view.dealerSeat === leftSeat}
          finalCard={revealing ? (view.handResult?.finalCards[leftSeat] ?? null) : null}
          dealAnimation={dealing}
        />
        <Seat
          player={playerAt(rightSeat)}
          place="right"
          acting={view.actionSeat === rightSeat}
          dealing={view.dealerSeat === rightSeat}
          finalCard={revealing ? (view.handResult?.finalCards[rightSeat] ?? null) : null}
          dealAnimation={dealing}
        />

        <div className="centre">
          {revealing ? (
            <Reveal
              view={view}
              onReady={() => onCommand({ type: 'READY', ready: true })}
              onNextMatch={() => onCommand({ type: 'START_NEXT_MATCH' })}
            />
          ) : (
            <>
              {view.stockCount > 0 ? (
                <div className="stock" aria-label={`${view.stockCount} cards left in the stock`}>
                  <CardBack small />
                  <CardBack small />
                  <span className="stock-count">{view.stockCount}</span>
                </div>
              ) : null}

              {/*
                * One layer, always mounted. Re-parenting the plays into a
                * wrapper when the trick settled remounted all three cards and
                * re-ran their entry animation, so the two already on the felt
                * jumped. Adding a class starts the fade without touching the
                * tree.
                */}
              <div className={`trick-layer${settled ? ' gathering' : ''}`}>
                <>
                  {(onFelt?.plays ?? []).map((play, index) => {
                    const place = placeOf(play.seat)
                    const isTarget = winner === play.seat && play.successful
                    return (
                      <div
                        className={`play play-${place}${play.successful ? '' : ' failed'}${
                          isTarget ? ' target' : ''
                        }`}
                        key={`${play.seat}-${index}-${play.cards.join('')}`}
                      >
                        {play.cards.map((card, at) => (
                          <CardFace key={card} id={card} index={at} />
                        ))}
                        {play.successful ? null : <span className="play-note">could not meet</span>}
                      </div>
                    )
                  })}

                  {settled ? (
                    <p className="centre-note settled-note">
                      {winner === mySeat
                        ? 'You take it'
                        : `${nameOf(view, winner ?? mySeat)} takes it`}
                    </p>
                  ) : null}
                </>
              </div>

              {view.phase === 'LOBBY' ? (
                <p className="centre-note">Waiting for the table.</p>
              ) : !settled && view.trick && view.trick.plays.length === 0 ? (
                <p className="centre-note">{leadLine(view)}</p>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="you">
        <div className={`prompt${prompt.kind === 'FORCED_LOW' ? ' forced' : ''}`}>
          {prompt.message}
        </div>

        <div className="you-plate">
          {view.dealerSeat === mySeat ? (
            <span className="dealer-button inline" title="You deal" aria-label="Dealer">
              D
            </span>
          ) : null}
          <span className={`dot${connected ? '' : ' off'}`} />
          <span className="seat-name">{view.you.displayName}</span>
          <span className="seat-score">{view.you.score}</span>
          {connected ? null : <span className="reconnecting">reconnecting…</span>}
        </div>

        {hand.length > 0 ? (
          <div className="hand">
            {hand.map((card, index) => {
              const { tilt, lift, dealFrom } = fan(index)
              // Always the same element, whether or not it is your move. It
              // used to switch to a plain face when you could not act, which
              // tore down all thirteen cards and dealt them again — on every
              // turn boundary.
              return (
                <CardButton
                  key={card}
                  id={card}
                  index={index}
                  tilt={tilt}
                  lift={lift}
                  dealFrom={dealFrom}
                  selected={selected.includes(card)}
                  advised={advised.has(card)}
                  plain={!interactive}
                  disabled={!interactive || isDisabled(card)}
                  onToggle={toggle}
                />
              )
            })}
          </div>
        ) : null}

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

      <aside className="rail rail-right">
        {advice ? (
          <Advisor
            advice={advice}
            thinking={advisorThinking}
            milliseconds={advisorMilliseconds}
            worlds={advisorWorlds}
          />
        ) : null}
      </aside>
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
            <span className="warn-note">That does not meet the current play.</span>
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

function nameOf(view: PlayerView, seat: SeatNumber): string {
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
