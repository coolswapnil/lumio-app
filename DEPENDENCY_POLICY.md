# Dependency Policy

This document defines how dependencies in the Lumio app are managed,
upgraded, and validated. Every contributor and automated tool (Dependabot,
Renovate, CI) must follow this policy.

---

## Guiding Principle

> **Never upgrade a runtime dependency in isolation.**
> All Expo ecosystem packages must move together on a coordinated timeline.

The React Native / Expo ecosystem has tight, peer-dependency coupling across
dozens of packages. Upgrading one package without upgrading its siblings
causes ERESOLVE conflicts, runtime crashes, or subtle behaviour regressions.

---

## Dependency Tiers

### Tier 1 — Expo Core (coordinated upgrades only)

These packages must be upgraded **together** in a single PR. They are all
tied to a specific Expo SDK release:

| Package | Expo 52 pin |
|---|---|
| `expo` | `~52.0.x` |
| `react` | `18.3.1` (exact) |
| `react-native` | `0.76.x` |
| `react-test-renderer` | `18.3.1` (exact — must equal `react`) |
| `expo-router` | `~4.0.x` |
| All `expo-*` packages | As specified in SDK 52 compat table |
| `react-native-safe-area-context` | `4.12.0` (SDK-pinned) |
| `react-native-screens` | `~4.4.0` |
| `react-native-gesture-handler` | `~2.20.2` |
| `react-native-reanimated` | `~3.16.1` |

**How to upgrade Tier 1:**

1. Check the new Expo SDK release notes and migration guide.
2. Run `npx expo install --fix` to get the full official version table.
3. Update **all** Tier 1 packages simultaneously in one PR.
4. Run `npx expo-doctor` — must report zero issues.
5. Run `npm ls` — must report zero unmet peers.
6. Run all tests — must pass.
7. Get manual approval from a maintainer before merging.

**Never:**
- Bump `react` without bumping `react-test-renderer` to the exact same version.
- Accept a Dependabot PR that bumps only one Expo SDK package.
- Use `--force` or `--legacy-peer-deps` to work around peer conflicts.

---

### Tier 2 — React Navigation (grouped upgrades)

| Package |
|---|
| `@react-navigation/native` |
| `@react-navigation/bottom-tabs` |
| `@react-navigation/stack` |

Upgrade all navigation packages in the same PR. Navigation packages share
internal APIs and must stay on the same major version.

---

### Tier 3 — Testing Stack

| Package | Rule |
|---|---|
| `jest` | Must stay compatible with `jest-expo` |
| `jest-expo` | Must match Expo SDK major |
| `react-test-renderer` | **Must equal `react` exactly** (see Tier 1) |
| `@testing-library/react-native` | Upgrade in same PR as `react-test-renderer` |
| `@testing-library/jest-native` | Minor/patch upgrades are safe independently |

---

### Tier 4 — TypeScript Tooling (independent upgrades safe)

`typescript`, `@types/*`, `@typescript-eslint/*`, `eslint`, `@babel/*`,
`babel-preset-expo` — these can be upgraded independently. They do not
affect runtime behaviour.

---

### Tier 5 — Utility Libraries (independent upgrades safe)

`dayjs`, `zod`, `react-hook-form`, `@hookform/resolvers`, `react-native-uuid`,
`react-native-paper`, `react-native-material-you-colors`, etc.

Minor/patch upgrades are generally safe. Major upgrades require a migration PR.

---

## The `overrides` Block

`package.json` contains an `overrides` block:

```json
"overrides": {
  "react-test-renderer": "18.3.1"
}
```

**Why:** `@testing-library/react-native` has an unbounded peer dep
(`react-test-renderer@>=16.8.0`). Without `overrides`, npm resolves this
to the latest version (19.x), which conflicts with `react@18`. The `overrides`
block forces npm to use exactly `18.3.1` for every consumer in the tree.

**Rule:** `overrides["react-test-renderer"]` must always equal
`devDependencies["react-test-renderer"]` which must always equal
`dependencies["react"]`.

This is enforced by CI (`pr-check.yml` — Dependency Health Check job).

---

## How to Process Dependabot PRs

### PRs you can merge directly (after CI passes):

- TypeScript tooling group
- ESLint group
- `dayjs`, `zod`, `react-hook-form`, `@hookform/resolvers`
- GitHub Actions group

### PRs requiring manual review before merge:

- `expo-ecosystem` group (any Expo SDK package)
- `react-navigation` group
- `testing` group

### PRs that must be **closed** (never merged):

- Any PR that bumps `react`, `react-native`, or `react-test-renderer` alone
  (not as part of the `expo-ecosystem` group)
- Any PR that bumps `expo` to a new major version
  (requires a full migration PR instead)

---

## CI Gate (must pass on every PR)

All pull requests and branch pushes run `pr-check.yml`, which enforces:

1. **`npm install`** — must succeed without `--force` or `--legacy-peer-deps`
2. **`npm ls`** — must exit 0 (zero unmet peers, zero invalid packages)
3. **`npm doctor`** — informational, non-blocking
4. **`npx expo-doctor`** — must report zero errors/incompatibilities
5. **react-test-renderer version gate** — major must equal `react` major
6. **overrides gate** — `overrides.react-test-renderer` must equal `devDependencies.react-test-renderer`
7. **Expo SDK compat gate** — validates `react` and `react-native` match the SDK's required versions
8. **`npm audit`** — fails on moderate+ (CVSS >= 4.0) vulnerabilities
9. **Secret scan** — fails on hardcoded API keys/tokens

No PR merges if any of the above fail.

---

## Upgrading Expo SDK (major migration)

When a new Expo SDK is released (e.g. SDK 53):

1. Create a branch: `expo-sdk-{version}-upgrade`
2. Run `npx expo install expo@next --fix` (or the specific version)
3. Update the compat table in this file
4. Update the CI Expo compat check in `pr-check.yml`
5. Run `npx expo-doctor` — fix every reported issue
6. Run `npm ls` — fix every unmet peer
7. Run `npm test` — fix every failing test
8. Update `app.json` → `versionCode` and `version`
9. Get sign-off from at least one reviewer
10. Merge and immediately cut a new release

---

## Quick Reference

```bash
# Check current dependency health
npm ls
npx expo-doctor

# Fix Expo version conflicts
npx expo install --fix

# After any change to package.json, verify
npm install && npm ls && npx expo-doctor
```
