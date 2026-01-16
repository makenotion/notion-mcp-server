import type {
  NotionPage,
  NotionDatabase,
  NotionUser,
  NotionBlock,
  SearchResults,
  BlocksListResponse,
  Comment,
  RichText,
  DatabaseProperty,
} from './types'
import { BlockFormatter } from './block-formatters'
import { MarkdownConverter } from './markdown-converter'

export class NotionResponseFormatter {
  private blockFormatter = new BlockFormatter()
  private markdownConverter = new MarkdownConverter()

  formatResponse(operationId: string, method: string, path: string, responseData: any): string {
    if (!responseData) {
      return 'No data returned'
    }

    if (this.isBlocksEndpoint(operationId, path)) {
      return this.formatBlocksResponse(responseData)
    }

    if (this.isPropertyEndpoint(operationId, path)) {
      return this.formatPropertyResponse(responseData)
    }

    if (this.isPageEndpoint(operationId, path)) {
      return this.formatPageResponse(responseData)
    }

    if (this.isDatabaseEndpoint(operationId, path)) {
      return this.formatDatabaseResponse(responseData)
    }

    if (this.isSearchEndpoint(operationId, path)) {
      return this.formatSearchResponse(responseData)
    }

    if (this.isUserEndpoint(operationId, path)) {
      return this.formatUserResponse(responseData)
    }

    if (this.isCommentEndpoint(operationId, path)) {
      return this.formatCommentResponse(responseData)
    }

    return this.formatFallback(responseData)
  }

  private isBlocksEndpoint(operationId: string, path: string): boolean {
    return (
      operationId?.includes('block') ||
      path?.includes('/blocks') ||
      operationId === 'get-block-children'
    )
  }

  private isPageEndpoint(operationId: string, path: string): boolean {
    return (
      operationId?.includes('page') ||
      path?.includes('/pages')
    )
  }

  private isDatabaseEndpoint(operationId: string, path: string): boolean {
    return (
      operationId?.includes('database') ||
      path?.includes('/databases')
    )
  }

  private isSearchEndpoint(operationId: string, path: string): boolean {
    return operationId?.includes('search') || path?.includes('/search')
  }

  private isUserEndpoint(operationId: string, path: string): boolean {
    return operationId?.includes('user') || path?.includes('/users')
  }

  private isCommentEndpoint(operationId: string, path: string): boolean {
    return operationId?.includes('comment') || path?.includes('/comments')
  }

  private isPropertyEndpoint(operationId: string, path: string): boolean {
    return operationId?.includes('property') || path?.includes('/properties')
  }

  private formatBlocksResponse(data: any): string {
    if (data.object === 'block') {
      const block = data as NotionBlock
      return this.blockFormatter.formatBlock(block)
    }

    if (data.object === 'list' && data.results) {
      const listResponse = data as BlocksListResponse
      this.blockFormatter.resetNumberedListCounters()
      const formatted = this.blockFormatter.formatBlocks(listResponse.results)

      if (listResponse.has_more && listResponse.next_cursor) {
        return `${formatted}\n\n[More results available, cursor: ${listResponse.next_cursor}]`
      }

      return formatted
    }

    return this.formatFallback(data)
  }

  private formatPageResponse(data: any): string {
    if (data.object === 'list' && data.results) {
      const pages = data.results.filter((r: any) => r.object === 'page')
      if (pages.length > 0) {
        return this.formatPagesList(pages, data.has_more, data.next_cursor)
      }
    }

    if (data.object === 'page') {
      const page = data as NotionPage
      return this.formatSinglePage(page)
    }

    return this.formatFallback(data)
  }

  private formatSinglePage(page: NotionPage): string {
    const parts: string[] = []

    const title = this.extractPageTitle(page)
    if (title) {
      parts.push(`# ${title} [page:${page.id}]`)
    } else {
      parts.push(`# Page [page:${page.id}]`)
    }

    if (page.icon?.emoji) {
      parts.push(`Icon: ${page.icon.emoji}`)
    }

    if (page.properties && Object.keys(page.properties).length > 0) {
      parts.push('\n**Properties:**')
      for (const [name, prop] of Object.entries(page.properties)) {
        const value = this.formatPropertyValue(prop)
        if (value) {
          parts.push(`- ${name}: ${value}`)
        }
      }
    }

    parts.push(`\nURL: ${page.url}`)
    parts.push(`Created: ${new Date(page.created_time).toLocaleString()}`)
    parts.push(`Last edited: ${new Date(page.last_edited_time).toLocaleString()}`)

    return parts.join('\n')
  }

  private formatPagesList(pages: NotionPage[], hasMore: boolean, nextCursor: string | null): string {
    const parts: string[] = [`Found ${pages.length} page(s):\n`]

    let untitledCount = 0
    for (const page of pages) {
      const title = this.extractPageTitle(page)
      if (title) {
        parts.push(`- ${title} [page:${page.id}]`)
      } else {
        untitledCount++
        const propNames = Object.keys(page.properties || {})
        if (propNames.length > 0) {
          parts.push(`- Untitled (properties: ${propNames.join(', ')}) [page:${page.id}]`)
        } else {
          parts.push(`- Untitled [page:${page.id}]`)
        }
      }
    }

    if (hasMore && nextCursor) {
      parts.push(`\n[More results available, cursor: ${nextCursor}]`)
    }

    if (untitledCount > 0 && untitledCount === pages.length) {
      parts.push(`\n[Note: All pages show as "Untitled" - if using filter_properties, omit it or include the title property ID to see page names]`)
    } else if (untitledCount > pages.length / 2) {
      parts.push(`\n[Note: ${untitledCount}/${pages.length} pages are "Untitled" - filter_properties may have excluded the title property]`)
    }

    return parts.join('\n')
  }

  private extractPageTitle(page: NotionPage): string | null {
    for (const prop of Object.values(page.properties)) {
      if (prop.type === 'title' && prop.title) {
        return this.markdownConverter.convertRichTextToMarkdown(prop.title)
      }
    }
    return null
  }

  private formatPropertyValue(prop: any): string {
    if (!prop || !prop.type) return ''

    switch (prop.type) {
      case 'title':
      case 'rich_text':
        const richText = prop[prop.type] as RichText[]
        return this.markdownConverter.convertRichTextToMarkdown(richText)

      case 'number':
        return prop.number?.toString() || ''

      case 'select':
        return prop.select?.name || ''

      case 'multi_select':
        return prop.multi_select?.map((s: any) => s.name).join(', ') || ''

      case 'date':
        if (prop.date?.start) {
          return prop.date.end ? `${prop.date.start} → ${prop.date.end}` : prop.date.start
        }
        return ''

      case 'people':
        return prop.people?.map((p: any) => p.name || p.id).join(', ') || ''

      case 'files':
        return prop.files?.map((f: any) => f.name || 'File').join(', ') || ''

      case 'checkbox':
        return prop.checkbox ? '✓' : '✗'

      case 'url':
        return prop.url || ''

      case 'email':
        return prop.email || ''

      case 'phone_number':
        return prop.phone_number || ''

      case 'status':
        return prop.status?.name || ''

      default:
        return `[${prop.type}]`
    }
  }

  private formatDatabaseResponse(data: any): string {
    if (data.object === 'list' && data.results) {
      const pages = data.results.filter((r: any) => r.object === 'page')
      if (pages.length > 0) {
        return this.formatPagesList(pages, data.has_more, data.next_cursor)
      }

      const databases = data.results.filter((r: any) => r.object === 'database')
      if (databases.length > 0) {
        return this.formatDatabasesList(databases, data.has_more, data.next_cursor)
      }
    }

    if (data.object === 'database') {
      const db = data as NotionDatabase
      return this.formatSingleDatabase(db)
    }

    return this.formatFallback(data)
  }

  private formatSingleDatabase(db: NotionDatabase): string {
    const parts: string[] = []

    const title = this.markdownConverter.convertRichTextToMarkdown(db.title)
    parts.push(`# Database: ${title || 'Untitled'} [db:${db.id}]`)

    if (db.icon?.emoji) {
      parts.push(`Icon: ${db.icon.emoji}`)
    }

    if (db.description && db.description.length > 0) {
      const desc = this.markdownConverter.convertRichTextToMarkdown(db.description)
      parts.push(`\n${desc}`)
    }

    if (db.properties && Object.keys(db.properties).length > 0) {
      parts.push('\n**Properties:**')
      for (const [name, prop] of Object.entries(db.properties)) {
        const propInfo = this.formatDatabaseProperty(name, prop)
        parts.push(`- ${propInfo}`)
      }
    }

    parts.push(`\nURL: ${db.url}`)
    parts.push(`Created: ${new Date(db.created_time).toLocaleString()}`)

    return parts.join('\n')
  }

  private formatDatabasesList(databases: NotionDatabase[], hasMore: boolean, nextCursor: string | null): string {
    const parts: string[] = [`Found ${databases.length} database(s):\n`]

    for (const db of databases) {
      const title = this.markdownConverter.convertRichTextToMarkdown(db.title) || 'Untitled'
      parts.push(`- ${title} [db:${db.id}]`)
    }

    if (hasMore && nextCursor) {
      parts.push(`\n[More results available, cursor: ${nextCursor}]`)
    }

    return parts.join('\n')
  }

  private formatDatabaseProperty(name: string, prop: DatabaseProperty): string {
    let typeInfo = prop.type

    if (prop.type === 'select' && prop.select?.options) {
      const options = prop.select.options.map((o: any) => o.name).join(', ')
      typeInfo = `select (${options})`
    } else if (prop.type === 'multi_select' && prop.multi_select?.options) {
      const options = prop.multi_select.options.map((o: any) => o.name).join(', ')
      typeInfo = `multi_select (${options})`
    } else if (prop.type === 'status' && prop.status?.options) {
      const options = prop.status.options.map((o: any) => o.name).join(', ')
      typeInfo = `status (${options})`
    }

    return `**${name}** (${typeInfo})`
  }

  private formatSearchResponse(data: any): string {
    if (data.object === 'list' && data.results) {
      const searchResults = data as SearchResults
      return this.formatSearchResults(searchResults)
    }

    return this.formatFallback(data)
  }

  private formatSearchResults(results: SearchResults): string {
    const parts: string[] = [`Found ${results.results.length} result(s):\n`]

    for (const result of results.results) {
      if (result.object === 'page') {
        const title = this.extractPageTitle(result as NotionPage) || 'Untitled'
        parts.push(`- 📄 ${title} [page:${result.id}]`)
      } else if (result.object === 'database') {
        const title = this.markdownConverter.convertRichTextToMarkdown((result as NotionDatabase).title) || 'Untitled'
        parts.push(`- 🗂 ${title} [db:${result.id}]`)
      }
    }

    if (results.has_more && results.next_cursor) {
      parts.push(`\n[More results available, cursor: ${results.next_cursor}]`)
    }

    return parts.join('\n')
  }

  private formatUserResponse(data: any): string {
    if (data.object === 'list' && data.results) {
      const users = data.results as NotionUser[]
      return this.formatUsersList(users)
    }

    if (data.object === 'user') {
      const user = data as NotionUser
      return this.formatSingleUser(user)
    }

    return this.formatFallback(data)
  }

  private formatSingleUser(user: NotionUser): string {
    const name = user.name || 'Unknown'
    const type = user.type || 'unknown'
    const parts = [`${name} (${type}) [user:${user.id}]`]

    if (user.person?.email) {
      parts.push(`Email: ${user.person.email}`)
    }

    if (user.bot?.workspace_name) {
      parts.push(`Workspace: ${user.bot.workspace_name}`)
    }

    if (user.avatar_url) {
      parts.push(`Avatar: ${user.avatar_url}`)
    }

    return parts.join('\n')
  }

  private formatUsersList(users: NotionUser[]): string {
    const parts: string[] = [`Found ${users.length} user(s):\n`]

    for (const user of users) {
      const name = user.name || 'Unknown'
      const type = user.type || 'unknown'
      parts.push(`- ${name} (${type}) [user:${user.id}]`)
    }

    return parts.join('\n')
  }

  private formatCommentResponse(data: any): string {
    if (data.object === 'list' && data.results) {
      const comments = data.results as Comment[]
      return this.formatCommentsList(comments)
    }

    if (data.object === 'comment') {
      const comment = data as Comment
      return this.formatSingleComment(comment)
    }

    return this.formatFallback(data)
  }

  private formatSingleComment(comment: Comment): string {
    const text = this.markdownConverter.convertRichTextToMarkdown(comment.rich_text)
    const created = new Date(comment.created_time).toLocaleString()

    return `Comment [comment:${comment.id}]
${text}

Created: ${created}
By: [user:${comment.created_by.id}]`
  }

  private formatCommentsList(comments: Comment[]): string {
    const parts: string[] = [`${comments.length} comment(s):\n`]

    for (const comment of comments) {
      const text = this.markdownConverter.convertRichTextToMarkdown(comment.rich_text)
      const preview = text.length > 100 ? text.substring(0, 100) + '...' : text
      parts.push(`- ${preview} [comment:${comment.id}]`)
    }

    return parts.join('\n')
  }

  private formatPropertyResponse(data: any): string {
    if (data.object === 'property_item') {
      return this.formatSinglePropertyItem(data)
    }

    if (data.object === 'list' && data.results) {
      const propertyItems = data.results.filter((r: any) => r.object === 'property_item')
      if (propertyItems.length > 0) {
        return this.formatPropertyItemsList(propertyItems, data.has_more, data.next_cursor)
      }
    }

    return this.formatFallback(data)
  }

  private formatSinglePropertyItem(item: any): string {
    const value = this.formatPropertyItemValue(item)
    return value || '[Empty property]'
  }

  private formatPropertyItemsList(items: any[], hasMore: boolean, nextCursor: string | null): string {
    const parts: string[] = [`Found ${items.length} property item(s):\n`]

    for (const item of items) {
      const value = this.formatPropertyItemValue(item)
      if (value) {
        parts.push(`- ${value}`)
      }
    }

    if (hasMore && nextCursor) {
      parts.push(`\n[More results available, cursor: ${nextCursor}]`)
    }

    return parts.join('\n')
  }

  private formatPropertyItemValue(item: any): string {
    if (!item || !item.type) return ''

    switch (item.type) {
      case 'title':
      case 'rich_text':
        const richText = item[item.type] as RichText
        return this.markdownConverter.convertRichTextToMarkdown([richText])

      case 'number':
        return item.number?.toString() || ''

      case 'select':
        return item.select?.name || ''

      case 'multi_select':
        return item.multi_select?.name || ''

      case 'date':
        if (item.date?.start) {
          return item.date.end ? `${item.date.start} → ${item.date.end}` : item.date.start
        }
        return ''

      case 'people':
        return item.people?.name || item.people?.id || ''

      case 'files':
        return item.files?.name || 'File'

      case 'checkbox':
        return item.checkbox ? '✓' : '✗'

      case 'url':
        return item.url || ''

      case 'email':
        return item.email || ''

      case 'phone_number':
        return item.phone_number || ''

      case 'status':
        return item.status?.name || ''

      case 'relation':
        return item.relation?.id ? `[page:${item.relation.id}]` : ''

      case 'rollup':
        if (item.rollup?.type === 'number') {
          return item.rollup.number?.toString() || ''
        } else if (item.rollup?.type === 'array') {
          return `[${item.rollup.array?.length || 0} items]`
        }
        return `[${item.rollup?.type || 'rollup'}]`

      default:
        return `[${item.type}]`
    }
  }

  private formatFallback(data: any): string {
    return JSON.stringify(data, null, 2)
  }
}
