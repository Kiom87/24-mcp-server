// The data layer: everything that touches the notes folder lives here.
// The MCP server in server.ts only calls these functions, so you can swap
// this file for a database, an API or a spreadsheet without touching it.

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface NoteSummary {
  name: string;
  title: string;
  sizeBytes: number;
  modified: string;
}

export interface SearchHit {
  name: string;
  title: string;
  line: number;
  snippet: string;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-_]{0,79}$/i;

export class NotesStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = path.resolve(dir);
  }

  /**
   * Turn a note name into a file path, refusing anything that could escape
   * the notes folder (for example "../../etc/passwd"). An AI assistant
   * chooses these names, so never trust them.
   */
  private pathFor(name: string): string {
    const clean = name.replace(/\.md$/i, "");
    if (!NAME_PATTERN.test(clean)) {
      throw new Error(
        `Invalid note name "${name}". Use letters, numbers, hyphens and underscores only.`,
      );
    }
    return path.join(this.dir, `${clean}.md`);
  }

  private titleOf(name: string, text: string): string {
    const heading = text.split("\n").find((l) => l.startsWith("# "));
    return heading ? heading.slice(2).trim() : name;
  }

  async list(): Promise<NoteSummary[]> {
    await mkdir(this.dir, { recursive: true });
    const files = (await readdir(this.dir)).filter((f) => f.endsWith(".md")).sort();
    return Promise.all(
      files.map(async (file) => {
        const full = path.join(this.dir, file);
        const [info, text] = await Promise.all([stat(full), readFile(full, "utf8")]);
        const name = file.slice(0, -3);
        return {
          name,
          title: this.titleOf(name, text),
          sizeBytes: info.size,
          modified: info.mtime.toISOString(),
        };
      }),
    );
  }

  async read(name: string): Promise<string> {
    try {
      return await readFile(this.pathFor(name), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`No note called "${name}". Use list_notes to see what exists.`);
      }
      throw err;
    }
  }

  /** Case-insensitive search: a line matches if it contains every word in the query. */
  async search(query: string, limit = 10): Promise<SearchHit[]> {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const hits: SearchHit[] = [];
    for (const note of await this.list()) {
      const lines = (await this.read(note.name)).split("\n");
      for (const [i, line] of lines.entries()) {
        const lower = line.toLowerCase();
        if (words.every((w) => lower.includes(w))) {
          hits.push({ name: note.name, title: note.title, line: i + 1, snippet: line.trim() });
          if (hits.length >= limit) return hits;
        }
      }
    }
    return hits;
  }

  /** Create a new note. Refuses to overwrite an existing one. */
  async create(name: string, content: string): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const clean = name.replace(/\.md$/i, "");
    try {
      // "wx" fails if the file already exists, so notes are never overwritten.
      await writeFile(this.pathFor(clean), content, { encoding: "utf8", flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`A note called "${clean}" already exists. Pick a different name.`);
      }
      throw err;
    }
    return clean;
  }
}
