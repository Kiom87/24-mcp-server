#!/usr/bin/env node
// An MCP server that exposes a folder of Markdown notes to AI assistants.
//
// MCP has three building blocks, and this server uses all of them:
//   - Tools:     actions the assistant can take (search, read, create).
//   - Resources: data the assistant or user can attach as context (each note).
//   - Prompts:   reusable prompt templates the user can pick (summarise a note).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { NotesStore } from "./notes.js";

// Where the notes live: NOTES_DIR if set, otherwise the notes folder beside this project.
const here = path.dirname(fileURLToPath(import.meta.url));
const store = new NotesStore(process.env.NOTES_DIR ?? path.join(here, "..", "notes"));

const server = new McpServer({ name: "notes", version: "1.0.0" });

/** Tool results are a list of content blocks. This wraps plain text in one. */
const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

/** Returning isError lets the assistant see what went wrong and try again. */
const failure = (err: unknown) => ({
  ...text(err instanceof Error ? err.message : String(err)),
  isError: true,
});

// ---------- Tools ----------
// The description is what the model reads to decide when to call a tool,
// so write it for the model: say what it does and when to use it.

server.registerTool(
  "list_notes",
  {
    title: "List notes",
    description: "List every note with its name, title and last modified date.",
    annotations: { readOnlyHint: true },
  },
  async () => {
    const notes = await store.list();
    if (notes.length === 0) return text("There are no notes yet.");
    return text(notes.map((n) => `${n.name}: ${n.title} (modified ${n.modified.slice(0, 10)})`).join("\n"));
  },
);

server.registerTool(
  "search_notes",
  {
    title: "Search notes",
    description:
      "Find lines in the notes that contain every word of the query. Use this to locate a note before reading it.",
    inputSchema: {
      query: z.string().min(1).describe("Words to look for, for example 'chunk size'"),
      limit: z.number().int().min(1).max(50).default(10).describe("Maximum number of matches"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, limit }) => {
    const hits = await store.search(query, limit);
    if (hits.length === 0) return text(`No notes mention "${query}".`);
    return text(hits.map((h) => `${h.name} (line ${h.line}): ${h.snippet}`).join("\n"));
  },
);

server.registerTool(
  "read_note",
  {
    title: "Read a note",
    description: "Return the full Markdown text of one note, given its name from list_notes or search_notes.",
    inputSchema: { name: z.string().describe("Note name without .md, for example 'rag-basics'") },
    annotations: { readOnlyHint: true },
  },
  async ({ name }) => {
    try {
      return text(await store.read(name));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "create_note",
  {
    title: "Create a note",
    description: "Save a new Markdown note. Fails if a note with that name already exists.",
    inputSchema: {
      name: z.string().describe("Short name using letters, numbers and hyphens, for example 'meeting-2026-10-09'"),
      content: z.string().min(1).describe("The note body in Markdown"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ name, content }) => {
    try {
      const saved = await store.create(name, content);
      // Tell connected clients the list of resources has changed.
      server.sendResourceListChanged();
      return text(`Saved note "${saved}".`);
    } catch (err) {
      return failure(err);
    }
  },
);

// ---------- Resources ----------
// Every note is also readable at notes://<name>, so a user can attach one
// to a conversation without the model having to call a tool.

server.registerResource(
  "note",
  new ResourceTemplate("notes://{name}", {
    list: async () => ({
      resources: (await store.list()).map((n) => ({
        uri: `notes://${n.name}`,
        name: n.name,
        title: n.title,
        mimeType: "text/markdown",
      })),
    }),
  }),
  { title: "Note", description: "A Markdown note", mimeType: "text/markdown" },
  async (uri, { name }) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: await store.read(String(name)) }],
  }),
);

// ---------- Prompts ----------

server.registerPrompt(
  "summarise_note",
  {
    title: "Summarise a note",
    description: "Summarise one note as key points and next actions.",
    argsSchema: { name: z.string().describe("Note name, for example 'weekly-plan'") },
  },
  async ({ name }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Summarise this note in three key points, then list any next actions.\n\n${await store.read(name)}`,
        },
      },
    ],
  }),
);

// ---------- Start ----------
// stdio transport: the client starts this program and talks to it over
// stdin/stdout. That means stdout is reserved for the protocol, so all
// logging must go to stderr (console.error), never console.log.

await server.connect(new StdioServerTransport());
console.error(`Notes MCP server running. Notes folder: ${store.dir}`);
