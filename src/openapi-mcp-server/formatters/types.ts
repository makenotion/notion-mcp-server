export type RichText = {
  type: 'text' | 'mention' | 'equation'
  text?: {
    content: string
    link?: { url: string } | null
  }
  mention?: {
    type: 'page' | 'database' | 'date' | 'user' | 'link_preview'
    page?: { id: string }
    database?: { id: string }
    user?: { id: string }
  }
  equation?: {
    expression: string
  }
  annotations: {
    bold: boolean
    italic: boolean
    strikethrough: boolean
    underline: boolean
    code: boolean
    color: string
  }
  plain_text: string
  href?: string | null
}

export type NotionBlock = {
  object: 'block'
  id: string
  type: string
  created_time: string
  last_edited_time: string
  has_children: boolean
  archived: boolean
  [key: string]: any
}

export type ParagraphBlock = NotionBlock & {
  type: 'paragraph'
  paragraph: {
    rich_text: RichText[]
    color: string
  }
}

export type HeadingBlock = NotionBlock & {
  type: 'heading_1' | 'heading_2' | 'heading_3'
  heading_1?: {
    rich_text: RichText[]
    color: string
    is_toggleable?: boolean
  }
  heading_2?: {
    rich_text: RichText[]
    color: string
    is_toggleable?: boolean
  }
  heading_3?: {
    rich_text: RichText[]
    color: string
    is_toggleable?: boolean
  }
}

export type BulletedListItemBlock = NotionBlock & {
  type: 'bulleted_list_item'
  bulleted_list_item: {
    rich_text: RichText[]
    color: string
  }
}

export type NumberedListItemBlock = NotionBlock & {
  type: 'numbered_list_item'
  numbered_list_item: {
    rich_text: RichText[]
    color: string
  }
}

export type ToDoBlock = NotionBlock & {
  type: 'to_do'
  to_do: {
    rich_text: RichText[]
    checked: boolean
    color: string
  }
}

export type CodeBlock = NotionBlock & {
  type: 'code'
  code: {
    rich_text: RichText[]
    language: string
    caption: RichText[]
  }
}

export type QuoteBlock = NotionBlock & {
  type: 'quote'
  quote: {
    rich_text: RichText[]
    color: string
  }
}

export type CalloutBlock = NotionBlock & {
  type: 'callout'
  callout: {
    rich_text: RichText[]
    icon?: {
      type: 'emoji' | 'external' | 'file'
      emoji?: string
    }
    color: string
  }
}

export type ToggleBlock = NotionBlock & {
  type: 'toggle'
  toggle: {
    rich_text: RichText[]
    color: string
  }
}

export type DividerBlock = NotionBlock & {
  type: 'divider'
  divider: Record<string, never>
}

export type TableBlock = NotionBlock & {
  type: 'table'
  table: {
    table_width: number
    has_column_header: boolean
    has_row_header: boolean
  }
}

export type TableRowBlock = NotionBlock & {
  type: 'table_row'
  table_row: {
    cells: RichText[][]
  }
}

export type ChildPageBlock = NotionBlock & {
  type: 'child_page'
  child_page: {
    title: string
  }
}

export type ChildDatabaseBlock = NotionBlock & {
  type: 'child_database'
  child_database: {
    title: string
  }
}

export type NotionPage = {
  object: 'page'
  id: string
  created_time: string
  last_edited_time: string
  archived: boolean
  icon?: {
    type: 'emoji' | 'external' | 'file'
    emoji?: string
    external?: { url: string }
    file?: { url: string }
  } | null
  cover?: {
    type: 'external' | 'file'
    external?: { url: string }
    file?: { url: string }
  } | null
  properties: Record<string, any>
  parent: {
    type: 'database_id' | 'page_id' | 'workspace'
    database_id?: string
    page_id?: string
  }
  url: string
}

export type NotionDatabase = {
  object: 'database'
  id: string
  created_time: string
  last_edited_time: string
  title: RichText[]
  description: RichText[]
  icon?: {
    type: 'emoji' | 'external' | 'file'
    emoji?: string
  } | null
  cover?: {
    type: 'external' | 'file'
    external?: { url: string }
  } | null
  properties: Record<string, DatabaseProperty>
  parent: {
    type: 'page_id' | 'workspace'
    page_id?: string
  }
  url: string
  archived: boolean
}

export type DatabaseProperty = {
  id: string
  name: string
  type: string
  [key: string]: any
}

export type NotionUser = {
  object: 'user'
  id: string
  type?: 'person' | 'bot'
  name?: string
  avatar_url?: string | null
  person?: {
    email?: string
  }
  bot?: {
    owner?: {
      type: string
      workspace?: boolean
    }
    workspace_name?: string
  }
}

export type SearchResults = {
  object: 'list'
  results: (NotionPage | NotionDatabase)[]
  next_cursor: string | null
  has_more: boolean
}

export type BlocksListResponse = {
  object: 'list'
  results: NotionBlock[]
  next_cursor: string | null
  has_more: boolean
  type?: 'block'
  block?: Record<string, never>
}

export type Comment = {
  object: 'comment'
  id: string
  parent: {
    type: 'page_id' | 'block_id'
    page_id?: string
    block_id?: string
  }
  discussion_id: string
  rich_text: RichText[]
  created_time: string
  last_edited_time: string
  created_by: {
    object: 'user'
    id: string
  }
}
