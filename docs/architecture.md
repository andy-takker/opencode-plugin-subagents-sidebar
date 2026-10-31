# Architecture

## Keyboard chooser

The TUI entry registers a host-owned keymap layer with a palette command and
`/subagents`, without binding a shortcut. A custom public `ui.dialog.show`
component uses OpenTUI input/select controls; it owns a separate controller only
while open, so navigation works independently of sidebar visibility/preferences.
The host owns command-layer disposal and dialog focus restoration. Plugin cleanup
also closes its own outstanding dialog, without clearing a replacement dialog.

The chooser uses the same complete tree, statuses, duration formatter, and bounded
connector projection. Title search is local and includes every status. A local
one-second display clock exists only for matching open-ended durations. Selection
is tracked by session ID across live reorder/removal, not by the visible index.
Both search and list focus use the same keyboard selection/activation handlers;
the list cannot independently select a replacement index after removal.
Opening performs a public metadata point read; cancellation, route changes,
selection/search changes, disposal, missing membership, or intervening events
prevent stale navigation.
Errors remain visible and retryable. No transcripts or write APIs are used.

The sidebar defaults to collapsed. Its clickable header shows the total count and,
while collapsed, the running count. With Waiting or Error rows it instead adds
a wrapping summary of disjoint running/waiting/error session counts. Multiple
requests for one session count once. Loading/errors remain visible in the header;
expanding an error reveals Retry. A weakly keyed per-plugin-context Solid signal
retains the expansion preference across component unmounts without persisting it
across OpenCode restarts or plugin reloads. Collapsing does not stop synchronization.

The same weakly keyed preference record stores the All/Active filter, defaulting
to All. The expanded ready state offers textual, clickable selectors with counts
and brackets around the selected mode. A memo derives the Active count from
`Row.active` (Running or Waiting); `treeRows` selects these rows and their
ancestors without changing the controller's complete snapshot. Inactive ancestors
have muted titles and a `·` marker, retain their real statuses and click targets,
and contribute only to a separate `+ N context (·)` count. Changing filters performs
no API reads. The header remains a total count; the active count plus context count
equals the visible row count in Active. Empty Active and an empty tree have distinct messages;
loading/error states take precedence over either. Filtering does not affect
synchronization, click targets or the retained session history.

The package exports only `./tui`, as compiled `dist/tui.js`. `bun run build` uses
the pinned official OpenTUI Solid transform and bundles only our four source
modules; all package imports stay external. OpenCode provides the shared
Solid/OpenTUI runtime. There is no server plugin or bundled renderer.

OpenTUI 0.8.0's runtime transform excludes `node_modules`. Publishing raw TSX
therefore failed on the npm-name installation path in OpenCode 2.2.5 even though
an archive extracted outside `node_modules` loaded successfully. The package
regression installs the actual archive beneath `node_modules` and renders/clicks
its exported sidebar in a separate process with shared runtime modules. This is
an automated loader regression, not a substitute for the real OpenCode npm smoke.

1. `model.ts` builds rows from session metadata: iterative, cycle-safe descendant
   traversal, deduplication and deterministic ordering. Confirmed Waiting takes
   precedence over Running, which takes precedence over a previous outcome.
   Unknown live status does not claim success.
2. `controller.ts` resolves ancestors, loads every child page and reads active
   running/pending statuses. Each selected session has a generation; obsolete responses and
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

## Tree ordering and projection

`buildRows` discovers a deduplicated, cycle-free tree breadth-first. A reverse
pass propagates active membership to ancestors without making those ancestors
active themselves. Siblings sort by active-subtree first, then creation time and
ID. An iterative depth-first traversal emits preorder rows: parents precede their
children and subtrees stay together. This replaces global flat active-first
ordering. Rows carry an internal `parentID` only when their parent is another row;
direct children of the selected root form the forest's top level. Disconnected
or deleted-parent descendants remain excluded by discovery and tombstones.

`treeRows` consumes that preorder. A reverse pass retains active rows and their
ancestors for Active; All keeps every row. It then computes `├─`, `└─`, `│` from
the visible siblings, so hiding a branch also repairs the connectors. Traversals
are iterative and linear apart from sibling sorting; prefixes never grow with
unbounded depth. The first two nested levels use normal tree paths (three columns
per level). Deeper rows use `…  ├─ ` or `…  └─ `, a maximum of six columns; ellipsis
means the earlier path is abbreviated, not that intermediate rows are hidden.
Top-level rows have no connector, matching a forest of subagents below the hidden
root. Tests exercise 10,000 nested nodes without recursion, shared context,
completion, deleted parents, other roots, cycles, deduplication and filtered paths.

The TUI keeps connectors and context markers separate from the shrinking title,
so middle truncation cannot erase ancestry markers. Status and duration columns
are shared by all visible rows, including context rows. Sidebar sizing and
scrolling belong to the host.

Separate API reads are not a transactional snapshot. Lifecycle events schedule
a fresh read when a run changes during traversal. Reconnection restores missed
updates from server metadata. Terminal outcomes come from `Session.Info.outcome`,
never from merely observing an idle session.

## Pending requests

The 2.2.5 SDK's `permission.list({ sessionID })` and
`session.form.list({ sessionID })` return pending requests owned by that session.
Location-wide lists would miss descendants that moved to a different location.
After the active snapshot, the adapter reads both lists per discovered session in
batches of four workers, with sequential permission/form calls inside a worker.
This adds up to two reads per session for a relevant full refresh; there is no
timer or transcript read. Only request ownership/presence is used, never contents
or answers. There is no persistent pending-request cache.

The adapter drains all batch siblings before propagating a failure; subsequent
batches stop. The controller's validity callback stops queued reads on disposal,
selection change or event invalidation (already-started requests drain normally).
Failed or unavailable endpoints invalidate the snapshot rather than implying no
pending requests. Permission asked/replied and form created/replied/cancelled
events use the same ancestry scoping and invalidation as lifecycle events.
Reconnect rereads both lists, repairing missed attention events.

Pending presence, including for an idle session, produces Waiting. Once the server
removes all requests, the current running/terminal state applies. Reruns never
reuse a latched Error or Waiting flag. Root requests and unrelated sessions are
excluded from rows and counts by the existing descendant filter.

## Execution duration

The installed `@opencode/schema` 2.2.5 `Session.Info` contract documents
`time.busy` as the start of the most recent execution and `time.idle` as the end
of the most recent completed one. While a new execution runs, idle can still
belong to the previous run; resuming after a server restart starts a new execution.
These are UTC epoch milliseconds, exposed by both session get and list.
The adapter preserves these optional fields without adding API requests.
Waiting retains its underlying running/idle execution state separately: pending
attention changes presentation, not the evidence used to validate timestamps.

The pure model derives an optional `{ start, end? }` duration per row:

- An underlying running execution with no end at/after the start uses the current clock,
  including when pending attention makes the displayed status Waiting.
- An underlying idle execution with a confirmed outcome and idle at/after busy freezes at
  that end, even if pending requests keep its status Waiting.
- Unknown live status, missing/invalid start, invalid end, an idle session
  without a matching completed run, or a running execution with an already completed pair
  has unknown duration. Creation/update timestamps are never fallback values.
- Formatting rejects negative, nonfinite or future times, returns `—` for
  unknown duration, floors displayed units and caps very long output at `999d+`.

`tui.tsx` owns a single one-second interval while expanded/ready rows contain an
open duration. A Solid effect samples wall time when rows/filter/visibility
change and cleans up its interval before replacement or unmount. No network
operation occurs on a tick. Rows hold timestamps, not accumulated elapsed values,
so navigation and reconnect do not reset the clock. Tests control the clock at
the runtime boundary while keeping real OpenTUI rendering and frame scheduling.

Visible rows share separate status and duration columns, sized to their longest
current labels. Statuses align left and durations right; only titles shrink and
truncate. Column widths react to filtering, snapshots and clock ticks without
issuing requests or restarting the display clock.
