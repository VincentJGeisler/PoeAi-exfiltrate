# Changelog

## 1.0.0

### Added

- Cross-platform launcher for Edge, Chrome, and Chromium on Windows, macOS, and Linux.
- User-authenticated browser login without password or cookie-database extraction.
- Conversation export to JSON, Markdown, and HTML, including declared attachments and media.
- Complete older-message pagination and resumable chat-list discovery.
- Atomic checkpoint writes and recovery of interrupted chats.
- Randomized automatic batches with configurable batch sizes and pauses.
- Live totals for completed chats, messages, and media files.
- Configurable browser endpoint, output directory, browser executable, and profile location.
- Offline validation of catalog coverage, message ordering, attachment records, and local files.
- Portable command reference, recovery instructions, troubleshooting, and privacy guidance.

### Reliability and security

- Loopback-only browser debugging by default.
- Session request headers retained only in memory.
- Finite API, browser-debugger, and media-request timeouts.
- Manual intervention flow for login, CAPTCHA, rate-limit, and server responses.
- Development exports, browser profiles, logs, session records, and temporary files excluded from distribution.
