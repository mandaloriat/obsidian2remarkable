import fs from "fs";
import os from "os";
import path from "path";
import type { Config } from "../src/config";
import type { ProcessedNote } from "../src/preprocessor";
import { convertToPdf } from "../src/converter";

const execFileMock = jest.fn();
const mdToPdfMock = jest.fn();

jest.mock("child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

jest.mock("md-to-pdf", () => ({
  mdToPdf: (...args: unknown[]) => mdToPdfMock(...args),
}));

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "o2r-converter-test-"));
  execFileMock.mockReset();
  mdToPdfMock.mockReset();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeConfig(): Config {
  return {
    vaultPath: tmpDir,
    inboxDir: "remarkable-inbox",
    scanAllVault: false,
    scanFrontmatter: true,
    outputDir: tmpDir,
    credentialsDir: path.join(tmpDir, "credentials"),
    remarkableFolder: "Obsidian",
    pdfPrefix: "Obsidian - ",
    maxRetries: 3,
    retryDelayMs: 2000,
    stateDbPath: path.join(tmpDir, "state.json"),
    pandocBin: "pandoc",
    pandocPdfEngine: "xelatex",
    pageGeometry: "a4paper,margin=2cm",
    fontSize: "11pt",
    watchDebounceMs: 2000,
    watchCooldownMs: 0,
  };
}

function makeProcessedNote(): ProcessedNote {
  return {
    candidate: {
      filePath: path.join(tmpDir, "test-note.md"),
      title: "Test Note",
      frontmatter: {},
      body: "Body",
    },
    processedBody: "Converted body",
    contentHash: "hash",
    attachments: [],
  };
}

describe("convertToPdf", () => {
  test("falls back to md-to-pdf when pandoc conversion fails", async () => {
    execFileMock.mockImplementation(
      (_file: string, args: string[], callback: (error: Error | null) => void) => {
        if (args.includes("--version")) {
          callback(null);
          return;
        }
        callback(new Error("LaTeX Error: missing package"));
      }
    );
    mdToPdfMock.mockResolvedValue({ content: Buffer.from("PDF") });

    const result = await convertToPdf(makeProcessedNote(), makeConfig());

    expect(mdToPdfMock).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(result.pdfPath)).toBe(true);
    expect(fs.readFileSync(result.pdfPath)).toEqual(Buffer.from("PDF"));
  });
});
