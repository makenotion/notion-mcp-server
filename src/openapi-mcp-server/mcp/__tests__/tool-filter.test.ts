import { describe, expect, it, vi, afterEach } from 'vitest'
import { isToolAllowed, parseToolList, toolFilterFromEnv, warnUnknownToolNames } from '../tool-filter'

describe('parseToolList', () => {
  it('returns undefined when the value is unset', () => {
    expect(parseToolList(undefined)).toBeUndefined()
  })

  it('returns undefined for blank values so they never hide every tool', () => {
    expect(parseToolList('')).toBeUndefined()
    expect(parseToolList('  ')).toBeUndefined()
    expect(parseToolList(' , ,')).toBeUndefined()
  })

  it('splits on commas and trims whitespace', () => {
    expect(parseToolList(' post-search ,API-retrieve-a-page,,')).toEqual(new Set(['post-search', 'API-retrieve-a-page']))
  })
})

describe('toolFilterFromEnv', () => {
  it('reads ENABLED_TOOLS and DISABLED_TOOLS', () => {
    expect(toolFilterFromEnv({ ENABLED_TOOLS: 'a,b', DISABLED_TOOLS: 'b' })).toEqual({
      enabled: new Set(['a', 'b']),
      disabled: new Set(['b']),
    })
  })

  it('returns an empty filter when neither variable is set', () => {
    expect(toolFilterFromEnv({})).toEqual({ enabled: undefined, disabled: undefined })
  })
})

describe('isToolAllowed', () => {
  it('allows every tool when no filter is set', () => {
    expect(isToolAllowed({}, 'API-post-search', 'post-search')).toBe(true)
  })

  it('matches allow-list entries by full tool name or operationId', () => {
    const filter = { enabled: new Set(['API-post-search', 'retrieve-a-page']) }
    expect(isToolAllowed(filter, 'API-post-search', 'post-search')).toBe(true)
    expect(isToolAllowed(filter, 'API-retrieve-a-page', 'retrieve-a-page')).toBe(true)
    expect(isToolAllowed(filter, 'API-delete-a-block', 'delete-a-block')).toBe(false)
  })

  it('matches deny-list entries by full tool name or operationId', () => {
    const filter = { disabled: new Set(['API-delete-a-block', 'patch-page']) }
    expect(isToolAllowed(filter, 'API-delete-a-block', 'delete-a-block')).toBe(false)
    expect(isToolAllowed(filter, 'API-patch-page', 'patch-page')).toBe(false)
    expect(isToolAllowed(filter, 'API-post-search', 'post-search')).toBe(true)
  })

  it('applies the deny-list on top of the allow-list', () => {
    const filter = { enabled: new Set(['post-search', 'patch-page']), disabled: new Set(['patch-page']) }
    expect(isToolAllowed(filter, 'API-post-search', 'post-search')).toBe(true)
    expect(isToolAllowed(filter, 'API-patch-page', 'patch-page')).toBe(false)
  })
})

describe('warnUnknownToolNames', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('warns once per unknown name and ignores known ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tools = [{ toolName: 'API-post-search', operationId: 'post-search' }]
    const filter = { enabled: new Set(['post-search', 'serach-typo']), disabled: new Set(['API-post-search']) }

    warnUnknownToolNames(filter, tools)
    warnUnknownToolNames(filter, tools)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('ENABLED_TOOLS: ignoring unknown tool name "serach-typo"')
  })
})
