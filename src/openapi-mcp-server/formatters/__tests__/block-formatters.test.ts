import { describe, it, expect } from 'vitest'
import { BlockFormatter } from '../block-formatters'
import type { ParagraphBlock, HeadingBlock, BulletedListItemBlock, ToDoBlock, RichText } from '../types'

describe('BlockFormatter', () => {
  const formatter = new BlockFormatter()

  const createRichText = (content: string): RichText[] => [
    {
      type: 'text',
      text: { content },
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: 'default',
      },
      plain_text: content,
      href: null,
    },
  ]

  it('should format paragraph block', () => {
    const block: ParagraphBlock = {
      object: 'block',
      id: 'abc123',
      type: 'paragraph',
      created_time: '2024-01-01T00:00:00.000Z',
      last_edited_time: '2024-01-01T00:00:00.000Z',
      has_children: false,
      archived: false,
      paragraph: {
        rich_text: createRichText('This is a paragraph.'),
        color: 'default',
      },
    }

    const result = formatter.formatBlock(block)
    expect(result).toBe('This is a paragraph. [block:abc123]')
  })

  it('should format heading_1 block', () => {
    const block: HeadingBlock = {
      object: 'block',
      id: 'def456',
      type: 'heading_1',
      created_time: '2024-01-01T00:00:00.000Z',
      last_edited_time: '2024-01-01T00:00:00.000Z',
      has_children: false,
      archived: false,
      heading_1: {
        rich_text: createRichText('Main Heading'),
        color: 'default',
      },
    }

    const result = formatter.formatBlock(block)
    expect(result).toBe('# Main Heading [block:def456]')
  })

  it('should format heading_2 block', () => {
    const block: HeadingBlock = {
      object: 'block',
      id: 'ghi789',
      type: 'heading_2',
      created_time: '2024-01-01T00:00:00.000Z',
      last_edited_time: '2024-01-01T00:00:00.000Z',
      has_children: false,
      archived: false,
      heading_2: {
        rich_text: createRichText('Subheading'),
        color: 'default',
      },
    }

    const result = formatter.formatBlock(block)
    expect(result).toBe('## Subheading [block:ghi789]')
  })

  it('should format bulleted list item', () => {
    const block: BulletedListItemBlock = {
      object: 'block',
      id: 'jkl012',
      type: 'bulleted_list_item',
      created_time: '2024-01-01T00:00:00.000Z',
      last_edited_time: '2024-01-01T00:00:00.000Z',
      has_children: false,
      archived: false,
      bulleted_list_item: {
        rich_text: createRichText('List item'),
        color: 'default',
      },
    }

    const result = formatter.formatBlock(block)
    expect(result).toBe('- List item [block:jkl012]')
  })

  it('should format to-do block unchecked', () => {
    const block: ToDoBlock = {
      object: 'block',
      id: 'mno345',
      type: 'to_do',
      created_time: '2024-01-01T00:00:00.000Z',
      last_edited_time: '2024-01-01T00:00:00.000Z',
      has_children: false,
      archived: false,
      to_do: {
        rich_text: createRichText('Task to complete'),
        checked: false,
        color: 'default',
      },
    }

    const result = formatter.formatBlock(block)
    expect(result).toBe('- [ ] Task to complete [block:mno345]')
  })

  it('should format to-do block checked', () => {
    const block: ToDoBlock = {
      object: 'block',
      id: 'pqr678',
      type: 'to_do',
      created_time: '2024-01-01T00:00:00.000Z',
      last_edited_time: '2024-01-01T00:00:00.000Z',
      has_children: false,
      archived: false,
      to_do: {
        rich_text: createRichText('Completed task'),
        checked: true,
        color: 'default',
      },
    }

    const result = formatter.formatBlock(block)
    expect(result).toBe('- [x] Completed task [block:pqr678]')
  })

  it('should handle indentation', () => {
    const block: ParagraphBlock = {
      object: 'block',
      id: 'stu901',
      type: 'paragraph',
      created_time: '2024-01-01T00:00:00.000Z',
      last_edited_time: '2024-01-01T00:00:00.000Z',
      has_children: false,
      archived: false,
      paragraph: {
        rich_text: createRichText('Indented text'),
        color: 'default',
      },
    }

    const result = formatter.formatBlock(block, 2)
    expect(result).toBe('    Indented text [block:stu901]')
  })
})
