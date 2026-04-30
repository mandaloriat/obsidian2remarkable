# obsidian2remarkable

A local service that automatically exports Markdown notes from an [Obsidian](https://obsidian.md/) vault to PDF and uploads them to the [reMarkable Cloud](https://remarkable.com/) — without SSH, without direct tablet access.

## Features

- 📁 **Two selection modes**: monitor a dedicated inbox folder (`remarkable-inbox/`) or tag individual notes with `remarkable: true` frontmatter
- 🔄 **Idempotent sync**: content-hashed state database skips unchanged notes
- 📄 **Obsidian-aware conversion**: resolves `[[wikilinks]]`, `![[image embeds]]`, callouts, and checkboxes before converting to PDF
- 📤 **reMarkable Cloud upload** via [`rmapi-js`](https://github.com/erikbrinkman/rmapi-js) (no SSH, no direct tablet access)
- 🔐 **Secure credential storage**: token saved locally, never committed
- 🔁 **Automatic retry** with exponential backoff for network failures
- 👁 **Watch mode**: continuous sync triggered by vault file changes
- 🔧 **Adapter pattern**: the upload layer is decoupled from the conversion pipeline, making it easy to swap the underlying cloud client

## Requirements

| Dependency | Purpose |
|---|---|
| Node.js ≥ 18 | Runtime |
| [Pandoc](https://pandoc.org/installing.html) | PDF generation (recommended) |
| LaTeX distribution | Required by Pandoc for PDF output (e.g. `texlive-xetex`) |

> **Note:** If Pandoc is not installed, the tool falls back to `md-to-pdf` (a pure Node.js engine). PDF quality will be lower but no system dependencies are needed.

### Install Pandoc (recommended)

```bash
# macOS
brew install pandoc

# Ubuntu / Debian
sudo apt-get install pandoc texlive-xetex

# Windows (via Chocolatey)
choco install pandoc
```

## Installation

```bash
git clone https://github.com/mandaloriat/obsidian2remarkable.git
cd obsidian2remarkable
npm install
npm run build
```

Or install globally:

```bash
npm install -g .
```

## Quick Start

### 1. Authenticate with reMarkable Cloud

```bash
VAULT_PATH=/path/to/vault obsidian2remarkable auth
```

Go to [my.remarkable.com/device/desktop/connect](https://my.remarkable.com/device/desktop/connect), copy the 8-character code, and paste it when prompted.

The device token is saved in `.credentials/remarkable.token` (mode 600, never committed).

### 2. Mark notes for export

**Option A – Inbox folder**

Drop any `.md` file into `<vault>/remarkable-inbox/` and it will be picked up automatically.

**Option B – Frontmatter tag**

Add `remarkable: true` to the YAML frontmatter of any note:

```yaml
---
title: My Research Notes
remarkable: true
tags: [research, physics]
---

Note content here…
```

### 3. Run a sync

```bash
VAULT_PATH=/path/to/vault obsidian2remarkable sync-once
```

PDFs are cached in `.remarkable-export/out/` and the document appears in the **Obsidian** folder on your reMarkable.

## CLI Reference

```
obsidian2remarkable [options] <command>

Commands:
  sync-once   Export all changed notes and upload to reMarkable Cloud
  watch       Watch the vault for changes and sync automatically
  dry-run     Show what would be converted/uploaded without doing it
  repair      Force re-process all notes regardless of hash
  auth        Authenticate (or re-authenticate) with reMarkable Cloud
  status      Print the current sync status report

Global options:
  --vault <path>            Obsidian vault path (or VAULT_PATH env var)
  --output <dir>            PDF output directory (default: .remarkable-export/out)
  --credentials-dir <dir>   Credential storage directory (default: .credentials)
  --folder <name>           reMarkable target folder (default: Obsidian)
  --log-level <level>       Log verbosity: debug|info|warn|error (default: info)
```

### Examples

```bash
# Dry run – see what would be synced
VAULT_PATH=~/Documents/Vault obsidian2remarkable dry-run

# Force re-process everything
VAULT_PATH=~/Documents/Vault obsidian2remarkable repair

# Watch mode (keeps running, syncs on change)
VAULT_PATH=~/Documents/Vault obsidian2remarkable watch

# Re-authenticate (replace existing token)
obsidian2remarkable auth --code abcd1234 --force

# Use a custom reMarkable folder name
VAULT_PATH=~/Vault obsidian2remarkable sync-once --folder "My Vault"
```

## Configuration

All settings can be provided via **environment variables** or **CLI flags**:

| Environment variable | CLI flag | Default | Description |
|---|---|---|---|
| `VAULT_PATH` | `--vault` | *(required)* | Obsidian vault root |
| `OUTPUT_DIR` | `--output` | `.remarkable-export/out` | PDF cache directory |
| `CREDENTIALS_DIR` | `--credentials-dir` | `.credentials` | Token storage |
| `REMARKABLE_FOLDER` | `--folder` | `Obsidian` | Target folder in reMarkable |
| `PDF_PREFIX` | — | `Obsidian - ` | Prefix added to PDF filenames |
| `INBOX_DIR` | — | `remarkable-inbox` | Inbox subfolder in vault |
| `SCAN_FRONTMATTER` | — | `true` | Scan vault for `remarkable: true` |
| `PANDOC_BIN` | — | `pandoc` | Path to Pandoc binary |
| `PANDOC_PDF_ENGINE` | — | *(auto)* | PDF engine: `xelatex`, `weasyprint`, etc. |
| `PAGE_GEOMETRY` | — | `a4paper,top=2cm,…` | Pandoc geometry string |
| `FONT_SIZE` | — | `11pt` | Base font size |
| `MAX_RETRIES` | — | `3` | Upload retry attempts |
| `RETRY_DELAY_MS` | — | `2000` | Initial retry delay (ms) |
| `LOG_LEVEL` | `--log-level` | `info` | Log verbosity |

## Markdown Feature Support

| Feature | Support |
|---|---|
| Headings | ✅ |
| Lists & nested lists | ✅ |
| `- [x]` checkboxes | ✅ |
| Code blocks | ✅ |
| Tables | ✅ |
| Local images (`![[image.png]]`) | ✅ resolved from vault |
| Obsidian callouts (`> [!NOTE]`) | ✅ converted to blockquotes |
| Wikilinks (`[[Note]]`) | ✅ resolved to links or plain text |
| Table of contents | ✅ generated by Pandoc (3 levels) |
| YAML frontmatter | ✅ used as PDF metadata |

## State Database

The tool maintains a local JSON state database at `.remarkable-export/state.json` (configurable via `STATE_DB_PATH`). It records:

- Source path and content hash
- Generated PDF path
- Last export timestamp
- reMarkable document ID and name
- Upload status (`pending` / `uploaded` / `failed`)
- Last error message

A second run will skip any note whose hash hasn't changed and whose upload status is `uploaded`.

## Architecture

```
cli.ts          ← Commander CLI, modes: sync-once | watch | dry-run | repair | auth | status
  ↓
sync.ts         ← Orchestration pipeline
  ↓
scanner.ts      ← Discovers notes (inbox folder + remarkable frontmatter)
  ↓
preprocessor.ts ← Obsidian → standard Markdown (wikilinks, callouts, images)
  ↓
converter.ts    ← Markdown → PDF (Pandoc primary, md-to-pdf fallback)
  ↓
uploader.ts     ← PDF → reMarkable Cloud (rmapi-js adapter)
  ↓
database.ts     ← JSON idempotency database
```

The upload layer is isolated behind a simple `uploadPdfWithRetry()` interface. To swap `rmapi-js` for another client (e.g., `rmapi` CLI, a future official API), only `uploader.ts` needs to change.

## Security

- Credentials are stored in `.credentials/remarkable.token` with mode `0600`
- `.credentials/` and `*.token` are in `.gitignore` — they will never be committed
- Tokens are never logged
- Use a dedicated `CREDENTIALS_DIR` outside the repo for extra safety

## Development

```bash
# Watch mode build
npm run build:watch

# Run tests
npm test

# Lint
npm run lint
```

## Troubleshooting

**"reMarkable token not found"**
Run `obsidian2remarkable auth` first.

**"Pandoc not found"**
Install Pandoc and (for PDF output) a LaTeX distribution. The tool falls back to `md-to-pdf` automatically but Pandoc produces much better results.

**"ValidationError" from rmapi-js**
The reMarkable Cloud API is unofficial and may change. Check for updates to `rmapi-js` with `npm update rmapi-js`.

**Upload keeps failing**
Increase retries: `MAX_RETRIES=5 RETRY_DELAY_MS=5000 obsidian2remarkable sync-once`

## License

ISC
