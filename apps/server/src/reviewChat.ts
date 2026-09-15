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
      const played = d.played.join('+') || '—'
      const best = d.best?.join('+') ?? '—'
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
4. A decision marked "no real difference" is not a mistake. The search cannot
   tell those plays apart, so do not call them errors.
5. Answer in two or three sentences. Name the specific hand and cards. No
   preamble, no encouragement, no bullet lists.`

export async function askAboutReview(input: AskRequest): Promise<string> {
  const prompt = `Review of the match just played.

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
  return answer
}
