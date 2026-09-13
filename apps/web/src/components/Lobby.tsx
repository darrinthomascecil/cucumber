import type { Room } from '@cucumber/shared'

interface Props {
  room: Room
  youId: string | null
}

/** Before the table is full there is no match to show — only chairs. */
export function Lobby({ room, youId }: Props) {
  const taken = room.seats.filter((seat) => seat.userId).length
  return (
    <div className="center">
      <div className="panel">
        <h1>The table</h1>
        <p>
          Cucumber needs three players. {taken} of 3 {taken === 1 ? 'seat is' : 'seats are'} taken.
        </p>
        <ul className="seat-list">
          {room.seats.map((seat) => (
            <li key={seat.seat} className={`seat-row${seat.userId ? '' : ' empty'}`}>
              <span className="seat-no">Seat {seat.seat}</span>
              <span className="seat-name">
                {seat.displayName ?? 'Empty'}
                {seat.userId && seat.userId === youId ? ' (you)' : ''}
              </span>
              {seat.userId ? (
                <span className={`tag${seat.connected ? '' : ' offline'}`}>
                  {seat.connected ? 'Here' : 'Away'}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <p style={{ margin: 0 }}>Waiting for the others to arrive…</p>
      </div>
    </div>
  )
}
