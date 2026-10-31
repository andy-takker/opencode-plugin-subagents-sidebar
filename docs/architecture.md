# Architecture

The sidebar defaults to collapsed. Its clickable header shows the total count and,
while collapsed, the running count. Loading/errors remain visible in the header;
expanding an error reveals Retry. A weakly keyed per-plugin-context Solid signal
retains the expansion preference across component unmounts without persisting it
across OpenCode restarts or plugin reloads. Collapsing does not stop synchronization.

The package exports only `./tui`, as TSX. OpenCode compiles it and provides the
shared Solid/OpenTUI runtime. There is no server plugin or bundled renderer.

1. `model.ts` builds rows from session metadata: iterative, cycle-safe descendant
   traversal, deduplication and deterministic ordering. Running takes precedence
   over a previous outcome. Unknown live status does not claim success.
2. `controller.ts` resolves ancestors, loads every child page and reads active
   statuses. Each selected session has a generation; obsolete responses and
   responses after disposal cannot publish. Deleted IDs are tombstoned until
   disposal. A dirty flag coalesces events during a load without losing a refresh.
   Child traversal uses batches of four requests, guards repeated cursors and
   ignores wrong-parent records. Failures surface as a retryable error.
3. `opencode-source.ts` adapts the official promise client and lifecycle events.
   It does not restrict children by location, assume a cache page is complete,
   read message transcripts, or interpret request failures as idle.
4. `tui.tsx` registers `sidebar.content`, owns a controller per mounted section,
   renders theme tokens and navigates using the host router. Solid cleanup
   unsubscribes on unmount; the returned registration cleanup removes the slot.

Refreshes are event-driven, including reconnect; text token events are ignored.
The controller caches parent links for the current selection and ignores events
whose ancestry proves they belong to another root. Creation events supply parent
links immediately, so new descendants do not have to be present in the list yet.
For unknown IDs, one deduplicated ancestry walk runs at a time using point reads;
known relevant events bypass that queue. This adds at most one metadata request
alongside the existing four-worker child traversal. Parent links are immutable in
the current API: `session.moved` changes location, not parentage.

Selection changes and reconnect discard ancestry knowledge and queued lookups;
late lookups cannot affect the new selection or publish after disposal. Initial
loads without a resolved root, unknown deletions, lookup failures and cyclic
ancestry conservatively trigger a full refresh. Reconnect and explicit Retry
always reload the complete tree. A relevant event still invalidates in-flight
snapshots; a confirmed unrelated event does not. No background polling is used.
Before publishing, newly discovered ancestry is checked against queued events.
A matching event invalidates that snapshot once, even if its point lookup is
still pending, so an older successful outcome cannot flash before reconciliation.

The request-count regression uses 100 events for an unknown unrelated child:
two metadata reads establish its root, with zero tree/status reloads. A second
100-event burst for the same child requires zero additional requests. This is a
controlled fixture measurement, not a production latency benchmark.

Rows remain a flat active-first list; nesting determines membership, not
indentation. Sidebar sizing and scrolling belong to the host.

Separate API reads are not a transactional snapshot. Lifecycle events schedule
a fresh read when a run changes during traversal. Reconnection restores missed
updates from server metadata. Terminal outcomes come from `Session.Info.outcome`,
never from merely observing an idle session.
