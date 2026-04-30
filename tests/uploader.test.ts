import fs from "fs";
import os from "os";
import path from "path";
import type { Config } from "../src/config";
import { saveToken, uploadPdf } from "../src/uploader";

const remarkableMock = jest.fn();

jest.mock("rmapi-js", () => ({
  remarkable: (...args: unknown[]) => remarkableMock(...args),
}));

let tmpDir: string;
let api: {
  listItems: jest.Mock;
  putFolder: jest.Mock;
  putPdf: jest.Mock;
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "o2r-uploader-test-"));
  api = {
    listItems: jest.fn().mockResolvedValue([
      { id: "folder-1", type: "CollectionType", visibleName: "Obsidian", parent: "" },
    ]),
    putFolder: jest.fn(),
    putPdf: jest.fn().mockResolvedValue({ id: "doc-1" }),
  };
  remarkableMock.mockReset();
  remarkableMock.mockResolvedValue(api);
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
    outputDir: path.join(tmpDir, "out"),
    credentialsDir: path.join(tmpDir, "credentials"),
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
  };
}

describe("uploadPdf", () => {
  test("reuses the remarkable api client and cached folder across uploads", async () => {
    const config = makeConfig();
    const pdf1 = path.join(tmpDir, "one.pdf");
    const pdf2 = path.join(tmpDir, "two.pdf");

    fs.writeFileSync(pdf1, Buffer.from("PDF1"));
    fs.writeFileSync(pdf2, Buffer.from("PDF2"));
    saveToken(config, "token-1");

    await uploadPdf(pdf1, "One", [], config);
    await uploadPdf(pdf2, "Two", [], config);

    expect(remarkableMock).toHaveBeenCalledTimes(1);
    expect(api.listItems).toHaveBeenCalledTimes(1);
    expect(api.putPdf).toHaveBeenCalledTimes(2);
  });

  test("creates nested folders once and reuses them for later uploads", async () => {
    const config = makeConfig();
    const pdf1 = path.join(tmpDir, "one.pdf");
    const pdf2 = path.join(tmpDir, "two.pdf");

    fs.writeFileSync(pdf1, Buffer.from("PDF1"));
    fs.writeFileSync(pdf2, Buffer.from("PDF2"));
    saveToken(config, "token-1");

    api.putFolder
      .mockResolvedValueOnce({ id: "folder-projects" })
      .mockResolvedValueOnce({ id: "folder-notes" });

    await uploadPdf(pdf1, "One", ["Projects", "Notes"], config);
    await uploadPdf(pdf2, "Two", ["Projects", "Notes"], config);

    expect(api.listItems).toHaveBeenCalledTimes(1);
    expect(api.putFolder).toHaveBeenCalledTimes(2);
    expect(api.putFolder.mock.calls).toEqual([
      ["Projects", { parent: "folder-1" }],
      ["Notes", { parent: "folder-projects" }],
    ]);
    expect(api.putPdf).toHaveBeenCalledTimes(2);
  });
});
