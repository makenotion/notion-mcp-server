import { describe, expect, it } from "vitest"
import { trimResponse, blocksToMarkdown } from "../trim-response"

describe("trimResponse", () => {
  describe("raw format", () => {
    it("returns input unchanged", () => {
      const input = { object: "page", id: "abc", weird: "field" }
      expect(trimResponse(input, "raw")).toBe(input)
    })
  })

  describe("compact: block", () => {
    it("removes created_by, last_edited_by, parent, archived:false", () => {
      const block = {
        object: "block",
        id: "block-1",
        parent: { type: "page_id", page_id: "page-1" },
        created_time: "2026-05-25T00:00:00.000Z",
        last_edited_time: "2026-05-25T00:00:00.000Z",
        created_by: { object: "user", id: "user-1" },
        last_edited_by: { object: "user", id: "user-1" },
        has_children: false,
        archived: false,
        in_trash: false,
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: { content: "hello", link: null },
              annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
              plain_text: "hello",
              href: null,
            },
          ],
          color: "default",
        },
      }
      const result = trimResponse({ object: "list", results: [block], has_more: false, next_cursor: null }, "compact")
      expect(result).toEqual({
        object: "list",
        results: [
          {
            id: "block-1",
            type: "paragraph",
            created_time: "2026-05-25T00:00:00.000Z",
            paragraph: {
              rich_text: [{ plain_text: "hello" }],
            },
          },
        ],
      })
    })

    it("preserves bold annotation", () => {
      const block = {
        object: "block",
        id: "b",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              plain_text: "bold!",
              annotations: { bold: true, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
              href: null,
            },
          ],
        },
      }
      const result: any = trimResponse({ object: "list", results: [block] }, "compact")
      expect(result.results[0].paragraph.rich_text[0]).toEqual({
        plain_text: "bold!",
        annotations: ["bold"],
      })
    })

    it("keeps has_children when true", () => {
      const block = {
        object: "block",
        id: "b",
        type: "toggle",
        has_children: true,
        toggle: { rich_text: [{ type: "text", plain_text: "toggle me" }] },
      }
      const result: any = trimResponse({ object: "list", results: [block] }, "compact")
      expect(result.results[0].has_children).toBe(true)
    })
  })

  describe("compact: page", () => {
    it("flattens title and rich_text properties to strings", () => {
      const page = {
        object: "page",
        id: "p1",
        created_time: "2026-01-01",
        last_edited_time: "2026-01-01",
        archived: false,
        url: "https://notion.so/p1",
        created_by: { id: "u1" },
        last_edited_by: { id: "u1" },
        parent: { type: "database_id", database_id: "db1" },
        properties: {
          Name: { id: "title", type: "title", title: [{ type: "text", plain_text: "Meeting" }] },
          Date: { id: "date", type: "date", date: { start: "2026-05-25", end: null } },
          Tags: { id: "tags", type: "multi_select", multi_select: [{ id: "t1", name: "prod", color: "blue" }, { id: "t2", name: "test", color: "red" }] },
          Empty: { id: "e", type: "rich_text", rich_text: [] },
        },
      }
      const result: any = trimResponse(page, "compact")
      expect(result).toEqual({
        id: "p1",
        object: "page",
        url: "https://notion.so/p1",
        created_time: "2026-01-01",
        properties: {
          Name: "Meeting",
          Date: "2026-05-25",
          Tags: ["prod", "test"],
        },
      })
    })
  })

  describe("compact: list pagination", () => {
    it("strips next_cursor:null and has_more:false", () => {
      const result: any = trimResponse({ object: "list", results: [], has_more: false, next_cursor: null }, "compact")
      expect(result).not.toHaveProperty("has_more")
      expect(result).not.toHaveProperty("next_cursor")
    })

    it("keeps has_more:true and next_cursor", () => {
      const result: any = trimResponse({ object: "list", results: [], has_more: true, next_cursor: "cursor-1" }, "compact")
      expect(result.has_more).toBe(true)
      expect(result.next_cursor).toBe("cursor-1")
    })
  })

  describe("markdown format", () => {
    it("converts block list to markdown string", () => {
      const blocks = [
        { object: "block", id: "1", type: "heading_1", heading_1: { rich_text: [{ plain_text: "Title" }] } },
        { object: "block", id: "2", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Some text." }] } },
        { object: "block", id: "3", type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "item 1" }] } },
        { object: "block", id: "4", type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "item 2" }] } },
        { object: "block", id: "5", type: "to_do", to_do: { rich_text: [{ plain_text: "task" }], checked: true } },
      ]
      const result: any = trimResponse({ object: "list", results: blocks }, "markdown")
      expect(result.markdown).toContain("# Title")
      expect(result.markdown).toContain("Some text.")
      expect(result.markdown).toContain("- item 1")
      expect(result.markdown).toContain("- item 2")
      expect(result.markdown).toContain("- [x] task")
    })

    it("falls back to compact for non-block lists", () => {
      const pages = [{ object: "page", id: "p1", properties: {} }]
      const result: any = trimResponse({ object: "list", results: pages }, "markdown")
      expect(result.markdown).toBeUndefined()
      expect(result.results[0].id).toBe("p1")
    })

    it("preserves pagination in markdown mode", () => {
      const blocks = [{ object: "block", id: "1", type: "paragraph", paragraph: { rich_text: [{ plain_text: "hi" }] } }]
      const result: any = trimResponse({ object: "list", results: blocks, has_more: true, next_cursor: "x" }, "markdown")
      expect(result.has_more).toBe(true)
      expect(result.next_cursor).toBe("x")
    })
  })

  describe("blocksToMarkdown direct", () => {
    it("numbers numbered_list_item sequentially", () => {
      const blocks = [
        { type: "numbered_list_item", numbered_list_item: { rich_text: [{ plain_text: "first" }] } },
        { type: "numbered_list_item", numbered_list_item: { rich_text: [{ plain_text: "second" }] } },
        { type: "numbered_list_item", numbered_list_item: { rich_text: [{ plain_text: "third" }] } },
      ]
      const md = blocksToMarkdown(blocks)
      expect(md).toContain("1. first")
      expect(md).toContain("2. second")
      expect(md).toContain("3. third")
    })

    it("renders inline bold/italic/code/link", () => {
      const blocks = [
        {
          type: "paragraph",
          paragraph: {
            rich_text: [
              { plain_text: "normal " },
              { plain_text: "bold", annotations: { bold: true } },
              { plain_text: " " },
              { plain_text: "code", annotations: { code: true } },
              { plain_text: " " },
              { plain_text: "link", href: "https://example.com" },
            ],
          },
        },
      ]
      const md = blocksToMarkdown(blocks)
      expect(md).toBe("normal **bold** `code` [link](https://example.com)")
    })

    it("renders code block with language", () => {
      const blocks = [
        {
          type: "code",
          code: {
            language: "typescript",
            rich_text: [{ plain_text: "const x = 1" }],
          },
        },
      ]
      const md = blocksToMarkdown(blocks)
      expect(md).toBe("```typescript\nconst x = 1\n```")
    })

    it("renders divider", () => {
      expect(blocksToMarkdown([{ type: "divider", divider: {} }])).toBe("---")
    })
  })
})
