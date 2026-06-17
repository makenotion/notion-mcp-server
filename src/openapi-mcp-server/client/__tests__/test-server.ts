import type { Express } from 'express'
import type { Server } from 'http'
import type { AddressInfo } from 'net'

/**
 * Start an Express app on an OS-assigned ephemeral port and resolve only once it
 * is actually accepting connections.
 *
 * This avoids two classes of test flakiness:
 * - **Port collisions:** vitest runs test files in parallel workers, so any
 *   fixed or randomly-chosen port can clash with another server. Port `0` lets
 *   the OS hand out a guaranteed-free port.
 * - **Request-before-bind races:** awaiting the `listening` event guarantees the
 *   socket is bound before tests issue requests, eliminating the intermittent
 *   `socket hang up` / ECONNRESET failures seen when requests raced `listen()`.
 *
 * The base URL uses `127.0.0.1` (not `localhost`) so the client connects over
 * IPv4 to match the IPv4 listener, avoiding `localhost` → `::1` mismatches.
 */
export function startTestServer(app: Express): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0)
    server.once('listening', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` })
    })
    server.once('error', reject)
  })
}

/** Close a server and resolve once it has fully shut down. */
export function stopTestServer(server: Server | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve()
      return
    }
    server.close(() => resolve())
  })
}
