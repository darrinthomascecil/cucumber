import { cardLabel } from '@cucumber/game-engine'

/**
 * Answering questions about a finished match, in plain English.
 *
 * The division of labour is the whole design. Every number comes from the
 * recorded evaluations — what was played, what was best, what it cost — which
 * were computed by the search while the hand was live. The model's job is to
 * find the relevant decision and say what it means. It never decides what a
 * play was worth, because it cannot: it is reading a table.
 *
 * That matters more than it sounds. Asked to explain a cost of 0.23, a local
 * 8B model will happily call it "a 23% chance of costing you the win", which
 * is not what the number means. So the units are stated in the prompt, the
 * table is given in the units it will be asked about, and the screen shows the
 * recorded figures beside the prose — a slip should look wrong, not
 * authoritative.
 */

const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'
const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.1:8b'

export interface ReviewDecision {
  handNumber: number
  played: string[]
  best: string[] | null
  /** Win probability given up, already in percentage points. */
  cost: number
  withinNoise: boolean
}

export interface AskRequest {
  question: string
  decisions: ReviewDecision[]
  accuracy: number
  totalCost: number
}

function table(decisions: ReviewDecision[]): string {
  if (decisions.length === 0) return '(no decisions were scored in this match)'
  return decisions
    .map((d, i) => {
      // Card ids in, card names out. Handing the model "JC" gets "JC" back,
      // and nobody reads their own game in database identifiers.
      const played = d.played.map(cardLabel).join(' + ') || '—'
      const best = d.best?.map(cardLabel).join(' + ') ?? '—'
      const verdict = d.withinNoise
        ? 'no real difference'
        : `gave up ${d.cost.toFixed(1)} points`
      return `${i + 1}. hand ${d.handNumber}: played ${played}; best was ${best}; ${verdict}`
    })
    .join('\n')
}

const SYSTEM = `You explain a finished card game review to the player who just played it.

RULES, in order of importance:
1. Use ONLY the decisions listed. If the question is about something not in the
   list, say plainly that it is not in the record. Never invent a decision, a
   card, or a number.
2. You do NOT know what anyone else held, what was led, what suit anything was,
   how the trick went, or what the score was. None of that is in the record.
   Never describe the situation — say only what was played, what was best, and
   what it cost. A sentence that begins "you were facing" or "they had" is
   always wrong.
3. "Points" are percentage points of win probability given up by not playing the
   best move. "Gave up 23 points" means the chance of surviving the match fell
   by 23 percentage points. It is NOT a 23% chance of anything.
4. A decision marked "no real difference" is not a mistake, an opportunity, a
   missed chance, or something that "might have been better". The search
   cannot tell those two plays apart, so there is nothing to improve there.
   Never list one as a suggestion. If every scored decision was either best or
   within noise, say the player played it clean and stop — do not then offer
   improvements, which contradicts it.
5. Write cards exactly as they appear above: J♣, 10♦, Joker. Never "JC".
6. Be specific or be silent. Every sentence must carry a hand number, a card,
   or a number of points. "You played well", "good choices", "solid game" and
   "nothing to improve" carry none of those and are filler.
7. Say each thing once. Do not restate a verdict in different words.
   "Played it clean", "best decision every time" and "nothing to improve" are
   the same sentence three times.
8. When nothing cost anything, there is still something specific to report:
   how many decisions were scored, and the closest call — its hand, its cards
   and its points — noting the search could not separate them. That is a
   finding. "You played well" is not.
9. No congratulation, no exclamation marks, no cheerleading. The player asked
   what happened, not to be told they did well. A flat report of what the
   record shows is the whole job.
10. Two or three sentences. No preamble, no bullet lists.`

export interface Answer {
  /** Computed here, exact, and shown to the player verbatim. */
  headline: string
  /** The model's prose. Context only — it may garble any figure in it. */
  answer: string
}

/*
 * The split exists because a small local model cannot be trusted to restate a
 * number. Handed the ranking precomputed and told not to re-rank, it still
 * named the second-closest call and, in another run, wrote "played 3 instead
 * of 4" for 3♦ and 4♠. So the figures reach the player from the code that
 * owns them, and the model only adds sentences around them. Nothing it
 * garbles can change what the player is told.
 */
export async function askAboutReview(input: AskRequest): Promise<Answer> {
  /*
   * The ranking is computed here, not asked for.
   *
   * Given the table and told to find the closest call, an 8B model picked the
   * second-closest and dropped the cards. Sorting is not what it is for. It
   * phrases; the arithmetic is done where arithmetic belongs, and then there
   * is nothing left for it to get wrong.
   */
  const scored = input.decisions.filter((d) => d.best !== null)
  const costly = scored.filter((d) => !d.withinNoise).sort((a, b) => b.cost - a.cost)
  const closest = scored.filter((d) => d.withinNoise).sort((a, b) => b.cost - a.cost)
  const name = (d: ReviewDecision) =>
    `hand ${d.handNumber}, played ${d.played.map(cardLabel).join(' + ')} instead of ${(d.best ?? []).map(cardLabel).join(' + ')}, ${d.cost.toFixed(1)} points`

  const headline = costly.length > 0
    ? `Costliest decision: ${name(costly[0]!)}.${costly[1] ? ` Next: ${name(costly[1]!)}.` : ''}`
    : closest.length > 0
      ? `Nothing cost anything. ${scored.length} decisions scored. Closest call: ${name(closest[0]!)} — inside the noise, so the search could not separate the two plays.`
      : `Nothing was scored in this match.`

  const prompt = `Review of the match just played.

ALREADY WORKED OUT FOR YOU — use these, do not re-rank anything:
${headline}


Decisions where a better play existed, or that were close enough not to matter:
${table(input.decisions)}

Overall: played the best move in ${Math.round(input.accuracy * 100)}% of scored decisions, giving up ${input.totalCost.toFixed(1)} points in total.

Question: ${input.question}`

  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      options: { temperature: 0.2 },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  })

  if (!response.ok) {
    throw new Error(`the local model answered ${response.status}`)
  }
  const body = (await response.json()) as { message?: { content?: string } }
  const answer = body.message?.content?.trim()
  if (!answer) throw new Error('the local model returned nothing')
  return { headline, answer }
}
