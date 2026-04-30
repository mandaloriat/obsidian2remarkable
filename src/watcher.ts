/**
 * File system watcher.
 * Watches the vault and triggers sync when .md files change.
 */

import path from "path";
import { Config } from "./config.js";
import { Database } from "./database.js";
import { runSync } from "./sync.js";
import { logger } from "./logger.js";

/**
 * Watch the vault for changes and sync on modification.
 */
export async function watchVault(config: Config, db: Database): Promise<void> {
  // Dynamic import because chokidar v5+ is ESM-only
  const { default: chokidar } = await import("chokidar");

  const inboxPath = path.join(config.vaultPath, config.inboxDir);
  const watchPaths = config.scanAllVault ? [config.vaultPath] : [inboxPath];

  if (!config.scanAllVault && config.scanFrontmatter) {
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
  let syncInProgress = false;
  let lastSyncCompletedAt = 0;

  async function runPendingSync(): Promise<void> {
    debounceTimer = null;

    if (syncInProgress || pendingFiles.size === 0) {
      return;
    }

    const now = Date.now();
    const cooldownRemaining = Math.max(
      0,
      lastSyncCompletedAt + config.watchCooldownMs - now
    );

    if (cooldownRemaining > 0) {
      logger.info(
        `Watch cooldown active – next sync in ${Math.ceil(cooldownRemaining / 1000)}s`
      );
      debounceTimer = setTimeout(() => {
        void runPendingSync();
      }, cooldownRemaining);
      return;
    }

    syncInProgress = true;
    const changedFiles = pendingFiles.size;
    pendingFiles.clear();

    logger.info(`Change detected (${changedFiles} file(s)) – syncing...`);
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
    } finally {
      lastSyncCompletedAt = Date.now();
      syncInProgress = false;

      if (pendingFiles.size > 0) {
        scheduleSync();
      }
    }
  }

  function scheduleSync(filePath?: string): void {
    if (filePath) {
      if (!filePath.endsWith(".md")) return;
      pendingFiles.add(filePath);
    }

    if (pendingFiles.size === 0 || syncInProgress) {
      return;
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void runPendingSync();
    }, config.watchDebounceMs);
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
