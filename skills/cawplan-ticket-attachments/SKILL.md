---
version: 0.2.10
name: cawplan-ticket-attachments
description: |
  List, download, upload, or add files on a CawPlan ticket — screenshots, recordings, logs, HAR, PDFs, documents, test results.
  Use when: the user wants to see/open/analyze a ticket's attachments, or to put local files (single files, a folder, or a Markdown/HTML write-up that references local files) onto a ticket, e.g. "把这个目录的文件传到 CWP-123", "attach these logs to the ticket", "submit the test results and screenshots to this ticket", "update the ticket with the latest screenshots".
  NOT for: showing ticket details without attachments (use cawplan-ticket-context), creating tickets, status/field updates without files, or QA reports (cawplan-ticket-report-generate).
argument-hint: "[ticket URL / display ID] [files, folder, or what to download]"
allowed-tools: Bash
---

# CawPlan Ticket Attachments

## Bootstrap

```bash
cawplan skill check
```

## Resolve the ticket

Get `product_id`, `version_id`, and `unique_id` (and `is_backlog`) for the ticket first:

```bash
cawplan tickets search --display_ids CWP-123
```

Extract display IDs from issue URLs (`/issue/<display-id>`, `/browse/<display-id>`). Commands below also accept the display ID in the `<ticket_id>` position.

| Action | Version ticket | Backlog ticket (`is_backlog: true`) |
|---|---|---|
| List / download | `cawplan tickets attachments list\|download <product_id> <version_id> <ticket_id>` | `cawplan backlog attachments list\|download <product_id> <ticket_id>` |
| Upload / add | `cawplan tickets attachments upload\|add <product_id> <version_id> <ticket_id>` | Not supported — the Open API only updates version tickets. Tell the user. |

## Read: list and download

Attachments are the files embedded in the ticket's rich-text fields (`remarks`, `comment`, `progress_comment`, root cause, solution): inline images and PDF / video / file blocks. Their CDN URLs are private — never fetch them directly.

```bash
cawplan tickets attachments list <product_id> <version_id> <ticket_id>
cawplan tickets attachments download <product_id> <version_id> <ticket_id> --type image,pdf
```

`download` prints a JSON summary with each local `path`; open images/PDFs/text files with the Read tool to inspect them. Use `--key <key>` (repeatable) to fetch specific files from `list`, and `--out <dir>` to choose the directory (default `./cawplan-attachments/<display_id>/` in the current directory — tell the user where files were written). Skip large videos unless the user asked for them. If the command reports `failed[]` entries or exits non-zero, report the errors as-is rather than claiming the files were retrieved.

## Write: add files to a ticket

`attachments add` uploads local files, embeds them as editor attachments (image / video / PDF / file), and saves them into one ticket field in a single update. Pick the source that matches what is on disk — do not hand-write HTML just to attach files:

| On disk | Use |
|---|---|
| A few specific files | `--file a.png --file crash.log` (repeatable, kept in order) |
| A folder of files (flat, or one subfolder per topic / test case) | `--dir <folder>` |
| A Markdown write-up referencing local files (`![](shots/a.png)`, `[rec](rec/a.mp4)`) | `--md-file notes.md` |
| An HTML document (e.g. from another skill) | `--html-file report.html` |

Exactly one source per call. Add `--note "<markdown>"` for a short explanation shown before the files.

`--dir` layout: an optional `README.md` / `index.md` / `summary.md` at the root is the intro; each subdirectory becomes a section titled by its name, with its `*.md` notes first and then its other files in name order (files the notes already reference are not repeated); loose root files are listed at the end (under "Attachments" when there is an intro or sections). Hidden files and `.DS_Store` are skipped.

```bash
cawplan tickets attachments add <product_id> <version_id> <ticket_id> --dir ./qa-results --dry-run
cawplan tickets attachments add <product_id> <version_id> <ticket_id> --dir ./qa-results [--field progress_comment|comment|remarks] [--mode append|replace]
```

- **Always `--dry-run` first** and show the user the file list, total size, target field, mode, and block id; fix every `missing[]` entry. Get an explicit go-ahead before the real call — it writes to the ticket.
- Default `--field progress_comment`, `--mode append`. Content is wrapped in a `<!-- cawplan-report:<block-id> -->` block:
  - `--dir` / `--md-file` / `--html-file`: the block id defaults to the folder / file name, so running again on the same source **replaces** that block (keeps the ticket in sync with the folder).
  - `--file`: the block id defaults to `attach-<timestamp>`, so each run **appends** a new block. Pass `--block-id <id>` to replace a specific earlier block instead.
  - `--mode replace` overwrites the whole field — only when the user asks for it.
- Each file is uploaded once (4 in parallel), then the field is saved with an optimistic-lock update (409s are re-read and retried). Nothing is written to the ticket if any file is missing or any upload fails; report `failed[]` as-is. HTML `<style>`/`<script>` are dropped.
- Allowed file types follow the web editor (images, video, audio, PDF/office, text/logs/HAR, archives, …; no executables, SVG or JS) and the workspace plan's upload size limit; rejected files show up in `failed[]` with the server's reason.

`cawplan tickets attachments upload <product_id> <version_id> <ticket_id> --file a.png` only uploads and prints each file's `url` and editor `html` snippet, without touching the ticket — use it only when the user wants to place the HTML themselves (e.g. via `cawplan tickets update --remarks`).

## Response

- Read: list the attachments (name, type, source field) or the downloaded paths; say which ones failed.
- Write: after the real call, report the ticket display ID, field, mode, block id, the uploaded files (name, type, size), and the new ticket `version`. Link the ticket as `https://app.cawplan.com/issue/<display_id>`.
