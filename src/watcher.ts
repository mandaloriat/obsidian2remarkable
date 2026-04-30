/**
 * File system watcher.
 * Watches the vault and triggers sync when .md files change.
 */

import path from "path";
import { Config } from "./config.js";
import { Database } from "./database.js";
import { runSync } from "./sync.js";
import { logger } from "./logger.js";

const DEBOUNCE_MS = 2000;

/**
 * Watch the vault for changes and sync on modification.
 */
export async function watchVault(config: Config, db: Database): Promise<void> {
  // Dynamic import because chokidar v5+ is ESM-only
  const { default: chokidar } = await import("chokidar");

  const inboxPath = path.join(config.vaultPath, config.inboxDir);
  const watchPaths = [inboxPath];

  if (config.scanFrontmatter) {
    watchPaths.push(config.vaultPath);
  }

  logger.info(`Watching vault for changes: ${watchPaths.join(", ")}`);

  const watcher = chokidar.watch(watchPaths, {
    ignored: [
      /(^|[/\\])\../,       // hidden files
      /node_modules/,
      /\.remarkable-export/,
    ],
    persistent: true,
    ignoreInitial: true,
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingFiles = new Set<string>();

  function scheduleSync(filePath: string): void {
    if (!filePath.endsWith(".md")) return;
    pendingFiles.add(filePath);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      logger.info(`Change detected (${pendingFiles.size} file(s)) – syncing...`);
      pendingFiles.clear();
      try {
        const result = await runSync(config, db);
        logger.info(
          `Sync complete: ${result.uploaded} uploaded, ` +
          `${result.skipped} skipped, ` +
          `${result.failed} failed`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`Sync error: ${msg}`);
      }
    }, DEBOUNCE_MS);
  }

  watcher
    .on("add", scheduleSync)
    .on("change", scheduleSync)
    .on("error", (err: unknown) => logger.error(`Watcher error: ${err}`));

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    logger.info("Stopping watcher...");
    void watcher.close().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    logger.info("Stopping watcher...");
    void watcher.close().then(() => process.exit(0));
  });
}
