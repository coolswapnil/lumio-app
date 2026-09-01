# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 2.x     | ✅ Yes    |
| < 2.0   | ❌ No     |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub Issues.**

Email: [security@lumio.app](mailto:security@lumio.app) (replace with actual contact)

Response SLA:
- Acknowledgement: within 48 hours
- Initial assessment: within 7 days
- Patch for Critical/High issues: within 30 days

---

## Security Architecture

### API Key Storage

- All AI provider API keys are stored using **`expo-secure-store`** which maps to:
  - Android: **Android Keystore System** (hardware-backed on supported devices)
  - iOS: **Keychain** (encrypted at rest)
- Keys are **never** written to SQLite, AsyncStorage, or any unencrypted storage.
- Keys are **never** logged, exported, or transmitted except to the configured AI provider's own endpoint.
- The JSON export feature exports only user-saved items and collections — never API keys or settings.

### Network Security

- All API calls use **HTTPS** (TLS 1.2+).
- The Google Gemini API key is sent via the `x-goog-api-key` **header**, not as a URL query parameter, to prevent exposure in server logs and browser history.
- No third-party analytics, tracking, or telemetry SDKs are included.

### Deep Link Security

All parameters received via Android share-sheet intents (`ACTION_SEND`) or deep links (`lumio://`) are:
1. Sanitized with `asString()` — strips control characters and null bytes.
2. URL fields are validated with `isValidUrl()` — only `http://` and `https://` schemes accepted.
3. Text fields are length-limited by `sanitizeText()` before being persisted.
4. Collection IDs are validated with `isValidId()` before database lookup.

Potentially dangerous schemes (`javascript:`, `data:`, `vbscript:`) are rejected outright.

### Data Storage

- All user data (saved items, collections) is stored in a **local SQLite database** using `expo-sqlite`.
- The database is **not encrypted at rest** by default. Users who require encryption should use a custom build with SQLCipher.
- GPS coordinates and location data are stored unencrypted. Users should be aware of this if device security is a concern.

### Clipboard Access

- Lumio requests clipboard access only when the user explicitly taps **"Paste URL"** in the save dialog.
- Clipboard contents are validated as safe `http(s)://` URLs before use.
- No clipboard data is ever transmitted or stored without user confirmation.

### Input Validation

All user inputs are validated and sanitized:

| Field        | Max Length | Validation          |
|--------------|-----------|---------------------|
| Title        | 200 chars  | Text sanitization   |
| Description  | 2,000 chars| Text sanitization   |
| Notes        | 5,000 chars| Text sanitization   |
| URL          | 2,048 chars| URL scheme check    |
| Tags         | 50 chars each, 20 max | Lowercase, dedup |
| Address      | 300 chars  | Text sanitization   |
| Collection name | 100 chars | Text sanitization |

### Build Security

- Release APKs are signed using a keystore.
- CI/CD runs `npm audit --audit-level=moderate` on every PR to detect vulnerable dependencies.
- CI/CD scans for hardcoded secrets/credentials in source files on every PR.
- The `build-apk.yml` workflow uses `npm ci` (not `npm install`) to ensure reproducible builds from the lockfile.

### Error Handling

- Stack traces and detailed error messages are **never exposed to end users**.
- The `getUserMessage()` utility returns generic, safe messages to the UI.
- Full error details are only logged server-side (or via Sentry in production).

---

## Known Limitations

1. **SQLite data is not encrypted at rest.** If a device is compromised at the OS level (rooted/jailbroken), the database can be read. For high-security use cases, integrate SQLCipher.

2. **No certificate pinning.** TLS is used for all external API calls but without certificate pinning. A network-level MITM on a compromised certificate authority could intercept API key exchanges.

3. **Clipboard prompt shown on every save screen open.** Future versions may allow users to disable this prompt in Settings.

---

## Dependency Management

Dependencies are scanned on every PR using `npm audit`. The policy is:

| Severity | Action |
|----------|--------|
| Critical (CVSS ≥ 9.0) | Block merge, fix within 24 hours |
| High (CVSS 7.0–8.9) | Block merge, fix within 30 days |
| Moderate (CVSS 4.0–6.9) | Warning, fix within 90 days |
| Low (CVSS < 4.0) | Track, fix in next release |
