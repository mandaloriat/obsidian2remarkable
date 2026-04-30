/**
 * Configuration management for obsidian2remarkable.
 * Reads settings from environment variables and a config file.
 */

import fs from "fs";
import path from "path";

export interface Config {
  /** Absolute path to the Obsidian vault root */
  vaultPath: string;
  /** Subdirectory inside the vault to watch (relative to vaultPath) */
  inboxDir: string;
  /** If true, export every Markdown note in the vault */
  scanAllVault: boolean;
  /** If true, also scan the entire vault for notes with remarkable:true frontmatter */
  scanFrontmatter: boolean;
  /** Directory where generated PDFs are cached (relative to cwd or absolute) */
  outputDir: string;
  /** Directory where credentials are stored */
  credentialsDir: string;
  /** Target folder name in the reMarkable Cloud */
  remarkableFolder: string;
  /** PDF filename prefix */
  pdfPrefix: string;
  /** Maximum retry attempts for upload failures */
  maxRetries: number;
  /** Base delay (ms) between retries */
  retryDelayMs: number;
  /** Delay after the last file change before watch mode starts a sync */
  watchDebounceMs: number;
  /** Minimum pause between completed watch sync runs */
  watchCooldownMs: number;
  /** Path to state/idempotency database file */
  stateDbPath: string;
  /** Pandoc binary path (defaults to system pandoc) */
  pandocBin: string;
  /** Custom Pandoc PDF engine (e.g. pdflatex, xelatex, weasyprint) */
  pandocPdfEngine: string;
  /** Page geometry string for pandoc (e.g. "a4paper,margin=2cm") */
  pageGeometry: string;
  /** Font size for PDF output */
  fontSize: string;
}

function resolveDir(dir: string): string {
  if (path.isAbsolute(dir)) return dir;
  return path.resolve(process.cwd(), dir);
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const vaultPath =
    overrides.vaultPath ??
    process.env.VAULT_PATH ??
    "";

  if (!vaultPath) {
    throw new Error(
      "VAULT_PATH is required. Set it via the VAULT_PATH environment variable or --vault flag."
    );
  }

  const outputDir = resolveDir(
    overrides.outputDir ??
    process.env.OUTPUT_DIR ??
    ".remarkable-export/out"
  );

  const credentialsDir = resolveDir(
    overrides.credentialsDir ??
    process.env.CREDENTIALS_DIR ??
    ".credentials"
  );

  const stateDbPath = resolveDir(
    overrides.stateDbPath ??
    process.env.STATE_DB_PATH ??
    ".remarkable-export/state.json"
  );

  return {
    vaultPath: resolveDir(vaultPath),
    inboxDir: overrides.inboxDir ?? process.env.INBOX_DIR ?? "remarkable-inbox",
    scanAllVault:
      overrides.scanAllVault ??
      (process.env.SCAN_ALL_VAULT === "true"),
    scanFrontmatter:
      overrides.scanFrontmatter ??
      (process.env.SCAN_FRONTMATTER !== "false"),
    outputDir,
    credentialsDir,
    remarkableFolder:
      overrides.remarkableFolder ??
      process.env.REMARKABLE_FOLDER ??
      "Obsidian",
    pdfPrefix: overrides.pdfPrefix ?? process.env.PDF_PREFIX ?? "Obsidian - ",
    maxRetries:
      overrides.maxRetries ??
      parseInt(process.env.MAX_RETRIES ?? "3", 10),
    retryDelayMs:
      overrides.retryDelayMs ??
      parseInt(process.env.RETRY_DELAY_MS ?? "2000", 10),
    watchDebounceMs:
      overrides.watchDebounceMs ??
      parseInt(process.env.WATCH_DEBOUNCE_MS ?? "2000", 10),
    watchCooldownMs:
      overrides.watchCooldownMs ??
      parseInt(process.env.WATCH_COOLDOWN_MS ?? "0", 10),
    stateDbPath,
    pandocBin: overrides.pandocBin ?? process.env.PANDOC_BIN ?? "pandoc",
    pandocPdfEngine:
      overrides.pandocPdfEngine ?? process.env.PANDOC_PDF_ENGINE ?? "",
    pageGeometry:
      overrides.pageGeometry ??
      process.env.PAGE_GEOMETRY ??
      "a4paper,top=2cm,bottom=2cm,left=2.5cm,right=2.5cm",
    fontSize: overrides.fontSize ?? process.env.FONT_SIZE ?? "11pt",
  };
}

/** Ensure required output directories exist */
export function ensureDirs(config: Config): void {
  for (const dir of [config.outputDir, config.credentialsDir, path.dirname(config.stateDbPath)]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
