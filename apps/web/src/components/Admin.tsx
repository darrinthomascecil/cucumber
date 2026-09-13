import { useEffect, useState } from 'react'
import { api } from '../api.ts'

interface Row {
  id: string
  email: string
  displayName: string
  status: string
  isAdmin: boolean
  hasPendingInvite: boolean
}

/** Invitations are handed out by hand — there is no mail server in V1. */
export function Admin({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => {
    api
      .users()
      .then(setRows)
      .catch((issue: Error) => setError(issue.message))
  }

  useEffect(refresh, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      const result = await api.invite(email.trim(), displayName.trim())
      setInviteUrl(result.inviteUrl)
      setEmail('')
      setDisplayName('')
      refresh()
    } catch (issue) {
      setError((issue as Error).message)
    }
  }

  return (
    <div className="center">
      <div className="panel">
        <h1>Invitations</h1>
        <p>Create a link and send it to the player yourself. Each link works once.</p>
        {error ? <div className="notice error">{error}</div> : null}
        {inviteUrl ? (
          <div className="notice info">
            <div style={{ marginBottom: '0.35rem' }}>Invitation ready — copy this link:</div>
            <div className="invite-url">{inviteUrl}</div>
          </div>
        ) : null}
        <form onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="player@example.com"
            />
          </label>
          <label className="field">
            <span>Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="How they appear at the table"
            />
          </label>
          <div className="actions" style={{ justifyContent: 'flex-start' }}>
            <button
              className="button"
              type="submit"
              disabled={!email.includes('@') || displayName.trim() === ''}
            >
              Create invitation
            </button>
            <button className="button ghost" type="button" onClick={onClose}>
              Back to the table
            </button>
          </div>
        </form>

        <table className="admin-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Email</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.displayName}
                  {row.isAdmin ? ' · admin' : ''}
                </td>
                <td>{row.email}</td>
                <td>
                  {row.status}
                  {row.hasPendingInvite ? ' · invite pending' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
