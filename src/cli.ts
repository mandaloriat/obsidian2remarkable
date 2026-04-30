#!/usr/bin/env node
/**
 * obsidian2remarkable – CLI entry point.
 *
 * Commands:
 *   sync-once  Export all changed notes and upload to reMarkable Cloud.
 *   watch      Watch the vault for changes and sync automatically.
 *   dry-run    Show what would be converted/uploaded without doing it.
 *   repair     Force re-process all notes regardless of hash.
 *   auth       Authenticate (or re-authenticate) with the reMarkable Cloud.
 *   status     Print the current sync state report.
 */

import { Command } from "commander";
import { loadConfig, ensureDirs } from "./config.js";
import { Database } from "./database.js";
import { runSync, runRepair, printReport } from "./sync.js";
import { watchVault } from "./watcher.js";
import { runAuth } from "./auth.js";
import { logger } from "./logger.js";

const program = new Command();

program
  .name("obsidian2remarkable")
  .description("Export Obsidian Markdown notes to PDF and upload to reMarkable Cloud")
  .version("1.0.0")
  .option("--vault <path>", "Absolute path to the Obsidian vault", process.env.VAULT_PATH)
  .option("--output <dir>", "Output directory for generated PDFs", process.env.OUTPUT_DIR)
  .option("--credentials-dir <dir>", "Directory for credential storage", process.env.CREDENTIALS_DIR)
  .option("--folder <name>", "Target folder name in reMarkable Cloud", process.env.REMARKABLE_FOLDER)
  .option("--log-level <level>", "Log level (debug|info|warn|error)", process.env.LOG_LEVEL ?? "info");

// ----------------------------------------------------------------
// sync-once
// ----------------------------------------------------------------
program
  .command("sync-once")
  .description("Export all changed notes and upload to reMarkable Cloud")
  .option("--force", "Re-process all notes even if unchanged")
  .action(async (opts) => {
    try {
      const config = loadConfig(buildConfigOverrides());
      ensureDirs(config);
      const db = new Database(config.stateDbPath);
      const result = await runSync(config, db, { force: opts.force });
      printSummary(result);
      process.exit(result.failed > 0 ? 1 : 0);
    } catch (err) {
      fatal(err);
    }
  });

// ----------------------------------------------------------------
// watch
// ----------------------------------------------------------------
program
  .command("watch")
  .description("Watch the vault for changes and sync automatically")
  .action(async () => {
    try {
      const config = loadConfig(buildConfigOverrides());
      ensureDirs(config);
      const db = new Database(config.stateDbPath);
      // Initial sync
      logger.info("Running initial sync...");
      const result = await runSync(config, db);
      printSummary(result);
      // Then watch
      await watchVault(config, db);
    } catch (err) {
      fatal(err);
    }
  });

// ----------------------------------------------------------------
// dry-run
// ----------------------------------------------------------------
program
  .command("dry-run")
  .description("Show what would be converted/uploaded without doing it")
  .action(async () => {
    try {
      const config = loadConfig(buildConfigOverrides());
      ensureDirs(config);
      const db = new Database(config.stateDbPath);
      const result = await runSync(config, db, { dryRun: true });
      printSummary(result);
    } catch (err) {
      fatal(err);
    }
  });

// ----------------------------------------------------------------
// repair
// ----------------------------------------------------------------
program
  .command("repair")
  .description("Force re-process all notes and compare with stored state")
  .action(async () => {
    try {
      const config = loadConfig(buildConfigOverrides());
      ensureDirs(config);
      const db = new Database(config.stateDbPath);
      const result = await runRepair(config, db);
      printSummary(result);
      process.exit(result.failed > 0 ? 1 : 0);
    } catch (err) {
      fatal(err);
    }
  });

// ----------------------------------------------------------------
// auth
// ----------------------------------------------------------------
program
  .command("auth")
  .description("Authenticate with the reMarkable Cloud")
  .option("--code <otc>", "One-time code from https://my.remarkable.com/device/desktop/connect")
  .option("--force", "Re-authenticate even if a token already exists")
  .action(async (opts) => {
    try {
      const config = loadConfig(buildConfigOverrides());
      ensureDirs(config);
      await runAuth(config, opts.code);
    } catch (err) {
      fatal(err);
    }
  });

// ----------------------------------------------------------------
// status
// ----------------------------------------------------------------
program
  .command("status")
  .description("Print the current sync status report")
  .action(async () => {
    try {
      const config = loadConfig(buildConfigOverrides());
      const db = new Database(config.stateDbPath);
      printReport(db);
    } catch (err) {
      fatal(err);
    }
  });

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function buildConfigOverrides(): Record<string, unknown> {
  const opts = program.opts();
  if (opts.logLevel) process.env.LOG_LEVEL = opts.logLevel;
  return {
    ...(opts.vault ? { vaultPath: opts.vault } : {}),
    ...(opts.output ? { outputDir: opts.output } : {}),
    ...(opts.credentialsDir ? { credentialsDir: opts.credentialsDir } : {}),
    ...(opts.folder ? { remarkableFolder: opts.folder } : {}),
  };
}

function printSummary(result: {
  total: number;
  skipped: number;
  converted: number;
  uploaded: number;
  failed: number;
  errors: Array<{ file: string; error: string }>;
}): void {
  logger.info(
    `Sync summary: ${result.total} total, ` +
    `${result.converted} converted, ` +
    `${result.uploaded} uploaded, ` +
    `${result.skipped} skipped, ` +
    `${result.failed} failed`
  );
  for (const { file, error } of result.errors) {
    logger.error(`  ${file}: ${error}`);
  }
}

function fatal(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error(`Fatal error: ${msg}`);
  process.exit(1);
}

program.parse(process.argv);
