import type { Calibration as Stats } from '../useCalibration.ts'

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

          <div className="calibration-count">
            {stats.count} predictions over {stats.matches} finished{' '}
            {stats.matches === 1 ? 'match' : 'matches'}
            {stats.pending > 0 ? ` · ${stats.pending} open` : ''}
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
