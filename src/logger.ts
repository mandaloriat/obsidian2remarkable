/**
 * Logger setup using winston.
 */

import { createLogger, format, transports } from "winston";

const { combine, timestamp, printf, colorize, errors } = format;

const logFormat = printf(({ level, message, timestamp: ts, stack }) => {
  return `${ts} [${level}] ${stack ?? message}`;
});

export const logger = createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: combine(
    colorize(),
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [new transports.Console()],
});
