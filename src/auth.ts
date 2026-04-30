/**
 * Authentication management.
 * Handles initial pairing and token renewal with the reMarkable Cloud.
 */

import readline from "readline";
import { Config } from "./config.js";
import { loadToken, registerDevice } from "./uploader.js";
import { logger } from "./logger.js";

/**
 * Prompt the user for the one-time code interactively.
 */
function promptOtc(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(
      "Enter the 8-character one-time code from https://my.remarkable.com/device/desktop/connect : ",
      (answer) => {
        rl.close();
        resolve(answer.trim());
      }
    );
  });
}

/**
 * Run the interactive authentication flow.
 * If `otc` is provided, use it directly; otherwise prompt the user.
 */
export async function runAuth(config: Config, otc?: string): Promise<void> {
  const existingToken = loadToken(config);
  if (existingToken && !otc) {
    logger.info(
      "A reMarkable token is already saved. " +
      "Pass --force to re-authenticate, or provide a new OTC code."
    );
    return;
  }

  const code = otc ?? (await promptOtc());
  if (!code || code.length < 6) {
    throw new Error("Invalid one-time code.");
  }

  await registerDevice(code, config);
}
