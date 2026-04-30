/**
 * Core sync pipeline.
 *
 * Orchestrates: scan → preprocess → convert → upload → persist state
 */

import path from "path";
import { Config } from "./config.js";
import { Database, NoteState } from "./database.js";
import { NoteCandidate, scanVault } from "./scanner.js";
import { preprocessNote } from "./preprocessor.js";
import { convertToPdf } from "./converter.js";
import { uploadPdfWithRetry } from "./uploader.js";
import { logger } from "./logger.js";

export interface SyncOptions {
  dryRun?: boolean;
  force?: boolean;
}

export interface SyncResult {
  total: number;
  skipped: number;
  converted: number;
  uploaded: number;
  failed: number;
  errors: Array<{ file: string; error: string }>;
}

/**
 * Build the document name for a note as it will appear in reMarkable.
 */
function buildDocumentName(candidate: NoteCandidate, config: Config): string {
  const safeName = candidate.title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .trim();
  return `${config.pdfPrefix}${safeName}`;
}

/**
 * Process a single note: preprocess → convert → upload.
 * Returns the updated NoteState.
 */
async function processNote(
  candidate: NoteCandidate,
  config: Config,
  db: Database,
  options: SyncOptions
): Promise<{ skipped: boolean; state: NoteState }> {
  const processed = preprocessNote(candidate, config.vaultPath);
  const documentName = buildDocumentName(candidate, config);

  // Idempotency check
  if (!options.force && db.isUpToDate(candidate.filePath, processed.contentHash)) {
    logger.debug(`Skipping unchanged: ${candidate.filePath}`);
    return {
      skipped: true,
      state: db.get(candidate.filePath) as NoteState,
    };
  }

  const now = new Date().toISOString();

  if (options.dryRun) {
    logger.info(`[dry-run] Would export: "${candidate.title}" → "${documentName}.pdf"`);
    return {
      skipped: false,
      state: {
        sourcePath: candidate.filePath,
        contentHash: processed.contentHash,
        pdfPath: path.join(config.outputDir, `${documentName}.pdf`),
        lastExportedAt: now,
        uploadStatus: "pending",
      },
    };
  }

  // Convert to PDF
  const { pdfPath } = await convertToPdf(processed, config);
  logger.info(`Converted: "${candidate.title}" → ${pdfPath}`);

  // Upload to reMarkable
  const uploadResult = await uploadPdfWithRetry(pdfPath, documentName, config);
  logger.info(`Uploaded: "${documentName}" (id: ${uploadResult.documentId})`);

  const state: NoteState = {
    sourcePath: candidate.filePath,
    contentHash: processed.contentHash,
    pdfPath,
    lastExportedAt: now,
    remarkableId: uploadResult.documentId,
    remarkableName: uploadResult.documentName,
    uploadStatus: "uploaded",
  };

  return { skipped: false, state };
}

/**
 * Run a full sync pass over the vault.
 */
export async function runSync(
  config: Config,
  db: Database,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const result: SyncResult = {
    total: 0,
    skipped: 0,
    converted: 0,
    uploaded: 0,
    failed: 0,
    errors: [],
  };

  const candidates = scanVault(config);
  result.total = candidates.length;

  if (candidates.length === 0) {
    logger.info("No notes found to export.");
    return result;
  }

  logger.info(
    `Found ${candidates.length} note(s) to evaluate` +
    (options.dryRun ? " [dry-run]" : "") +
    (options.force ? " [force]" : "")
  );

  for (const candidate of candidates) {
    try {
      const { skipped, state } = await processNote(candidate, config, db, options);

      if (skipped) {
        result.skipped++;
      } else {
        result.converted++;
        if (!options.dryRun) {
          result.uploaded++;
          db.set(state);
        }
      }
    } catch (err) {
      result.failed++;
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to process "${candidate.filePath}": ${errMsg}`);
      result.errors.push({ file: candidate.filePath, error: errMsg });

      // Persist failed state so it is visible in reports
      if (!options.dryRun) {
        const existing = db.get(candidate.filePath);
        db.set({
          sourcePath: candidate.filePath,
          contentHash: existing?.contentHash ?? "",
          pdfPath: existing?.pdfPath ?? "",
          lastExportedAt: existing?.lastExportedAt ?? new Date().toISOString(),
          remarkableId: existing?.remarkableId,
          remarkableName: existing?.remarkableName,
          uploadStatus: "failed",
          lastError: errMsg,
        });
      }
    }
  }

  return result;
}

/**
 * Repair mode: force re-process all notes regardless of hash.
 */
export async function runRepair(
  config: Config,
  db: Database
): Promise<SyncResult> {
  return runSync(config, db, { force: true });
}

/**
 * Print a summary report of the current sync state.
 */
export function printReport(db: Database): void {
  const states = db.all();
  if (states.length === 0) {
    logger.info("No notes in database.");
    return;
  }

  logger.info(`\n${"─".repeat(60)}`);
  logger.info(`Sync Status Report (${states.length} note(s))`);
  logger.info("─".repeat(60));
  for (const s of states) {
    const status =
      s.uploadStatus === "uploaded" ? "✓" :
      s.uploadStatus === "failed" ? "✗" :
      "~";
    logger.info(
      `${status} ${path.basename(s.sourcePath)} ` +
      `[${s.uploadStatus}] ` +
      `last: ${s.lastExportedAt}`
    );
    if (s.lastError) {
      logger.info(`  Error: ${s.lastError}`);
    }
  }
  logger.info("─".repeat(60));
}
