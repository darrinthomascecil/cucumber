import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { review, type Decision } from '@cucumber/strategy'
import type { CardId } from '@cucumber/shared'
import { Review } from './Review.tsx'

/**
 * The review arrives when the player can no longer act on it, so its job is to
 * be honest rather than encouraging. Two failures matter: congratulating
 * someone for the obvious, and calling a play a mistake when the search cannot
 * tell it from the best one.
 */

const option = (cards: CardId[], winProbability: number, cost: number) => ({
  cards,
  description: cards.join(' '),
  winProbability,
  cost,
})

const decision = (played: CardId[], options: ReturnType<typeof option>[]): Decision => ({
  handNumber: 3,
  kind: 'PLAY',
  options,
  played,
  odds: options[0]?.winProbability ?? 0,
})

const render = (decisions: Decision[]) =>
  renderToStaticMarkup(<Review summary={review(decisions)} onDismiss={() => {}} />)

describe('the review screen', () => {
  it('names the costly decision, what was played and what was best', () => {
    const html = render([
      decision(['3D'], [option(['4S'], 0.84, 0), option(['3D'], 0.61, 0.23)]),
      decision(['9H'], [option(['9H'], 0.9, 0)]),
    ])

    expect(html).toContain('hand 3')
    // Card faces, not database ids: nobody reads their own game as "3D".
    expect(html).toContain('3♦')
    expect(html).toContain('4♠')
    expect(html).not.toContain('>3D<')
    expect(html).toContain('−23 pts')
    expect(html).toContain('50%')
  })

  /*
   * The one that matters. A gap of one point is inside the search's own noise,
   * so the screen must not paint it as a mistake — it must say the opposite.
   */
  it('says either play was fine when the gap is inside the noise', () => {
    const html = render([
      decision(['3D'], [option(['4S'], 0.8, 0), option(['3D'], 0.79, 0.01)]),
      decision(['9H'], [option(['9H'], 0.9, 0), option(['2C'], 0.88, 0.02)]),
    ])

    expect(html).toContain('100%')
    expect(html).toContain('inside the noise')
    expect(html).not.toContain('handed back in total')
    // No mistake rows at all: nothing to list.
    expect(html).not.toContain('review-row')
  })

  it('stays quiet about decisions played at the maximum', () => {
    const html = render([
      decision(['4S'], [option(['4S'], 0.84, 0), option(['3D'], 0.61, 0.23)]),
      decision(['9H'], [option(['9H'], 0.9, 0), option(['2C'], 0.5, 0.4)]),
      decision(['2C'], [option(['KD'], 0.5, 0), option(['2C'], 0.44, 0.06)]),
    ])

    // Three decisions, one mistake, so exactly one row is listed.
    expect(html.split('review-row').length - 1).toBe(1)
    expect(html).toContain('−6 pts')
  })

  it('refuses to score a match the advisor never judged', () => {
    const html = render([decision(['7C'], [])])
    expect(html).toContain('Nothing to judge')
    expect(html).not.toContain('played at the maximum')
  })

  it('counts decisions it could not score separately', () => {
    const html = render([
      decision(['3D'], [option(['4S'], 0.84, 0), option(['3D'], 0.61, 0.23)]),
      decision(['7C'], []),
    ])
    expect(html).toContain('1 decision judged')
    expect(html).toContain('1 unscored')
  })
})
