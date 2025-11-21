import { describe, it, expect } from 'vitest'
import {
  matchesPattern,
  matchesAnyPattern,
  extractResourceType,
  shouldIncludeOperation,
  type ToolFilterConfig,
} from '../filter-config'

describe('matchesPattern', () => {
  it('should match exact strings', () => {
    expect(matchesPattern('get-user', 'get-user')).toBe(true)
    expect(matchesPattern('get-user', 'get-users')).toBe(false)
  })

  it('should match wildcard patterns with *', () => {
    expect(matchesPattern('get-user', 'get-*')).toBe(true)
    expect(matchesPattern('get-users', 'get-*')).toBe(true)
    expect(matchesPattern('post-user', 'get-*')).toBe(false)
  })

  it('should match patterns with * in the middle', () => {
    expect(matchesPattern('retrieve-a-page', '*-page')).toBe(true)
    expect(matchesPattern('post-page', '*-page')).toBe(true)
    expect(matchesPattern('retrieve-a-block', '*-page')).toBe(false)
  })

  it('should match patterns with * anywhere', () => {
    expect(matchesPattern('retrieve-a-block', '*block*')).toBe(true)
    expect(matchesPattern('get-block-children', '*block*')).toBe(true)
    expect(matchesPattern('get-user', '*block*')).toBe(false)
  })

  it('should match patterns with ? for single character', () => {
    expect(matchesPattern('get-user', 'get-use?')).toBe(true)
    expect(matchesPattern('get-users', 'get-use?')).toBe(false)
  })

  it('should be case-insensitive', () => {
    expect(matchesPattern('GET-USER', 'get-user')).toBe(true)
    expect(matchesPattern('get-user', 'GET-USER')).toBe(true)
  })
})

describe('matchesAnyPattern', () => {
  it('should match if any pattern matches', () => {
    expect(matchesAnyPattern('get-user', ['get-*', 'post-*'])).toBe(true)
    expect(matchesAnyPattern('post-page', ['get-*', 'post-*'])).toBe(true)
    expect(matchesAnyPattern('delete-block', ['get-*', 'post-*'])).toBe(false)
  })

  it('should return false for empty patterns array', () => {
    expect(matchesAnyPattern('get-user', [])).toBe(false)
  })
})

describe('extractResourceType', () => {
  it('should extract resource type from path', () => {
    expect(extractResourceType('/v1/users/me')).toBe('users')
    expect(extractResourceType('/v1/pages')).toBe('pages')
    expect(extractResourceType('/v1/blocks/123')).toBe('blocks')
    expect(extractResourceType('/v1/databases/456')).toBe('databases')
    expect(extractResourceType('/v1/comments')).toBe('comments')
    expect(extractResourceType('/v1/search')).toBe('search')
  })

  it('should return null for unknown paths', () => {
    expect(extractResourceType('/v2/users')).toBe(null)
    expect(extractResourceType('/unknown')).toBe(null)
    expect(extractResourceType('')).toBe(null)
  })
})

describe('shouldIncludeOperation', () => {
  it('should include all operations when no config provided', () => {
    expect(shouldIncludeOperation('get-user', '/v1/users/me')).toBe(true)
    expect(shouldIncludeOperation('post-page', '/v1/pages')).toBe(true)
  })

  it('should filter by resource types', () => {
    const config: ToolFilterConfig = {
      resourceTypes: ['pages', 'blocks'],
    }

    expect(shouldIncludeOperation('get-user', '/v1/users/me', config)).toBe(false)
    expect(shouldIncludeOperation('retrieve-a-page', '/v1/pages/123', config)).toBe(true)
    expect(shouldIncludeOperation('get-block-children', '/v1/blocks/123', config)).toBe(true)
  })

  it('should filter by include list', () => {
    const config: ToolFilterConfig = {
      include: ['get-user', 'get-users'],
    }

    expect(shouldIncludeOperation('get-user', '/v1/users/me', config)).toBe(true)
    expect(shouldIncludeOperation('get-users', '/v1/users', config)).toBe(true)
    expect(shouldIncludeOperation('post-page', '/v1/pages', config)).toBe(false)
  })

  it('should filter by include list with wildcards', () => {
    const config: ToolFilterConfig = {
      include: ['get-*', 'retrieve-*'],
    }

    expect(shouldIncludeOperation('get-user', '/v1/users/me', config)).toBe(true)
    expect(shouldIncludeOperation('retrieve-a-page', '/v1/pages/123', config)).toBe(true)
    expect(shouldIncludeOperation('post-page', '/v1/pages', config)).toBe(false)
  })

  it('should filter by exclude list', () => {
    const config: ToolFilterConfig = {
      exclude: ['delete-a-block'],
    }

    expect(shouldIncludeOperation('delete-a-block', '/v1/blocks/123', config)).toBe(false)
    expect(shouldIncludeOperation('get-user', '/v1/users/me', config)).toBe(true)
  })

  it('should filter by exclude list with wildcards', () => {
    const config: ToolFilterConfig = {
      exclude: ['delete-*', 'patch-*'],
    }

    expect(shouldIncludeOperation('delete-a-block', '/v1/blocks/123', config)).toBe(false)
    expect(shouldIncludeOperation('patch-page', '/v1/pages/123', config)).toBe(false)
    expect(shouldIncludeOperation('get-user', '/v1/users/me', config)).toBe(true)
  })

  it('should combine resource types and include filters', () => {
    const config: ToolFilterConfig = {
      resourceTypes: ['pages'],
      include: ['get-*', 'retrieve-*'],
    }

    expect(shouldIncludeOperation('get-user', '/v1/users/me', config)).toBe(false)
    expect(shouldIncludeOperation('retrieve-a-page', '/v1/pages/123', config)).toBe(true)
    expect(shouldIncludeOperation('post-page', '/v1/pages', config)).toBe(false)
  })

  it('should apply exclude after include and resource types', () => {
    const config: ToolFilterConfig = {
      resourceTypes: ['pages'],
      include: ['*-page'],
      exclude: ['delete-*'],
    }

    expect(shouldIncludeOperation('retrieve-a-page', '/v1/pages/123', config)).toBe(true)
    expect(shouldIncludeOperation('post-page', '/v1/pages', config)).toBe(true)
    expect(shouldIncludeOperation('delete-a-page', '/v1/pages/123', config)).toBe(false)
    expect(shouldIncludeOperation('get-user', '/v1/users/me', config)).toBe(false)
  })
})
