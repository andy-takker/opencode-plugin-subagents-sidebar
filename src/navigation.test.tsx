import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { displayClock } from "../test/clock"
import { form, session } from "../test/context"
import { navigationFixture } from "../test/navigation"
import plugin from "./tui"

test.each(["focus", "delete"] as const)(
  "list selection remains authoritative after %s",
  async (action) => {
    const f = navigationFixture([
      session("root"),
      { ...session("a", "root"), title: "Alpha" },
      { ...session("b", "root"), title: "Beta" },
    ])
    const cleanup = await plugin.setup(f.context)
    await using screen = await testRender(f.render, {
      width: 60,
      height: 20,
      kittyKeyboard: true,
    })
    await f.open()
    await screen.waitForFrame((frame) => frame.includes("Alpha"))
    const lines = screen.captureCharFrame().split("\n")
    await screen.mockMouse.click(
      4,
      lines.findIndex((line) => line.includes("Alpha")),
    )
    await screen.mockInput.pressKey("ARROW_DOWN")
    await screen.waitForFrame((frame) => frame.includes("▶ Beta"))
    if (action === "focus") {
      await screen.mockMouse.click(
        4,
        lines.findIndex((line) => line.includes("Search task")),
      )
    } else {
      f.records.splice(2, 1)
      f.emit({
        type: "session.deleted",
        id: "deleted",
        created: 1,
        durable: { aggregateID: "b", seq: 1, version: 2 },
        data: { sessionID: "b" },
      })
      await screen.waitForFrame((frame) => !frame.includes("Beta"))
    }
    await screen.mockInput.pressKey("RETURN")
    await screen.waitForFrame(
      (frame) => f.routes.length > 0 || frame.includes("Selection changed"),
    )
    expect(f.routes).toEqual(
      action === "focus" ? [{ type: "session", sessionID: "b" }] : [],
    )
    await cleanup?.()
  },
)

test.each(["selection", "query"] as const)(
  "changing %s invalidates a pending navigation",
  async (action) => {
    const f = navigationFixture([
      session("root"),
      { ...session("a", "root"), title: "Alpha" },
      { ...session("b", "root"), title: "Beta" },
    ])
    const cleanup = await plugin.setup(f.context)
    await using screen = await testRender(f.render, {
      width: 60,
      height: 20,
      kittyKeyboard: true,
    })
    await f.open()
    await screen.waitForFrame((frame) => frame.includes("Alpha"))
    const gate = Promise.withResolvers<void>()
    const original = f.sessionAPI.get
    f.sessionAPI.get = async (input) => {
      await gate.promise
      return original(input)
    }
    await screen.mockInput.pressKey("RETURN")
    await screen.waitForFrame((frame) => frame.includes("Opening…"))
    if (action === "selection") await screen.mockInput.pressKey("ARROW_DOWN")
    else await screen.mockInput.typeText("Beta")
    await screen.waitForFrame((frame) => frame.includes("▶ Beta"))
    gate.resolve()
    await screen.waitForFrame(
      (frame) => f.routes.length > 0 || frame.includes("Select again"),
    )
    expect(f.routes).toEqual([])
    await screen.mockInput.pressKey("RETURN")
    await screen.waitForFrame(() => f.routes.length > 0)
    expect(f.routes).toEqual([{ type: "session", sessionID: "b" }])
    await cleanup?.()
  },
)

test("command works without a sidebar, searches the whole tree and opens with the keyboard", async () => {
  const parent = {
    ...session("parent", "root"),
    title: "Research",
    outcome: "succeeded" as const,
  }
  const child = {
    ...session("child", "parent"),
    title: "API 日本語",
    time: { created: 1, updated: 1, busy: 1000, idle: 26000 },
    outcome: "succeeded" as const,
  }
  const f = navigationFixture([session("root"), parent, child])
  f.forms.push(form("child"))
  const cleanup = await plugin.setup(f.context)
  await using screen = await testRender(f.render, {
    width: 60,
    height: 20,
    kittyKeyboard: true,
  })
  expect(f.command()).toMatchObject({
    title: "Open subagent",
    palette: true,
    slash: { name: "subagents" },
  })
  expect(f.command()?.bind).toBeUndefined()
  await f.open()
  await screen.waitForFrame((frame) => frame.includes("API 日本語"))
  expect(screen.captureCharFrame()).toContain("Waiting")
  expect(screen.captureCharFrame()).toContain("25s")
  const reads = f.requests.length
  await screen.mockInput.typeText("日本語")
  await screen.waitForFrame(
    (frame) => !frame.includes("Research") && frame.includes("API 日本語"),
  )
  expect(f.requests.length).toBe(reads)
  await screen.mockInput.pressKey("RETURN")
  await screen.waitForFrame(() => f.routes.length === 1)
  expect(f.routes).toEqual([{ type: "session", sessionID: "child" }])
  expect(f.dialog()).toBeUndefined()
  expect(f.listeners.size).toBe(0)
  await cleanup?.()
  expect(f.slotRemovals()).toBe(1)
})

test("arrows select, Escape cancels and unloading cannot navigate or reopen", async () => {
  const f = navigationFixture([
    session("root"),
    session("a", "root"),
    session("b", "root"),
  ])
  const cleanup = await plugin.setup(f.context)
  await using screen = await testRender(f.render, {
    width: 60,
    height: 20,
    kittyKeyboard: true,
  })
  await f.open()
  await screen.waitForFrame((frame) => frame.includes("Idle"))
  await screen.mockInput.pressKey("ARROW_DOWN")
  await screen.mockInput.pressKey("RETURN")
  await screen.waitForFrame(() => f.routes.length === 1)
  expect(f.routes).toEqual([{ type: "session", sessionID: "b" }])
  await f.open()
  await screen.waitForFrame((frame) => frame.includes("Idle"))
  await screen.mockInput.pressKey("ESCAPE")
  await screen.waitForFrame(() => f.listeners.size === 0)
  expect(f.dialog()).toBeUndefined()
  await f.open()
  await screen.waitForFrame((frame) => frame.includes("Idle"))
  await cleanup?.()
  await screen.waitForFrame(() => f.listeners.size === 0)
  await f.open()
  expect(f.dialog()).toBeUndefined()
  expect(f.routes).toHaveLength(1)
})

test("a removed selection never opens its replacement and live statuses remain current", async () => {
  const f = navigationFixture([
    session("root"),
    session("a", "root"),
    session("b", "root"),
  ])
  const cleanup = await plugin.setup(f.context)
  await using screen = await testRender(f.render, {
    width: 60,
    height: 20,
    kittyKeyboard: true,
  })
  await f.open()
  await screen.waitForFrame((frame) => frame.includes("Idle"))
  await screen.mockInput.pressKey("ARROW_DOWN")
  f.records.splice(2, 1)
  f.emit({
    type: "session.deleted",
    id: "deleted",
    created: 1,
    durable: { aggregateID: "b", seq: 1, version: 2 },
    data: { sessionID: "b" },
  })
  f.forms.push(form("a"))
  f.emit({
    type: "form.created",
    id: "asked",
    created: 2,
    data: { form: form("a") },
  })
  await screen.waitForFrame((frame) => frame.includes("Waiting"))
  await screen.mockInput.pressKey("RETURN")
  await screen.waitForFrame((frame) => frame.includes("Selection changed"))
  expect(f.routes).toHaveLength(0)
  await screen.mockInput.pressKey("ARROW_UP")
  await screen.mockInput.pressKey("RETURN")
  await screen.waitForFrame(() => f.routes.length === 1)
  expect(f.routes).toEqual([{ type: "session", sessionID: "a" }])
  await cleanup?.()
})

test("loading is cancellable, errors retry with Enter, empty and search-empty states differ", async () => {
  const f = navigationFixture([session("root")])
  const original = f.sessionAPI.get
  const gate = Promise.withResolvers<void>()
  f.sessionAPI.get = async (input) => {
    await gate.promise
    return original(input)
  }
  const cleanup = await plugin.setup(f.context)
  await using screen = await testRender(f.render, {
    width: 60,
    height: 20,
    kittyKeyboard: true,
  })
  await f.open()
  await screen.waitForFrame((frame) => frame.includes("Loading subagents"))
  await screen.mockInput.pressKey("ESCAPE")
  await screen.waitForFrame(() => f.dialog() === undefined)
  gate.resolve()
  await screen.waitForFrame(() => f.listeners.size === 0)
  expect(f.requests).toHaveLength(0)
  f.sessionAPI.get = async () => {
    throw new Error("secret backend error")
  }
  await f.open()
  const error = await screen.waitForFrame((frame) =>
    frame.includes("Enter to retry"),
  )
  expect(error).not.toContain("secret")
  f.sessionAPI.get = original
  await screen.mockInput.pressKey("RETURN")
  await screen.waitForFrame((frame) => frame.includes("No subagents"))
  f.records.push({ ...session("child", "root"), title: "Research" })
  f.emit({ type: "server.connected", id: "reconnect", data: {} })
  await screen.waitForFrame((frame) => frame.includes("Research"))
  await screen.mockInput.typeText("nomatch")
  await screen.waitForFrame((frame) => frame.includes("No matching subagents"))
  await cleanup?.()
})

test.each(["cancel", "route", "delete", "unload"] as const)(
  "pending selection is invalidated by %s",
  async (action) => {
    const f = navigationFixture()
    const cleanup = await plugin.setup(f.context)
    await using screen = await testRender(f.render, {
      width: 60,
      height: 20,
      kittyKeyboard: true,
    })
    await f.open()
    await screen.waitForFrame((frame) => frame.includes("Idle"))
    const gate = Promise.withResolvers<void>()
    const original = f.sessionAPI.get
    f.sessionAPI.get = async (input) => {
      await gate.promise
      return original(input)
    }
    await screen.mockInput.pressKey("RETURN")
    await screen.waitForFrame((frame) => frame.includes("Opening…"))
    if (action === "cancel") {
      await screen.mockInput.pressKey("ESCAPE")
      await screen.waitForFrame(() => f.dialog() === undefined)
    }
    if (action === "route")
      f.setRoute({ type: "session", sessionID: "other-root" })
    if (action === "delete")
      f.emit({
        type: "session.deleted",
        id: "deleted",
        created: 1,
        durable: { aggregateID: "child", seq: 1, version: 2 },
        data: { sessionID: "child" },
      })
    if (action === "unload") await cleanup?.()
    gate.resolve()
    await screen.waitForFrame(() =>
      action === "delete"
        ? screen.captureCharFrame().includes("List changed")
        : f.listeners.size === 0,
    )
    expect(f.routes).toHaveLength(0)
    if (action !== "unload") await cleanup?.()
  },
)

test("command is disabled off-session and cleanup preserves another plugin dialog", async () => {
  const f = navigationFixture()
  const cleanup = await plugin.setup(f.context)
  await using screen = await testRender(f.render, {
    width: 60,
    height: 20,
    kittyKeyboard: true,
  })
  f.setRoute({ type: "home" })
  const enabled = f.command()?.enabled
  expect(typeof enabled === "function" ? enabled() : enabled).toBe(false)
  await f.open()
  expect(f.dialog()).toBeUndefined()
  f.setRoute({ type: "session", sessionID: "root" })
  await f.open()
  await screen.waitForFrame((frame) => frame.includes("Idle"))
  f.context.ui.dialog.show(() => <text>Another plugin</text>)
  await screen.waitForFrame((frame) => frame.includes("Another plugin"))
  await cleanup?.()
  expect(f.dialog()).toBeDefined()
  expect(f.listeners.size).toBe(0)
})

test("picker clock advances locally and stops on replacement", async () => {
  using clock = displayClock(10_000)
  const f = navigationFixture([
    session("root"),
    {
      ...session("child", "root"),
      time: { created: 1, updated: 1, busy: 10_000 },
    },
  ])
  f.sessionAPI.active = async () => ({ child: { type: "running" } })
  const cleanup = await plugin.setup(f.context)
  await using screen = await testRender(f.render, {
    width: 60,
    height: 20,
    kittyKeyboard: true,
  })
  await f.open()
  await screen.waitForFrame((frame) => frame.includes("Running · 0s"))
  const reads = [f.requests.length, f.attentionRequests.length]
  clock.advance(1000)
  await screen.waitForFrame((frame) => frame.includes("Running · 1s"))
  expect([f.requests.length, f.attentionRequests.length]).toEqual(reads)
  f.context.ui.dialog.show(() => <text>Replacement</text>)
  await screen.waitForFrame((frame) => frame.includes("Replacement"))
  expect(clock.active).toBe(0)
  await cleanup?.()
})

test("a failed pre-navigation read is visible and can be retried without reopening", async () => {
  const f = navigationFixture()
  const cleanup = await plugin.setup(f.context)
  await using screen = await testRender(f.render, {
    width: 60,
    height: 20,
    kittyKeyboard: true,
  })
  await f.open()
  await screen.waitForFrame((frame) => frame.includes("Idle"))
  const original = f.sessionAPI.get
  let fail = true
  f.sessionAPI.get = async (input) => {
    if (input.sessionID === "child" && fail) {
      fail = false
      throw new Error("private details")
    }
    return original(input)
  }
  await screen.mockInput.pressKey("RETURN")
  const frame = await screen.waitForFrame((frame) =>
    frame.includes("Unable to open subagent"),
  )
  expect(frame).not.toContain("private details")
  expect(f.routes).toHaveLength(0)
  await screen.mockInput.pressKey("RETURN")
  await screen.waitForFrame(() => f.routes.length === 1)
  expect(f.routes).toEqual([{ type: "session", sessionID: "child" }])
  await cleanup?.()
})
