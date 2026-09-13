import { useState } from 'react'

interface Props {
  error: string | null
  onRedeem: (token: string) => Promise<void>
}

/** There is no registration: you arrive with an invitation or not at all. */
export function Login({ error, onRedeem }: Props) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const token = extractToken(value)
    if (!token) return
    setBusy(true)
    try {
      await onRedeem(token)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <form className="panel" onSubmit={submit}>
        <h1>Cucumber</h1>
        <p>A private three-handed card game. Sign in with the invitation you were sent.</p>
        {error ? <div className="notice error">{error}</div> : null}
        <label className="field">
          <span>Invitation link or token</span>
          <input
            type="text"
            value={value}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://…/invite/… or the token itself"
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <button className="button" type="submit" disabled={busy || value.trim() === ''}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

/** Accept the whole link or just the token — people paste both. */
export function extractToken(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/invite\/([^/?#\s]+)/)
  return match ? (match[1] as string) : trimmed
}
