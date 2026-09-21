import type { PlayerView } from '@cucumber/shared'
import { nextCommand } from './clientPlayer.ts'
import { delay, type TestClient } from './server.ts'

/** Play one person's seat until the table reaches the position we want. */
export async function playAlone(
  client: TestClient,
  stop: (view: PlayerView) => boolean,
  limit = 1200,
): Promise<PlayerView> {
  let lastVersion = -1
  for (let step = 0; step < limit; step++) {
    const view = client.view
    if (view && stop(view)) return view
    // Act once per position; a refused or overtaken move brings a new one.
    if (view && view.version !== lastVersion) {
      const command = nextCommand(view)
      if (command) {
        client.send(command)
        lastVersion = view.version
      }
    }
    await delay(50)
  }
  throw new Error(
    `Never reached the target position; last view: ${JSON.stringify(client.view)?.slice(0, 600)}`,
  )
}

export function opponents(view: PlayerView): string[] {
  return view.players
    .filter((player) => player.seat !== view.you.seat)
    .map((player) => player.displayName)
    .sort()
}
