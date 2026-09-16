import { useState } from 'react'
import { cardLabel } from '@cucumber/game-engine'
import type { Judged, ReviewSummary } from '@cucumber/strategy'

interface Props {
  summary: ReviewSummary
  onDismiss: () => void
}

const pct = (value: number) => `${Math.round(value * 100)}%`
const points = (value: number) => `−${(value * 100).toFixed(0)} pts`

/**
 * What the advisor thought, now that it can no longer help you.
 *
 * It is deliberately quiet about the decisions you got right. A list of ticks
 * beside every obvious play would bury the two that actually cost something,
 * and most positions in this game have one sensible move — saying so at length
 * would be flattery, not review.
 */
export function Review({ summary, onDismiss }: Props) {
  const { decisions, mistakes, totalCost, worstMoment, accuracy, unscored } = summary
  const scored = decisions - unscored

  if (scored === 0) {
    return (
      <div className="review">
        <div className="review-card">
          <div className="review-head">
            <h2>The review</h2>
          </div>
          <p className="review-sub">
            Nothing to judge: the advisor did not evaluate any of your decisions this
            match. That happens when it was never asked — turn the advisor on, or play
            with Blind so it thinks without telling you.
          </p>
          <div className="review-actions">
            <button className="button" type="button" onClick={onDismiss}>
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  const flawless = mistakes.length === 0

  return (
    <div className="review">
      <div className="review-card">
        <div className="review-head">
          <h2>The review</h2>
          <span className="review-hand">
            {scored} {scored === 1 ? 'decision' : 'decisions'} judged
            {unscored > 0 ? ` · ${unscored} unscored` : ''}
          </span>
        </div>

        <div className="review-verdict">
          <b>{pct(accuracy)}</b>
          <span>
            played at the maximum
            {flawless ? '' : ` · ${points(totalCost)} handed back in total`}
          </span>
        </div>

        <p className="review-sub">
          {flawless
            ? 'No decision cost you anything the search can measure. Either you found the best play every time, or what you played was inside the noise of it — which counts the same, because the advisor cannot tell those apart.'
            : `The costliest was hand ${worstMoment?.handNumber}: ${points(worstMoment?.cost ?? 0)}.
               A cost under 2 points is not listed — at that size the search cannot tell
               two plays apart, and calling it a mistake would be reading its own noise.`}
        </p>

        {mistakes.length > 0 ? (
          <div className="review-list">
            {mistakes.map((moment, index) => (
              <Moment key={`${moment.handNumber}-${index}`} moment={moment} />
            ))}
          </div>
        ) : null}

        <Ask summary={summary} />

        <div className="review-actions">
          <button className="button" type="button" onClick={onDismiss}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * A question box over the recorded evaluations.
 *
 * What is sent is the table, not the prose: the model is given the decisions
 * and their costs and asked to explain them. It never computes a cost — the
 * search did that while the hand was live — and the numbers stay on screen
 * beside the answer so a misdescription reads as wrong rather than as fact.
 */
function Ask({ summary }: { summary: ReviewSummary }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  // Computed server-side and shown verbatim; the prose below it is commentary.
  const [headline, setHeadline] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'asking' | 'failed'>('idle')

  const ask = async (event: React.FormEvent) => {
    event.preventDefault()
    const asked = question.trim()
    if (!asked || state === 'asking') return
    setState('asking')
    setAnswer(null)
    setHeadline(null)
    try {
      const response = await fetch('/api/review/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: asked,
          accuracy: summary.accuracy,
          // Points, so the model is handed the units it will be asked about.
          totalCost: summary.totalCost * 100,
          decisions: summary.judged
            .filter((j) => j.chosen !== null)
            .map((j) => ({
              handNumber: j.handNumber,
              played: j.played,
              best: j.best?.cards ?? null,
              cost: j.cost * 100,
              withinNoise: j.withinNoise,
            })),
        }),
      })
      const body = (await response.json()) as { answer?: string; headline?: string; error?: string }
      if (!response.ok) {
        setState('failed')
        setAnswer(body.error ?? 'The local model did not answer.')
        return
      }
      setState('idle')
      setHeadline(body.headline ?? null)
      setAnswer(body.answer ?? '')
    } catch {
      setState('failed')
      setAnswer('Could not reach the server.')
    }
  }

  return (
    <>
      {headline ? <p className="review-headline">{headline}</p> : null}
      {answer !== null || state === 'asking' ? (
        <p className={`review-answer${state === 'asking' ? ' thinking' : state === 'failed' ? ' failed' : ''}`}>
          {state === 'asking' ? 'Thinking…' : answer}
        </p>
      ) : null}

      <form className="review-ask" onSubmit={ask}>
        <input
          type="text"
          value={question}
          placeholder="Ask about the match — where did I lose it?"
          onChange={(event) => setQuestion(event.target.value)}
          aria-label="Ask about this match"
        />
        <button className="button" type="submit" disabled={state === 'asking' || question.trim() === ''}>
          Ask
        </button>
      </form>
    </>
  )
}

function Moment({ moment }: { moment: Judged }) {
  // 'JC' is an id, not a card. People read J♣.
  const played = moment.played.map(cardLabel).join(' ')
  const best = moment.best?.cards.map(cardLabel).join(' ') ?? '—'
  return (
    <div className="review-row costly">
      <span className="review-hand">hand {moment.handNumber}</span>
      <span className="review-what">
        you played <b>{played}</b> <em>— best was</em> <b>{best}</b>
      </span>
      <span className="review-cost">{points(moment.cost)}</span>
    </div>
  )
}
