import { describe, it, expect } from 'vitest'
import { MarkdownConverter } from '../markdown-converter'
import type { RichText } from '../types'

describe('MarkdownConverter', () => {
  const converter = new MarkdownConverter()

  it('should convert plain text', () => {
    const richText: RichText[] = [
      {
        type: 'text',
        text: { content: 'Hello world' },
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: 'default',
        },
        plain_text: 'Hello world',
        href: null,
      },
    ]

    const result = converter.convertRichTextToMarkdown(richText)
    expect(result).toBe('Hello world')
  })

  it('should convert bold text', () => {
    const richText: RichText[] = [
      {
        type: 'text',
        text: { content: 'Bold text' },
        annotations: {
          bold: true,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: 'default',
        },
        plain_text: 'Bold text',
        href: null,
      },
    ]

    const result = converter.convertRichTextToMarkdown(richText)
    expect(result).toBe('**Bold text**')
  })

  it('should convert italic text', () => {
    const richText: RichText[] = [
      {
        type: 'text',
        text: { content: 'Italic text' },
        annotations: {
          bold: false,
          italic: true,
          strikethrough: false,
          underline: false,
          code: false,
          color: 'default',
        },
        plain_text: 'Italic text',
        href: null,
      },
    ]

    const result = converter.convertRichTextToMarkdown(richText)
    expect(result).toBe('*Italic text*')
  })

  it('should convert code text', () => {
    const richText: RichText[] = [
      {
        type: 'text',
        text: { content: 'code()' },
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: true,
          color: 'default',
        },
        plain_text: 'code()',
        href: null,
      },
    ]

    const result = converter.convertRichTextToMarkdown(richText)
    expect(result).toBe('`code()`')
  })

  it('should convert text with link', () => {
    const richText: RichText[] = [
      {
        type: 'text',
        text: { content: 'Click here', link: { url: 'https://example.com' } },
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: 'default',
        },
        plain_text: 'Click here',
        href: 'https://example.com',
      },
    ]

    const result = converter.convertRichTextToMarkdown(richText)
    expect(result).toBe('[Click here](https://example.com)')
  })

  it('should combine multiple formatting', () => {
    const richText: RichText[] = [
      {
        type: 'text',
        text: { content: 'Bold italic' },
        annotations: {
          bold: true,
          italic: true,
          strikethrough: false,
          underline: false,
          code: false,
          color: 'default',
        },
        plain_text: 'Bold italic',
        href: null,
      },
    ]

    const result = converter.convertRichTextToMarkdown(richText)
    expect(result).toBe('***Bold italic***')
  })

  it('should handle page mentions', () => {
    const richText: RichText[] = [
      {
        type: 'mention',
        mention: {
          type: 'page',
          page: { id: 'abc123' },
        },
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: 'default',
        },
        plain_text: 'Page Name',
        href: null,
      },
    ]

    const result = converter.convertRichTextToMarkdown(richText)
    expect(result).toBe('Page Name [page:abc123]')
  })

  it('should handle empty array', () => {
    const result = converter.convertRichTextToMarkdown([])
    expect(result).toBe('')
  })
})
