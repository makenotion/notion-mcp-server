import type { RichText } from './types'

export class MarkdownConverter {
  convertRichTextToMarkdown(richTextArray: RichText[]): string {
    if (!richTextArray || richTextArray.length === 0) {
      return ''
    }

    return richTextArray.map(rt => this.convertSingleRichText(rt)).join('')
  }

  private convertSingleRichText(richText: RichText): string {
    let text = richText.plain_text

    if (richText.type === 'equation' && richText.equation) {
      return `$${richText.equation.expression}$`
    }

    if (richText.type === 'mention' && richText.mention) {
      const mention = richText.mention
      if (mention.type === 'page' && mention.page) {
        return `${text} [page:${mention.page.id}]`
      } else if (mention.type === 'database' && mention.database) {
        return `${text} [db:${mention.database.id}]`
      } else if (mention.type === 'user' && mention.user) {
        return `${text} [user:${mention.user.id}]`
      }
      return text
    }

    const annotations = richText.annotations
    let formatted = text

    if (annotations.code) {
      formatted = `\`${formatted}\``
    }

    if (annotations.bold) {
      formatted = `**${formatted}**`
    }

    if (annotations.italic) {
      formatted = `*${formatted}*`
    }

    if (annotations.strikethrough) {
      formatted = `~~${formatted}~~`
    }

    if (richText.href || (richText.type === 'text' && richText.text?.link)) {
      const url = richText.href || richText.text?.link?.url || ''
      formatted = `[${formatted}](${url})`
    }

    return formatted
  }

  escapeMarkdown(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/#/g, '\\#')
      .replace(/\+/g, '\\+')
      .replace(/-/g, '\\-')
      .replace(/\./g, '\\.')
      .replace(/!/g, '\\!')
  }
}
