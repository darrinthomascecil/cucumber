import { useCallback, useEffect, useRef, useState } from 'react'
import type { CardId, ClientCommand, PlayerView, Room, ServerMessage } from '@cucumber/shared'

export interface Rejection {
  code: string
  reason: string
}

export interface GameConnection {
  view: PlayerView | null
  /** Cards this player threw into their own face-down discard — they saw
   *  them, so the advisor may count them. Cleared each hand. */
  discarded: CardId[]
  room: Room | null
  connected: boolean
  rejection: Rejection | null
  send: (command: Omit<ClientCommand, 'matchId' | 'expectedVersion' | 'actionId'>) => void
  dismiss: () => void
}

function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

/**
 * One socket for the whole session. It reconnects on its own and asks for a
 * fresh snapshot every time it comes back, so a laptop lid does not lose a
 * match (spec §37).
 */
export function useGame(enabled: boolean): GameConnection {
  const [view, setView] = useState<PlayerView | null>(null)
  const [room, setRoom] = useState<Room | null>(null)
  const [connected, setConnected] = useState(false)
  const [rejection, setRejection] = useState<Rejection | null>(null)
  const [discarded, setDiscarded] = useState<CardId[]>([])
  const socketRef = useRef<WebSocket | null>(null)
  const viewRef = useRef<PlayerView | null>(null)
  const closedRef = useRef(false)
  // The last command sent, held in case it lost a race with someone else's.
  const pendingRef = useRef<{ command: ClientCommand; retried: boolean } | null>(null)
  const retryRef = useRef(false)

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    if (!enabled) return
    closedRef.current = false
    let attempt = 0
    let timer: number | undefined

    const open = () => {
      if (closedRef.current) return
      const socket = new WebSocket(socketUrl())
      socketRef.current = socket

      socket.onopen = () => {
        attempt = 0
        setConnected(true)
        socket.send(JSON.stringify({ type: 'RESYNC' }))
      }

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as ServerMessage
        if (message.type === 'STATE_UPDATED') {
          setView(message.view)
          setRoom(null)
          // A rejected-on-version command is replayed against the state that
          // overtook it. The action id is unchanged, so the server's ledger
          // still guarantees it lands at most once (spec §46).
          if (retryRef.current && pendingRef.current) {
            retryRef.current = false
            const pending = pendingRef.current
            pending.retried = true
            socket.send(
              JSON.stringify({ ...pending.command, expectedVersion: message.view.version }),
            )
          }
        } else if (message.type === 'ROOM_WAITING') {
          setRoom(message.room)
        } else if (message.type === 'PLAY_REJECTED' || message.type === 'ERROR') {
          const pending = pendingRef.current
          if (
            message.type === 'PLAY_REJECTED' &&
            message.code === 'VERSION_CONFLICT' &&
            pending &&
            !pending.retried &&
            pending.command.actionId === message.actionId
          ) {
            retryRef.current = true
            return
          }
          setRejection({ code: message.code, reason: message.reason })
        }
      }

      socket.onclose = () => {
        setConnected(false)
        socketRef.current = null
        if (closedRef.current) return
        attempt += 1
        timer = window.setTimeout(open, Math.min(500 * attempt, 5000))
      }

      socket.onerror = () => socket.close()
    }

    open()
    return () => {
      closedRef.current = true
      if (timer) window.clearTimeout(timer)
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [enabled])

  const send = useCallback(
    (command: Omit<ClientCommand, 'matchId' | 'expectedVersion' | 'actionId'>) => {
      const socket = socketRef.current
      const current = viewRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN || !current) return
      setRejection(null)
      const full = {
        ...command,
        matchId: current.matchId,
        expectedVersion: current.version,
        // Stable per action so a double click or a duplicate delivery is
        // recognised by the server rather than played twice (spec §46).
        actionId: crypto.randomUUID(),
      } as ClientCommand
      pendingRef.current = { command: full, retried: false }
      retryRef.current = false
      if (full.type === 'SUBMIT_DISCARDS') {
        setDiscarded((current) => [...current, ...full.cards])
      }
      socket.send(JSON.stringify(full))
    },
    [],
  )

  const dismiss = useCallback(() => setRejection(null), [])

  // A new deal wipes the slate: last hand's discards are back in the deck.
  const handNumber = view?.handNumber ?? 0
  useEffect(() => {
    setDiscarded([])
  }, [handNumber])

  return { view, room, connected, rejection, send, dismiss, discarded }
}
