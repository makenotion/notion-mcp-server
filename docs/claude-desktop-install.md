# Installing the Notion MCP Server in Claude Desktop

This guide walks you through setting up the Notion MCP Server as a local custom MCP in Claude Desktop.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [Git](https://git-scm.com/)
- [Claude Desktop](https://claude.ai/download) installed on your machine

---

## Step 1: Create a Notion Integration and Get Your API Key

1. Go to [https://www.notion.so/profile/integrations](https://www.notion.so/profile/integrations).
2. Click **New integration**.
3. Give it a name (e.g. "Claude MCP") and select the workspace you want it to access.
4. Click **Submit**.
5. On the integration's **Configuration** tab, copy the **Internal Integration Secret** — it starts with `ntn_`.

> **Tip:** You can limit the integration to read-only access under **Capabilities** if you only need Claude to read your Notion content.

### Grant the Integration Access to Your Pages

Your integration can only see pages it has been explicitly granted access to.

**Option A — Bulk access from the integration settings:**

Go to the **Access** tab in your integration settings, click **Edit access**, and select the pages you want to share.

**Option B — Per-page access:**

Open a Notion page, click the **···** menu in the top right, select **Connect to**, and choose your integration.

---

## Step 2: Download and Build the Server

Clone the repository and build it:

```bash
git clone https://github.com/zhawken/notion-mcp-server.git
cd notion-mcp-server
npm install
npm run build
```

Note the full path to the repository — you'll need it in the next step. You can get it by running:

```bash
pwd
```

It will print something like `/Users/yourname/notion-mcp-server`.

---

## Step 3: Configure Claude Desktop

1. Open **Claude Desktop**.
2. Go to **Settings** (gear icon or `Cmd + ,` on macOS).
3. Click **Developer** in the sidebar.
4. Click **Edit Config** to open the local MCP servers configuration file.

This opens `claude_desktop_config.json` in your editor. Add the following to the file, replacing the two placeholder values:

```json
{
  "mcpServers": {
    "notionApi": {
      "command": "node",
      "args": [
        "/FULL/PATH/TO/notion-mcp-server/bin/cli.mjs"
      ],
      "env": {
        "NOTION_TOKEN": "ntn_YOUR_TOKEN_HERE"
      }
    }
  }
}
```

Replace:
- `/FULL/PATH/TO/notion-mcp-server` with the actual path from Step 2 (the output of `pwd`).
- `ntn_YOUR_TOKEN_HERE` with your Notion integration secret from Step 1.

**Example with real values:**

```json
{
  "mcpServers": {
    "notionApi": {
      "command": "node",
      "args": [
        "/Users/zane/dev/notion-mcp-server/bin/cli.mjs"
      ],
      "env": {
        "NOTION_TOKEN": "ntn_abc123def456"
      }
    }
  }
}
```

> **Note:** If the file already has other MCP servers configured, merge the `notionApi` entry into the existing `mcpServers` object rather than replacing the whole file.

---

## Step 4: Restart Claude Desktop

Quit Claude Desktop completely and reopen it. The Notion MCP server will start automatically when Claude Desktop launches.

You should see a hammer (tools) icon in the chat input area. Click it to confirm the Notion tools are loaded — you should see tools like `search`, `retrieve-a-page`, `query-data-source`, and others.

---

## Troubleshooting

**Tools don't appear after restart:**
- Double-check that the path in `args` points to the actual `bin/cli.mjs` file. Run `ls /FULL/PATH/TO/notion-mcp-server/bin/cli.mjs` to verify it exists.
- Make sure `npm run build` completed without errors.
- Check the Claude Desktop logs for error messages.

**"Unauthorized" or "Invalid token" errors:**
- Verify your `NOTION_TOKEN` value is correct and starts with `ntn_`.
- Make sure you haven't accidentally included extra spaces or quotes around the token.

**"Could not find page" or empty results:**
- Ensure the pages you want to access are connected to your integration (see Step 1).

**JSON syntax errors in config:**
- Validate your `claude_desktop_config.json` is valid JSON. A common mistake is a missing comma between server entries.
