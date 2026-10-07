# Lumio Stability Baseline

**Version:** 1.0  
**Status:** ENFORCED  
**Effective:** Immediately — applies to every build from this point forward  
**Owner:** Engineering Lead  

---

## Engineering Policy

A bug is not considered fixed until:

1. The target issue is resolved.  
2. **All previously fixed P0/P1 issues remain fixed.**

No APK may be declared **FIXED**, **READY**, or **VALIDATED** unless every test in this baseline passes.

---

## Baseline Tests

### BSL-001 — App Launch

**Intent:** Confirm the app installs, starts, and opens Library without a crash.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Install APK on clean device (no prior Lumio data) | Installation succeeds |
| 2 | Tap the Lumio icon | App opens — no crash, no ANR |
| 3 | Observe first screen | Library screen is visible within 3 seconds |

**Pass Criteria:** Library screen visible. No crash dialog. No ANR.  
**Fail Criteria:** Any crash, ANR, blank screen, or hang on launch.  
**OEMs Required:** Pixel (reference), Samsung OneUI, Xiaomi HyperOS  
**Android Versions:** 13, 14, 15  
**Automated Coverage:** `__tests__/stability/baseline.test.ts` → `BSL-001`

---

### BSL-002 — Open After Share

**Intent:** Confirm the "Open Lumio After Share" setting causes the app to open after a share action.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open Lumio Settings | Settings screen visible |
| 2 | Enable **Open Lumio After Share** | Toggle is ON |
| 3 | Leave Lumio and share any web URL from Chrome | Lumio opens to the foreground within 2 seconds |
| 4 | Disable **Open Lumio After Share** | Toggle is OFF |
| 5 | Share any URL from Chrome | Lumio does **not** open to the foreground |

**Pass Criteria:** App opens when setting is ON; does not open when OFF.  
**Fail Criteria:** App never opens regardless of setting; app opens even when OFF.  
**OEMs Required:** Pixel, Samsung OneUI, Xiaomi HyperOS  
**Automated Coverage:** `__tests__/stability/baseline.test.ts` → `BSL-002`

---

### BSL-003 — Share Reliability

**Intent:** Confirm capture succeeds for the three canonical share sources.

| Step | Source | Share Action | Expected Result |
|------|--------|-------------|-----------------|
| 3a | Instagram Reel | Open any public Reel → Share → Lumio | Item captured; visible in Library |
| 3b | YouTube Video | Open any video → Share → Lumio | Item captured; visible in Library |
| 3c | Web URL (Chrome) | Open any article → Share → Lumio | Item captured; visible in Library |

**Pass Criteria:** All three sources captured successfully. Item appears in Library.  
**Fail Criteria:** Any single source fails to capture.  
**OEMs Required:** Pixel, Samsung OneUI, Xiaomi HyperOS  
**Automated Coverage:** `__tests__/stability/baseline.test.ts` → `BSL-003` (unit); manual test required for device validation  
**Related Tests:** `__tests__/native/e2eSharePipeline.test.ts`, `__tests__/services/shareIngestion.test.ts`

---

### BSL-004 — Immediate Visibility

**Intent:** Confirm a shared item appears in the Library within 2 seconds with a Queued status.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Share a URL from any source | — |
| 2 | Switch to Lumio immediately (within 500 ms) | Item is visible in Library |
| 3 | Check item status indicator | Status shows **Queued** |
| 4 | Verify time from share to Library visibility | ≤ 2 seconds |

**Pass Criteria:** Item visible within 2 seconds. Status is Queued (not invisible, not hidden, not errored).  
**Fail Criteria:** Item not visible after 2 seconds; item hidden until processing completes; item shows error state immediately.  
**Automated Coverage:** `__tests__/stability/baseline.test.ts` → `BSL-004`

---

### BSL-005 — Processing Pipeline

**Intent:** Confirm the full processing state machine: Queued → Processing → Ready.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Share a URL | Item appears with status **Queued** |
| 2 | Wait for WorkManager to begin | Status transitions to **Processing** |
| 3 | Wait for AI enrichment to complete | Status transitions to **Ready** |
| 4 | Open the item detail | Title, summary, category, tags all populated |

**Pass Criteria:** All three states observed in order. Item detail is fully populated.  
**Fail Criteria:** Item stuck in Queued indefinitely; item jumps from Queued to error; detail screen blank.  
**Timeout:** Queued → Processing ≤ 30 seconds. Processing → Ready ≤ 60 seconds on WiFi.  
**Automated Coverage:** `__tests__/stability/baseline.test.ts` → `BSL-005`  
**Related Tests:** `__tests__/native/e2eSharePipeline.test.ts`

---

### BSL-006 — Collection Integrity

**Intent:** Confirm collection item counts remain accurate after share and processing operations.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Record current item count for each collection | Baseline recorded |
| 2 | Share a URL whose content type maps to a known collection | — |
| 3 | Wait for processing to complete | — |
| 4 | Check the target collection item count | Count increased by exactly 1 |
| 5 | Verify no other collection counts changed unexpectedly | All other counts unchanged |

**Pass Criteria:** Target collection count +1. All other collection counts unchanged. No phantom counts.  
**Fail Criteria:** Count not updated; count updated for wrong collection; count shows stale data without refresh.  
**Automated Coverage:** `__tests__/stability/baseline.test.ts` → `BSL-006`  
**Related Tests:** `__tests__/services/collectionInsights.test.ts`

---

### BSL-007 — Translation Integrity

**Intent:** Confirm that previously working language detection and translation continues to work correctly.

| Step | Language | Test Input | Expected Result |
|------|----------|-----------|-----------------|
| 7a | Japanese | Share any Japanese-language URL or reel | Language detected as Japanese; content translated |
| 7b | Hindi | Share any Hindi-language URL | Language detected as Hindi; content translated |
| 7c | Marathi | Share any Marathi-language URL | Language detected as Marathi (not Hindi) |
| 7d | German | Share any German-language URL | Language detected as German; content translated |

**Pass Criteria:** Correct language detected for all four test cases. Translation output present and in English.  
**Fail Criteria:** Language misidentified; translation absent; translation in wrong language; Hindi/Marathi discrimination broken.  
**Automated Coverage:** `__tests__/stability/baseline.test.ts` → `BSL-007`  
**Related Tests:** `__tests__/services/languageDetection.test.ts`

---

### BSL-008 — Launch Integrity

**Intent:** Confirm no startup crash occurs across cold, warm, and post-share launch scenarios.

| Step | Scenario | Expected Result |
|------|----------|-----------------|
| 8a | Cold launch (app killed, reopen) | Library opens. No crash. |
| 8b | Warm launch (app backgrounded, reopen) | Library opens from same state. No crash. |
| 8c | Launch immediately after share | App is usable. No crash. No ANR. |
| 8d | Launch after device restart (no prior app state) | Library opens. No crash. |

**Pass Criteria:** All four scenarios complete without crash or ANR.  
**Fail Criteria:** Any crash dialog; any ANR; blank screen persisting > 5 seconds.  
**OEMs Required:** Pixel, Samsung OneUI, Xiaomi HyperOS  
**Automated Coverage:** `__tests__/stability/baseline.test.ts` → `BSL-008`  
**Related Tests:** `__tests__/native/nativeShareConfig.test.ts`

---

## Baseline Result Tracking

Every build under test must record results in the following format before any release declaration.

```
Lumio Stability Baseline Results
═══════════════════════════════════════════════════════
Build:        <versionName> (<versionCode>)
APK SHA-256:  <hash>
Date:         <ISO 8601>
Tester:       <name or "automated">
Device(s):    <device list>
Android:      <API levels tested>

BSL-001  App Launch              [ PASS / FAIL ]
BSL-002  Open After Share        [ PASS / FAIL ]
BSL-003  Share Reliability
  BSL-003a  Instagram Reel       [ PASS / FAIL ]
  BSL-003b  YouTube Video        [ PASS / FAIL ]
  BSL-003c  Web URL              [ PASS / FAIL ]
BSL-004  Immediate Visibility    [ PASS / FAIL ]
BSL-005  Processing Pipeline     [ PASS / FAIL ]
BSL-006  Collection Integrity    [ PASS / FAIL ]
BSL-007  Translation Integrity
  BSL-007a  Japanese             [ PASS / FAIL ]
  BSL-007b  Hindi                [ PASS / FAIL ]
  BSL-007c  Marathi              [ PASS / FAIL ]
  BSL-007d  German               [ PASS / FAIL ]
BSL-008  Launch Integrity        [ PASS / FAIL ]
═══════════════════════════════════════════════════════
BASELINE STATUS:  [ PASS / FAIL ]

PASS = all 11 checks passed.
FAIL = one or more checks failed. Release is BLOCKED.
═══════════════════════════════════════════════════════
Failed checks:
  - BSL-XXX: <description of failure>

Release Verdict:  READY / NOT READY
```

---

## Regression Gate

The following automated test suite **must pass** before any release APK is distributed.

**Command:**
```bash
npx jest __tests__/stability/baseline.test.ts --verbose
```

**Required result:** 0 failures, 0 skipped.

If the automated gate produces any failure, the build is **NOT READY** regardless of manual test results.

---

## Release Gate

A release APK may only be declared **READY** when all of the following are true:

| Gate | Check | Tool |
|------|-------|------|
| RG-1 | Automated stability baseline passes | `npx jest __tests__/stability/baseline.test.ts` |
| RG-2 | Full Jest test suite passes | `npx jest` |
| RG-3 | Manual baseline BSL-001 through BSL-008 executed on device | Tester sign-off |
| RG-4 | APK verified: NativeShareActivity in DEX | `lumio-apk-analyzer verify_dex_classes` |
| RG-5 | APK verified: ShareWorker in DEX | `lumio-apk-analyzer verify_dex_classes` |
| RG-6 | APK verified: ACTION_SEND routed to NativeShareActivity in manifest | `lumio-apk-analyzer read_manifest` |
| RG-7 | APK verified: JS bundle embedded (standalone) | `lumio-apk-analyzer verify_bundle` |
| RG-8 | APK verified: arm64-v8a ABI present | `lumio-apk-analyzer inspect_abi` |
| RG-9 | No P0 or P1 open issues | `lumio-release-blocker-triage` |
| RG-10 | No regressions vs. previous release | `lumio-regression-detective` |

**All 10 gates must be GREEN. A single RED gate blocks the release.**

---

## Escalation Protocol

If any baseline test fails after a fix was declared complete:

1. The fix is **immediately reclassified as incomplete**.
2. A new P0 issue is raised: "Regression — BSL-XXX failed after fix for [original issue]".
3. The build is pulled from distribution.
4. Root cause analysis must identify **why the regression was not caught** and add a prevention step to the regression detective checklist.
5. No new features may be merged until the baseline is clean.

---

## Amendment History

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-07-11 | Initial baseline — 8 tests, 11 checks |
