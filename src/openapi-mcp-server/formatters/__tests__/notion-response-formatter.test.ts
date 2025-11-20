import { describe, it, expect } from 'vitest'
import { NotionResponseFormatter } from '../notion-response-formatter'
import type { NotionPage, NotionDatabase, NotionUser, SearchResults } from '../types'

describe('NotionResponseFormatter', () => {
  const formatter = new NotionResponseFormatter()

  describe('User responses', () => {
    it('should format single user', () => {
      const user: NotionUser = {
        object: 'user',
        id: 'user123',
        type: 'person',
        name: 'John Doe',
        avatar_url: 'https://example.com/avatar.jpg',
        person: {
          email: 'john@example.com',
        },
      }

      const result = formatter.formatResponse('get-user', 'GET', '/users/user123', user)
      expect(result).toContain('John Doe')
      expect(result).toContain('[user:user123]')
      expect(result).toContain('john@example.com')
    })

    it('should format user list', () => {
      const users = {
        object: 'list',
        results: [
          {
            object: 'user',
            id: 'user1',
            type: 'person',
            name: 'Alice',
          },
          {
            object: 'user',
            id: 'user2',
            type: 'person',
            name: 'Bob',
          },
        ],
      }

      const result = formatter.formatResponse('list-users', 'GET', '/users', users)
      expect(result).toContain('Found 2 user(s)')
      expect(result).toContain('Alice')
      expect(result).toContain('[user:user1]')
      expect(result).toContain('Bob')
      expect(result).toContain('[user:user2]')
    })
  })

  describe('Search responses', () => {
    it('should format search results with pages and databases', () => {
      const searchResults: SearchResults = {
        object: 'list',
        results: [
          {
            object: 'page',
            id: 'page123',
            created_time: '2024-01-01T00:00:00.000Z',
            last_edited_time: '2024-01-01T00:00:00.000Z',
            archived: false,
            properties: {
              title: {
                type: 'title',
                title: [
                  {
                    type: 'text',
                    text: { content: 'My Page' },
                    annotations: {
                      bold: false,
                      italic: false,
                      strikethrough: false,
                      underline: false,
                      code: false,
                      color: 'default',
                    },
                    plain_text: 'My Page',
                    href: null,
                  },
                ],
              },
            },
            parent: { type: 'workspace' },
            url: 'https://notion.so/page123',
          } as NotionPage,
          {
            object: 'database',
            id: 'db456',
            created_time: '2024-01-01T00:00:00.000Z',
            last_edited_time: '2024-01-01T00:00:00.000Z',
            title: [
              {
                type: 'text',
                text: { content: 'My Database' },
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: 'default',
                },
                plain_text: 'My Database',
                href: null,
              },
            ],
            description: [],
            properties: {},
            parent: { type: 'workspace' },
            url: 'https://notion.so/db456',
            archived: false,
          } as NotionDatabase,
        ],
        next_cursor: null,
        has_more: false,
      }

      const result = formatter.formatResponse('search', 'POST', '/search', searchResults)
      expect(result).toContain('Found 2 result(s)')
      expect(result).toContain('📄 My Page [page:page123]')
      expect(result).toContain('🗂 My Database [db:db456]')
    })
  })

  describe('Fallback for unknown responses', () => {
    it('should format unknown responses as JSON', () => {
      const unknownData = { foo: 'bar', nested: { value: 123 } }

      const result = formatter.formatResponse('unknown-operation', 'GET', '/unknown', unknownData)
      expect(result).toContain('"foo"')
      expect(result).toContain('"bar"')
      expect(result).toContain('"nested"')
    })
  })
})
