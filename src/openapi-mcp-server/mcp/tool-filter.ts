/**
 * Selective tool loading via the `ENABLED_TOOLS` / `DISABLED_TOOLS` environment
 * variables.
 *
 * Both variables take a comma-separated list of tool names. A name may be given
 * either as the full MCP tool name (e.g. `API-post-search`) or as the bare
 * OpenAPI operationId (e.g. `post-search`).
 *
 * - `ENABLED_TOOLS` is an allow-list: only the listed tools are exposed.
 * - `DISABLED_TOOLS` is a deny-list: every tool except the listed ones is exposed.
 * - When both are set, the allow-list is applied first and the deny-list is then
 *   removed from it.
 *
 * Unset or blank variables mean "no filtering", so the default behavior is
 * unchanged.
 *
 * @see https://github.com/makenotion/notion-mcp-server/issues/111
 */

export type ToolFilter = {
  enabled?: ReadonlySet<string>
  disabled?: ReadonlySet<string>
}

/**
 * Parse a comma-separated tool list. Returns `undefined` when the value is unset
 * or contains no names, so a blank variable never hides every tool.
 */
export function parseToolList(value: string | undefined): Set<string> | undefined {
  if (value === undefined) {
    return undefined
  }
  const names = value
    .split(',')
    .map(name => name.trim())
    .filter(name => name.length > 0)
  return names.length > 0 ? new Set(names) : undefined
}

export function toolFilterFromEnv(env: NodeJS.ProcessEnv = process.env): ToolFilter {
  return {
    enabled: parseToolList(env.ENABLED_TOOLS),
    disabled: parseToolList(env.DISABLED_TOOLS),
  }
}

/**
 * Whether a tool passes the filter.
 *
 * @param toolName Full MCP tool name, e.g. `API-post-search`.
 * @param operationId The tool's OpenAPI operationId, e.g. `post-search`.
 */
export function isToolAllowed(filter: ToolFilter, toolName: string, operationId: string): boolean {
  const matches = (names: ReadonlySet<string>) => names.has(toolName) || names.has(operationId)
  if (filter.enabled && !matches(filter.enabled)) {
    return false
  }
  if (filter.disabled && matches(filter.disabled)) {
    return false
  }
  return true
}

// The HTTP transport builds a proxy per session; only warn about each unknown
// name once per process instead of on every connection.
const warnedUnknownNames = new Set<string>()

/**
 * Warn (on stderr, so stdio transport output is unaffected) about filter
 * entries that do not match any tool, which usually indicates a typo.
 */
export function warnUnknownToolNames(
  filter: ToolFilter,
  tools: ReadonlyArray<{ toolName: string; operationId: string }>,
): void {
  const known = new Set<string>()
  for (const { toolName, operationId } of tools) {
    known.add(toolName)
    known.add(operationId)
  }
  for (const [variable, names] of [
    ['ENABLED_TOOLS', filter.enabled],
    ['DISABLED_TOOLS', filter.disabled],
  ] as const) {
    for (const name of names ?? []) {
      const key = `${variable}:${name}`
      if (!known.has(name) && !warnedUnknownNames.has(key)) {
        warnedUnknownNames.add(key)
        console.warn(`${variable}: ignoring unknown tool name "${name}"`)
      }
    }
  }
}
