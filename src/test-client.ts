// A small MCP client that starts the server and exercises every feature.
// Run it with: npm test

import assert from "node:assert/strict";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Work on a temporary copy so the test never changes your real notes.
const notesDir = await mkdtemp(path.join(tmpdir(), "notes-test-"));
await cp(path.join(root, "notes"), notesDir, { recursive: true });

const client = new Client({ name: "test-client", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", path.join(root, "src", "server.ts")],
    env: { ...(process.env as Record<string, string>), NOTES_DIR: notesDir },
    cwd: root,
  }),
);

/** Call a tool and return its first text block plus the error flag. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const blocks = result.content as Array<{ type: string; text?: string }>;
  return { text: blocks[0]?.text ?? "", isError: result.isError === true };
}

let passed = 0;
async function check(label: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${label}`);
}

try {
  await check("lists four tools", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["create_note", "list_notes", "read_note", "search_notes"]);
  });

  await check("list_notes shows the sample notes", async () => {
    const r = await call("list_notes");
    assert.match(r.text, /rag-basics: RAG basics/);
  });

  await check("search_notes finds a line", async () => {
    const r = await call("search_notes", { query: "chunk size" });
    assert.match(r.text, /rag-basics \(line \d+\)/);
  });

  await check("search_notes reports no matches", async () => {
    const r = await call("search_notes", { query: "zzzznothing" });
    assert.match(r.text, /No notes mention/);
  });

  await check("read_note returns the Markdown", async () => {
    const r = await call("read_note", { name: "mcp-ideas" });
    assert.match(r.text, /^# MCP server ideas/);
  });

  await check("read_note returns an error for a missing note", async () => {
    const r = await call("read_note", { name: "does-not-exist" });
    assert.equal(r.isError, true);
  });

  await check("read_note blocks path traversal", async () => {
    const r = await call("read_note", { name: "../package" });
    assert.equal(r.isError, true);
    assert.match(r.text, /Invalid note name/);
  });

  await check("create_note saves, then refuses to overwrite", async () => {
    const first = await call("create_note", { name: "test-note", content: "# Test\n\nhello" });
    assert.equal(first.isError, false);
    const second = await call("create_note", { name: "test-note", content: "again" });
    assert.equal(second.isError, true);
    assert.match((await call("read_note", { name: "test-note" })).text, /hello/);
  });

  await check("invalid arguments are rejected", async () => {
    const r = await client.callTool({ name: "search_notes", arguments: { query: "" } }).catch((e) => ({ thrown: e }));
    assert.ok("thrown" in r || (r as { isError?: boolean }).isError === true);
  });

  await check("notes are listed and readable as resources", async () => {
    const { resources } = await client.listResources();
    assert.ok(resources.some((r) => r.uri === "notes://weekly-plan"));
    const { contents } = await client.readResource({ uri: "notes://weekly-plan" });
    const first = contents[0];
    assert.ok(first && "text" in first);
    assert.match(first.text, /Weekly plan/);
  });

  await check("summarise_note prompt includes the note", async () => {
    const { messages } = await client.getPrompt({ name: "summarise_note", arguments: { name: "weekly-plan" } });
    const content = messages[0]?.content as { type: string; text?: string };
    assert.match(content.text ?? "", /Monday/);
  });

  console.log(`\nAll ${passed} checks passed.`);
} finally {
  await client.close();
  await rm(notesDir, { recursive: true, force: true });
}
