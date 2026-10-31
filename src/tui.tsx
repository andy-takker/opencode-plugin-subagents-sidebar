import { Plugin } from "@opencode/plugin/tui"
import type { JSX } from "@opentui/solid"
import {
  createEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  type Signal,
  Show,
  Switch,
} from "solid-js"
import { createController, type View } from "./controller"
import type { Row } from "./model"
import { createOpenCodeSource } from "./opencode-source"

// One preference per plugin context, surviving sidebar unmounts and navigation.
// Weak keys release the state when OpenCode unloads the plugin context.
const expandedPreferences = new WeakMap<Plugin.Context, Signal<boolean>>()

export function Sidebar(props: {
  context: Plugin.Context
  sessionID: string
}): JSX.Element {
  let preference = expandedPreferences.get(props.context)
  if (!preference) {
    preference = createSignal(false)
    expandedPreferences.set(props.context, preference)
  }
  const [expanded, setExpanded] = preference
  const [view, setView] = createSignal<View>({ phase: "loading", rows: [] })
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
          ? ` · ${view().rows.length}${!expanded() && view().rows.some((row) => row.active) ? ` · ${view().rows.filter((row) => row.active).length} running` : ""}`
          : view().phase === "loading"
            ? " · Loading…"
            : " · Error"}
      </text>
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
            <For
              each={view().rows}
              fallback={
                <text fg={props.context.theme.text.muted}>No subagents</text>
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
                  <text
                    flexGrow={1}
                    flexShrink={1}
                    minWidth={0}
                    truncate
                    wrapMode="none"
                    fg={props.context.theme.text.base}
                  >
                    {row.title.replace(/[\r\n\t]/g, " ")}
                  </text>
                  <text flexShrink={0} fg={color(row)}>
                    {row.status}
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
