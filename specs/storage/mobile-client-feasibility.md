**iOS, iPadOS, and Android client feasibility — persistent data, cache limits, and cleanup**

Assessment date: 11 September 2026. Status: feasibility report; no implementation or device validation performed. Repository inspected at commit `11242e52b`, including the current working tree. Scope: persistent local data, cache limits, and cleanup.

**Recommendation: feasible, with a shared web interface and native storage.** Build a small mobile shell around the existing Solid application, retaining a remote OpenCode server for execution and authoritative session data. Prefer a Capacitor prototype for this repository; evaluate Tauri 2 if the team specifically wants a Rust storage layer. A full native interface rewrite adds little storage benefit for its cost.

The strongest reason to ship an installed client is control over the distinction between durable user data and replaceable cache. Cache accounting and cleanup can also improve in the existing browser client, so those improvements should form the shared foundation. A wrapper that continues using only browser storage does not deliver the central durability benefit.

| Target | Feasibility for this scope | Main work |
| --- | --- | --- |
| iOS | High, conditional on a device prototype | Native persistence, interruption recovery, phone layout, Apple build/signing pipeline |
| iPadOS | High; share the iOS target and storage implementation | Resizable layouts, hardware keyboard, concurrent scenes if supported |
| Android | High, conditional on a device prototype | Native persistence, process recreation, storage pressure, WebView/device coverage |

These ratings describe technical feasibility, not release readiness. They do not imply local execution of the desktop server or access to unrestricted device files.

**What the repository already provides**

| Evidence | Implication |
| --- | --- |
| The desktop package uses [electron-store 11.0.2](../../packages/desktop/package.json#L31) and [Electron 42.3.3](../../packages/desktop/package.json#L51). | This is a new mobile shell, not an existing Tauri application that can simply add mobile targets. |
| The shared platform contract [identifies only web and desktop](../../packages/app/src/context/platform.tsx#L20), while exposing [storage, draft storage, and a fetch override](../../packages/app/src/context/platform.tsx#L65-L78). | Reuse these boundaries and extend them for mobile capabilities. |
| Browser persistence has an [8 MiB / 500-entry in-memory cache](../../packages/app/src/utils/persist.ts#L33-L68). On localStorage quota failure, it [deletes other `opencode.*` entries largest first](../../packages/app/src/utils/persist.ts#L112-L164). | The existing limit is a memory limit, not a disk budget. Eviction does not classify durable data separately from reconstructible cache. |
| Storage errors can [disable later writes for a scope without surfacing an error to the caller](../../packages/app/src/utils/persist.ts#L388-L431). | A mobile storage adapter alone will not establish trustworthy saved/unsaved status. Error handling also needs attention. |
| Browser drafts use [content hashes](../../packages/app/src/utils/draft-store.ts#L24-L33), [IndexedDB document and blob stores, and startup cleanup of unreferenced blobs](../../packages/app/src/utils/draft-store.ts#L97-L153). | Useful storage already exists. This is not an implementation starting from zero, but it has no configurable disk budget or general storage dashboard. |
| Desktop drafts use [SQLite with WAL, a document/blob schema, startup orphan cleanup, and buffered writes](../../packages/desktop/src/main/draft-store.ts#L16-L80). | Reuse the model and behavior where appropriate; its Node SQLite driver and shutdown assumptions require replacement on mobile. |
| Desktop cleanup [applies age/count rules to matching draft `.dat` files and removes empty stores](../../packages/desktop/src/main/store-cleanup.ts#L17-L78). | This is a separate cleanup mechanism, not a byte cap for the SQLite draft database or all application storage. |
| Canvas code also [writes directly to localStorage](../../packages/app/src/pages/canvas/workspace.tsx#L593-L598). | Route durable writes through the shared boundary; swapping the main adapter would otherwise miss data. |
| Removing a server from the [persisted server store](../../packages/app/src/context/server.tsx#L263-L274) [updates the connection list without clearing its workspace/session data](../../packages/app/src/context/server.tsx#L306-L313). | Add an explicit way to inspect and remove disconnected-server caches while preserving local drafts. |

The [organizer architecture](../../specs/organizer/architecture.md#L3) is explicitly proposed. Its server authority, protected unsynchronized content, disposable derived data, quota monitoring, and reachability-based cleanup are useful design inputs. Its full catalog, chunk synchronization, revision history, and search system must not be counted as delivered functionality or prerequisites for this smaller mobile project.

**What native storage changes**

Browser storage is substantially more capable than older Safari guidance suggests. WebKit documents origin quotas of up to 60% of disk for browser applications and 15% for other embedding applications; Home Screen web apps receive the browser quota class. These are ceilings, not available-space guarantees. Storage pressure can evict best-effort origin data, while persistent mode can protect it from automatic eviction. Applications can request persistence and inspect estimated usage, but must handle failure. Consequently, an embedded WebView can have a lower browser-storage ceiling than the installed web app. [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)

Those larger origin quotas do not turn localStorage into a bulk database: it remains synchronous, string-only storage with a much smaller practical limit. Moving larger records to IndexedDB benefits the browser client independently of mobile packaging. [Google's storage guidance](https://web.dev/articles/storage-for-the-web?hl=en)

Native applications can instead put durable records in their private data container and regenerable files in an OS cache directory. Apple treats `Library/Caches` and temporary files as purgeable and excludes them from backup; user-created content needs a different retention policy. Android similarly separates persistent app files from cache, which the system may delete under pressure. Native storage therefore provides a clearer retention contract, while free disk space, uninstall, explicit data removal, and backup decisions still matter. [Apple backup and storage guidance](https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup), [Android app-specific storage](https://developer.android.com/training/data-storage/app-specific?hl=en)

**Implementation options**

| Option | Storage outcome | Repository fit and judgment |
| --- | --- | --- |
| Improve browser/PWA storage | IndexedDB, persistence requests, usage estimates, and safe cleanup; still browser-managed | Lowest effort. Do this for the shared foundation and users who stay on the web. |
| Capacitor + shared Solid UI + native storage | Native preferences, transactional records, and separate cache files | Preferred prototype. Reuses the web UI and introduces a focused mobile runtime alongside Electron. |
| Tauri 2 + shared Solid UI + native storage | Similar control through native SQL and filesystem capabilities | Feasible alternative. Restores a Rust shell alongside Electron; there is no current Tauri implementation or mobile target in the working tree. |
| React Native, Flutter, or separate Swift/Kotlin interfaces | Comparable storage control | Much more UI work. Consider only if a broader native experience becomes a product goal. |

Capacitor is designed to embed existing web applications and expose native SDK functionality. Its Preferences plugin is explicitly for lightweight key/value data, with SQLite recommended for larger or more demanding workloads. Its filesystem plugin provides native file operations and chunked reads. Select and validate the SQLite integration during the prototype; Capacitor's core preferences API is not a transactional database. [Capacitor overview](https://capacitorjs.com/docs), [Preferences](https://capacitorjs.com/docs/apis/preferences), [Filesystem](https://capacitorjs.com/docs/apis/filesystem)

Tauri documents mobile targets and SQL, filesystem, and persistent store plugins. This establishes a credible alternative, not measured parity for this application. [Tauri SQL](https://v2.tauri.app/plugin/sql/), [Tauri filesystem](https://v2.tauri.app/plugin/file-system/), [Tauri store](https://v2.tauri.app/plugin/store/)

The repository previously had a Tauri desktop shell; [Electron migration code still migrates its old `.dat` stores](../../packages/desktop/src/main/migrate.ts#L34-L66). That history is reference material and may help the team evaluate Tauri, but it does not establish a mobile-ready application.

**Proposed storage behavior**

Use the existing storage and draft interfaces where they fit, plus a small management surface for usage, limits, and cleanup. Put transactional draft records and their metadata in native SQLite. Keep bulk attachments as files when their size justifies it; retain the existing small-blob model for the first prototype rather than implementing the organizer chunk engine prematurely.

| Data class | Placement | Cleanup rule |
| --- | --- | --- |
| Settings and UI preferences | Native small-value store | Reset only through an explicit settings action |
| Unsent drafts and their attachments | Durable database/private files | Never remove to meet a cache limit |
| User-requested offline copies, if offered | Durable private files with an explicit offline allocation | Preserve until the user removes the offline copy; exclude recoverable downloads from backup as appropriate |
| Reconstructible session data, previews, thumbnails | Cache database/files | Evict by age/use within the selected cache limit |
| Temporary imports and downloads | Staging storage | Protect active or recoverable work; delete only abandoned staging data |
| Connection credentials | Native credential protection | Keep outside cache cleanup and ordinary exports |

On iOS/iPadOS, use Application Support for private durable app data and Caches for disposable files. On Android, use the internal database/files locations and `cacheDir` respectively. Keep locally unique data eligible for the chosen backup/export policy; exclude re-downloadable bulk content where appropriate. An offline pin is a retention promise, so it should not live only in an OS-purgeable cache.

The storage screen should show durable data, offline copies, replaceable cache, and total managed storage, with a breakdown by server/workspace where ownership exists. Provide a cache limit, clear-cache action with estimated reclaimable bytes, and export/discard controls for drafts. Removing a local cached copy must never call the server's content/session delete endpoint. A full local reset must be a separate action that explains what will be lost.

A reasonable prototype policy is a **256 MiB replaceable-cache cap**, adjustable after real-device measurements. This is a proposed product default, not an OS quota or a total app-size guarantee. Durable content, application files, and database overhead are reported separately. Before large writes, check available capacity and account for in-flight writes. If safe cleanup cannot make room, reject the write with a visible explanation while preserving the previous durable value.

Cleanup must protect drafts, offline pins, active readers/transfers, and any future unacknowledged outbox. Track ownership and references, remove least-recently-used eligible cache entries, and stop prefetching before space becomes critical. Reuse existing server scoping and include account identity if multiple accounts share a server. The current [server scope utilities](../../packages/app/src/utils/server-scope.ts#L19-L24) are a starting point, not proof that every existing storage key is isolated.

Measure real disk usage, including database journals and staging files. Deleting SQLite rows may leave reusable space inside the file without returning it to the OS. Choose a reclamation policy during the prototype and report bytes actually freed. Do not rely on emergency full-database `VACUUM` when disk is already full: SQLite documents that it can require substantial temporary free space. [SQLite VACUUM documentation](https://www.sqlite.org/lang_vacuum.html)

**Integration and reliability work**

The general persistence adapter is currently selected using `platform === "desktop"` in both [deletion](../../packages/app/src/utils/persist.ts#L540-L565) and [read/write migration paths](../../packages/app/src/utils/persist.ts#L568-L649). Change this to honor the storage capability for mobile, audit direct browser writes, and preserve migration behavior. Avoid pretending the phone is a desktop, which would also activate unrelated desktop behavior.

Keep server execution remote. Desktop startup [executes a bundled CLI](../../packages/desktop/src/main/background-cli.ts#L19-L22), which is not a drop-in component for a mobile WebView shell. Reuse the existing [transport selection](../../packages/app/src/context/server-sdk.tsx#L193-L218) and [stream reconnect behavior](../../packages/app/src/context/server-sdk.tsx#L280-L319), adding native app-resume handling and state reconciliation. A disconnected draft remains a local draft unless an explicit offline-send feature is later designed. The mobile package should use Client/Schema/Protocol for network contracts, without importing Core or Server runtime services. The shared UI has existing Core utility imports, so mobile bundling requires an import audit rather than an assumption of complete portability. These leaf imports are not evidence of an existing browser build failure.

Durable writes need an observable completion point. Do not report a draft as saved merely because it entered a debounce buffer; preserve the last committed version on disk-full or transaction failure. Commit during normal use, then use lifecycle hooks as an additional opportunity to flush. Correctness must not depend on a termination callback or continuous background execution. Apple schedules background processing at its discretion; Android provides WorkManager for persistent, constrained work. Background transfer is optional for this storage-focused beta. [Apple background strategies](https://developer.apple.com/documentation/BackgroundTasks/choosing-background-strategies-for-your-app), [Android persistent work](https://developer.android.com/develop/background-work/background-tasks/persistent?hl=en)

Remote connectivity has a concrete integration gap: the [server origin allowlist](../../packages/server/src/cors.ts#L11-L19) does not include Capacitor's default `capacitor://localhost` or `https://localhost` origins. Electron also [rewrites response headers](../../packages/desktop/src/main/windows.ts#L217-L220), so successful desktop networking does not prove mobile compatibility. Configure the exact mobile origins on the server, or validate a narrowly scoped native transport that supports the required streaming behavior. Do not assume a generic native fetch replacement handles live event streams. [Capacitor origin configuration](https://capacitorjs.com/docs/config)

Test HTTPS authentication, streaming responses, app suspension, reconnect, and unreachable servers in the chosen shell. The [persisted server connection list](../../packages/app/src/context/server.tsx#L263-L274) can retain [username/password fields](../../packages/app/src/context/server.tsx#L184-L194), so separating credentials into native protected storage is migration work, not just a new settings preference. Preserve the renderer's existing trust boundary. iPad scene concurrency, if enabled, needs coordinated writes and cleanup; it must not introduce a second uncoordinated garbage collector.

Migration should copy data, validate records and attachment hashes, record completion, and retain the old copy until success is established. The current [synchronous legacy migration](../../packages/app/src/utils/persist.ts#L234-L270) removes the source after calling a [localStorage adapter that can suppress a failed write](../../packages/app/src/utils/persist.ts#L388-L431); that behavior needs correction before reuse. Data already in the same application can use an in-app migration. Moving from Safari/Chrome to a separately installed native application requires an explicit export/import or an implemented server synchronization route; do not assume the new app can directly read the browser's storage. Existing authoritative server data can be fetched again, while unsynchronized browser-only drafts need explicit preservation.

**Delivery estimate and decision gates**

| Stage | Deliverable | Planning estimate |
| --- | --- | --- |
| Device prototype | Shared UI opens on all three device classes; native draft persistence, disk-full behavior, cache removal, and reconnect demonstrated | 1–2 engineer-weeks |
| Shared storage foundation | Durable/cache classification, errors, accounting, safe cleanup, settings UI | 2–3 engineer-weeks |
| Mobile integration | Native adapters, migration/export, authentication, lifecycle, phone/tablet usability | 3–5 engineer-weeks |
| Hardening and beta packaging | Upgrade/recovery tests, physical-device coverage, signing and release preparation | 2–3 engineer-weeks |

Total: approximately **8–13 engineer-weeks**, or **6–10 calendar weeks with two experienced engineers** and some overlap. Confidence is moderate-to-low until the prototype. This assumes the existing remote server is usable, the scope stays focused on storage, and Apple tooling/devices are available. It excludes store review delays, full desktop feature parity, a new organizer synchronization service, and local agent execution. These are engineering estimates, not measured project velocity.

Android builds can run on Windows, but iOS/iPadOS builds require a Mac with Xcode or an appropriate macOS build service. [Mobile build prerequisites](https://v2.tauri.app/start/prerequisites/#ios)

Proceed beyond the prototype only when physical iPhone, iPad, and Android tests demonstrate:

- A write acknowledged as saved survives forced process termination, relaunch, and upgrade; failed writes preserve the last committed value.
- Cache cleanup respects its byte limit, reports reclaimed space, and preserves unsent drafts, referenced attachments, offline pins, and other server/account data.
- A disk-full event produces a recoverable error; migration can restart without deleting the source prematurely.
- OS cache deletion leaves the app functional; data can be reconstructed when the server is available.
- Suspension and reconnect do not duplicate submission or mistake stale local state for authoritative server state.
- Representative attachment and history workloads stay within measured memory limits; current whole-blob hashing is replaced or bounded if measurements require it, and retained blob URLs are released when no longer used.

The recommended next investment is the bounded Capacitor/native-storage prototype plus shared cleanup improvements. It can establish whether native durability is worth mobile release maintenance while producing storage improvements that also benefit the existing clients.
