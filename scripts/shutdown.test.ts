import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { exitOnSignals, removeFileOnExit } from './shutdown'

describe('removeFileOnExit', () => {
  let directory: string
  let filePath: string

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-mcp-shutdown-'))
    filePath = path.join(directory, '.notion-mcp-auth-token-1234')
    fs.writeFileSync(filePath, 'secret', { mode: 0o600 })
  })

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('leaves the file alone while the process is running', () => {
    const proc = new EventEmitter()

    removeFileOnExit(filePath, proc)

    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('deletes the file when the process exits', () => {
    const proc = new EventEmitter()
    removeFileOnExit(filePath, proc)

    proc.emit('exit', 1)

    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('does not throw when the file is already gone', () => {
    const proc = new EventEmitter()
    removeFileOnExit(filePath, proc)
    fs.rmSync(filePath)

    expect(() => proc.emit('exit', 0)).not.toThrow()
  })

  it('does not throw when the path cannot be removed as a file', () => {
    const proc = new EventEmitter()
    const notAFile = path.join(directory, 'subdirectory')
    fs.mkdirSync(notAFile)
    fs.writeFileSync(path.join(notAFile, 'child'), 'x')
    removeFileOnExit(notAFile, proc)

    expect(() => proc.emit('exit', 0)).not.toThrow()
  })
})

describe('exitOnSignals', () => {
  function fakeProcess() {
    return Object.assign(new EventEmitter(), { exit: vi.fn<(code?: number) => void>() })
  }

  it('exits with status 0 on SIGINT and SIGTERM', () => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const proc = fakeProcess()
      exitOnSignals(proc)

      proc.emit(signal)

      expect(proc.exit).toHaveBeenCalledTimes(1)
      expect(proc.exit).toHaveBeenCalledWith(0)
    }
  })

  it('does nothing until a signal arrives', () => {
    const proc = fakeProcess()

    exitOnSignals(proc)

    expect(proc.exit).not.toHaveBeenCalled()
    expect(proc.listenerCount('SIGINT')).toBe(1)
    expect(proc.listenerCount('SIGTERM')).toBe(1)
  })

  it('only listens for the signals it is given', () => {
    const proc = fakeProcess()

    exitOnSignals(proc, ['SIGHUP'])

    expect(proc.listenerCount('SIGHUP')).toBe(1)
    expect(proc.listenerCount('SIGINT')).toBe(0)
    expect(proc.listenerCount('SIGTERM')).toBe(0)
  })
})
