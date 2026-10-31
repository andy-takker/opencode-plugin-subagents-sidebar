import { Plugin } from "@opencode/plugin/tui"
import type { JSX } from "@opentui/solid"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  type Signal,
  Show,
  Switch,
} from "solid-js"
import { createController, type View } from "./controller"
import { formatDuration, type Row, treeRows } from "./model"
import { createOpenCodeSource } from "./opencode-source"

// Preferences survive sidebar unmounts and navigation within a plugin context.
// Weak keys release the state when OpenCode unloads the plugin context.
type Filter = "all" | "active"
const preferences = new WeakMap<
  Plugin.Context,
  {
    expanded: Signal<boolean>
    filter: Signal<Filter>
  }
>()

export function Sidebar(props: {
  context: Plugin.Context
  sessionID: string
}): JSX.Element {
  let preference = preferences.get(props.context)
  if (!preference) {
    preference = {
      expanded: createSignal(false),
      filter: createSignal<Filter>("all"),
    }
    preferences.set(props.context, preference)
  }
  const [expanded, setExpanded] = preference.expanded
  const [filter, setFilter] = preference.filter
  const [view, setView] = createSignal<View>({ phase: "loading", rows: [] })
  const activeRows = createMemo(() => view().rows.filter((row) => row.active))
  const counts = createMemo(() => {
    const result = { running: 0, waiting: 0, errors: 0 }
    for (const row of view().rows) {
      if (row.status === "Running") result.running++
      if (row.status === "Waiting") result.waiting++
      if (row.status === "Error") result.errors++
    }
    return result
  })
  const attention = () => counts().waiting > 0 || counts().errors > 0
  const summary = () =>
    [
      counts().running ? `${counts().running} running` : "",
      counts().waiting ? `${counts().waiting} waiting` : "",
      counts().errors
        ? `${counts().errors} error${counts().errors === 1 ? "" : "s"}`
        : "",
    ].filter(Boolean)
  const visibleRows = createMemo(() =>
    treeRows(view().rows, filter() === "active"),
  )
  const contextCount = createMemo(
    () => visibleRows().filter((row) => row.context).length,
  )
  const [now, setNow] = createSignal(Date.now())
  const columnWidths = createMemo(() => {
    let status = 0
    let duration = 0
    for (const row of visibleRows()) {
      status = Math.max(status, row.status.length)
      duration = Math.max(duration, formatDuration(row.duration, now()).length)
    }
    return { status, duration }
  })
  createEffect(() => {
    if (!expanded() || view().phase !== "ready") return
    const rows = visibleRows()
    setNow(Date.now())
    if (!rows.some((row) => row.duration && row.duration.end === undefined))
      return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    onCleanup(() => clearInterval(timer))
  })
  const controller = createController(
    createOpenCodeSource(props.context),
    setView,
  )
  createEffect(() => {
    void controller.select(props.sessionID)
  })
  onCleanup(() => controller.dispose())
  const color = (row: Row) => {
    const text = props.context.theme.text
    switch (row.status) {
      case "Running":
        return text.feedback.info.base
      case "Done":
        return text.feedback.success.base
      case "Error":
        return text.feedback.error.base
      case "Interrupted":
      case "Waiting":
        return text.feedback.warning.base
      default:
        return text.muted
    }
  }
  return (
    <box width="100%" flexDirection="column" marginTop={1} flexShrink={0}>
      <text
        fg={props.context.theme.text.base}
        truncate
        wrapMode="none"
        onMouseUp={(event) => {
          if (event.button === 0) setExpanded((value) => !value)
        }}
      >
        <b>{expanded() ? "▼" : "▶"} Subagents</b>
        {view().phase === "ready"
          ? ` · ${view().rows.length}${!expanded() && !attention() && counts().running ? ` · ${counts().running} running` : ""}`
          : view().phase === "loading"
            ? " · Loading…"
            : " · Error"}
      </text>
      <Show when={!expanded() && view().phase === "ready" && attention()}>
        <box width="100%" flexDirection="row" flexWrap="wrap" gap={1}>
          <For each={summary()}>
            {(count) => (
              <text
                flexShrink={0}
                wrapMode="none"
                fg={props.context.theme.text.feedback.warning.base}
              >
                {count}
              </text>
            )}
          </For>
        </box>
      </Show>
      <Show when={expanded()}>
        <Switch>
          <Match when={view().phase === "loading"}>
            <text fg={props.context.theme.text.muted}>Loading…</text>
          </Match>
          <Match when={view().phase === "error"}>
            <text fg={props.context.theme.text.muted}>
              Unable to load subagents
            </text>
            <text
              fg={props.context.theme.text.base}
              onMouseUp={(event) => {
                if (event.button === 0) void controller.refresh()
              }}
            >
              Retry
            </text>
          </Match>
          <Match when={view().phase === "ready"}>
            <box flexDirection="row" gap={1} width="100%" height={1}>
              <For each={["all", "active"] as const}>
                {(mode) => (
                  <text
                    fg={
                      filter() === mode
                        ? props.context.theme.text.base
                        : props.context.theme.text.muted
                    }
                    wrapMode="none"
                    truncate
                    onMouseUp={(event) => {
                      if (event.button === 0) setFilter(mode)
                    }}
                  >
                    {`${filter() === mode ? "[" : ""}${mode === "all" ? "All" : "Active"} (${mode === "all" ? view().rows.length : activeRows().length})${filter() === mode ? "]" : ""}`}
                  </text>
                )}
              </For>
            </box>
            <Show when={contextCount() > 0}>
              <text fg={props.context.theme.text.muted}>
                {`+ ${contextCount()} context (·)`}
              </text>
            </Show>
            <For
              each={visibleRows()}
              fallback={
                <text fg={props.context.theme.text.muted}>
                  {filter() === "active" && view().rows.length
                    ? "No active subagents"
                    : "No subagents"}
                </text>
              }
            >
              {(row) => (
                <box
                  height={1}
                  width="100%"
                  flexDirection="row"
                  gap={1}
                  onMouseUp={(event) => {
                    if (event.button === 0)
                      props.context.ui.router.navigate({
                        type: "session",
                        sessionID: row.id,
                      })
                  }}
                >
                  <box
                    flexGrow={1}
                    flexShrink={1}
                    minWidth={0}
                    flexDirection="row"
                  >
                    <Show when={row.prefix}>
                      <text
                        flexShrink={0}
                        width={row.prefix.length}
                        wrapMode="none"
                        fg={props.context.theme.text.muted}
                      >
                        {row.prefix}
                      </text>
                    </Show>
                    <Show when={row.context}>
                      <text
                        flexShrink={0}
                        width={2}
                        wrapMode="none"
                        fg={props.context.theme.text.muted}
                      >
                        ·{" "}
                      </text>
                    </Show>
                    <text
                      flexGrow={1}
                      flexShrink={1}
                      minWidth={0}
                      truncate
                      wrapMode="none"
                      fg={
                        row.context
                          ? props.context.theme.text.muted
                          : props.context.theme.text.base
                      }
                    >
                      {row.title.replace(/[\r\n\t]/g, " ")}
                    </text>
                  </box>
                  <text
                    width={columnWidths().status}
                    flexShrink={0}
                    wrapMode="none"
                    fg={color(row)}
                  >
                    {row.status}
                  </text>
                  <text
                    width={columnWidths().duration}
                    flexShrink={0}
                    textAlign="right"
                    wrapMode="none"
                    fg={color(row)}
                  >
                    {formatDuration(row.duration, now())}
                  </text>
                </box>
              )}
            </For>
          </Match>
        </Switch>
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.subagents-sidebar",
  setup(context) {
    return context.ui.slot({
      append: "sidebar.content",
      render: (props) => (
        <Sidebar context={context} sessionID={props.sessionID} />
      ),
    })
  },
})
