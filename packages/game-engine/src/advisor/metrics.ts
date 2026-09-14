export interface ForecastObservation {
  probability: number
  outcome: number
  match: string
}

export interface Calibration {
  thresholds: number[]
  values: number[]
  blend: number
}

function validateObservation(probability: number, outcome: number): void {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('Probability must lie in [0, 1]')
  if (outcome !== 0 && outcome !== 1) throw new Error('Outcome must be binary')
}

export function brierScore(observations: readonly ForecastObservation[]): number {
  if (observations.length === 0) throw new Error('Cannot score an empty forecast set')
  return observations.reduce((sum, row) => {
    validateObservation(row.probability, row.outcome)
    return sum + (row.probability - row.outcome) ** 2
  }, 0) / observations.length
}

export function fitCalibration(observations: readonly ForecastObservation[], blend = 1): Calibration {
  if (observations.length === 0) throw new Error('Calibration needs training observations')
  if (!Number.isFinite(blend) || blend < 0 || blend > 1) throw new Error('Invalid calibration blend')
  const sorted = [...observations].sort((left, right) => left.probability - right.probability)
  const groups: { threshold: number; sum: number; count: number }[] = []
  for (const row of sorted) {
    validateObservation(row.probability, row.outcome)
    const previous = groups[groups.length - 1]
    if (previous?.threshold === row.probability) {
      previous.sum += row.outcome
      previous.count++
    } else groups.push({ threshold: row.probability, sum: row.outcome, count: 1 })
  }
  const blocks: typeof groups = []
  for (const group of groups) {
    blocks.push(group)
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1]!
      const before = blocks[blocks.length - 2]!
      if (before.sum / before.count <= last.sum / last.count) break
      blocks.splice(-2, 2, { threshold: last.threshold, sum: last.sum + before.sum, count: last.count + before.count })
    }
  }
  return { thresholds: blocks.map((block) => block.threshold), values: blocks.map((block) => block.sum / block.count), blend }
}

export function calibrate(probability: number, calibration?: Calibration): number {
  validateObservation(probability, 0)
  if (!calibration) return probability
  if (calibration.thresholds.length === 0 || calibration.values.length !== calibration.thresholds.length) throw new Error('Invalid calibration model')
  const found = calibration.thresholds.findIndex((threshold) => probability <= threshold)
  const index = found < 0 ? calibration.values.length - 1 : found
  const fitted = calibration.values[index]!
  validateObservation(fitted, 0)
  if (!Number.isFinite(calibration.blend) || calibration.blend < 0 || calibration.blend > 1) throw new Error('Invalid calibration blend')
  return probability * (1 - calibration.blend) + fitted * calibration.blend
}

export function reliabilityBins(observations: readonly ForecastObservation[], count = 10) {
  if (!Number.isInteger(count) || count < 1) throw new Error('Invalid bin count')
  return Array.from({ length: count }, (_, index) => {
    const rows = observations.filter((row) => Math.min(count - 1, Math.floor(row.probability * count)) === index)
    return {
      lower: index / count,
      upper: (index + 1) / count,
      count: rows.length,
      predicted: rows.length ? rows.reduce((sum, row) => sum + row.probability, 0) / rows.length : null,
      observed: rows.length ? rows.reduce((sum, row) => sum + row.outcome, 0) / rows.length : null,
    }
  })
}