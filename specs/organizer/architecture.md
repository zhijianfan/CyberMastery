# IndexedDB Organizer — Architecture

Status: proposed
Companion: [../IndexedDB Organizer Backend Architecture.md](../IndexedDB%20Organizer%20Backend%20Architecture.md) (full design reference)

## 1. Goals

A browser-based local-first organizer for large text files, JSON documents,
binary files, and pictures. Works fully offline for local use; when a host
server is configured, its database is the single authority for all shared
state, and the client converges to it on every synchronization.

- Hierarchical folders, tags, favorites, pinning, custom metadata
- Exact duplicate detection (hash), optional near-duplicate image grouping
- Large-file search, structured JSON search with record-level updates
- Offline writes, crash-safe imports, incremental upload/download
- Cross-device revision + metadata sync, revision history, conflict preservation
- Storage quota monitoring, garbage collection, IndexedDB ⇄ OPFS migration

Non-goals for v1: real-time collaborative editing, arbitrary binary diffs,
automatic semantic merge of arbitrary JSON, serverless sync, authoritative
perceptual or full-text indexes.

## 2. Core decision

**IndexedDB is the local catalog, revision store, transaction log, and sync
state database.** File content is stored as immutable, content-addressed
chunks addressed by SHA-256:

```
Asset
  └── Current Revision
        └── Manifest
              ├── Chunk sha256:A
              ├── Chunk sha256:B
              └── Chunk sha256:C
```

**When a host server is configured, its database is always authoritative for
shared state.** The client IndexedDB catalog is a replica and offline buffer:
it serves reads and offline writes, but every synchronized entity must
converge to the server's version. The server assigns `serverVersion`, orders
the global change log, resolves conflicts, and is the only source a client
may trust to rebuild its catalog after loss.

### Invariants

1. Asset IDs are stable; rename/move does not change identity.
2. Revisions are immutable; every content edit creates a new revision.
3. Chunks are immutable and content-addressed.
4. Derived data (search indexes, thumbnails, parsed caches) is disposable.
5. Hashes detect identical content; versions detect conflicts.
6. Unsynchronized content is never garbage-collected.
7. Large files are processed incrementally; no full-file memory allocation.
8. Server optional for local-only use; required for cross-device sync.
9. IndexedDB catalog stays the local authority over OPFS/SQLite derived data.
10. With a host server configured, the server DB is the authority for all
    shared entities (assets, revisions, manifests, tombstones, versions,
    cursor). Clients never assign `serverVersion` or invent server state.

## 3. System context

```
┌─────────────────────────────── Browser client ──────────────────────────────┐
│  UI (main thread)                                                           │
│    OrganizerBackend facade · small metadata reads · Dexie liveQuery()       │
│                                                                             │
│  Workers (Comlink RPC)                                                      │
│    ingestion  image  search  sync                                           │
│                                                                             │
│  IndexedDB / Dexie (organizer-db)          PayloadStore                     │
│    catalog · revisions · manifests         IndexedDB Blobs  (portable)      │
│    derived records · outbox · jobs         OPFS files      (scale, optional)│
│                                                                             │
│  FullTextSearchAdapter                                                      │
│    FlexSearch worker (default) · SQLite WASM FTS5 (optional scale tier)     │
└──────────────────────────────────────────────────────────────────────────────┘
                  │ HTTPS (authenticated, optional)
┌─────────────────────────────── Host server (authority) ───────────────────────┐
│  Metadata store (authoritative DB): assets · revisions · manifests            │
│                  tombstones · processed mutation IDs · global change log      │
│  Content-addressed chunk store (sha256 keyed)                                 │
│  Endpoints: /v1/chunks/exists · /v1/chunks/{hash} · /v1/manifests/commit     │
│             /v1/sync/push · /v1/sync/pull?cursor= · tus resumable uploads    │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Layer | Authoritative? | Responsibility |
|---|---|---|
| Host server metadata DB | **Yes — single authority** | Assets, revisions, manifests, versions, global cursor, tombstones, conflict arbitration |
| IndexedDB catalog | Local replica | Serves reads, offline writes; authoritative only for unsynced local content until the server acknowledges |
| PayloadStore (IndexedDB or OPFS) | Replica of synced content | Immutable chunks and derived picture files; re-downloadable from server |
| Full-text search index | No | Term/phrase/prefix/field search |
| Thumbnail + preview cache | No | Fast picture display |
| Server chunk store | Yes for synced content | Chunk persistence |
| Client outbox | Yes until acknowledged | Durable pending mutations |
| Client import session | Yes during import | Crash recovery and staging |

## 4. Libraries

| Requirement | Choice | Alternative |
|---|---|---|
| IndexedDB wrapper | Dexie | idb / RxDB / PouchDB |
| Incremental SHA-256 | hash-wasm | Web Crypto (whole-buffer only) |
| Full-text (default) | FlexSearch (worker) | SQLite WASM + FTS5 (scale tier) |
| Streaming JSON | @streamparser/json | — |
| JSON semantic hash | json-canonicalize (RFC 8785) | — |
| JSON Schema | Ajv (optional) | — |
| Worker RPC | Comlink | — |
| Picture metadata | exifr | — |
| Resumable upload | tus-js-client (optional) | — |

Rule: hashing, parsing, image work, worker calls, and network access never
happen inside a Dexie write transaction (transactions auto-commit on unrelated
awaits).

## 5. Domain model

```ts
type AssetKind = "folder" | "text" | "json" | "binary" | "image";

interface Asset {
  id, parentId, name, normalizedName, kind, mimeType,
  tags, favorite, pinned,
  currentRevisionId,
  createdAt, modifiedAt, deletedAt,
  serverVersion,                 // server-controlled optimistic concurrency
  syncState: "local" | "pending" | "synced" | "conflict" | "remote-only";
}

interface Revision {
  id, assetId, parentRevisionIds[], manifestId,
  byteHash,                      // sha256 of exact original bytes
  semanticHash | null,           // normalized text or canonical JSON
  totalBytes, createdAt, sourceModifiedAt, createdByClientId,
  processingState: "staging" | "ready" | "failed",
  metadataId | null;
}

interface ContentManifest {
  id, version: 1, hashAlgorithm: "sha256",
  chunkingAlgorithm: "fixed-v1" | "content-defined-v1",
  totalBytes, partCount,
  rootHash,                      // sha256 of canonical manifest JSON
  state: "staging" | "ready", importSessionId;
}

interface ManifestPart { manifestId, ordinal, chunkHash, chunkOffset, length }

interface ChunkRecord {
  hash,                          // "sha256:9d17..."
  size, storage: "indexeddb" | "opfs",
  blob? | opfsPath?,
  state: "staging" | "ready" | "missing" | "corrupt",
  synchronized, createdAt, lastAccessedAt, approximateRefCount;
}
```

Derived records: `TextBlock` (decoded 64-Ki-char blocks with byte/char/line
ranges), `JsonRecord` (stable-keyed, independently hashable), `ImageVariant`
(thumbnail/preview/screen), `ImageMetadata` (dimensions, EXIF, GPS, optional
perceptual hash).

Metadata-only edits (rename, move, tags, favorite, pinned) never rewrite file
content and sync as one metadata mutation.

## 6. Dexie schema

DB name `organizer-db`. Tables: `assets`, `revisions`, `manifests`,
`manifestParts`, `chunks`, `textBlocks`, `jsonRecords`, `imageVariants`,
`imageMetadata`, `outbox`, `conflicts`, `indexJobs`, `imports`, `syncMeta`.

Schema rules:

- Never index large text, binary values, or whole JSON objects.
- Index only navigation/filter/job/sync keys; multi-entry index for tags.
- Full-text terms live in the search backend; raw payloads live in `chunks`.
- Outbox: one row per logical entity; newer pending edit replaces older one.
- Migrations must be resumable (never one transaction for gigabytes).

Key tables:

```
outbox     { entityKey, mutationId, entityType, operation, baseServerVersion,
             payload, createdAt }
conflicts  { entityKey, localValue, remoteValue, remoteServerVersion, detectedAt }
indexJobs  { id, assetId, revisionId, operation: index|remove|rebuild,
             state, attempts, createdAt, lastError }
imports    { id, assetId, manifestId, sourceName, sourceSize, processedBytes,
             state, startedAt, updatedAt, lastError }
```

## 7. PayloadStore abstraction

The catalog never knows whether a chunk is an IndexedDB Blob or an OPFS file.

```ts
interface PayloadStore {
  readonly kind: "indexeddb" | "opfs";
  has(hash): Promise<boolean>;
  put(hash, data: Blob, opts?): Promise<void>;
  get(hash): Promise<Blob | null>;
  openStream(parts: ManifestPart[], opts?): Promise<ReadableStream<Uint8Array>>;
  delete(hash): Promise<void>;
  verify(hash): Promise<boolean>;
}
```

- **Portable profile**: everything in IndexedDB (`chunks[hash].blob`).
- **Large-corpus profile**: OPFS adapter
  (`/opfs/organizer/chunks/sha256/9d/17/9d17...`); IndexedDB keeps only the
  catalog row with `opfsPath`; SQLite FTS5 in OPFS for search.
- **Hybrid policy**: `{ payloadBackend: "indexeddb" | "opfs" | "hybrid",
  opfsMinimumAssetBytes }` — small assets in IndexedDB, large originals in
  OPFS, background migration between stores without touching manifests.

## 8. Hashing and chunking

| Hash | Input | Purpose |
|---|---|---|
| byteHash | Exact original bytes | File identity |
| chunkHash | Exact chunk bytes | Dedup + transfer |
| manifestHash | Canonical manifest JSON | Reconstruction identity |
| semanticHash | Normalized text / canonical JSON | Logical equivalence |
| perceptualHash | Decoded appearance | Near-duplicate grouping only |

Semantic and perceptual hashes are never used for reconstruction, sync
identity, or security.

Defaults (benchmark before release): 4 MiB binary chunks, 2 MiB text chunks,
32 MiB write batches, 64-Ki-char search blocks with 256-char overlap, 8 MiB
inline-JSON limit, 256 px thumbnails, 1600 px previews.

Fixed-size chunks for v1 (`Chunker` interface preserved so
`content-defined-v1` can coexist later). Dedup before store: reuse existing
`ready` chunks by hash; verify before flipping `staging → ready`.

## 9. Import pipeline (crash-safe)

```
created → reading → deriving → committing → complete   (failed | cancelled)
```

Algorithm: create ImportSession + staging Manifest → ingest in a worker
(read incrementally, hash, chunk, store chunks) → write ManifestPart batches →
derived records per type → compute manifest root hash → **one small final
transaction**: manifest ready + revision add + asset put (currentRevisionId,
syncState pending) + outbox mutation + index jobs + import complete.

Recovery on startup: resume resumable sessions, fail the rest, keep chunks
referenced by ready manifests, let mark-and-sweep clean orphans. Never trust a
chunk because its key exists — verify its hash.

## 10. Type pipelines

- **Text**: raw byte chunks (reconstruction/sync) + decoded text blocks
  (search/edit), never mixed; line checkpoints every 512–1024 lines. Edits
  use manifest slices as a piece table — only inserted bytes get new chunks;
  rebuild only affected + overlap blocks; old revision preserved.
- **JSON**: `byteHash` (exact bytes) and `semanticHash` (canonical) are
  separate identities. Small docs: parse + optional Ajv + canonicalize.
  Large docs: stream with `@streamparser/json`; mode A top-level array with
  stable record key, mode B keyed object, mode C arbitrary (chunk-level
  transfer only). Explicit `JsonIndexPolicy` (include/exclude pointers) —
  never index every leaf. Distinguish file sync (exact bytes) from dataset
  sync (logical records); never silently switch.
- **Binary**: exact bytes only, never Base64; MIME from detection, not
  extension; chunk-level transfer; optional `BinaryFormatExtractor` plugins
  produce derived metadata/searchable text.
- **Images**: original immutable; worker pipeline `createImageBitmap() →
  orient → OffscreenCanvas → convertToBlob()` for thumbnail (256 px) and
  preview (1600 px); exifr for metadata with `ImagePrivacyPolicy` (GPS
  retention/sync configurable). byteHash = exact dup; perceptualHash =
  advisory visual grouping only.

## 11. Search architecture

Three layers:

1. **IndexedDB metadata indexes** — folders, name/tags/kind/mime/date,
   favorites, sync state. Never cursor-scan text blocks.
2. **FullTextSearchAdapter** — FlexSearch in a dedicated worker by default
   (document mode: title, path, tags, body, selected fields; exported
   checkpoints stored in IndexedDB, replayed via `indexJobs`). SQLite WASM
   FTS5 adapter for millions of records; the SQLite DB is disposable —
   IndexedDB is the rebuild source, never the reverse.
3. **Query planner** — parse `kind: tag: modified:` + text; intersect
   full-text hits with metadata-filtered candidates; stable cursor paging.

Index jobs are durable and idempotent
(`pending → claimed → indexed → complete`), keyed by a search-index
generation (`schemaVersion` bump forces rebuild).

## 12. Synchronization

Hashes answer "does content match?", server versions answer "did another
client change the entity after my copy?". Both are required.

### Server authority rules

- The server DB assigns every `serverVersion` and orders the global change
  log; clients never set or increment versions themselves.
- Every local mutation carries `baseServerVersion`; the server rejects
  mutations whose base does not match the current version (stale write).
- The client applies a pull only after the server accepts it, in the same
  transaction as the cursor advance — server state is never overwritten by
  local state.
- On startup or reconnect, the client reconciles against the server first;
  local-only data exists only in the outbox until acknowledged.
- If the local catalog is lost or corrupt, the server is the recovery
  source; IndexedDB is never used to reconstruct server state.

**Push**: read stable outbox batch → collect chunk hashes → ask server which
are missing (`/v1/chunks/exists`, tenant-scoped) → upload missing → commit
manifests → push mutations with `baseServerVersion` → server validates
versions, records mutation IDs, appends to global change log → client removes
only acknowledged IDs. Retries are idempotent (server retains processed IDs).

**Pull**: client sends server-generated cursor (never timestamps) → applies
one page in one IndexedDB transaction → updates cursor in the same
transaction. Missing chunks download lazily on open, in priority order, each
hash-verified; pinned assets download eagerly.

Asset payload states: `remote-only → partial → available`.

## 13. Conflicts, tombstones, GC

- Conflict matrix: metadata vs content edits merge; concurrent content edits
  preserve **both revisions** (`keep-local | keep-remote | keep-both |
  merged`); delete-vs-edit conflicts explicitly; equal hashes converge.
  Stable-record JSON merges per record. The **server arbitrates**: it detects
  stale `baseServerVersion`, records both values in conflict rows, and its
  resolution becomes the next authoritative version that all clients pull.
- Deletes set `deletedAt` + tombstone mutation, hide from browsing, preserve
  content until no live roots reference it.
- GC uses **mark-and-sweep** from roots (current/historical/pinned/
  unsynchronized revisions, conflicts, active imports/exports/transfers,
  trash within retention). Sweep order: stale checkpoints → thumbnails →
  abandoned imports → unpinned remote caches → expired history → orphan
  chunks. Short-lived `ChunkLease`s protect active reads/uploads. Never
  delete unsynchronized chunks or the only local copy.

## 14. Quota and storage health

`navigator.storage.estimate()` + `navigator.storage.persist()` after
meaningful user actions, plus internal per-category accounting. Policy:
healthy > 20% free, warning 10–20% (stop prefetch, trim caches), critical
< 10% (block large imports, drop regenerable data, preserve unsynchronized
and pinned content).

## 15. Workers and concurrency

Workers: `ingestion` (reads, hashing, chunking, decoding, JSON streaming),
`image`, `search`, `sync` — all via Comlink. Main thread never hashes big
buffers, parses large JSON, decodes images, builds search indexes, or runs
GC scans.

Multi-tab: one leader per domain (sync, search mutation, GC, migration) via
Web Locks with an IndexedDB lease fallback + tab broadcast; all jobs
idempotent in case leaders overlap. Per-tab user imports stay independent.

Reactive UI: Dexie `liveQuery()` for folder contents, import progress, pending
counts, conflicts, storage; search worker returns IDs, UI resolves metadata
reactively.

## 16. Public API

```ts
interface OrganizerBackend {
  initialize(): Promise<void>;
  importFile(file: File, options: ImportOptions): AsyncIterable<ImportProgress>;
  createFolder(parentId, name): Promise<Asset>;
  listChildren(parentId): Promise<Asset[]>;
  getAsset(assetId): Promise<Asset | null>;
  moveAsset / renameAsset / updateTags / deleteAsset / restoreAsset;
  openAssetStream(assetId, options?): Promise<ReadableStream<Uint8Array>>;
  readTextRange(assetId, { revisionId?, lineStart, lineCount });
  getJsonRecord(assetId, recordKey): Promise<JsonRecord | null>;
  search(query): Promise<{ hits, nextCursor }>;
  synchronize(): Promise<{ pushedMutations, uploadedChunks, pulledChanges,
                           downloadedChunks, conflicts }>;
  collectGarbage(): Promise<{ deletedChunks, deletedDerivedRecords, freedBytes }>;
  getStorageHealth(): Promise<StorageHealth>;
}
```

## 17. Module layout

```
src/
├── organizer/     OrganizerBackend.ts · OrganizerService.ts · types.ts
├── database/      OrganizerDatabase.ts · migrations/ · repositories/
│                  (Asset, Revision, Manifest, Chunk, Import, SearchJob, Sync)
├── payload/       PayloadStore · IndexedDbPayloadStore · OpfsPayloadStore
│                  · HybridPayloadStore · ManifestStream
├── ingestion/     ImportCoordinator · Chunker · FixedChunker · Hashing
│                  · ImportRecovery · type-handlers/ (Text, Json, Binary, Image)
├── search/        SearchCoordinator · QueryParser · FullTextSearchAdapter
│                  · FlexSearchAdapter · SqliteFts5Adapter · SearchIndexer
│                  · SnippetBuilder
├── sync/          SyncCoordinator · SyncApiClient · OutboxProcessor
│                  · ChunkTransferManager · ConflictResolver · RetryPolicy
├── images/        ImageMetadataExtractor · ImageVariantGenerator · ImagePrivacyPolicy
├── json/          JsonStreamProcessor · JsonCanonicalizer · JsonRecordExtractor
│                  · JsonSchemaValidator
├── maintenance/   GarbageCollector · StorageMonitor · IntegrityVerifier
│                  · BackendMigrator
└── workers/       ingestion · image · search · sync (.worker.ts)
```

Stable interfaces from day one: `PayloadStore`, `Chunker`,
`FullTextSearchAdapter`, `BinaryFormatExtractor`, `SyncApiClient` — they are
the boundaries that permit later OPFS, SQLite FTS5, content-defined chunking,
extractor plugins, and tus transfers without model changes.

## 18. Delivery phases

| Phase | Scope | Exit criteria |
|---|---|---|
| 1. Catalog + immutable content | Dexie schema, folders/assets, revisions, fixed chunks, IndexedDB Blob adapter, SHA-256, crash-safe imports, export, dup detection, storage health | No full-file allocation; exact byte export; dup chunk reuse; interrupted-import recovery |
| 2. Type processors | Text decoding/blocks/checkpoints, streaming JSON, stable-record mode, canonicalization, Ajv, image metadata + variants | Correct line navigation; record-level JSON; grid never loads originals |
| 3. Search | Query planner, FlexSearch worker, index jobs, checkpoints, snippets, rebuild | Content search across types; index deletable + rebuildable |
| 4. Sync | Outbox, mutation IDs, per-asset versions, pull cursor, chunk existence batching, lazy payload, conflicts, tombstones | Offline edits sync; interrupted transfers resume; both revisions preserved; idempotent retries; server DB is authority on every pull — local state never overrides server state |
| 5. Scale profile | OPFS adapter + migration, SQLite FTS5, storage tiers, expanded GC | No full index in heap; IndexedDB stays the local authority over derived data while the server DB remains the sync authority; SQLite rebuild works |
| 6. Advanced editing | Piece-table text edits, JSON patches, content-defined chunker, perceptual hashes, extractor plugins, revision merge | As needed |

## 19. Acceptance checklist (highlights)

- IndexedDB is the local replica; with a host configured, the server DB is
  the single authority for shared entities; stable asset IDs; immutable
  revisions; canonical manifests; hash-addressed chunks.
- Large files never fully in memory; raw text bytes separate from search
  text; JSON byte vs semantic identity separate; no Base64 binaries.
- Hashing/workers outside write transactions; import finalization is one
  atomic transaction; interrupted imports recover.
- Outbox survives reload/offline; idempotent retries; versions not timestamps
  detect conflicts; cursor advances atomically; tombstone deletes.
- Clients never assign `serverVersion`; stale `baseServerVersion` writes are
  rejected by the server; server conflict resolution becomes the next
  authoritative version; a lost client catalog is rebuilt from the server,
  never the reverse.
- Every downloaded chunk hash-verified; GC reachability-based; unsynchronized
  content never evicted.
- One PayloadStore interface for IndexedDB and OPFS; multi-tab leader
  coordination; feature-detected browser capabilities; automated fixtures
  (text/JSON/binary/image/crash/quota).

## 20. Boundary summary

```
The host server DB is the single authority for shared state.
IndexedDB is the local replica, offline buffer, and coordination store.
Chunks store immutable bytes.
Search indexes and thumbnails are disposable derivatives.
Clients converge to server versions, cursors, and resolutions —
the server never trusts client state as truth.
```

First release stack: Dexie + IndexedDB Blob chunks + hash-wasm SHA-256 +
fixed-size manifests + Comlink workers + FlexSearch + @streamparser/json +
json-canonicalize + Ajv + exifr + native image workers + custom
outbox/cursor sync.
