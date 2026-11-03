import fs from 'node:fs'

// The parts of `process` the helpers use, so that tests can pass an EventEmitter.
type EventSource = { on(event: string, listener: (...args: any[]) => void): unknown }
type ExitableProcess = EventSource & { exit(code?: number): unknown }

/**
 * Delete `filePath` when the process exits: normally, through `process.exit()`, or after a
 * crash such as the port already being in use. A hard kill (SIGKILL, or TerminateProcess on
 * Windows) cannot be intercepted, so the file can still outlive the process in that case.
 */
export function removeFileOnExit(filePath: string, proc: EventSource = process): void {
  proc.on('exit', () => {
    try {
      fs.rmSync(filePath, { force: true })
    } catch {
      // Best effort: the process is already exiting.
    }
  })
}

/**
 * Exit with status 0 on SIGINT and SIGTERM. Without a handler Node ends the process on the
 * signal itself, which clients can report as a failed server and which skips the `exit`
 * listeners that clean up after the process.
 *
 * @see https://github.com/makenotion/notion-mcp-server/issues/177
 */
export function exitOnSignals(proc: ExitableProcess = process, signals: string[] = ['SIGINT', 'SIGTERM']): void {
  for (const signal of signals) {
    proc.on(signal, () => proc.exit(0))
  }
}
