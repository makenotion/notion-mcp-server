import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Resolve this package's version by walking up from the current module to the
 * nearest package.json. This is robust across `tsx`/source runs, the compiled
 * `build/` output, and installation under `node_modules` — each resolves to the
 * correct package.json regardless of how deep the running file is nested.
 *
 * Replaces the previously hardcoded MCP `serverInfo.version` of `1.0.0`.
 * @see https://github.com/makenotion/notion-mcp-server/issues/310
 */
let cached: string | undefined

export function getPackageVersion(): string {
  if (cached) return cached
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as {
        name?: string
        version?: string
      }
      if (pkg && typeof pkg.version === 'string' && pkg.name) {
        cached = pkg.version
        return cached
      }
    } catch {
      // no package.json at this level — keep walking up
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  cached = '0.0.0'
  return cached
}
