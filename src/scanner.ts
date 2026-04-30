/**
 * Vault scanner.
 * Discovers Obsidian Markdown notes that should be exported to reMarkable.
 *
 * Selection criteria (applied in order):
 *  1. (When scanAllVault is true) All .md files in the vault
 *  2. All .md files inside `<vaultPath>/<inboxDir>/`
 *  3. (When scanFrontmatter is true) Any .md file in the vault with
 *     `remarkable: true` or `remarkable: yes` in its YAML frontmatter.
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { Config } from "./config.js";

export interface NoteCandidate {
  /** Absolute path to the .md file */
  filePath: string;
  /** Display title derived from frontmatter `title` field or filename */
  title: string;
  /** Raw frontmatter parsed from the file */
  frontmatter: Record<string, unknown>;
  /** Raw Markdown body (without frontmatter) */
  body: string;
}

/** Recursively collect all .md files under a directory */
function walkMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMarkdown(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

/** Parse a single .md file into a NoteCandidate */
function parseNote(filePath: string): NoteCandidate {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data: frontmatter, content: body } = matter(raw);
  const title =
    (typeof frontmatter.title === "string" ? frontmatter.title : null) ??
    path.basename(filePath, ".md");
  return { filePath, title, frontmatter, body };
}

/** Return true when the frontmatter has `remarkable: true` (or "true"/"yes") */
function isMarkedForExport(frontmatter: Record<string, unknown>): boolean {
  const val = frontmatter["remarkable"];
  if (val === true) return true;
  if (typeof val === "string") {
    return val.toLowerCase() === "true" || val.toLowerCase() === "yes";
  }
  return false;
}

/**
 * Scan the vault and return all notes that should be exported.
 */
export function scanVault(config: Config): NoteCandidate[] {
  const seen = new Set<string>();
  const candidates: NoteCandidate[] = [];

  function add(filePath: string): void {
    const resolved = path.resolve(filePath);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    candidates.push(parseNote(resolved));
  }

  // 1. Whole vault
  if (config.scanAllVault) {
    for (const file of walkMarkdown(config.vaultPath)) {
      add(file);
    }
    return candidates;
  }

  // 2. Inbox directory
  const inboxPath = path.join(config.vaultPath, config.inboxDir);
  for (const file of walkMarkdown(inboxPath)) {
    add(file);
  }

  // 3. Frontmatter scan
  if (config.scanFrontmatter) {
    for (const file of walkMarkdown(config.vaultPath)) {
      // Skip files already added from inbox
      if (seen.has(path.resolve(file))) continue;
      const raw = fs.readFileSync(file, "utf-8");
      const { data: fm } = matter(raw);
      if (isMarkedForExport(fm)) {
        add(file);
      }
    }
  }

  return candidates;
}
