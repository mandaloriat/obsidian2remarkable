import fs from "fs";
import path from "path";
import os from "os";
import { Database } from "../src/database";
import { NoteState } from "../src/database";

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "o2r-db-test-"));
  dbPath = path.join(tmpDir, "state.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const makeState = (override: Partial<NoteState> = {}): NoteState => ({
  sourcePath: "/vault/note.md",
  contentHash: "abc123",
  pdfPath: "/out/note.pdf",
  lastExportedAt: "2024-01-01T00:00:00.000Z",
  remarkablePath: "Obsidian/note.pdf",
  uploadStatus: "uploaded",
  ...override,
});

describe("Database", () => {
  test("starts empty when file does not exist", () => {
    const db = new Database(dbPath);
    expect(db.all()).toHaveLength(0);
  });

  test("set and get a note state", () => {
    const db = new Database(dbPath);
    const state = makeState();
    db.set(state);
    expect(db.get(state.sourcePath)).toEqual(state);
  });

  test("persists state to disk after set", () => {
    const db = new Database(dbPath);
    db.set(makeState());
    // Load fresh from disk
    const db2 = new Database(dbPath);
    expect(db2.all()).toHaveLength(1);
  });

  test("delete removes a note", () => {
    const db = new Database(dbPath);
    const state = makeState();
    db.set(state);
    db.delete(state.sourcePath);
    expect(db.get(state.sourcePath)).toBeUndefined();
  });

  test("isUpToDate returns true when hash matches and status is uploaded", () => {
    const db = new Database(dbPath);
    db.set(makeState({ contentHash: "hash1", uploadStatus: "uploaded" }));
    expect(db.isUpToDate("/vault/note.md", "hash1", "Obsidian/note.pdf")).toBe(true);
  });

  test("isUpToDate returns false when hash differs", () => {
    const db = new Database(dbPath);
    db.set(makeState({ contentHash: "hash1", uploadStatus: "uploaded" }));
    expect(db.isUpToDate("/vault/note.md", "differenthash", "Obsidian/note.pdf")).toBe(false);
  });

  test("isUpToDate returns false when status is not uploaded", () => {
    const db = new Database(dbPath);
    db.set(makeState({ contentHash: "hash1", uploadStatus: "failed" }));
    expect(db.isUpToDate("/vault/note.md", "hash1", "Obsidian/note.pdf")).toBe(false);
  });

  test("isUpToDate returns false for unknown note", () => {
    const db = new Database(dbPath);
    expect(db.isUpToDate("/vault/unknown.md", "hash1", "Obsidian/note.pdf")).toBe(false);
  });

  test("isUpToDate returns false when remote path differs", () => {
    const db = new Database(dbPath);
    db.set(makeState({ contentHash: "hash1", remarkablePath: "Obsidian/flat.pdf" }));
    expect(db.isUpToDate("/vault/note.md", "hash1", "Obsidian/folder/note.pdf")).toBe(false);
  });

  test("handles corrupt JSON file gracefully", () => {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, "{ not valid json !!!", "utf-8");
    const db = new Database(dbPath);
    expect(db.all()).toHaveLength(0);
  });

  test("all() returns all stored notes", () => {
    const db = new Database(dbPath);
    db.set(makeState({ sourcePath: "/vault/a.md" }));
    db.set(makeState({ sourcePath: "/vault/b.md" }));
    expect(db.all()).toHaveLength(2);
  });
});
