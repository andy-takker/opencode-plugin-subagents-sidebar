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
Currently relevant lifecycle events across the connected server refresh the
visible tree, including events from unrelated sessions. Very large trees may
therefore generate extra requests. Rows remain a flat active-first list; nesting
determines membership, not indentation. Sidebar sizing and scrolling belong to
the host.

Separate API reads are not a transactional snapshot. Lifecycle events schedule
a fresh read when a run changes during traversal. Reconnection restores missed
updates from server metadata. Terminal outcomes come from `Session.Info.outcome`,
never from merely observing an idle session.
