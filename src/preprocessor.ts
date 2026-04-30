/**
 * Markdown preprocessor.
 *
 * Transforms Obsidian-flavoured Markdown into standard Markdown suitable
 * for Pandoc conversion:
 *  - Resolves [[wikilinks]] to plain text or relative links
 *  - Converts Obsidian callout syntax (> [!NOTE]) to blockquotes
 *  - Resolves ![[image]] embeds to standard Markdown image syntax
 *  - Returns a stable content hash for idempotency
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { NoteCandidate } from "./scanner.js";

export interface ProcessedNote {
  /** Original note metadata */
  candidate: NoteCandidate;
  /** Preprocessed Markdown body */
  processedBody: string;
  /** SHA-256 hex hash of (body + sorted attachment paths + attachment hashes) */
  contentHash: string;
  /** Absolute paths of referenced local images/attachments */
  attachments: string[];
}

// ------------------------------------------------------------------
// Wikilink resolution
// ------------------------------------------------------------------

/**
 * Resolve a [[wikilink]] target to an absolute path inside the vault.
 * Returns undefined if the file cannot be found.
 */
function resolveWikilink(
  target: string,
  vaultPath: string
): string | undefined {
  // Strip anchor/heading (e.g. Note#heading → Note)
  const base = target.split("#")[0].trim();
  if (!base) return undefined;

  // Try with and without .md extension
  for (const candidate of [base, `${base}.md`]) {
    const fullPath = path.join(vaultPath, candidate);
    if (fs.existsSync(fullPath)) return fullPath;
  }

  // Recursive search
  function findFile(dir: string, name: string): string | undefined {
    if (!fs.existsSync(dir)) return undefined;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findFile(full, name);
        if (found) return found;
      } else if (
        entry.isFile() &&
        (entry.name === name || entry.name === `${name}.md`)
      ) {
        return full;
      }
    }
    return undefined;
  }

  return findFile(vaultPath, base) ?? findFile(vaultPath, `${base}.md`);
}

/** Replace [[wikilinks]] with display text (and optional path) */
function resolveWikilinks(body: string, vaultPath: string): string {
  // [[target|alias]] → alias  or  [[target]] → target
  return body.replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
    const parts = inner.split("|");
    const target = parts[0].trim();
    const alias = parts[1]?.trim() ?? target.split("#").pop() ?? target;
    const resolvedPath = resolveWikilink(target, vaultPath);
    if (resolvedPath) {
      // Relative link to another note (Pandoc can make this navigable)
      const rel = path.relative(vaultPath, resolvedPath);
      return `[${alias}](${encodeURIComponent(rel)})`;
    }
    // Cannot resolve – keep as plain text
    return alias;
  });
}

// ------------------------------------------------------------------
// Image embed resolution
// ------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp",
]);

/**
 * Replace ![[image]] with standard Markdown image syntax.
 * Returns resolved attachment paths as a side-effect.
 */
function resolveImageEmbeds(
  body: string,
  noteDir: string,
  vaultPath: string,
  attachments: string[]
): string {
  return body.replace(/!\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
    const target = inner.split("|")[0].trim();
    const ext = path.extname(target).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) {
      // Non-image embed (e.g. note embed) – render as a note reference
      return `*[Embedded: ${target}]*`;
    }

    // Try to locate the image
    const inNoteDir = path.join(noteDir, target);
    const inVaultRoot = path.join(vaultPath, target);

    function findImage(base: string): string | undefined {
      if (fs.existsSync(base)) return base;
      // Search recursively
      function walk(dir: string, name: string): string | undefined {
        if (!fs.existsSync(dir)) return undefined;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            const found = walk(full, name);
            if (found) return found;
          } else if (e.isFile() && e.name === name) {
            return full;
          }
        }
        return undefined;
      }
      return walk(path.dirname(base), path.basename(base));
    }

    const resolved = findImage(inNoteDir) ?? findImage(inVaultRoot);
    if (resolved) {
      attachments.push(resolved);
      return `![${target}](${resolved})`;
    }
    // Image not found – leave a placeholder
    return `*[Image not found: ${target}]*`;
  });
}

// ------------------------------------------------------------------
// Callout conversion
// ------------------------------------------------------------------

const CALLOUT_REGEX = /^> \[!([\w-]+)\][+-]?\s*(.*)/;

/**
 * Convert Obsidian callout blocks to readable blockquotes.
 *
 * Input:
 *   > [!NOTE] Optional title
 *   > body text
 *
 * Output:
 *   > **NOTE – Optional title**
 *   > body text
 */
function convertCallouts(body: string): string {
  const lines = body.split("\n");
  const output: string[] = [];

  for (const line of lines) {
    const match = CALLOUT_REGEX.exec(line);
    if (match) {
      const type = match[1].toUpperCase();
      const title = match[2].trim();
      const label = title ? `${type} – ${title}` : type;
      output.push(`> **${label}**`);
    } else {
      output.push(line);
    }
  }

  return output.join("\n");
}

// ------------------------------------------------------------------
// Checkbox normalisation
// ------------------------------------------------------------------

/**
 * Obsidian supports `- [x]` and `- [ ]` but also `- [/]` (in progress).
 * Normalise non-standard checkboxes to plain list items with a label.
 */
function normaliseCheckboxes(body: string): string {
  return body.replace(/^(\s*[-*])\s+\[([^[\] ])\]\s+/gm, (_m, bullet, state) => {
    const label =
      state === "x" ? "[x] " :
      state === "/" ? "[~] " :
      "[ ] ";
    return `${bullet} ${label}`;
  });
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/** Compute SHA-256 of a file's contents */
function fileHash(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Preprocess an Obsidian note into standard Markdown.
 */
export function preprocessNote(
  candidate: NoteCandidate,
  vaultPath: string
): ProcessedNote {
  const noteDir = path.dirname(candidate.filePath);
  const attachments: string[] = [];

  let body = candidate.body;

  // Order matters:
  // 1. Resolve image embeds first (they use ![[...]])
  body = resolveImageEmbeds(body, noteDir, vaultPath, attachments);
  // 2. Resolve wikilinks (they use [[...]])
  body = resolveWikilinks(body, vaultPath);
  // 3. Convert callouts
  body = convertCallouts(body);
  // 4. Normalise checkboxes
  body = normaliseCheckboxes(body);

  // Compute content hash: body + attachment file hashes
  const hashInput = [body, ...attachments.sort().map(fileHash)].join("\n---\n");
  const contentHash = crypto
    .createHash("sha256")
    .update(hashInput)
    .digest("hex");

  return {
    candidate,
    processedBody: body,
    contentHash,
    attachments: [...new Set(attachments)],
  };
}
