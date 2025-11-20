import type {
  NotionBlock,
  ParagraphBlock,
  HeadingBlock,
  BulletedListItemBlock,
  NumberedListItemBlock,
  ToDoBlock,
  CodeBlock,
  QuoteBlock,
  CalloutBlock,
  ToggleBlock,
  DividerBlock,
  TableBlock,
  TableRowBlock,
  ChildPageBlock,
  ChildDatabaseBlock,
} from './types'
import { MarkdownConverter } from './markdown-converter'

export class BlockFormatter {
  private markdownConverter = new MarkdownConverter()
  private numberedListCounters: Map<number, number> = new Map()

  formatBlock(block: NotionBlock, indentLevel: number = 0): string {
    const indent = '  '.repeat(indentLevel)
    const blockId = `[block:${block.id}]`

    switch (block.type) {
      case 'paragraph':
        return this.formatParagraph(block as ParagraphBlock, blockId, indent)

      case 'heading_1':
      case 'heading_2':
      case 'heading_3':
        return this.formatHeading(block as HeadingBlock, blockId)

      case 'bulleted_list_item':
        return this.formatBulletedListItem(block as BulletedListItemBlock, blockId, indent)

      case 'numbered_list_item':
        return this.formatNumberedListItem(block as NumberedListItemBlock, blockId, indent, indentLevel)

      case 'to_do':
        return this.formatToDo(block as ToDoBlock, blockId, indent)

      case 'code':
        return this.formatCode(block as CodeBlock, blockId)

      case 'quote':
        return this.formatQuote(block as QuoteBlock, blockId)

      case 'callout':
        return this.formatCallout(block as CalloutBlock, blockId)

      case 'toggle':
        return this.formatToggle(block as ToggleBlock, blockId, indent)

      case 'divider':
        return this.formatDivider()

      case 'table':
        return this.formatTable(block as TableBlock, blockId)

      case 'table_row':
        return this.formatTableRow(block as TableRowBlock)

      case 'child_page':
        return this.formatChildPage(block as ChildPageBlock, blockId, indent)

      case 'child_database':
        return this.formatChildDatabase(block as ChildDatabaseBlock, blockId, indent)

      default:
        return `${indent}[${block.type}] ${blockId}\n`
    }
  }

  formatBlocks(blocks: NotionBlock[], indentLevel: number = 0): string {
    return blocks.map(block => this.formatBlock(block, indentLevel)).join('\n')
  }

  private formatParagraph(block: ParagraphBlock, blockId: string, indent: string): string {
    const text = this.markdownConverter.convertRichTextToMarkdown(block.paragraph.rich_text)
    if (!text.trim()) {
      return ''
    }
    return `${indent}${text} ${blockId}`
  }

  private formatHeading(block: HeadingBlock, blockId: string): string {
    const level = parseInt(block.type.replace('heading_', ''))
    const hashes = '#'.repeat(level)
    const content = block[block.type as keyof HeadingBlock]
    if (!content || typeof content !== 'object' || !('rich_text' in content)) {
      return `${hashes} [Heading] ${blockId}`
    }
    const text = this.markdownConverter.convertRichTextToMarkdown(content.rich_text)
    return `${hashes} ${text} ${blockId}`
  }

  private formatBulletedListItem(block: BulletedListItemBlock, blockId: string, indent: string): string {
    const text = this.markdownConverter.convertRichTextToMarkdown(block.bulleted_list_item.rich_text)
    return `${indent}- ${text} ${blockId}`
  }

  private formatNumberedListItem(block: NumberedListItemBlock, blockId: string, indent: string, indentLevel: number): string {
    if (!this.numberedListCounters.has(indentLevel)) {
      this.numberedListCounters.set(indentLevel, 1)
    }
    const num = this.numberedListCounters.get(indentLevel)!
    this.numberedListCounters.set(indentLevel, num + 1)

    const text = this.markdownConverter.convertRichTextToMarkdown(block.numbered_list_item.rich_text)
    return `${indent}${num}. ${text} ${blockId}`
  }

  private formatToDo(block: ToDoBlock, blockId: string, indent: string): string {
    const checkbox = block.to_do.checked ? '[x]' : '[ ]'
    const text = this.markdownConverter.convertRichTextToMarkdown(block.to_do.rich_text)
    return `${indent}- ${checkbox} ${text} ${blockId}`
  }

  private formatCode(block: CodeBlock, blockId: string): string {
    const language = block.code.language || ''
    const code = this.markdownConverter.convertRichTextToMarkdown(block.code.rich_text)
    const caption = block.code.caption?.length > 0
      ? `\n*${this.markdownConverter.convertRichTextToMarkdown(block.code.caption)}*`
      : ''
    return `\`\`\`${language}\n${code}\n\`\`\` ${blockId}${caption}`
  }

  private formatQuote(block: QuoteBlock, blockId: string): string {
    const text = this.markdownConverter.convertRichTextToMarkdown(block.quote.rich_text)
    const lines = text.split('\n')
    return lines.map(line => `> ${line}`).join('\n') + ` ${blockId}`
  }

  private formatCallout(block: CalloutBlock, blockId: string): string {
    const icon = block.callout.icon?.emoji || '💡'
    const text = this.markdownConverter.convertRichTextToMarkdown(block.callout.rich_text)
    return `> ${icon} ${text} ${blockId}`
  }

  private formatToggle(block: ToggleBlock, blockId: string, indent: string): string {
    const text = this.markdownConverter.convertRichTextToMarkdown(block.toggle.rich_text)
    return `${indent}▸ ${text} ${blockId}`
  }

  private formatDivider(): string {
    return '---'
  }

  private formatTable(block: TableBlock, blockId: string): string {
    return `[Table: ${block.table.table_width} columns] ${blockId}`
  }

  private formatTableRow(block: TableRowBlock): string {
    const cells = block.table_row.cells.map(cell =>
      this.markdownConverter.convertRichTextToMarkdown(cell)
    )
    return `| ${cells.join(' | ')} |`
  }

  private formatChildPage(block: ChildPageBlock, blockId: string, indent: string): string {
    return `${indent}📄 ${block.child_page.title} ${blockId}`
  }

  private formatChildDatabase(block: ChildDatabaseBlock, blockId: string, indent: string): string {
    return `${indent}🗂 ${block.child_database.title} ${blockId}`
  }

  resetNumberedListCounters(): void {
    this.numberedListCounters.clear()
  }
}
