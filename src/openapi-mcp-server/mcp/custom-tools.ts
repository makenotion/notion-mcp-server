/**
 * OpenAPI spec 外で独自に追加する MCP ツール。
 *
 * - get-page-content-markdown:  ページ本文を再帰取得して markdown 1本にまとめる
 * - query-meetings-summary:     議事録 DB に特化した query-data-source ラッパー
 */
import { Tool } from "@modelcontextprotocol/sdk/types.js"
import { HttpClient } from "../client/http-client"
import { blocksToMarkdown } from "./trim-response"

export const CUSTOM_TOOL_NAMES = ["get-page-content-markdown", "query-meetings-summary"] as const
export type CustomToolName = (typeof CUSTOM_TOOL_NAMES)[number]

export function isCustomTool(name: string): name is CustomToolName {
  return (CUSTOM_TOOL_NAMES as readonly string[]).includes(name)
}

export function getCustomToolDefinitions(): Tool[] {
  return [
    {
      name: "get-page-content-markdown",
      description:
        "Notion のページ本文を再帰的に取得し、markdown 1 本にまとめて返す。 " +
        "OpenAPI 生成の get-block-children を内部で多段呼び出しし、子ブロックも展開するため、 " +
        "ページの「読みやすい全文」が一発で得られる。 トークン消費は raw 比で ~80% 削減。",
      inputSchema: {
        type: "object",
        properties: {
          page_id: {
            type: "string",
            description: "Notion ページ (またはブロック) の ID。ハイフンあり/なしどちらでも可。",
          },
          max_depth: {
            type: "number",
            description: "子ブロックを辿る最大深さ。既定 3。1 だとトップレベルのみ。",
            default: 3,
          },
          max_blocks: {
            type: "number",
            description: "取得するブロックの上限 (安全弁)。 既定 500。超えた場合 truncated:true を返す。",
            default: 500,
          },
        },
        required: ["page_id"],
      },
    },
    {
      name: "query-meetings-summary",
      description:
        "議事録 (Meetings) データソースを TL;DR と日付・タグ列だけに絞ってクエリするラッパー。 " +
        "白リスト指定済みなので、汎用 query-data-source より体感 3〜5 倍トークン効率が良い。 " +
        "data_source_id は環境変数 NOTION_MEETINGS_DATA_SOURCE_ID または引数で指定。",
      inputSchema: {
        type: "object",
        properties: {
          data_source_id: {
            type: "string",
            description:
              "議事録データソース ID。省略時は環境変数 NOTION_MEETINGS_DATA_SOURCE_ID を使用。",
          },
          filter: {
            type: "object",
            description: "Notion API 標準の filter オブジェクト (任意)。",
          },
          sorts: {
            type: "array",
            description: "Notion API 標準の sorts 配列 (任意)。",
          },
          page_size: {
            type: "number",
            description: "取得件数 (既定 10、最大 100)。第1段階のしぼり込みは 10 推奨。",
            default: 10,
          },
          start_cursor: {
            type: "string",
            description: "ページネーション用カーソル。",
          },
        },
      },
    },
  ]
}

// ====== get-page-content-markdown ======

interface GetPageContentParams {
  page_id: string
  max_depth?: number
  max_blocks?: number
}

export async function handleGetPageContentMarkdown(
  httpClient: HttpClient,
  params: GetPageContentParams
): Promise<{ markdown: string; block_count: number; truncated: boolean }> {
  const maxDepth = params.max_depth ?? 3
  const maxBlocks = params.max_blocks ?? 500
  const counter = { count: 0, truncated: false }

  const blocks = await fetchChildrenRecursive(httpClient, params.page_id, 0, maxDepth, maxBlocks, counter)
  const markdown = blocksToMarkdown(blocks)

  return {
    markdown,
    block_count: counter.count,
    truncated: counter.truncated,
  }
}

async function fetchChildrenRecursive(
  httpClient: HttpClient,
  blockId: string,
  depth: number,
  maxDepth: number,
  maxBlocks: number,
  counter: { count: number; truncated: boolean }
): Promise<any[]> {
  if (depth >= maxDepth) return []
  if (counter.count >= maxBlocks) {
    counter.truncated = true
    return []
  }

  const all: any[] = []
  let cursor: string | undefined
  do {
    if (counter.count >= maxBlocks) {
      counter.truncated = true
      break
    }
    const query: Record<string, any> = { page_size: 100 }
    if (cursor) query.start_cursor = cursor
    const res = await httpClient.callRaw<any>("GET", `/blocks/${blockId}/children`, { query })
    const results: any[] = res.data?.results || []
    for (const block of results) {
      if (counter.count >= maxBlocks) {
        counter.truncated = true
        break
      }
      counter.count += 1
      all.push(block)
    }
    cursor = res.data?.has_more ? res.data?.next_cursor : undefined
  } while (cursor)

  // 子持ちブロックは再帰展開
  for (const block of all) {
    if (block.has_children) {
      block._children = await fetchChildrenRecursive(
        httpClient,
        block.id,
        depth + 1,
        maxDepth,
        maxBlocks,
        counter
      )
    }
  }
  return all
}

// ====== query-meetings-summary ======

interface QueryMeetingsParams {
  data_source_id?: string
  filter?: any
  sorts?: any[]
  page_size?: number
  start_cursor?: string
}

/**
 * 議事録の白リスト用プロパティ ID
 * skill の references/properties_catalog.md と合わせる
 *
 * 注: プロパティ ID は環境により変わる可能性があるので、外部設定を上書きできるよう env も見る。
 */
const DEFAULT_MEETING_PROPERTY_WHITELIST = [
  "title", // Name
  "Date",
  "Type",
  "Status",
  "Participants",
  "Topics",
  "Keywords",
  "TL;DR",
  "Meeting ID",
  "Decision Count",
  "Action Item Count",
  "Has Unresolved",
  "Unresolved Count",
  "Duration (min)",
]

export async function handleQueryMeetingsSummary(
  httpClient: HttpClient,
  params: QueryMeetingsParams
): Promise<any> {
  const dataSourceId = params.data_source_id || process.env.NOTION_MEETINGS_DATA_SOURCE_ID
  if (!dataSourceId) {
    throw new Error(
      "data_source_id is required (or set NOTION_MEETINGS_DATA_SOURCE_ID env var)"
    )
  }

  const body: Record<string, any> = {
    page_size: params.page_size ?? 10,
  }
  if (params.filter) body.filter = params.filter
  if (params.sorts) body.sorts = params.sorts
  if (params.start_cursor) body.start_cursor = params.start_cursor

  const res = await httpClient.callRaw<any>("POST", `/data_sources/${dataSourceId}/query`, { body })

  // 結果を白リストでフィルタした上で、trim を全部通す
  const data = res.data
  if (data?.results) {
    data.results = data.results.map((page: any) => {
      if (!page.properties) return page
      const filtered: Record<string, any> = {}
      for (const key of DEFAULT_MEETING_PROPERTY_WHITELIST) {
        if (page.properties[key] !== undefined) filtered[key] = page.properties[key]
      }
      return { ...page, properties: filtered }
    })
  }
  return data
}
