# Collection Architecture Upgrade — Plan

## Overview

The current flat-collection model causes AI suggestions to fail assignment when the
suggested name does not exactly match a user collection. The upgrade introduces a
two-level hierarchy:

- **Level 1 — System Collections** (fixed, 9 entries, never auto-created by AI)
- **Level 2 — Topics** (AI-generated, auto-created when threshold is met)

AI assigns the Level 1 collection automatically (always) and suggests a Topic
(always). Topic auto-creation is governed by an OR-threshold:
  - ≥ 5 items with the same topic label, OR
  - ≥ 3 items across at least 2 different calendar days.

The Knowledge Hub surfaces Topics, item counts, top tags, and top sources per
collection. Topic chips are tappable and drill into a filtered item list.

A one-time migration maps legacy free-form collection names to the correct Level 1
system collection using rename-and-adopt for exact name matches.

---

## Architecture Decisions

### What changes and what stays the same

| Area | Current | After |
|---|---|---|
| `collections` table | Flat, user-created | Gains `is_system` flag |
| `saved_items` table | `collection_id` only | Gains `topic_id` FK + `topic_suggestion` staging |
| New `topics` table | Does not exist | Stores AI-suggested topic labels per system collection |
| AI prompt | Sends all collection names, gets name suggestions | Sends system collection list; also asks for `topicSuggestion` |
| Collection matching | Lowercase name lookup (fails on non-existent) | Category → fixed system collection ID (deterministic) |
| Topic creation | N/A | OR-threshold: 5 items, or 3 items across 2+ days |
| Topic dedup | N/A | Normalization + canonical merge table |
| Knowledge Hub UI | Flat collection list | Collection → tappable Topics chips |

### Why Category drives Level 1 assignment

The AI already returns `category` from a fixed 16-value enum (`ContentCategory`).
All 16 values now map to a system collection (the 6 unmapped categories are
redirected as specified). This is fully deterministic — no name matching involved.

### Complete category → system collection map (approved)

| ContentCategory | System Collection |
|---|---|
| Finance | `sys-finance` |
| Technology | `sys-technology` |
| Learning | `sys-learning` |
| Real Estate | `sys-real-estate` |
| Travel | `sys-travel` |
| Food | `sys-food` |
| Entertainment | `sys-entertainment` |
| Career | `sys-career` |
| Research | `sys-research` |
| Science | `sys-research` |
| Other | `sys-research` |
| Business | `sys-career` |
| Health | `sys-learning` |
| Sports | `sys-entertainment` |
| Lifestyle | `sys-learning` |
| Politics | `sys-research` |
| Design | `sys-technology` |

All 16 values are mapped. The `pendingAutoAssignPrompt` for unmapped categories
is no longer needed — this simplifies `CaptureQueueContext` significantly.

### Topic threshold (approved)

A Topic is auto-created when EITHER:
  - `COUNT(items with this label in this collection) >= 5`, OR
  - `COUNT(DISTINCT DATE(created_at) WHERE label matches) >= 2`
    AND `COUNT(items) >= 3`

This prevents burst-saves from instantly creating noise topics while still
capturing genuine multi-session interest patterns early.

### Topic normalization / merge rules (approved)

Before persisting `topic_suggestion` and before threshold checks, apply
normalization so near-duplicate labels converge:

1. **Lowercase trim** — strip leading/trailing whitespace, lowercase.
2. **Possessive strip** — remove trailing `'s` (e.g. "Buffett's strategy" → "buffett strategy").
3. **Stop-word reduction** — strip leading articles/prepositions: "the", "a", "an", "in", "on", "for", "of".
4. **Singular form** — strip trailing "s" from words ≥ 6 chars (simple plurals only).
5. **Canonical map lookup** — after normalization, check a hard-coded canonical map
   (e.g. `"dividend investing" → "dividend investing"`, `"dividend stocks" → "dividend investing"`)
   defined in `src/constants/topicNormalization.ts`.

The normalized form is what gets written to `topic_suggestion` and matched against
existing topics. The original AI-suggested label is preserved in the item's
`topic_suggestion_raw` field (for diagnostics).

### Migration strategy

The existing `runSafe(ALTER TABLE ADD COLUMN)` pattern handles additive column
migrations. New tables use `CREATE TABLE IF NOT EXISTS`. The legacy name → system
collection mapping runs as a one-time `UPDATE` at startup — idempotent, safe to
repeat. No collection rows are deleted; orphan user collection rows remain and the
user may delete them manually.

---

## System Collections (Level 1)

These 9 collections are seeded at startup. They cannot be deleted by the user.

| ID (fixed) | Name | Icon | Color |
|---|---|---|---|
| `sys-finance` | Finance | `cash` | `#10b981` |
| `sys-technology` | Technology | `hardware-chip` | `#0ea5e9` |
| `sys-learning` | Learning | `school` | `#3b82f6` |
| `sys-real-estate` | Real Estate | `home` | `#f59e0b` |
| `sys-travel` | Travel | `airplane` | `#8b5cf6` |
| `sys-food` | Food | `restaurant` | `#ef4444` |
| `sys-entertainment` | Entertainment | `film` | `#ec4899` |
| `sys-career` | Career | `briefcase` | `#6366f1` |
| `sys-research` | Research | `search` | `#64748b` |

---

## Sub-Tasks

---

### Sub-Task 1 — Database Schema

**Status:** [x] done

**Intent**

Add the `topics` table, `is_system` column on `collections`, `topic_id` and
`topic_suggestion` columns on `saved_items`. Seed the 9 system collections.

**Expected Outcomes**

- `topics` table exists with columns: `id TEXT PK`, `label TEXT NOT NULL`,
  `normalized_label TEXT NOT NULL`, `parent_collection_id TEXT NOT NULL`,
  `item_count INTEGER DEFAULT 0`, `created_at TEXT NOT NULL`.
  Unique constraint on `(normalized_label, parent_collection_id)`.
- `collections.is_system` column exists (INTEGER NOT NULL DEFAULT 0).
- `saved_items.topic_id` column exists (TEXT nullable).
- `saved_items.topic_suggestion` column exists (TEXT nullable) — normalized label.
- `saved_items.topic_suggestion_raw` column exists (TEXT nullable) — original AI label.
- 9 system collection rows exist with `is_system = 1` and fixed IDs.
- Existing user-created collections untouched.

**Todo List**

1. In `src/database/db.ts`: add `CREATE TABLE IF NOT EXISTS topics (...)` with the
   columns and unique constraint listed above.
2. Add `runSafe(ALTER TABLE collections ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0)`.
3. Add `runSafe(ALTER TABLE saved_items ADD COLUMN topic_id TEXT)`.
4. Add `runSafe(ALTER TABLE saved_items ADD COLUMN topic_suggestion TEXT)`.
5. Add `runSafe(ALTER TABLE saved_items ADD COLUMN topic_suggestion_raw TEXT)`.
6. Replace `seedDefaultCollections()` with `seedSystemCollections()` using the fixed
   IDs and `INSERT OR IGNORE` (never overwrites existing rows).
7. Call `seedSystemCollections()` unconditionally after DDL (not count-gated).

**Relevant Context**

- `src/database/db.ts` — `initDatabase()`, `seedDefaultCollections()`, `runSafe()`
- System collection table in this plan (IDs, names, icons, colors)

---

### Sub-Task 2 — Types and Constants

**Status:** [x] done

**Intent**

Add TypeScript types for `Topic`, extend `Collection` with `isSystem`, extend
`SavedItem` with `topicId`/`topicSuggestion`/`topicSuggestionRaw`, and add the
`SYSTEM_COLLECTION_MAP` constant (all 16 categories mapped).

**Expected Outcomes**

- `Topic` interface exported from `src/types/index.ts` with fields:
  `id`, `label`, `normalizedLabel`, `parentCollectionId`, `itemCount`, `createdAt`.
- `Collection.isSystem: boolean` added.
- `SavedItem.topicId?: string` added.
- `SavedItem.topicSuggestion?: string` added (normalized).
- `SavedItem.topicSuggestionRaw?: string` added (original AI text).
- `SYSTEM_COLLECTION_MAP: Record<ContentCategory, string>` exported from
  `src/constants/systemCollections.ts` — covers all 16 `ContentCategory` values.
- `SYSTEM_COLLECTIONS` seed array exported (id, name, icon, color) for `db.ts`.

**Todo List**

1. Add `Topic` interface to `src/types/index.ts`.
2. Add `isSystem: boolean` to `Collection`.
3. Add `topicId`, `topicSuggestion`, `topicSuggestionRaw` to `SavedItem`.
4. Create `src/constants/systemCollections.ts` with `SYSTEM_COLLECTION_MAP`,
   `SYSTEM_COLLECTIONS` seed array, and re-export from `src/constants/index.ts`.
5. `tsc --noEmit` must pass with zero errors.

**Relevant Context**

- `src/types/index.ts` — `Collection`, `SavedItem`, `ContentCategory`
- `src/constants/index.ts` — existing barrel file

---

### Sub-Task 3 — Topic Normalization

**Status:** [x] done

**Intent**

Create `src/services/topicNormalization.ts` with the normalization pipeline and
canonical merge map. This is used in Sub-Tasks 5 and 6 to ensure consistent labels.

**Expected Outcomes**

- `normalizeTopicLabel(raw: string): string` function exported:
  1. Lowercase + trim.
  2. Strip trailing `'s`.
  3. Strip leading stop words (the, a, an, in, on, for, of).
  4. Strip trailing "s" from words ≥ 6 chars.
  5. Canonical map lookup (returns canonical form if found).
- `TOPIC_CANONICAL_MAP: Record<string, string>` exported (hard-coded, can be extended):
  - `"dividend stocks" → "dividend investing"`
  - `"dividend shares" → "dividend investing"`
  - `"property deals" → "property investment"`
  - `"renting" → "rental properties"`
  - `"real estate listings" → "property investment"`
  - (extend as needed)
- Unit tests in `__tests__/services/topicNormalization.test.ts` covering each
  normalization step and canonical map lookups.

**Todo List**

1. Create `src/services/topicNormalization.ts`.
2. Implement `normalizeTopicLabel` with the 5-step pipeline.
3. Define `TOPIC_CANONICAL_MAP`.
4. Create `__tests__/services/topicNormalization.test.ts` with ≥ 10 test cases.
5. `tsc --noEmit` clean.

**Relevant Context**

- No existing normalization code — new file.

---

### Sub-Task 4 — Data Layer: Topics and Collections

**Status:** [x] done

**Intent**

Create `src/database/topics.ts` with CRUD and threshold logic. Update
`collections.ts` and `items.ts` for new columns.

**Expected Outcomes**

- `src/database/topics.ts` with:
  - `getTopicsByCollection(collectionId): Promise<Topic[]>`
  - `getAllTopics(): Promise<Topic[]>` — for batch loading in the UI.
  - `maybeAutoCreateTopic(normalizedLabel, rawLabel, collectionId, db): Promise<Topic | null>`
    — applies the OR-threshold rule (≥5 items OR ≥3 items across ≥2 days),
      creates topic if met, backfills `topic_id` on all qualifying items,
      returns null if threshold not met.
  - `getTopicById(id): Promise<Topic | null>`
  - `getItemsByTopic(topicId): Promise<SavedItem[]>`
- `src/database/collections.ts`:
  - `rowToCollection` includes `isSystem` (`is_system !== 0`).
  - `saveCollection` writes `is_system`.
  - `getAllCollections` selects `is_system`.
- `src/database/items.ts`:
  - `rowToItem` maps `topic_id`, `topic_suggestion`, `topic_suggestion_raw`.
  - `saveItem` and `updateItem` handle the three new fields.

**Todo List**

1. Create `src/database/topics.ts` with the five functions above.
   `maybeAutoCreateTopic` runs two COUNT queries:
   - `SELECT COUNT(*) FROM saved_items WHERE topic_suggestion = ? AND collection_id = ?`
   - `SELECT COUNT(DISTINCT DATE(created_at)) FROM saved_items WHERE topic_suggestion = ? AND collection_id = ?`
   Creates topic if `total >= 5` OR (`total >= 3` AND `distinctDays >= 2`).
   On creation: `INSERT INTO topics ...`, then
   `UPDATE saved_items SET topic_id = ? WHERE topic_suggestion = ? AND collection_id = ?`.
2. Update `collections.ts` mapper, `saveCollection`, `getAllCollections`.
3. Update `items.ts` mapper, `saveItem`, `updateItem`.
4. `tsc --noEmit` clean.

**Relevant Context**

- `src/database/collections.ts`, `src/database/items.ts`
- `src/types/index.ts` — `Topic` (from Sub-Task 2)
- `src/services/topicNormalization.ts` (from Sub-Task 3)

---

### Sub-Task 5 — Migration: Legacy Name → System Collection

**Status:** [x] done

**Intent**

At startup, two idempotent passes migrate existing data to the new system collection
IDs. Existing item assignments and counts are fully preserved.

**Expected Outcomes**

- **Pass 1 — rename-and-adopt**: User collections whose name matches a system
  collection name have their `id` updated to the fixed system ID and `is_system`
  set to 1. All `saved_items.collection_id` FKs are updated to the new system ID.
- **Pass 2 — alias remap**: Items assigned to collections with known legacy alias
  names are moved to the canonical system collection.
- No collection rows are deleted. Orphan user rows remain.
- Diagnostic entry emitted with migrated row counts.

**Full name-to-system-ID table**

| Collection name (case-insensitive) | System collection ID |
|---|---|
| Finance | `sys-finance` |
| Investing | `sys-finance` |
| Technology | `sys-technology` |
| Learning | `sys-learning` |
| Real Estate | `sys-real-estate` |
| Travel | `sys-travel` |
| Food | `sys-food` |
| Entertainment | `sys-entertainment` |
| Career | `sys-career` |
| Research | `sys-research` |
| Property & Land Deals | `sys-real-estate` |
| Renting & Housing | `sys-real-estate` |
| Real Estate Listings | `sys-real-estate` |
| Dividend Investing | `sys-finance` |
| Stock Market | `sys-finance` |

**Todo List**

1. Create `src/database/migrations.ts` with `runLegacyCollectionMigration(db)`.
2. Pass 1 for each system-name match:
   ```sql
   UPDATE saved_items SET collection_id = '<sys-id>'
   WHERE collection_id IN (
     SELECT id FROM collections
     WHERE lower(name) = lower('<name>') AND id != '<sys-id>'
   );
   UPDATE collections SET id = '<sys-id>', is_system = 1
   WHERE lower(name) = lower('<name>') AND id != '<sys-id>';
   ```
   Note: items FK update MUST run before the collections ID update.
3. Pass 2 for each alias name (same item-update pattern, no collections row update).
4. Wrap each statement pair in try/catch (not `runSafe`) to log counts via `diagLog`.
5. Call `runLegacyCollectionMigration` from `initDatabase()` after seeding.

**Relevant Context**

- `src/database/db.ts` — `initDatabase()`, call site for migration
- `src/services/diagnostics.ts` — `diagLog.addEntry`

---

### Sub-Task 6 — AI Prompt and captureQueue Assignment

**Status:** [x] done

**Intent**

Update `summarizeItem` to request `topicSuggestion` from the AI and use the system
collection name list. Update `captureQueue.ts` to perform deterministic Level 1
assignment and persist the normalized topic suggestion.

**Expected Outcomes**

- `AISummarizeResult.topicSuggestion?: string` added.
- `summarizeItem` parameter renamed from `collectionNames` to `systemCollectionNames`.
  The AI prompt tells the model these are fixed system buckets and to return a
  `topicSuggestion` sub-label within the chosen collection.
- In `captureQueue.ts` enrichment, after `result.category` is set:
  1. Look up `SYSTEM_COLLECTION_MAP[result.category]` → `systemCollectionId`.
  2. If found: `dbUpdates.collectionId = systemCollectionId` (silent, no prompt).
  3. Skip the existing name-matching block entirely for mapped categories.
  4. If `result.topicSuggestion` is set:
     - Normalize via `normalizeTopicLabel(result.topicSuggestion)`.
     - Write `dbUpdates.topicSuggestion = normalizedLabel`.
     - Write `dbUpdates.topicSuggestionRaw = result.topicSuggestion`.
- `pendingAutoAssignPrompt` path is removed entirely — all categories now map.
- `CaptureQueueContext.enqueue` removes `collectionNames`, `collectionIds`,
  `collectionDisplayNames` parameters (no longer needed).
- `CaptureEntry.pendingAutoAssignPrompt` field and all consuming code in
  `CaptureQueueContext` removed.

**Todo List**

1. Add `topicSuggestion?: string` to `AISummarizeResult` in `src/types/index.ts`
   (or `src/services/ai.ts` if defined there).
2. Rename `collectionNames` → `systemCollectionNames` in `summarizeItem` signature.
3. Update the AI system prompt `collectionHint` to describe system collection buckets
   and ask for `"topicSuggestion": "short topic label within the collection"`.
4. Update AI response parsing to extract `topicSuggestion` string.
5. In `captureQueue.ts`, import `SYSTEM_COLLECTION_MAP` and `normalizeTopicLabel`.
6. Replace the collection assignment block: pre-check `SYSTEM_COLLECTION_MAP`,
   assign directly, skip name-matching.
7. Persist `topicSuggestion` + `topicSuggestionRaw` on `dbUpdates`.
8. Remove `pendingAutoAssignPrompt` from `CaptureEntry`, `captureQueue.ts`,
   and `CaptureQueueContext.tsx`.
9. Remove collection-map parameters from `enqueueCapture` opts and
   `CaptureQueueContext.enqueue`.
10. `tsc --noEmit` clean.

**Relevant Context**

- `src/services/ai.ts` lines 454–490 — `summarizeItem`, `collectionHint`, prompt
- `src/services/captureQueue.ts` lines 385–466 — category + collection assignment
- `src/context/CaptureQueueContext.tsx` lines 159–181 — collection maps + prompt
- `src/types/index.ts` — `AISummarizeResult`, `CaptureEntry`

---

### Sub-Task 7 — Topic Auto-Creation in captureQueue

**Status:** [x] done

**Intent**

After the enrichment DB write, call `maybeAutoCreateTopic` to apply the OR-threshold
rule and silently promote a topic if warranted. Trigger a UI refresh on creation.

**Expected Outcomes**

- At the end of `runEnrichment` in `captureQueue.ts`, after all DB updates are
  written, if `dbUpdates.topicSuggestion` and `dbUpdates.collectionId` are both set:
  call `maybeAutoCreateTopic(normalizedLabel, rawLabel, collectionId)`.
- If a topic is created, call `opts.onRefresh?.()` to update the Knowledge Hub.
- Topic creation is silent — no user prompt, no banner.
- Diagnostic entry emitted: `QUEUE_ITEM_CREATED` with `topic=<label> created=<bool>`.

**Todo List**

1. Import `maybeAutoCreateTopic` from `src/database/topics.ts` in `captureQueue.ts`.
2. After the final `updateItem(itemId, dbUpdates)` call, if topic suggestion and
   collection ID are present, call `maybeAutoCreateTopic`.
3. If the return value is non-null (topic was just created), call `opts.onRefresh?.()`.
4. Emit diagnostic entry.
5. `tsc --noEmit` clean.

**Relevant Context**

- `src/services/captureQueue.ts` — enrichment completion block
- `src/database/topics.ts` — `maybeAutoCreateTopic` (from Sub-Task 4)

---

### Sub-Task 8 — Knowledge Hub UI

**Status:** [x] done

**Intent**

Update `CollectionCard` and the collections screen to show Topics. Make topic chips
tappable. Add the topic-filtered item list screen. Guard system collections from
delete/rename.

**Expected Outcomes**

- `app/(tabs)/collections.tsx`: fetches all topics on focus via `getAllTopics()`,
  builds a `topicsByCollection: Record<string, Topic[]>` map, passes relevant slice
  to each `CollectionCard`.
- `CollectionCard` shows up to 3 tappable topic chips; navigates to
  `/collection/[collectionId]/topic/[topicId]` on press.
- `CollectionCard` shows a lock icon or "System" pill when `collection.isSystem`.
- System collections cannot be deleted (no delete action shown).
- `app/collection/[id].tsx`: fetches topics via `getTopicsByCollection(id)` and
  renders a "Topics" section with label + item count chips.
- New screen `app/collection/[id]/topic/[topicId].tsx`: loads items via
  `getItemsByTopic(topicId)`, renders a searchable `FlatList` of `ItemCard`s
  with the topic name as the header title.

**Todo List**

1. Update `app/(tabs)/collections.tsx`: add `getAllTopics()` call on focus, build
   `topicsByCollection` map, pass `topics` prop to `CollectionCard`.
2. Update `CollectionCard` props to accept `topics: Topic[]`. Add tappable chip
   row and system-lock badge.
3. Update `app/collection/[id].tsx`: add `getTopicsByCollection` call, render Topics
   section, guard delete/rename for `collection.isSystem`.
4. Create `app/collection/[id]/topic/[topicId].tsx` using `getItemsByTopic`.
5. `tsc --noEmit` clean.

**Relevant Context**

- `src/components/CollectionCard.tsx`
- `app/(tabs)/collections.tsx`
- `app/collection/[id].tsx`
- `src/database/topics.ts` — `getAllTopics`, `getTopicsByCollection`, `getItemsByTopic`
- `src/types/index.ts` — `Topic`, `Collection.isSystem`

---

### Sub-Task 9 — Tests

**Status:** [x] done

**Intent**

Update existing tests for the new prompt shape and collection assignment. Add tests
for normalization, threshold logic, and migration.

**Expected Outcomes**

- `__tests__/services/ai.test.ts`: updated for `systemCollectionNames` parameter
  and `topicSuggestion` in parsed result.
- `__tests__/services/topicNormalization.test.ts` (from Sub-Task 3): ≥ 10 cases.
- `__tests__/database/topics.test.ts`: threshold logic (5-item rule, 2-day rule,
  idempotent creation, backfill of `topic_id`).
- `__tests__/database/migration.test.ts`: rename-and-adopt pass, alias remap pass.
- All existing 51 tests pass; total test count increases.

**Todo List**

1. Update `ai.test.ts` for new prompt and `topicSuggestion` output.
2. Create `__tests__/database/topics.test.ts`.
3. Create `__tests__/database/migration.test.ts`.
4. Run `npx jest --no-coverage` — zero failures.

**Relevant Context**

- `__tests__/services/ai.test.ts`
- `__tests__/services/collectionInsights.test.ts` — existing patterns

---

## Data Flow After Upgrade

```
Share → enqueueCapture()
      → AI: summarizeItem(systemCollectionNames)
            returns { category: "Real Estate", topicSuggestion: "Property Investment" }
      → SYSTEM_COLLECTION_MAP["Real Estate"] = "sys-real-estate"  (deterministic)
      → normalizeTopicLabel("Property Investment") = "property investment"
      → updateItem({ collectionId: "sys-real-estate",
                     topicSuggestion: "property investment",
                     topicSuggestionRaw: "Property Investment" })
      → maybeAutoCreateTopic("property investment", "sys-real-estate")
            total=3, distinctDays=2  → threshold met → Topic created
            UPDATE saved_items SET topic_id = <new-topic-id> WHERE topic_suggestion = ...
      → refreshAll()  →  Knowledge Hub re-renders with new Topic chip
```

## Non-Goals

- User-created topics (outside the AI suggestion flow).
- More than 2 hierarchy levels.
- Deleting or renaming system collections from within the app.
- Real-time cross-device sync of topics.
- No "General" or "Other" collection is introduced.
