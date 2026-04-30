import fs from "fs";
import path from "path";
import os from "os";
import { scanVault } from "../src/scanner";
import { Config } from "../src/config";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "o2r-scanner-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeNote(relPath: string, content: string): string {
  const full = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
  return full;
}

function makeConfig(override: Partial<Config> = {}): Config {
  return {
    vaultPath: tmpDir,
    inboxDir: "remarkable-inbox",
    scanAllVault: false,
    scanFrontmatter: true,
    outputDir: path.join(tmpDir, "out"),
    credentialsDir: path.join(tmpDir, ".credentials"),
    remarkableFolder: "Obsidian",
    pdfPrefix: "Obsidian - ",
    maxRetries: 3,
    retryDelayMs: 100,
    stateDbPath: path.join(tmpDir, "state.json"),
    pandocBin: "pandoc",
    pandocPdfEngine: "",
    pageGeometry: "a4paper",
    fontSize: "11pt",
    watchDebounceMs: 2000,
    watchCooldownMs: 0,
    ...override,
  };
}

describe("scanVault", () => {
  test("returns empty array when vault is empty", () => {
    const config = makeConfig();
    const results = scanVault(config);
    expect(results).toHaveLength(0);
  });

  test("picks up notes from inbox directory", () => {
    writeNote("remarkable-inbox/my-note.md", "# My Note\n\nHello");
    const config = makeConfig();
    const results = scanVault(config);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("my-note");
  });

  test("uses frontmatter title when available", () => {
    writeNote(
      "remarkable-inbox/note.md",
      "---\ntitle: My Custom Title\n---\n\nBody"
    );
    const config = makeConfig();
    const results = scanVault(config);
    expect(results[0].title).toBe("My Custom Title");
  });

  test("picks up notes with remarkable:true frontmatter", () => {
    writeNote("notes/hidden.md", "---\nremarkable: true\n---\n\nSecret");
    const config = makeConfig({ scanFrontmatter: true });
    const results = scanVault(config);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("hidden");
  });

  test("picks up notes with remarkable:yes frontmatter", () => {
    writeNote("notes/other.md", "---\nremarkable: yes\n---\n\nContent");
    const config = makeConfig({ scanFrontmatter: true });
    const results = scanVault(config);
    expect(results).toHaveLength(1);
  });

  test("does not pick up notes without remarkable frontmatter when scanFrontmatter=true", () => {
    writeNote("notes/no-export.md", "# Plain Note\n\nNo frontmatter");
    const config = makeConfig({ scanFrontmatter: true });
    const results = scanVault(config);
    expect(results).toHaveLength(0);
  });

  test("does not duplicate notes that are in inbox AND have remarkable frontmatter", () => {
    writeNote(
      "remarkable-inbox/dual.md",
      "---\nremarkable: true\n---\n\nDual"
    );
    const config = makeConfig({ scanFrontmatter: true });
    const results = scanVault(config);
    expect(results).toHaveLength(1);
  });

  test("does not scan frontmatter when scanFrontmatter=false", () => {
    writeNote("notes/tagged.md", "---\nremarkable: true\n---\n\nTagged");
    const config = makeConfig({ scanFrontmatter: false });
    const results = scanVault(config);
    expect(results).toHaveLength(0);
  });

  test("scans subdirectories of inbox", () => {
    writeNote("remarkable-inbox/sub/note.md", "# Sub note");
    const config = makeConfig();
    const results = scanVault(config);
    expect(results).toHaveLength(1);
  });

  test("ignores non-markdown files in inbox", () => {
    writeNote("remarkable-inbox/image.png", "binary");
    writeNote("remarkable-inbox/note.txt", "plain text");
    const config = makeConfig();
    const results = scanVault(config);
    expect(results).toHaveLength(0);
  });

  test("body does not contain frontmatter", () => {
    writeNote(
      "remarkable-inbox/note.md",
      "---\ntitle: My Note\n---\n\nJust the body"
    );
    const config = makeConfig();
    const results = scanVault(config);
    expect(results[0].body).toContain("Just the body");
    expect(results[0].body).not.toContain("title:");
  });

  test("picks up every markdown note when scanAllVault=true", () => {
    writeNote("notes/a.md", "# A");
    writeNote("notes/sub/b.md", "# B");
    writeNote("remarkable-inbox/c.md", "# C");

    const config = makeConfig({ scanAllVault: true, scanFrontmatter: false });
    const results = scanVault(config);

    expect(results).toHaveLength(3);
    expect(results.map((note) => note.title).sort()).toEqual(["a", "b", "c"]);
  });

  test("ignores non-markdown files when scanAllVault=true", () => {
    writeNote("notes/a.md", "# A");
    writeNote("notes/image.png", "binary");
    writeNote("notes/plain.txt", "text");

    const config = makeConfig({ scanAllVault: true });
    const results = scanVault(config);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("a");
  });
});
