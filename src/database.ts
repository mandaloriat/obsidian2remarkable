/**
 * Idempotency state database.
 * Stores per-note state in a JSON file so we can skip re-processing unchanged notes.
 */

import fs from "fs";
import path from "path";

export interface NoteState {
  /** Absolute path to the source Markdown file */
  sourcePath: string;
  /** SHA-256 hash of the resolved Markdown content + attachments */
  contentHash: string;
  /** Absolute path to the generated PDF file */
  pdfPath: string;
  /** ISO timestamp of last successful export */
  lastExportedAt: string;
  /** reMarkable document ID (if uploaded) */
  remarkableId?: string;
  /** reMarkable document name as uploaded */
  remarkableName?: string;
  /** Upload status */
  uploadStatus: "pending" | "uploaded" | "failed";
  /** Last error message */
  lastError?: string;
}

export interface StateDb {
  version: number;
  notes: Record<string, NoteState>;
}

export class Database {
  private dbPath: string;
  private state: StateDb;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.state = this.load();
  }

  private load(): StateDb {
    if (fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, "utf-8");
        return JSON.parse(raw) as StateDb;
      } catch {
        // Corrupt file – start fresh
        return { version: 1, notes: {} };
      }
    }
    return { version: 1, notes: {} };
  }

  save(): void {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.dbPath, JSON.stringify(this.state, null, 2), "utf-8");
  }

  get(sourcePath: string): NoteState | undefined {
    return this.state.notes[sourcePath];
  }

  set(state: NoteState): void {
    this.state.notes[state.sourcePath] = state;
    this.save();
  }

  delete(sourcePath: string): void {
    delete this.state.notes[sourcePath];
    this.save();
  }

  all(): NoteState[] {
    return Object.values(this.state.notes);
  }

  /**
   * Returns true if the note's contentHash matches the stored one,
   * meaning no re-processing is needed.
   */
  isUpToDate(sourcePath: string, contentHash: string): boolean {
    const stored = this.get(sourcePath);
    return stored !== undefined &&
      stored.contentHash === contentHash &&
      stored.uploadStatus === "uploaded";
  }
}
