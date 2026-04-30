/**
 * reMarkable Cloud upload adapter.
 *
 * Encapsulates all interaction with the reMarkable Cloud API behind a simple
 * interface so the underlying implementation (rmapi-js, rmapi CLI, etc.) can
 * be swapped without touching the rest of the pipeline.
 *
 * Current implementation: rmapi-js
 */

import fs from "fs";
import path from "path";
import type { RemarkableApi } from "rmapi-js";
import { Config } from "./config.js";
import { logger } from "./logger.js";

const TOKEN_FILE = "remarkable.token";

export interface UploadResult {
  /** reMarkable document ID assigned by the cloud */
  documentId: string;
  /** Display name of the uploaded document */
  documentName: string;
}

// ------------------------------------------------------------------
// Token persistence
// ------------------------------------------------------------------

function tokenPath(config: Config): string {
  return path.join(config.credentialsDir, TOKEN_FILE);
}

export function loadToken(config: Config): string | null {
  const p = tokenPath(config);
  if (fs.existsSync(p)) {
    return fs.readFileSync(p, "utf-8").trim();
  }
  return null;
}

export function saveToken(config: Config, token: string): void {
  if (!fs.existsSync(config.credentialsDir)) {
    fs.mkdirSync(config.credentialsDir, { recursive: true });
  }
  fs.writeFileSync(tokenPath(config), token, { encoding: "utf-8", mode: 0o600 });
  logger.info(`Token saved to ${tokenPath(config)}`);
}

// ------------------------------------------------------------------
// rmapi-js helpers
// ------------------------------------------------------------------

async function getRemarkableApi(config: Config): Promise<RemarkableApi> {
  const rmapi = await import("rmapi-js");

  const token = loadToken(config);
  if (!token) {
    throw new Error(
      "reMarkable token not found. Run `obsidian2remarkable auth` first."
    );
  }

  return rmapi.remarkable(token);
}

/**
 * Find or create the target folder in the reMarkable Cloud.
 * Returns the folder ID.
 */
async function ensureFolder(
  api: RemarkableApi,
  folderName: string
): Promise<string> {
  const entries = await api.listItems();
  const existing = entries.find(
    (e) => e.type === "CollectionType" && e.visibleName === folderName
  );
  if (existing) {
    return existing.id;
  }

  // Create the folder
  logger.info(`Creating reMarkable folder: "${folderName}"`);
  const result = await api.putFolder(folderName, { parent: "" });
  return result.id;
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/**
 * Register this application with the reMarkable Cloud using a one-time code.
 * The one-time code can be obtained at https://my.remarkable.com/device/desktop/connect
 */
export async function registerDevice(
  otc: string,
  config: Config
): Promise<void> {
  const { register } = await import("rmapi-js");
  logger.info("Registering with reMarkable Cloud...");
  const token = await register(otc);
  saveToken(config, token);
  logger.info("Authentication successful.");
}

/**
 * Upload a PDF to the reMarkable Cloud.
 * Creates the target folder if it does not exist.
 */
export async function uploadPdf(
  pdfPath: string,
  documentName: string,
  config: Config
): Promise<UploadResult> {
  const api = await getRemarkableApi(config);

  const folderId = await ensureFolder(api, config.remarkableFolder);
  const pdfBuffer = fs.readFileSync(pdfPath);

  logger.debug(
    `Uploading "${documentName}" (${(pdfBuffer.length / 1024).toFixed(1)} KB) to folder "${config.remarkableFolder}"`
  );

  const result = await api.putPdf(documentName, pdfBuffer, {
    parent: folderId || undefined,
  });

  return {
    documentId: result.id,
    documentName,
  };
}

/**
 * Sleep helper for retry backoff.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload a PDF with automatic retry and exponential backoff.
 */
export async function uploadPdfWithRetry(
  pdfPath: string,
  documentName: string,
  config: Config
): Promise<UploadResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      return await uploadPdf(pdfPath, documentName, config);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Upload attempt ${attempt}/${config.maxRetries} failed: ${msg}`);

      if (attempt < config.maxRetries) {
        const delay = config.retryDelayMs * Math.pow(2, attempt - 1);
        logger.debug(`Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Upload failed after ${config.maxRetries} attempts: ${msg}`);
}
