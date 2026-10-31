import type { KeymapLayer, Route } from "@opencode/plugin/tui/context"
import type { JSX } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { contextFixture } from "./context"

export function navigationFixture(...args: Parameters<typeof contextFixture>) {
  const f = contextFixture(...args)
  const layers: (() => KeymapLayer)[] = []
  const [route, setRoute] = createSignal<Route>({
    type: "session",
    sessionID: "root",
  })
  const [dialog, setDialog] = createSignal<{
    render: () => JSX.Element
    close?: () => void
  }>()
  let slotRemovals = 0
  const clear = () => {
    const previous = dialog()
    setDialog(undefined)
    previous?.close?.()
  }
  Object.assign(f.context.ui, {
    dialog: {
      set() {},
      clear,
      show(render: () => JSX.Element, close?: () => void) {
        clear()
        setDialog({ render, ...(close ? { close } : {}) })
      },
    },
    slot: () => () => {
      slotRemovals++
    },
  })
  Object.assign(f.context.ui.router, { current: route })
  Object.assign(f.context, {
    keymap: { layer: (factory: () => KeymapLayer) => layers.push(factory) },
  })
  return {
    ...f,
    layers,
    setRoute,
    dialog,
    clear,
    slotRemovals: () => slotRemovals,
    render: () => (
      <Show when={dialog()} keyed>
        {(value) => value.render()}
      </Show>
    ),
    command: () =>
      layers
        .flatMap((factory) => factory().commands ?? [])
        .find((command) => command.id === "opencode.subagents-sidebar.open"),
    open: () =>
      layers
        .flatMap((factory) => factory().commands ?? [])
        .find((command) => command.id === "opencode.subagents-sidebar.open")
        ?.run(),
  }
}
