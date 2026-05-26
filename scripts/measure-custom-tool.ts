/**
 * 本物の Notion API で get-page-content-markdown の効果を実測する。
 * - 「従来の get-block-children + 手動再帰」
 * - 「新規 get-page-content-markdown 一発呼び出し」
 * のトークン消費を比較する。
 */
import { readFileSync } from "fs"
import { HttpClient } from "../src/openapi-mcp-server/client/http-client"
import { handleGetPageContentMarkdown, handleQueryMeetingsSummary } from "../src/openapi-mcp-server/mcp/custom-tools"
import { trimResponse } from "../src/openapi-mcp-server/mcp/trim-response"

function loadEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.+)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  return env
}

function bytes(v: any): number {
  return Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v), "utf8")
}

async function main() {
  const env = loadEnv(process.env.NOTION_ENV_PATH || ".env")
  const KEY = env.NOTION_API_KEY
  const VER = env.NOTION_VERSION || "2025-09-03"
  const DB_ID = env.NOTION_DATABASE_ID

  // HttpClient を OpenAPI spec なしで使えないので最小 spec を渡す
  const minimalSpec: any = {
    openapi: "3.0.0",
    info: { title: "n", version: "1" },
    paths: {},
    servers: [{ url: "https://api.notion.com/v1" }],
  }
  const http = new HttpClient(
    {
      baseUrl: "https://api.notion.com/v1",
      headers: { Authorization: `Bearer ${KEY}`, "Notion-Version": VER },
    },
    minimalSpec
  )

  // 議事録 1 件のページ ID を取得
  const db = await http.callRaw<any>("GET", `/databases/${DB_ID}`)
  const dsId = db.data.data_sources?.[0]?.id
  const q = await http.callRaw<any>("POST", `/data_sources/${dsId}/query`, { body: { page_size: 1 } })
  const pageId = q.data.results[0].id
  console.log(`target page_id = ${pageId}`)
  console.log(`title = ${q.data.results[0].properties?.["名前"]?.title?.[0]?.plain_text || "(no title)"}`)

  // ---- A. get-page-content-markdown 単発 ----
  console.log(`\n[A] get-page-content-markdown`)
  const t1 = Date.now()
  const a = await handleGetPageContentMarkdown(http, { page_id: pageId, max_depth: 3 })
  const elapsedA = Date.now() - t1
  const aBytes = bytes(a)
  console.log(`  block_count = ${a.block_count}, truncated = ${a.truncated}, elapsed = ${elapsedA}ms`)
  console.log(`  output bytes = ${aBytes.toLocaleString()} B`)
  console.log(`\n  ↓ markdown preview (先頭 600 文字):`)
  console.log(a.markdown.substring(0, 600).split("\n").map((l) => "    " + l).join("\n"))

  // ---- B. 比較: 同じページの get-block-children 単発 (raw) ----
  console.log(`\n[B] 比較: 標準 get-block-children (raw, 再帰なし)`)
  const bRaw = await http.callRaw<any>("GET", `/blocks/${pageId}/children`, { query: { page_size: 100 } })
  const bRawBytes = bytes(bRaw.data)
  console.log(`  raw output bytes = ${bRawBytes.toLocaleString()} B`)
  console.log(`  → 削減率 (A vs B raw): ${((100 * aBytes) / bRawBytes).toFixed(1)}%`)

  // ---- C. query-meetings-summary 動作確認 ----
  console.log(`\n[C] query-meetings-summary (page_size: 5)`)
  const c = await handleQueryMeetingsSummary(http, {
    data_source_id: dsId,
    page_size: 5,
    sorts: [{ property: "Date", direction: "descending" }],
  })
  const cTrim = trimResponse(c, "compact")
  console.log(`  compact bytes = ${bytes(cTrim).toLocaleString()} B`)
  console.log(`  results count = ${cTrim.results?.length}`)
  console.log(`\n  ↓ 1件目の compact プロパティ:`)
  console.log("    " + JSON.stringify(cTrim.results?.[0], null, 2).split("\n").join("\n    ").substring(0, 1000))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
