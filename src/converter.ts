/**
 * Markdown → PDF converter.
 *
 * Primary engine: Pandoc (must be installed on the host system).
 * Fallback engine: md-to-pdf (pure Node.js, no system dependency).
 *
 * The Pandoc engine produces better output (proper page layout, TOC, etc.)
 * and is strongly recommended for production use.
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { Config } from "./config.js";
import { ProcessedNote } from "./preprocessor.js";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

export interface ConvertResult {
  pdfPath: string;
}

// ------------------------------------------------------------------
// Pandoc engine
// ------------------------------------------------------------------

/**
 * Check whether pandoc is available on the system.
 */
export async function isPandocAvailable(pandocBin: string): Promise<boolean> {
  try {
    await execFileAsync(pandocBin, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the complete Markdown document (YAML front-matter + body) that
 * Pandoc will render as a PDF.
 */
function buildPandocInput(note: ProcessedNote, config: Config): string {
  const fm: Record<string, unknown> = {
    title: note.candidate.title,
    ...note.candidate.frontmatter,
    // Ensure we remove internal Obsidian keys that confuse Pandoc
    remarkable: undefined,
    tags: note.candidate.frontmatter.tags ?? undefined,
  };

  // Build YAML front-matter for Pandoc
  const yamlLines = ["---"];
  for (const [key, value] of Object.entries(fm)) {
    if (value === undefined) continue;
    if (typeof value === "string") {
      // Escape backslashes first, then double quotes to produce valid YAML double-quoted strings
      const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      yamlLines.push(`${key}: "${escaped}"`);
    } else if (Array.isArray(value)) {
      yamlLines.push(`${key}:`);
      for (const item of value) {
        yamlLines.push(`  - ${item}`);
      }
    } else {
      yamlLines.push(`${key}: ${value}`);
    }
  }
  yamlLines.push("---", "", note.processedBody);

  return yamlLines.join("\n");
}

async function convertWithPandoc(
  note: ProcessedNote,
  pdfPath: string,
  config: Config
): Promise<void> {
  const inputDoc = buildPandocInput(note, config);
  const inputFile = pdfPath.replace(/\.pdf$/, ".md.tmp");

  fs.writeFileSync(inputFile, inputDoc, "utf-8");

  const args: string[] = [
    inputFile,
    "--output", pdfPath,
    "--from", "markdown+smart",
    "--toc",
    "--toc-depth=3",
    "--variable", `geometry:${config.pageGeometry}`,
    "--variable", `fontsize:${config.fontSize}`,
    "--variable", "colorlinks:true",
  ];

  if (config.pandocPdfEngine) {
    args.push("--pdf-engine", config.pandocPdfEngine);
  }

  try {
    await execFileAsync(config.pandocBin, args);
  } finally {
    // Clean up temp file
    if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
  }
}

// ------------------------------------------------------------------
// md-to-pdf fallback engine
// ------------------------------------------------------------------

async function convertWithMdToPdf(
  note: ProcessedNote,
  pdfPath: string
): Promise<void> {
  // Dynamically import md-to-pdf so it does not crash if missing
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mdToPdf } = await import("md-to-pdf");

  const content = `# ${note.candidate.title}\n\n${note.processedBody}`;

  const result = await mdToPdf(
    { content },
    {
      pdf_options: {
        format: "A4",
        margin: { top: "2cm", bottom: "2cm", left: "2.5cm", right: "2.5cm" },
        printBackground: true,
      },
      stylesheet_encoding: "utf-8",
    }
  );

  if (result.content) {
    fs.writeFileSync(pdfPath, result.content);
  } else {
    throw new Error("md-to-pdf returned no content");
  }
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/**
 * Convert a preprocessed Obsidian note to PDF.
 * Uses Pandoc when available, falls back to md-to-pdf otherwise.
 */
export async function convertToPdf(
  note: ProcessedNote,
  config: Config
): Promise<ConvertResult> {
  // Build a safe filename from the title
  const safeName = note.candidate.title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .trim();
  const pdfFileName = `${config.pdfPrefix}${safeName}.pdf`;
  const pdfPath = path.join(config.outputDir, pdfFileName);

  // Ensure output directory exists
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }

  const pandocAvailable = await isPandocAvailable(config.pandocBin);

  if (pandocAvailable) {
    logger.debug(`Converting "${note.candidate.title}" with Pandoc`);
    await convertWithPandoc(note, pdfPath, config);
  } else {
    logger.warn(
      "Pandoc not found – falling back to md-to-pdf. " +
      "Install pandoc for better PDF quality: https://pandoc.org/installing.html"
    );
    await convertWithMdToPdf(note, pdfPath);
  }

  return { pdfPath };
}
