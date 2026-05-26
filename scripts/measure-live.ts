/**
 * 本物の Notion API を叩いて trim-response.ts の動作を実測する。
 *
 * 実行: NOTION_ENV_PATH=.env npx tsx scripts/measure-live.ts
 * .env には NOTION_API_KEY / NOTION_DATABASE_ID / NOTION_VERSION を定義。
 */
import { readFileSync } from "fs"
import { trimResponse } from "../src/openapi-mcp-server/mcp/trim-response"

const envPath = process.env.NOTION_ENV_PATH || ".env"

function loadEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.+)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  return env
}

function bytes(v: any): number {
  return Buffer.byteLength(JSON.stringify(v), "utf8")
}

function pct(after: number, before: number): string {
  return `${((100 * after) / before).toFixed(1)}%`
}

async function main() {
  const env = loadEnv(envPath)
  const KEY = env.NOTION_API_KEY
  const VER = env.NOTION_VERSION || "2025-09-03"
  const DB_ID = env.NOTION_DATABASE_ID
  if (!KEY || !DB_ID) throw new Error("NOTION_API_KEY / NOTION_DATABASE_ID missing")

  const headers = {
    Authorization: `Bearer ${KEY}`,
    "Notion-Version": VER,
    "Content-Type": "application/json",
  }

  // ---- 1. database メタ取得 → data_source_id を抜く ----
  console.log("[1] retrieve-a-database")
  const dbRes = await fetch(`https://api.notion.com/v1/databases/${DB_ID}`, { headers })
  if (!dbRes.ok) throw new Error(`db fetch failed: ${dbRes.status} ${await dbRes.text()}`)
  const db = (await dbRes.json()) as any
  const dsId = db.data_sources?.[0]?.id
  console.log(`  data_source_id = ${dsId}`)
  console.log(`  raw     = ${bytes(db).toLocaleString()} B`)
  console.log(`  compact = ${bytes(trimResponse(db, "compact")).toLocaleString()} B (${pct(bytes(trimResponse(db, "compact")), bytes(db))})`)

  // ---- 2. data_source を query (3件だけ) ----
  console.log("\n[2] query-data-source (page_size: 3)")
  const qRes = await fetch(`https://api.notion.com/v1/data_sources/${dsId}/query`, {
    method: "POST",
    headers,
    body: JSON.stringify({ page_size: 3 }),
  })
  if (!qRes.ok) throw new Error(`query failed: ${qRes.status} ${await qRes.text()}`)
  const q = (await qRes.json()) as any
  const qRaw = bytes(q)
  const qCompact = bytes(trimResponse(q, "compact"))
  console.log(`  raw     = ${qRaw.toLocaleString()} B`)
  console.log(`  compact = ${qCompact.toLocaleString()} B (${pct(qCompact, qRaw)})`)
  console.log(`  ↓ compact 例 (1件目):`)
  const firstPage = trimResponse(q, "compact").results[0]
  console.log("    " + JSON.stringify(firstPage, null, 2).split("\n").join("\n    "))

  // ---- 3. block-children を取得 (議事録1件分の本文) ----
  const firstPageId = q.results[0]?.id
  if (!firstPageId) throw new Error("no page found")
  console.log(`\n[3] get-block-children (page_id=${firstPageId}, page_size: 20)`)
  const bRes = await fetch(`https://api.notion.com/v1/blocks/${firstPageId}/children?page_size=20`, { headers })
  if (!bRes.ok) throw new Error(`blocks failed: ${bRes.status} ${await bRes.text()}`)
  const b = (await bRes.json()) as any
  const bRaw = bytes(b)
  const bCompact = bytes(trimResponse(b, "compact"))
  const bMd = bytes(trimResponse(b, "markdown"))
  console.log(`  raw       = ${bRaw.toLocaleString()} B`)
  console.log(`  compact   = ${bCompact.toLocaleString()} B (${pct(bCompact, bRaw)})`)
  console.log(`  markdown  = ${bMd.toLocaleString()} B (${pct(bMd, bRaw)})`)

  const mdOut = trimResponse(b, "markdown")
  console.log(`\n  ↓ markdown 出力 (先頭 1200 文字):\n`)
  console.log(String(mdOut.markdown).substring(0, 1200).split("\n").map((l) => "    " + l).join("\n"))

  // ---- 4. 議事録1件の compact 詳細 ----
  console.log(`\n[4] retrieve-a-page (議事録1件のプロパティ確認)`)
  const pRes = await fetch(`https://api.notion.com/v1/pages/${firstPageId}`, { headers })
  if (!pRes.ok) throw new Error(`page failed: ${pRes.status}`)
  const p = (await pRes.json()) as any
  const pRaw = bytes(p)
  const pCompact = bytes(trimResponse(p, "compact"))
  console.log(`  raw     = ${pRaw.toLocaleString()} B`)
  console.log(`  compact = ${pCompact.toLocaleString()} B (${pct(pCompact, pRaw)})`)
  console.log(`  ↓ compact:`)
  console.log("    " + JSON.stringify(trimResponse(p, "compact"), null, 2).split("\n").join("\n    "))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
