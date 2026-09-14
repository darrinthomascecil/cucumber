import type { Calibration as Stats, SeriesPoint } from '../useCalibration.ts'

interface Props {
  stats: Stats
  onReset: () => void
}

const pct = (value: number) => `${Math.round(value * 100)}%`

/**
 * Expected against actual: what the advisor claimed, and what happened.
 *
 * A prediction is settled when the match it was about ends, so the sample that
 * matters is matches, not moves — every claim made inside one match shares its
 * outcome, and they are not independent of each other.
 */
/**
 * Both numbers as they stand after each match. Cumulative on purpose: a single
 * match is one outcome shared by every claim inside it, so plotted alone it
 * would be a chart of coin flips. The gap between the lines is the thing to
 * watch, and it should close as the run gets longer.
 */
function AccuracyChart({ series }: { series: SeriesPoint[] }) {
  const W = 260
  const H = 74
  const pad = { top: 6, right: 4, bottom: 6, left: 4 }
  const last = series[series.length - 1]!
  const x = (i: number) =>
    pad.left + (i / Math.max(1, series.length - 1)) * (W - pad.left - pad.right)
  const y = (v: number) => pad.top + (1 - v) * (H - pad.top - pad.bottom)
  const path = (pick: (p: SeriesPoint) => number) =>
    series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(' ')

  return (
    <figure className="accuracy-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Advisor claimed ${Math.round(last.expected * 100)} percent and ${Math.round(
          last.actual * 100,
        )} percent actually survived, over ${series.length} matches`}
      >
        {[0.25, 0.5, 0.75].map((v) => (
          <line key={v} className="chart-grid" x1={pad.left} x2={W - pad.right} y1={y(v)} y2={y(v)} />
        ))}
        <path className="chart-line chart-said" d={path((p) => p.expected)} />
        <path className="chart-line chart-happened" d={path((p) => p.actual)} />
        <circle className="chart-dot chart-said" cx={x(series.length - 1)} cy={y(last.expected)} r="2.6" />
        <circle
          className="chart-dot chart-happened"
          cx={x(series.length - 1)}
          cy={y(last.actual)}
          r="2.6"
        />
      </svg>
      <figcaption>
        <span className="chart-key said">said</span>
        <span className="chart-key happened">happened</span>
        <span className="chart-span">{series.length} matches</span>
      </figcaption>
    </figure>
  )
}

export function Calibration({ stats, onReset }: Props) {
  const gap = stats.actual - stats.expected
  const enough = stats.matches >= 3

  return (
    <section className="calibration">
      <header className="calibration-head">
        <span className="felt-title">Advisor accuracy</span>
        {stats.count > 0 ? (
          <button className="link-button" type="button" onClick={onReset}>
            Reset
          </button>
        ) : null}
      </header>

      {stats.count === 0 ? (
        <p className="calibration-empty">
          Nothing settled yet. Predictions are scored when the match they were about ends.
        </p>
      ) : (
        <>
          <div className="calibration-headline">
            <span className="calibration-figure">
              <b>{pct(stats.expected)}</b>
              <span>advisor said</span>
            </span>
            <span className="calibration-figure">
              <b className={enough && Math.abs(gap) > 0.08 ? 'off' : ''}>{pct(stats.actual)}</b>
              <span>actually survived</span>
            </span>
          </div>

          {stats.series.length > 1 ? <AccuracyChart series={stats.series} /> : null}

          <div className="calibration-count">
            {stats.count} predictions over {stats.matches} finished{' '}
            {stats.matches === 1 ? 'match' : 'matches'}
            {stats.pending > 0 ? ` · ${stats.pending} open` : ''}
            <br />
            Brier {stats.brier.toFixed(3)} <span className="calibration-hint">(0.25 = guessing)</span>
          </div>

          {stats.buckets.length > 1 ? (
            <table className="calibration-table">
              <thead>
                <tr>
                  <th>said</th>
                  <th>actual</th>
                  <th>n</th>
                </tr>
              </thead>
              <tbody>
                {stats.buckets.map((bucket) => (
                  <tr key={bucket.from}>
                    <td>{pct(bucket.expected)}</td>
                    <td>
                      <span className="calibration-bar">
                        <span
                          className="calibration-bar-fill"
                          style={{ width: pct(bucket.actual) }}
                        />
                      </span>
                      {pct(bucket.actual)}
                    </td>
                    <td>{bucket.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {!enough ? (
            <p className="calibration-note">
              Too few matches to mean much yet — turn autoplay on and leave it running.
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
