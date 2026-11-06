# Poe Archiver

A local, cross-platform exporter for your own Poe conversations and attachments. It saves readable Markdown and HTML, original JSON, and media files. It supports interrupted downloads, resumable indexing, randomized batches, and offline validation.

No Kimi installation, npm dependencies, password extraction, or cookie-database access is required. You log into Poe yourself in a dedicated browser window.

## Requirements

- Windows, macOS, or Linux
- Node.js 22 or later (`node --version`)
- Microsoft Edge, Google Chrome, or Chromium
- A Poe account and access to its conversations

Keep the browser window open throughout the export. The exporter communicates only with that browser's loopback debugging endpoint.

## Quick start

From the `poe-archiver` directory:

```bash
npm run launch
```

The launcher detects Edge, Chrome, or Chromium and opens a separate Poe Archiver browser profile. Log into Poe and complete any CAPTCHA manually.

Test the export with ten chats:

```bash
npm start -- --limit 10
```

Inspect the files in `exports/`. If they look correct, export the remaining history in randomized 40–60 chat batches:

```bash
npm run batch
```

When the account list reaches its end, validate the local archive:

```bash
npm run validate
```

There is no `npm install` step because the project has no external dependencies.

## Commands

### `npm run launch`

Starts a supported browser with an isolated profile and a loopback-only debugging endpoint.

```bash
npm run launch -- --browser "/path/to/browser"
npm run launch -- --profile "/path/to/browser-profile"
npm run launch -- --endpoint "http://127.0.0.1:9222"
npm run launch -- --dry-run
```

`--browser` is useful when automatic detection fails. `--dry-run` reports the detected browser, profile, and endpoint without launching anything. Do not expose the debugging port to a network.

### `npm start`

Exports unfinished chats once, then exits.

```bash
npm start                         # all currently unfinished chats
npm start -- --limit 50           # up to 50 unfinished chats
npm start -- --output "./my-poe-archive"
npm start -- --endpoint "http://127.0.0.1:9222"
npm start -- --delay 10000         # slower chat-opening delay
npm start -- --reindex            # restart account discovery from the newest chats
npm start -- --refresh --reindex  # re-export chats, not just missing ones
npm start -- --help
```

Use `--reindex` to discover newly created chats after a previous catalog reached completion. Normally, completed chats are skipped and indexing resumes from the saved cursor.

### `npm run batch`

Repeats randomized batches until the catalog reaches the end of the account chat list.

```bash
npm run batch
npm run batch -- --min-batch 40 --max-batch 60 --pause-ms 30000
npm run batch -- --limit 50 --output "./my-poe-archive"
```

Exporter options such as `--output`, `--endpoint`, `--delay`, and `--reindex` are forwarded to each batch. The default pause between batches is 30 seconds.

### `npm run validate`

Checks the archive without contacting Poe:

- Catalog coverage and completion
- JSON parsing and chat/index message counts
- Unique, chronologically ordered message IDs
- Attachment-record coverage
- Missing media, Markdown, and HTML files
- Per-chat completion status

Zero-byte media files are listed separately as warnings because a source server can return a successful but empty response. Structural problems produce a nonzero exit code.

```bash
npm run validate
npm run validate -- --output "./my-poe-archive"
```

### `npm run check`

Performs JavaScript syntax checks on all source files. It does not contact Poe.

## Output and recovery

Each chat has its own directory containing:

- `chat.json`: original message and attachment metadata
- `chat.md`: readable conversation
- `chat.html`: browser-readable conversation
- `media.json`: attachment names, local paths, and source URLs
- `media/`: downloaded attachments, when present

The export root also contains:

- `index.json`: per-chat completion and message/media counts
- `catalog.json`: discovered chats, next pagination cursor, and scan completion state

Writes are atomic. It is safe to stop and restart the exporter. An interrupted chat remains incomplete and is selected again on the next run. Do not run two exporters against the same output directory simultaneously.

Back up the entire output directory to preserve the archive. The browser profile is separate and is not part of the archive.

## Timing and intervention

- Chat-list and older-history pages: randomized 10–110 ms
- Opening a chat: randomized 1–3 seconds
- Media: up to three concurrent downloads without artificial per-file delays
- Between automatic batches: 30 seconds

The exporter waits for manual help with login redirects, CAPTCHA/Cloudflare pages, HTTP 403/429, and server errors. HTTP 422 and other unexpected statuses stop the run for diagnosis. Network, browser-debugger, and media operations have finite timeouts.

If the browser session expires, log in again in the same Poe Archiver browser window. Do not close it while the exporter is running.

## Troubleshooting

**No supported browser found**  
Pass its executable path with `npm run launch -- --browser "PATH"`.

**No Poe tab found**  
Keep the launcher-created Poe tab open, then retry. If using an existing browser endpoint, open `https://poe.com/chats` in that browser.

**Could not observe a chat-list request**  
Confirm that you are logged in and the chat list loads. Reload the tab, complete any challenge, and retry.

**A chat was interrupted**  
Run `npm start` again. Its index entry is incomplete, so it will be retried without repeating completed chats.

**New chats are not discovered after a completed export**  
Run `npm start -- --reindex` to restart discovery from the newest chats. Completed chats are still skipped.

**Validation reports zero-byte media**  
Inspect the preserved source URL in that chat's `media.json`. This can reflect an empty upstream response rather than a missing local download.

## Privacy and scope

Session request headers are held in memory and are not written to disk. Exported chats and media are personal data; store and share the archive carefully. The exporter archives conversations and declared attachments available to your logged-in account; it does not bypass access controls or retrieve deleted content.
