import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  getCustomToolDefinitions,
  isCustomTool,
  handleGetPageContentMarkdown,
  handleQueryMeetingsSummary,
} from "../custom-tools"

function makeHttpClient(responder: (method: string, path: string, opts: any) => any) {
  return {
    callRaw: vi.fn(async (method: string, path: string, opts: any) => ({
      data: responder(method, path, opts),
      status: 200,
      headers: {},
    })),
  } as any
}

describe("custom-tools definitions", () => {
  it("isCustomTool returns true for registered names", () => {
    expect(isCustomTool("get-page-content-markdown")).toBe(true)
    expect(isCustomTool("query-meetings-summary")).toBe(true)
    expect(isCustomTool("get-block-children")).toBe(false)
  })

  it("getCustomToolDefinitions returns 2 tools with inputSchema", () => {
    const defs = getCustomToolDefinitions()
    expect(defs.length).toBe(2)
    expect(defs[0].name).toBe("get-page-content-markdown")
    expect(defs[1].name).toBe("query-meetings-summary")
    expect(defs[0].inputSchema.properties).toHaveProperty("page_id")
    expect(defs[1].inputSchema.properties).toHaveProperty("data_source_id")
  })
})

describe("handleGetPageContentMarkdown", () => {
  it("fetches root blocks and converts to markdown", async () => {
    const httpClient = makeHttpClient((_m, path) => {
      if (path === "/blocks/root/children") {
        return {
          object: "list",
          results: [
            { id: "b1", type: "heading_1", heading_1: { rich_text: [{ plain_text: "Title" }] }, has_children: false },
            { id: "b2", type: "paragraph", paragraph: { rich_text: [{ plain_text: "body" }] }, has_children: false },
          ],
          has_more: false,
        }
      }
      throw new Error(`unexpected path ${path}`)
    })

    const result = await handleGetPageContentMarkdown(httpClient, { page_id: "root" })
    expect(result.markdown).toContain("# Title")
    expect(result.markdown).toContain("body")
    expect(result.block_count).toBe(2)
    expect(result.truncated).toBe(false)
  })

  it("recursively fetches has_children blocks up to max_depth", async () => {
    const httpClient = makeHttpClient((_m, path) => {
      if (path === "/blocks/root/children") {
        return {
          object: "list",
          results: [
            {
              id: "b1",
              type: "bulleted_list_item",
              bulleted_list_item: { rich_text: [{ plain_text: "parent" }] },
              has_children: true,
            },
          ],
          has_more: false,
        }
      }
      if (path === "/blocks/b1/children") {
        return {
          object: "list",
          results: [
            {
              id: "b1c1",
              type: "bulleted_list_item",
              bulleted_list_item: { rich_text: [{ plain_text: "child" }] },
              has_children: false,
            },
          ],
          has_more: false,
        }
      }
      return { results: [] }
    })

    const result = await handleGetPageContentMarkdown(httpClient, { page_id: "root", max_depth: 3 })
    expect(result.markdown).toContain("- parent")
    expect(result.markdown).toContain("- child")
    expect(result.markdown.indexOf("- child")).toBeGreaterThan(result.markdown.indexOf("- parent"))
    expect(result.block_count).toBe(2)
  })

  it("stops recursion at max_depth", async () => {
    const httpClient = makeHttpClient((_m, path) => {
      if (path === "/blocks/root/children") {
        return {
          object: "list",
          results: [{ id: "b1", type: "paragraph", paragraph: { rich_text: [{ plain_text: "p" }] }, has_children: true }],
          has_more: false,
        }
      }
      throw new Error(`should not fetch ${path} at depth 1`)
    })
    const result = await handleGetPageContentMarkdown(httpClient, { page_id: "root", max_depth: 1 })
    expect(result.block_count).toBe(1)
  })

  it("respects max_blocks safety cap", async () => {
    const httpClient = makeHttpClient((_m, path) => ({
      object: "list",
      results: Array.from({ length: 10 }, (_, i) => ({
        id: `b${i}`,
        type: "paragraph",
        paragraph: { rich_text: [{ plain_text: `text ${i}` }] },
        has_children: false,
      })),
      has_more: false,
    }))
    const result = await handleGetPageContentMarkdown(httpClient, {
      page_id: "root",
      max_blocks: 3,
    })
    expect(result.truncated).toBe(true)
    expect(result.block_count).toBe(3)
  })

  it("follows pagination with start_cursor", async () => {
    let firstCall = true
    const httpClient = makeHttpClient((_m, path, opts) => {
      if (path !== "/blocks/root/children") return { results: [] }
      if (firstCall) {
        firstCall = false
        return {
          object: "list",
          results: [{ id: "b1", type: "paragraph", paragraph: { rich_text: [{ plain_text: "p1" }] }, has_children: false }],
          has_more: true,
          next_cursor: "cur-2",
        }
      }
      expect(opts.query?.start_cursor).toBe("cur-2")
      return {
        object: "list",
        results: [{ id: "b2", type: "paragraph", paragraph: { rich_text: [{ plain_text: "p2" }] }, has_children: false }],
        has_more: false,
      }
    })
    const result = await handleGetPageContentMarkdown(httpClient, { page_id: "root" })
    expect(result.markdown).toContain("p1")
    expect(result.markdown).toContain("p2")
    expect(result.block_count).toBe(2)
  })
})

describe("handleQueryMeetingsSummary", () => {
  beforeEach(() => {
    delete process.env.NOTION_MEETINGS_DATA_SOURCE_ID
  })

  it("throws when data_source_id is missing", async () => {
    const httpClient = makeHttpClient(() => ({}))
    await expect(handleQueryMeetingsSummary(httpClient, {})).rejects.toThrow(/data_source_id/)
  })

  it("uses env var as fallback", async () => {
    process.env.NOTION_MEETINGS_DATA_SOURCE_ID = "ds-env"
    const httpClient = makeHttpClient((_m, path) => {
      expect(path).toBe("/data_sources/ds-env/query")
      return { object: "list", results: [] }
    })
    await handleQueryMeetingsSummary(httpClient, {})
  })

  it("filters properties by whitelist", async () => {
    const httpClient = makeHttpClient(() => ({
      object: "list",
      results: [
        {
          id: "p1",
          properties: {
            "TL;DR": { id: "x", type: "rich_text", rich_text: [{ plain_text: "summary" }] },
            Date: { id: "d", type: "date", date: { start: "2026-05-25" } },
            "Internal Notes": { id: "z", type: "rich_text", rich_text: [{ plain_text: "should-be-removed" }] },
          },
        },
      ],
    }))
    const result = await handleQueryMeetingsSummary(httpClient, { data_source_id: "ds-1" })
    const props = result.results[0].properties
    expect(props).toHaveProperty("TL;DR")
    expect(props).toHaveProperty("Date")
    expect(props).not.toHaveProperty("Internal Notes")
  })

  it("forwards filter, sorts, page_size to API body", async () => {
    let capturedBody: any
    const httpClient = makeHttpClient((_m, _p, opts) => {
      capturedBody = opts.body
      return { object: "list", results: [] }
    })
    await handleQueryMeetingsSummary(httpClient, {
      data_source_id: "ds-1",
      filter: { property: "Status", select: { equals: "draft" } },
      sorts: [{ property: "Date", direction: "descending" }],
      page_size: 5,
    })
    expect(capturedBody.filter).toBeDefined()
    expect(capturedBody.sorts).toBeDefined()
    expect(capturedBody.page_size).toBe(5)
  })
})
