import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { availableParallelism } from 'node:os'
import { parseArgs } from 'node:util'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'
import { SEATS, type MatchState, type Seat } from '@cucumber/shared'
import { actionSeat, applyCommand, createMatch, setConnection } from '../packages/game-engine/src/stateMachine.ts'
import { viewFor } from '../packages/game-engine/src/view.ts'
import { leadGroup } from '../packages/game-engine/src/ranking.ts'
import { advisorCommand, legalActions, type AdvisorAction } from '../packages/game-engine/src/advisor/actions.ts'
import { forecastLoss } from '../packages/game-engine/src/advisor/forecast.ts'
import { brierScore, calibrate, fitCalibration, reliabilityBins, type Calibration, type ForecastObservation } from '../packages/game-engine/src/advisor/metrics.ts'
import { advisorRng } from '../packages/game-engine/src/advisor/random.ts'
import { choosePolicyAction, POLICY_NAMES, type PolicyName } from '../packages/game-engine/src/advisor/policy.ts'
import { simulateMatch, type SeatPolicies } from '../packages/game-engine/src/advisor/simulation.ts'

type Split = 'train' | 'validation' | 'test'
type Model = 'uniform' | 'history'
interface Job {
  index: number
  split: Split
  particles: number
  simulations: number
  population: 'mixture' | 'greedy' | 'careful'
  dataset: string
}
interface Row extends ForecastObservation {
  model: Model
  seat: Seat
  observer: Seat
  handSize: number
  effectiveParticles: number
  fallback: boolean
  guaranteed: boolean
}
interface JobResult {
  rows: Row[]
  failures: { model: Model; message: string }[]
}

function seed(domain: string): number {
  return createHash('sha256').update(`cucumber-advisor-v1:${domain}`).digest().readUInt32LE(0)
}

function fixture(job: Job): { state: MatchState; observer: Seat; policies: SeatPolicies; action: AdvisorAction } {
  const identity = `${job.dataset}:${job.population}:${job.split}:${job.index}`
  const observer = ((job.index % 3) + 1) as Seat
  const policyRng = advisorRng(seed(`opponent-types:${identity}`))
  const policies = {} as SeatPolicies
  for (const seat of SEATS) policies[seat] = seat === observer ? 'careful'
    : job.population === 'mixture' ? POLICY_NAMES[policyRng(POLICY_NAMES.length)]! : job.population
  const context = { rng: advisorRng(seed(`deal:${identity}`)) }
  const choices = {
    1: advisorRng(seed(`actions:1:${identity}`)),
    2: advisorRng(seed(`actions:2:${identity}`)),
    3: advisorRng(seed(`actions:3:${identity}`)),
  }
  let state = createMatch(identity, SEATS.map((seat) => ({ userId: `seat-${seat}`, displayName: `Seat ${seat}` })))
  for (const seat of SEATS) state = setConnection(state, seat, 'ONLINE', context).state
  const targetSize = [13, 9, 5, 3][job.index % 4]!
  for (let turn = 0; turn < 512; turn++) {
    const seat = actionSeat(state) ?? state.players.find((player) => !player.ready)?.seat
    if (!seat) throw new Error('Benchmark reached a terminal state without a forecast')
    const view = viewFor(state, seat)
    if (seat === observer && state.phase === 'TRICK_PLAY') {
      const hand = state.hands[seat]
      const canFinish = view.prompt.kind === 'LEAD'
        ? hand.some((card) => hand.filter((candidate) => leadGroup(candidate) === leadGroup(card)).length >= hand.length - 1)
        : view.trick!.playCount >= hand.length - 1
      if (hand.length <= targetSize || canFinish) {
        const interventions = legalActions(view)
        const interventionRng = advisorRng(seed(`intervention:${identity}`))
        const action = job.index % 2 === 0
          ? choosePolicyAction(view, 'careful', interventionRng, 0)
          : interventions[interventionRng(interventions.length)]!
        return { state, observer, policies, action }
      }
    }
    const action = choosePolicyAction(view, policies[seat], choices[seat])
    state = applyCommand(state, seat, advisorCommand(view, action), context).state
  }
  throw new Error('Benchmark fixture exceeded its guard')
}

function evaluateJob(job: Job): JobResult {
  const { state, observer, policies, action } = fixture(job)
  const view = viewFor(state, observer)
  const identity = `${job.dataset}:${job.population}:${job.split}:${job.index}`
  const intervened = applyCommand(state, observer, advisorCommand(view, action), { rng: advisorRng(seed(`intervention-deal:${identity}`)) }).state
  const outcome = simulateMatch(intervened, policies, seed(`label:${identity}`))
  const failures: JobResult['failures'] = []
  const rows: Row[] = []
  let uniform: ReturnType<typeof forecastLoss> | undefined
  for (const model of ['uniform', 'history'] as const) {
    let forecast: ReturnType<typeof forecastLoss>
    let fallback = false
    try {
      forecast = forecastLoss(view, {
        model,
        seed: seed(`forecast:${identity}`),
        particles: job.particles,
        maxAttempts: job.particles * 200,
        simulations: job.simulations,
        selfPolicy: 'careful',
      }, action)
      if (model === 'uniform') uniform = forecast
    } catch (error) {
      failures.push({ model, message: error instanceof Error ? error.message : String(error) })
      if (!uniform) throw error
      forecast = uniform
      fallback = true
    }
    for (const seat of SEATS) rows.push({
      probability: forecast.probabilities[seat], outcome: outcome[seat], match: identity,
      model, seat, observer, handSize: view.you.hand.length,
      effectiveParticles: forecast.effectiveParticles, fallback,
      guaranteed: forecast.guaranteedLosses.includes(seat),
    })
  }
  return { rows, failures }
}

function calibratedRows(rows: Row[], calibration?: Calibration): Row[] {
  return rows.map((row) => ({ ...row, probability: row.guaranteed ? 1 : calibrate(row.probability, calibration) }))
}

function summarize(rows: Row[], calibration?: Calibration) {
  const forecasts = calibratedRows(rows, calibration)
  return {
    brier: brierScore(forecasts),
    observations: forecasts.length,
    matches: new Set(forecasts.map((row) => row.match)).size,
    meanEffectiveParticles: rows.reduce((sum, row) => sum + row.effectiveParticles, 0) / rows.length,
    fallbackMatches: new Set(rows.filter((row) => row.fallback).map((row) => row.match)).size,
    selfBrier: brierScore(forecasts.filter((row) => row.seat === row.observer)),
    opponentBrier: brierScore(forecasts.filter((row) => row.seat !== row.observer)),
    reliability: reliabilityBins(forecasts),
  }
}

function pairedInterval(first: ForecastObservation[], second: ForecastObservation[]) {
  if (first.length !== second.length) throw new Error('Paired forecasts have unequal length')
  const byMatch = new Map<string, number[]>()
  for (let index = 0; index < first.length; index++) {
    const left = first[index]!
    const right = second[index]!
    if (left.match !== right.match || left.outcome !== right.outcome) throw new Error('Paired forecasts are not aligned')
    const values = byMatch.get(left.match) ?? []
    values.push((left.probability - left.outcome) ** 2 - (right.probability - right.outcome) ** 2)
    byMatch.set(left.match, values)
  }
  const differences = [...byMatch.values()].map((values) => values.reduce((sum, value) => sum + value, 0) / values.length)
  const rng = advisorRng(seed('bootstrap:paired-test'))
  const replicates = Array.from({ length: 2000 }, () => {
    let sum = 0
    for (let index = 0; index < differences.length; index++) sum += differences[rng(differences.length)]!
    return sum / differences.length
  }).sort((left, right) => left - right)
  return { mean: differences.reduce((sum, value) => sum + value, 0) / differences.length, lower95: replicates[50], upper95: replicates[1949], unit: 'match-clustered Brier difference; negative favors selected model' }
}

async function runJobs(jobs: Job[], concurrency: number): Promise<JobResult[]> {
  const results: JobResult[] = Array(jobs.length)
  let cursor = 0
  let completed = 0
  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, () => new Worker(new URL(import.meta.url), { workerData: 'forecast-worker' }))
  try {
    await Promise.all(workers.map((worker) => new Promise<void>((accept, reject) => {
      let current = -1
      const next = () => {
        if (cursor >= jobs.length) {
          accept()
          return
        }
        current = cursor++
        worker.postMessage(jobs[current])
      }
      worker.on('error', reject)
      worker.on('message', (message: { result?: JobResult; error?: string }) => {
        if (message.error) {
          reject(new Error(message.error))
          return
        }
        results[current] = message.result!
        completed++
        if (completed % 10 === 0 || completed === jobs.length) console.log(`${jobs[0]!.split}: ${completed}/${jobs.length} matches`)
        next()
      })
      next()
    })))
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()))
  }
  return results
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    train: { type: 'string', default: '80' }, validation: { type: 'string', default: '80' }, test: { type: 'string', default: '160' },
    particles: { type: 'string', default: '96' }, simulations: { type: 'string', default: '128' },
    workers: { type: 'string', default: String(Math.min(4, availableParallelism())) },
    population: { type: 'string', default: 'mixture' }, output: { type: 'string', default: 'artifacts/advisor' },
    dataset: { type: 'string', default: 'heldout-v1' },
  } })
  const config = {
    train: Number(values.train), validation: Number(values.validation), test: Number(values.test),
    particles: Number(values.particles), simulations: Number(values.simulations), workers: Number(values.workers),
    population: values.population as Job['population'],
    dataset: values.dataset!,
  }
  for (const [name, value] of Object.entries(config)) {
    if (name === 'population' || name === 'dataset') continue
    if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`Invalid ${name}`)
  }
  if (!['mixture', 'greedy', 'careful'].includes(config.population)) throw new Error('Unknown opponent population')
  const output = resolve(values.output!)
  await mkdir(output, { recursive: true })
  const partition = async (split: Split, count: number) => runJobs(Array.from({ length: count }, (_, index) => ({ index, split, ...config })), config.workers)
  const trainingResults = await partition('train', config.train)
  const validationResults = await partition('validation', config.validation)
  const training = trainingResults.flatMap((result) => result.rows)
  const validation = validationResults.flatMap((result) => result.rows)
  const candidates: { model: Model; calibration: Calibration; brier: number }[] = []
  for (const model of ['uniform', 'history'] as const) {
    const fitted = fitCalibration(training.filter((row) => row.model === model && !row.guaranteed))
    for (const blend of [0, 0.25, 0.5, 0.75, 1]) {
      const calibration = { ...fitted, blend }
      const brier = brierScore(calibratedRows(validation.filter((row) => row.model === model), calibration))
      candidates.push({ model, calibration, brier })
    }
  }
  candidates.sort((left, right) => left.brier - right.brier || left.calibration.blend - right.calibration.blend)
  const selected = candidates[0]!
  const baseRows = training.filter((row) => row.model === 'uniform')
  const baseRates = {
    self: baseRows.filter((row) => row.seat === row.observer).reduce((sum, row) => sum + row.outcome, 0) / config.train,
    other: baseRows.filter((row) => row.seat !== row.observer).reduce((sum, row) => sum + row.outcome, 0) / (2 * config.train),
  }
  const frozen = { schemaVersion: 1, target: 'eventual-match-loss', selfPolicy: 'careful', population: config.population, model: selected.model, calibration: selected.calibration, particles: config.particles, simulations: config.simulations, trainingMatches: config.train, validationMatches: config.validation, validationBrier: selected.brier }
  const modelPath = resolve(output, 'model.json')
  await writeFile(modelPath, `${JSON.stringify(frozen, null, 2)}\n`)
  const frozenHash = createHash('sha256').update(JSON.stringify(frozen)).digest('hex')
  console.log(`FROZEN_MODEL ${JSON.stringify({ model: selected.model, blend: selected.calibration.blend, validationBrier: selected.brier, sha256: frozenHash })}`)
  const testResults = await partition('test', config.test)
  const testing = testResults.flatMap((result) => result.rows)
  const history = testing.filter((row) => row.model === 'history')
  const uniform = testing.filter((row) => row.model === 'uniform')
  const selectedRows = calibratedRows(testing.filter((row) => row.model === selected.model), selected.calibration)
  const baselineRows = uniform.map((row) => ({ ...row, probability: row.seat === row.observer ? baseRates.self : baseRates.other }))
  const report = {
    schemaVersion: 1,
    protocol: 'One action-conditional forecast per independent first-hand match; three binary marginal loss outcomes. Fit on train, select on validation, freeze before test. Random interventions and careful-policy interventions alternate. Suits randomized within rank-equivalent actions. No forecast receives true hidden cards, policy labels, deal seed, or label RNG.',
    config, frozen, frozenHash,
    validationCandidates: candidates.map((candidate) => ({ model: candidate.model, blend: candidate.calibration.blend, brier: candidate.brier })),
    test: { baseRateBrier: brierScore(baselineRows), uniform: summarize(uniform), history: summarize(history), selected: summarize(testing.filter((row) => row.model === selected.model), selected.calibration), selectedMinusUniform: pairedInterval(selectedRows, uniform), selectedMinusBaseRate: pairedInterval(selectedRows, baselineRows) },
    failures: { train: trainingResults.flatMap((result) => result.failures), validation: validationResults.flatMap((result) => result.failures), test: testResults.flatMap((result) => result.failures) },
    limitations: ['Synthetic opponent populations, not human play.', 'First-hand decision distribution; later-hand score states are not covered by this report.', 'Match-loss probabilities are conditional on the declared careful continuation policy for the observer.', 'Importance sampling and finite rollouts are approximate.', 'Sampling failures use a predeclared uniform fallback and are included in scores, never dropped.', 'No result establishes a globally minimal Brier score.'],
  }
  await mkdir(dirname(resolve(output, 'report.json')), { recursive: true })
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(resolve(output, 'observations.json'), `${JSON.stringify({ training, validation, testing })}\n`)
  console.log(`BRIER_RESULTS ${JSON.stringify({ output, population: config.population, train: config.train, validation: config.validation, test: config.test, selectedModel: selected.model, blend: selected.calibration.blend, baseRate: report.test.baseRateBrier, uniform: report.test.uniform.brier, history: report.test.history.brier, selected: report.test.selected.brier, difference: report.test.selectedMinusUniform, fallbackMatches: report.test.selected.fallbackMatches })}`)
}

if (isMainThread) await main()
else if (workerData === 'forecast-worker') {
  parentPort!.on('message', (job: Job) => {
    try { parentPort!.postMessage({ result: evaluateJob(job) }) }
    catch (error) { parentPort!.postMessage({ error: error instanceof Error ? error.stack : String(error) }) }
  })
}