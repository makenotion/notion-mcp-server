/**
 * Notion API レスポンスを AI トークン効率向けに整形する。
 *
 * - "compact": 冗長なメタ情報を削った JSON
 * - "markdown": block を含むレスポンスは markdown 化、それ以外は compact
 * - "raw": 加工なし (互換性維持用)
 */

export type ResponseFormat = "raw" | "compact" | "markdown"

export function getDefaultFormat(): ResponseFormat {
  const env = (process.env.NOTION_MCP_RESPONSE_FORMAT || "").toLowerCase()
  if (env === "raw" || env === "compact" || env === "markdown") return env
  return "markdown"
}

export function trimResponse(data: any, format: ResponseFormat = getDefaultFormat()): any {
  if (format === "raw") return data
  if (data === null || data === undefined) return data

  if (format === "markdown" && isBlockChildrenList(data)) {
    return {
      markdown: blocksToMarkdown(data.results),
      ...(data.has_more ? { has_more: true, next_cursor: data.next_cursor } : {}),
    }
  }

  return compactify(data)
}

function isBlockChildrenList(data: any): boolean {
  return (
    data &&
    data.object === "list" &&
    Array.isArray(data.results) &&
    data.results.length > 0 &&
    data.results[0]?.object === "block"
  )
}

function compactify(value: any): any {
  if (Array.isArray(value)) return value.map(compactify)
  if (value === null || typeof value !== "object") return value

  if (value.object === "block") return compactBlock(value)
  if (value.object === "page") return compactPage(value)
  if (value.object === "database" || value.object === "data_source") return compactDatabase(value)
  if (value.object === "user") return compactUser(value)
  if (value.object === "list") return compactList(value)

  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(value)) {
    if (v === null || v === undefined) continue
    out[k] = compactify(v)
  }
  return out
}

function compactList(list: any): any {
  const out: Record<string, any> = {
    object: "list",
    results: list.results?.map(compactify) ?? [],
  }
  if (list.has_more) {
    out.has_more = true
    if (list.next_cursor) out.next_cursor = list.next_cursor
  }
  return out
}

function compactBlock(block: any): any {
  const out: Record<string, any> = {
    id: block.id,
    type: block.type,
  }
  if (block.has_children) out.has_children = true
  if (block.created_time) out.created_time = block.created_time
  if (block.last_edited_time && block.last_edited_time !== block.created_time) {
    out.last_edited_time = block.last_edited_time
  }
  const inner = block[block.type]
  if (inner) out[block.type] = compactBlockInner(block.type, inner)
  return out
}

function compactBlockInner(type: string, inner: any): any {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(inner)) {
    if (v === null || v === undefined) continue
    if (k === "rich_text" || k === "caption") {
      const trimmed = compactRichText(v as any[])
      if (trimmed.length > 0) out[k] = trimmed
    } else if (k === "color" && v === "default") {
      // skip
    } else if (k === "is_toggleable" && v === false) {
      // skip
    } else if (k === "checked" && v === false && type === "to_do") {
      // skip default
    } else {
      out[k] = compactify(v)
    }
  }
  return out
}

function compactRichText(rich: any[]): any[] {
  if (!Array.isArray(rich)) return []
  return rich.map((r) => {
    const out: Record<string, any> = { plain_text: r.plain_text ?? "" }
    if (r.href) out.href = r.href
    if (r.annotations) {
      const a = r.annotations
      const flags: string[] = []
      if (a.bold) flags.push("bold")
      if (a.italic) flags.push("italic")
      if (a.strikethrough) flags.push("strikethrough")
      if (a.underline) flags.push("underline")
      if (a.code) flags.push("code")
      if (a.color && a.color !== "default") flags.push(`color:${a.color}`)
      if (flags.length > 0) out.annotations = flags
    }
    if (r.type && r.type !== "text") out.type = r.type
    if (r.type === "mention" && r.mention) out.mention = compactify(r.mention)
    if (r.type === "equation" && r.equation) out.equation = r.equation
    return out
  })
}

function compactPage(page: any): any {
  const out: Record<string, any> = {
    id: page.id,
    object: "page",
  }
  if (page.url) out.url = page.url
  if (page.created_time) out.created_time = page.created_time
  if (page.last_edited_time && page.last_edited_time !== page.created_time) {
    out.last_edited_time = page.last_edited_time
  }
  if (page.icon) out.icon = page.icon
  if (page.archived) out.archived = true
  if (page.properties) out.properties = compactProperties(page.properties)
  return out
}

function compactProperties(props: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [name, prop] of Object.entries(props)) {
    const v = compactProperty(prop as any)
    if (v !== undefined) out[name] = v
  }
  return out
}

function compactProperty(prop: any): any {
  if (!prop || typeof prop !== "object") return undefined
  const t = prop.type
  if (!t) return undefined
  const inner = prop[t]
  if (inner === null || inner === undefined) return undefined

  switch (t) {
    case "title":
    case "rich_text": {
      const arr = compactRichText(inner)
      if (arr.length === 0) return undefined
      return arr.map((r) => r.plain_text).join("")
    }
    case "number":
      return inner
    case "select":
      return inner?.name
    case "multi_select":
      return (inner as any[]).map((s) => s.name)
    case "status":
      return inner?.name
    case "date":
      if (!inner.start) return undefined
      return inner.end ? { start: inner.start, end: inner.end } : inner.start
    case "checkbox":
      return inner
    case "url":
    case "email":
    case "phone_number":
      return inner
    case "people":
      return (inner as any[]).map((p) => p.id)
    case "files":
      return (inner as any[]).map((f) => f.name)
    case "relation":
      return (inner as any[]).map((r) => r.id)
    case "formula":
      return inner[inner.type]
    case "rollup":
      return inner[inner.type] ?? inner
    case "created_time":
    case "last_edited_time":
      return inner
    case "created_by":
    case "last_edited_by":
      return undefined
    case "unique_id":
      return inner.prefix ? `${inner.prefix}-${inner.number}` : inner.number
    default:
      return compactify(inner)
  }
}

function compactDatabase(db: any): any {
  const out: Record<string, any> = {
    id: db.id,
    object: db.object,
  }
  if (db.title) out.title = compactRichText(db.title).map((r) => r.plain_text).join("")
  if (db.url) out.url = db.url
  if (db.properties) {
    out.properties = Object.fromEntries(
      Object.entries(db.properties).map(([k, v]: [string, any]) => [k, { id: v.id, type: v.type }])
    )
  }
  if (db.data_sources) out.data_sources = db.data_sources
  return out
}

function compactUser(user: any): any {
  const out: Record<string, any> = { id: user.id }
  if (user.name) out.name = user.name
  if (user.type) out.type = user.type
  return out
}

// ===== Block → Markdown =====

/**
 * blocks 配列を markdown 文字列に変換する。
 * options.indent を渡すと先頭にスペースを入れて、ネストされた子ブロックの表現に使える。
 * 各ブロックに `_children` (再帰取得した子配列) が含まれていれば、自動的にインデント+1で展開する。
 */
export function blocksToMarkdown(blocks: any[], options: { indent?: number } = {}): string {
  const indent = options.indent ?? 0
  const pad = "  ".repeat(indent)
  const lines: string[] = []
  let listCounter = 0

  for (const block of blocks) {
    if (block.type !== "numbered_list_item") listCounter = 0
    const md = blockToMarkdown(block, listCounter)
    if (block.type === "numbered_list_item") listCounter += 1
    if (md !== null) {
      lines.push(pad + md.replace(/\n/g, "\n" + pad))
    }
    const children = block._children || block.children
    if (Array.isArray(children) && children.length > 0) {
      const childMd = blocksToMarkdown(children, { indent: indent + 1 })
      if (childMd) lines.push(childMd)
    }
  }
  return lines.join("\n\n").replace(/\n{3,}/g, "\n\n").trim()
}

function blockToMarkdown(block: any, listIndex: number): string | null {
  const type = block.type
  const inner = block[type]
  const rt = (key = "rich_text") => richTextToMarkdown(inner?.[key] ?? [])

  switch (type) {
    case "heading_1":
      return `# ${rt()}`
    case "heading_2":
      return `## ${rt()}`
    case "heading_3":
      return `### ${rt()}`
    case "paragraph": {
      const text = rt()
      return text || ""
    }
    case "bulleted_list_item":
      return `- ${rt()}`
    case "numbered_list_item":
      return `${listIndex + 1}. ${rt()}`
    case "to_do":
      return `- [${inner?.checked ? "x" : " "}] ${rt()}`
    case "toggle":
      return `> ${rt()}`
    case "quote":
      return `> ${rt()}`
    case "callout":
      return `> ${rt()}`
    case "code": {
      const lang = inner?.language || ""
      return `\`\`\`${lang}\n${rt()}\n\`\`\``
    }
    case "divider":
      return `---`
    case "image":
    case "file":
    case "video":
    case "audio":
    case "pdf": {
      const url = inner?.file?.url || inner?.external?.url
      const caption = richTextToMarkdown(inner?.caption ?? [])
      if (!url) return caption || null
      return type === "image" ? `![${caption}](${url})` : `[${caption || type}](${url})`
    }
    case "bookmark":
    case "embed":
    case "link_preview": {
      const url = inner?.url
      if (!url) return null
      return `[${url}](${url})`
    }
    case "equation":
      return `$$${inner?.expression || ""}$$`
    case "table_of_contents":
      return null
    case "child_page":
      return `**[child_page]** ${inner?.title || ""}`
    case "child_database":
      return `**[child_database]** ${inner?.title || ""}`
    case "synced_block":
      return null
    case "column_list":
    case "column":
      return null
    case "table":
      return null
    case "table_row": {
      const cells = (inner?.cells || []).map((c: any[]) => richTextToMarkdown(c))
      return `| ${cells.join(" | ")} |`
    }
    case "breadcrumb":
      return null
    case "link_to_page":
      return `[link_to_page]`
    case "unsupported":
      return null
    default:
      return rt() || null
  }
}

function richTextToMarkdown(rich: any[]): string {
  if (!Array.isArray(rich)) return ""
  return rich
    .map((r) => {
      let text = r.plain_text ?? ""
      const a = r.annotations || {}
      if (a.code) text = `\`${text}\``
      if (a.bold) text = `**${text}**`
      if (a.italic) text = `*${text}*`
      if (a.strikethrough) text = `~~${text}~~`
      const href = r.href || r.text?.link?.url
      if (href) text = `[${text}](${href})`
      return text
    })
    .join("")
}
