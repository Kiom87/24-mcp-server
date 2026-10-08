# 24: Notes MCP server

An MCP (Model Context Protocol) server, written in TypeScript, that lets an AI
assistant search, read and add to a folder of Markdown notes.

## What it does

| Kind | Name | What it does |
|---|---|---|
| Tool | `list_notes` | Lists every note with its title and modified date |
| Tool | `search_notes` | Finds lines containing every word of a query |
| Tool | `read_note` | Returns the full text of one note |
| Tool | `create_note` | Saves a new note (never overwrites) |
| Resource | `notes://{name}` | Each note, attachable as context |
| Prompt | `summarise_note` | Summarises a note as key points and next actions |

## How to run it

You need Node.js 20 or newer.

```bash
npm install
npm test          # starts the server and runs 11 checks against it
npm run build     # compiles TypeScript to dist/
npm run inspect   # opens the MCP Inspector, a web UI for trying each tool by hand
```

The server reads notes from the `notes/` folder. To point it at your own
folder, set the `NOTES_DIR` environment variable.

## Connect it to an assistant

Build first (`npm run build`), then register the server using the full path
to `dist/server.js`.

**Claude Desktop:** open Settings, then Developer, then Edit Config, and add:

```json
{
  "mcpServers": {
    "notes": {
      "command": "node",
      "args": ["/full/path/to/24-mcp-server/dist/server.js"],
      "env": { "NOTES_DIR": "/full/path/to/your/notes" }
    }
  }
}
```

Restart Claude Desktop, then ask "What notes do I have about RAG?".

**Claude Code:**

```bash
claude mcp add notes -- node /full/path/to/24-mcp-server/dist/server.js
```

## How the code is organised

- `src/notes.ts` is the data layer. It is the only file that touches the disk.
- `src/server.ts` defines the tools, resource and prompt, and starts the server.
- `src/test-client.ts` is an MCP client that tests the server end to end.

## What I learned

- Tools are actions the model chooses to call, resources are data a user
  attaches, and prompts are templates a user picks.
- Tool descriptions and parameter descriptions are written for the model.
  They decide whether the tool gets called correctly.
- With the stdio transport, stdout belongs to the protocol. Log with
  `console.error`, never `console.log`.
- The model picks the arguments, so validate them. `notes.ts` rejects names
  like `../secrets` that would escape the notes folder.
- Return failures with `isError: true` so the model can read the message and
  retry, instead of throwing.

## Make it your own

The project brief is "expose one of your own data sources". Once this works,
swap `src/notes.ts` for something of yours and keep `server.ts` nearly as is:

1. Add an `append_to_note` tool and a test for it.
2. Replace keyword search with embeddings, reusing project 21.
3. Point the data layer at a real source: a SQLite database, a spreadsheet,
   or a web API you use.
4. Add an HTTP transport so the server can run remotely.
