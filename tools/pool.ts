/**
 * A fixed pool of worker threads that each run self-play. Tasks are handed out
 * as workers free up, so one slow chunk cannot stall the rest.
 */
import { cpus } from 'node:os'
import { Worker } from 'node:worker_threads'
import type { TrialResult, TrialTask } from './trial-worker.ts'

const WORKER_URL = new URL('./trial-worker.ts', import.meta.url)

export class TrialPool {
  private workers: Worker[] = []
  private idle: Worker[] = []
  private queue: { task: TrialTask; resolve: (result: TrialResult) => void; reject: (error: Error) => void }[] = []
  private pending = new Map<Worker, { resolve: (result: TrialResult) => void; reject: (error: Error) => void }>()

  readonly size: number

  constructor(size = Math.max(1, Math.min(cpus().length - 2, 12))) {
    this.size = size
    for (let i = 0; i < this.size; i++) {
      const worker = new Worker(WORKER_URL)
      worker.on('message', (result: TrialResult) => {
        const waiting = this.pending.get(worker)
        this.pending.delete(worker)
        this.idle.push(worker)
        waiting?.resolve(result)
        this.drain()
      })
      worker.on('error', (error: Error) => {
        const waiting = this.pending.get(worker)
        this.pending.delete(worker)
        if (waiting) waiting.reject(error)
        else console.error('worker failed:', error)
      })
      this.workers.push(worker)
      this.idle.push(worker)
    }
  }

  private drain(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop()!
      const next = this.queue.shift()!
      this.pending.set(worker, { resolve: next.resolve, reject: next.reject })
      worker.postMessage(next.task)
    }
  }

  run(task: TrialTask): Promise<TrialResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject })
      this.drain()
    })
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.terminate()))
    this.workers = []
    this.idle = []
  }
}

export interface Measured {
  lossRate: number
  matches: number
  error: number
  averageHands: number
}

/**
 * Run one evaluation as a single task. When there are many evaluations to do
 * at once this beats splitting each of them, because the pool is already busy
 * and the per-task overhead stops mattering.
 */
export async function measureOne(
  pool: TrialPool,
  task: Omit<TrialTask, 'id' | 'startIndex'> & { startIndex?: number },
): Promise<Measured> {
  const result = await pool.run({ id: 0, startIndex: 0, ...task })
  const rate = result.losses / result.matches
  return {
    lossRate: rate,
    matches: result.matches,
    error: Math.sqrt((rate * (1 - rate)) / result.matches),
    averageHands: result.hands / result.matches,
  }
}

/** Split `matches` across the pool and recombine. */
export async function measure(
  pool: TrialPool,
  task: Omit<TrialTask, 'id' | 'matches' | 'startIndex'> & { matches: number },
): Promise<Measured> {
  const chunks = pool.size
  const per = Math.max(1, Math.floor(task.matches / chunks))
  const jobs: Promise<TrialResult>[] = []
  let start = 0
  for (let i = 0; i < chunks; i++) {
    const count = i === chunks - 1 ? task.matches - start : per
    if (count <= 0) continue
    jobs.push(
      pool.run({
        ...task,
        id: i,
        matches: count,
        startIndex: start,
        // A distinct stream per chunk, derived from the caller's seed.
        seed: (task.seed + i * 0x9e3779b1) >>> 0,
      }),
    )
    start += count
  }
  const results = await Promise.all(jobs)
  const matches = results.reduce((sum, r) => sum + r.matches, 0)
  const losses = results.reduce((sum, r) => sum + r.losses, 0)
  const hands = results.reduce((sum, r) => sum + r.hands, 0)
  const rate = losses / matches
  return {
    lossRate: rate,
    matches,
    error: Math.sqrt((rate * (1 - rate)) / matches),
    averageHands: hands / matches,
  }
}
