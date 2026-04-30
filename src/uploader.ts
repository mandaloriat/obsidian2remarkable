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
const FOLDER_CACHE_FILE = "remarkable-folders.json";
let cachedApi: Promise<RemarkableApi> | null = null;
let cachedToken: string | null = null;
const cachedFolderIds = new Map<string, string>();
const validatedLookupPaths = new Set<string>();

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

function folderCachePath(config: Config): string {
  return path.join(config.credentialsDir, FOLDER_CACHE_FILE);
}

function loadFolderCache(config: Config): void {
  if (cachedFolderIds.size > 0 || !fs.existsSync(folderCachePath(config))) {
    return;
  }
  try {
    const raw = fs.readFileSync(folderCachePath(config), "utf-8");
    const data = JSON.parse(raw) as Record<string, string>;
    for (const [remotePath, folderId] of Object.entries(data)) {
      cachedFolderIds.set(remotePath, folderId);
    }
  } catch {
    // Ignore corrupt cache and rebuild it lazily from the API.
  }
}

function saveFolderCache(config: Config): void {
  if (!fs.existsSync(config.credentialsDir)) {
    fs.mkdirSync(config.credentialsDir, { recursive: true });
  }
  fs.writeFileSync(
    folderCachePath(config),
    JSON.stringify(Object.fromEntries(cachedFolderIds), null, 2),
    "utf-8"
  );
}

function clearFolderCacheTree(remotePath: string): void {
  for (const key of Array.from(cachedFolderIds.keys())) {
    if (key === remotePath || key.startsWith(`${remotePath}/`)) {
      cachedFolderIds.delete(key);
    }
  }
  for (const key of Array.from(validatedLookupPaths)) {
    if (key === remotePath || key.startsWith(`${remotePath}/`)) {
      validatedLookupPaths.delete(key);
    }
  }
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
  clearUploadCache();
  logger.info(`Token saved to ${tokenPath(config)}`);
}

function clearUploadCache(): void {
  cachedApi = null;
  cachedToken = null;
  cachedFolderIds.clear();
  validatedLookupPaths.clear();
}

// ------------------------------------------------------------------
// rmapi-js helpers
// ------------------------------------------------------------------

async function getRemarkableApi(config: Config): Promise<RemarkableApi> {
  const token = loadToken(config);
  if (!token) {
    throw new Error(
      "reMarkable token not found. Run `obsidian2remarkable auth` first."
    );
  }

  if (!cachedApi || cachedToken !== token) {
    cachedToken = token;
    cachedFolderIds.clear();
    cachedApi = import("rmapi-js").then((rmapi) => rmapi.remarkable(token));
  }

  return cachedApi;
}

/**
 * Find or create the target folder in the reMarkable Cloud.
 * Returns the folder ID.
 */
async function ensureFolder(
  api: RemarkableApi,
  config: Config,
  folderName: string,
  parentId: string,
  remotePath: string,
  useLookup: boolean
): Promise<string> {
  loadFolderCache(config);
  const cachedFolderId = cachedFolderIds.get(remotePath);
  if (cachedFolderId && (!useLookup || validatedLookupPaths.has(remotePath))) {
    return cachedFolderId;
  }

  if (useLookup) {
    const entries = await api.listItems(true);
    const existing = entries.find(
      (e) =>
        e.type === "CollectionType" &&
        e.visibleName === folderName &&
        e.parent === parentId
    );
    if (existing) {
      if (cachedFolderId && cachedFolderId !== existing.id) {
        clearFolderCacheTree(remotePath);
      }
      cachedFolderIds.set(remotePath, existing.id);
      validatedLookupPaths.add(remotePath);
      saveFolderCache(config);
      return existing.id;
    }

    if (cachedFolderId) {
      clearFolderCacheTree(remotePath);
    }
  }

  logger.info(`Creating reMarkable folder: "${remotePath}"`);
  const result = await api.putFolder(folderName, { parent: parentId });
  cachedFolderIds.set(remotePath, result.id);
  if (useLookup) {
    validatedLookupPaths.add(remotePath);
  }
  saveFolderCache(config);
  return result.id;
}

async function ensureFolderPath(
  api: RemarkableApi,
  config: Config,
  remoteFolderPath: string[]
): Promise<string> {
  let currentPath = config.remarkableFolder;
  let parentId = await ensureFolder(
    api,
    config,
    config.remarkableFolder,
    "",
    currentPath,
    true
  );

  for (const segment of remoteFolderPath) {
    currentPath = `${currentPath}/${segment}`;
    parentId = await ensureFolder(
      api,
      config,
      segment,
      parentId,
      currentPath,
      false
    );
  }

  return parentId;
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
  remoteFolderPath: string[],
  config: Config
): Promise<UploadResult> {
  const api = await getRemarkableApi(config);

  const folderId = await ensureFolderPath(api, config, remoteFolderPath);
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

function getRetryDelayMs(err: unknown, attempt: number, config: Config): number {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const baseDelay = config.retryDelayMs * Math.pow(2, attempt - 1);

  if (msg.includes("too many requests")) {
    return Math.max(baseDelay, 15000);
  }

  return baseDelay;
}

/**
 * Upload a PDF with automatic retry and exponential backoff.
 */
export async function uploadPdfWithRetry(
  pdfPath: string,
  documentName: string,
  remoteFolderPath: string[],
  config: Config
): Promise<UploadResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      return await uploadPdf(pdfPath, documentName, remoteFolderPath, config);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Upload attempt ${attempt}/${config.maxRetries} failed: ${msg}`);

      if (attempt < config.maxRetries) {
        const delay = getRetryDelayMs(err, attempt, config);
        logger.debug(`Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Upload failed after ${config.maxRetries} attempts: ${msg}`);
}
