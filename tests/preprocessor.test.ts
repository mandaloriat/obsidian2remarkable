import fs from "fs";
import path from "path";
import os from "os";
import { preprocessNote } from "../src/preprocessor";
import { NoteCandidate } from "../src/scanner";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "o2r-preprocessor-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeCandidate(
  body: string,
  frontmatter: Record<string, unknown> = {},
  relPath = "notes/test-note.md"
): NoteCandidate {
  const filePath = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return {
    filePath,
    title: "Test Note",
    frontmatter,
    body,
  };
}

describe("preprocessNote – callouts", () => {
  test("converts NOTE callout", () => {
    const candidate = makeCandidate("> [!NOTE] This is a note\n> Content here");
    const result = preprocessNote(candidate, tmpDir);
    expect(result.processedBody).toContain("**NOTE – This is a note**");
  });

  test("converts WARNING callout without title", () => {
    const candidate = makeCandidate("> [!WARNING]\n> Be careful");
    const result = preprocessNote(candidate, tmpDir);
    expect(result.processedBody).toContain("**WARNING**");
  });

  test("converts callout with collapsible marker", () => {
    const candidate = makeCandidate("> [!TIP]+ Collapsible tip\n> Content");
    const result = preprocessNote(candidate, tmpDir);
    expect(result.processedBody).toContain("**TIP – Collapsible tip**");
  });
});

describe("preprocessNote – wikilinks", () => {
  test("converts [[wikilink]] to plain text when file not found", () => {
    const candidate = makeCandidate("See [[Some Note]] for details.");
    const result = preprocessNote(candidate, tmpDir);
    expect(result.processedBody).toContain("Some Note");
    expect(result.processedBody).not.toContain("[[");
  });

  test("uses alias for [[target|alias]] when file not found", () => {
    const candidate = makeCandidate("Click [[Some Note|here]] to read more.");
    const result = preprocessNote(candidate, tmpDir);
    expect(result.processedBody).toContain("here");
    expect(result.processedBody).not.toContain("[[");
  });

  test("resolves [[wikilink]] to markdown link when file exists", () => {
    // Create the linked file
    fs.writeFileSync(path.join(tmpDir, "Linked Note.md"), "# Linked Note\n");
    const candidate = makeCandidate("See [[Linked Note]] for details.");
    const result = preprocessNote(candidate, tmpDir);
    expect(result.processedBody).toContain("[Linked Note]");
  });

  test("strips heading anchors from [[note#section]] links", () => {
    const candidate = makeCandidate("See [[Some Note#Introduction]].");
    const result = preprocessNote(candidate, tmpDir);
    expect(result.processedBody).not.toContain("[[");
  });
});

describe("preprocessNote – image embeds", () => {
  test("replaces ![[image.png]] with placeholder when image not found", () => {
    const candidate = makeCandidate("![[missing.png]]");
    const result = preprocessNote(candidate, tmpDir);
    expect(result.processedBody).toContain("Image not found: missing.png");
  });

  test("resolves ![[image.png]] to markdown image when file exists", () => {
    fs.writeFileSync(path.join(tmpDir, "diagram.png"), Buffer.from("PNG"));
    const candidate = makeCandidate("![[diagram.png]]");
    const result = preprocessNote(candidate, tmpDir);
    expect(result.processedBody).toContain("![diagram.png]");
    expect(result.attachments).toHaveLength(1);
  });

  test("non-image embeds render as reference text", () => {
    const candidate = makeCandidate("![[other-note]]");
    const result = preprocessNote(candidate, tmpDir);
    expect(result.processedBody).toContain("*[Embedded: other-note]*");
  });
});

describe("preprocessNote – checkboxes", () => {
  test("normalises - [x] checkboxes", () => {
    const candidate = makeCandidate("- [x] Done item");
    const result = preprocessNote(candidate, tmpDir);
    expect(result.processedBody).toContain("- [x] Done item");
  });

  test("normalises - [ ] checkboxes", () => {
    const candidate = makeCandidate("- [ ] Pending item");
    const result = preprocessNote(candidate, tmpDir);
    expect(result.processedBody).toContain("- [ ] Pending item");
  });

  test("normalises - [/] in-progress checkboxes", () => {
    const candidate = makeCandidate("- [/] In progress");
    const result = preprocessNote(candidate, tmpDir);
    expect(result.processedBody).toContain("- [~] In progress");
  });
});

describe("preprocessNote – content hash", () => {
  test("produces consistent hash for same content", () => {
    const candidate = makeCandidate("Hello, world!");
    const result1 = preprocessNote(candidate, tmpDir);
    const result2 = preprocessNote(candidate, tmpDir);
    expect(result1.contentHash).toBe(result2.contentHash);
  });

  test("produces different hashes for different content", () => {
    const a = makeCandidate("Content A");
    const b = makeCandidate("Content B");
    const result1 = preprocessNote(a, tmpDir);
    const result2 = preprocessNote(b, tmpDir);
    expect(result1.contentHash).not.toBe(result2.contentHash);
  });

  test("hash changes when an attachment changes", () => {
    const imgPath = path.join(tmpDir, "img.png");
    fs.writeFileSync(imgPath, Buffer.from("original"));
    const candidate = makeCandidate("![[img.png]]");
    const result1 = preprocessNote(candidate, tmpDir);

    fs.writeFileSync(imgPath, Buffer.from("modified content"));
    const result2 = preprocessNote(candidate, tmpDir);
    expect(result1.contentHash).not.toBe(result2.contentHash);
  });
});
