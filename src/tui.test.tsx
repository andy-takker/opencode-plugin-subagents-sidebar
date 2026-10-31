import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { contextFixture, form, permission, session } from "../test/context"
import { Sidebar } from "./tui"

async function clickText(
  screen: Awaited<ReturnType<typeof testRender>>,
  text: string,
) {
  const frame = await screen.waitForFrame((frame) => frame.includes(text))
  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes(text))
  await screen.mockMouse.click((lines[y]?.indexOf(text) ?? 0) + 1, y)
}

test("All defaults to complete history; Active filters locally and keeps narrow Unicode navigation", async () => {
  const running = {
    ...session("running", "root"),
    title: "Исследование 界界 👩‍💻".repeat(8),
  }
  const f = contextFixture([
    session("root"),
    running,
    { ...session("finished", "root"), title: "History", outcome: "succeeded" },
  ])
  let reads = 0
  const get = f.sessionAPI.get
  const list = f.sessionAPI.list
  f.sessionAPI.get = (input) => {
    reads++
    return get(input)
  }
  f.sessionAPI.list = (input) => {
    reads++
    return list(input)
  }
  f.sessionAPI.active = async () => {
    reads++
    return { running: { type: "running" } }
  }
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 10 },
  )
  await clickText(screen, "▶ Subagents")
  const all = await screen.waitForFrame((frame) => frame.includes("[All (2)]"))
  expect(all).toContain("History")
  expect(all).toContain("Active (1)")
  const loadedReads = reads
  await clickText(screen, "Active (1)")
  const active = await screen.waitForFrame((frame) =>
    frame.includes("[Active (1)]"),
  )
  expect(active).toContain("Subagents · 2")
  expect(active).toContain("Running")
  expect(active).not.toContain("History")
  expect(screen.renderer.root.getChildren()[0]?.width).toBeLessThanOrEqual(28)
  await screen.mockMouse.click(
    2,
    active.split("\n").findIndex((line) => line.includes("Running")),
  )
  expect(f.routes).toEqual([{ type: "session", sessionID: "running" }])
  await clickText(screen, "All (2)")
  expect(
    await screen.waitForFrame((frame) => frame.includes("[All (2)]")),
  ).toContain("History")
  expect(reads).toBe(loadedReads)
})

test("narrow collapsed attention counts sessions once; Active includes waiting and clicks the correct child", async () => {
  const f = contextFixture([
    session("root"),
    {
      ...session("waiting", "root"),
      title: "Ожидание 界界 👩‍💻".repeat(8),
      outcome: "failed",
    },
    { ...session("running", "root"), title: "Working", outcome: "failed" },
    { ...session("failed", "root"), title: "Failure", outcome: "failed" },
  ])
  f.sessionAPI.active = async () => ({
    waiting: { type: "running" },
    running: { type: "running" },
  })
  f.permissions.push(permission("waiting", "p1"), permission("waiting", "p2"))
  f.forms.push(form("waiting"))
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 12 },
  )
  const collapsed = await screen.waitForFrame((frame) =>
    frame.includes("1 waiting"),
  )
  expect(collapsed).toContain("▶ Subagents · 3")
  expect(collapsed).toContain("1 running")
  expect(collapsed).toContain("1 error")
  expect(collapsed).not.toContain("2 running")
  expect(collapsed).not.toContain("Failure")
  await clickText(screen, "▶ Subagents")
  await clickText(screen, "Active (2)")
  const active = await screen.waitForFrame((frame) =>
    frame.includes("[Active (2)]"),
  )
  expect(active).toContain("Waiting")
  expect(active).toContain("Running")
  expect(active).not.toContain("Failure")
  expect(screen.renderer.root.getChildren()[0]?.width).toBeLessThanOrEqual(28)
  await screen.mockMouse.click(
    2,
    active.split("\n").findIndex((line) => line.includes("Waiting")),
  )
  expect(f.routes).toEqual([{ type: "session", sessionID: "waiting" }])
  await clickText(screen, "▼ Subagents")
  f.permissions.length = 0
  f.forms.length = 0
  f.emit({
    id: "reply",
    created: 1,
    type: "form.replied",
    data: { sessionID: "waiting", id: "form", answer: {} },
  })
  const resolved = await screen.waitForFrame((frame) =>
    frame.includes("2 running"),
  )
  expect(resolved).not.toContain("waiting")
  expect(resolved).toContain("1 error")
  f.sessionAPI.active = async () => ({
    waiting: { type: "running" },
    running: { type: "running" },
    failed: { type: "running" },
  })
  f.emit({
    id: "rerun",
    created: 2,
    type: "session.execution.started",
    durable: { aggregateID: "failed", seq: 1, version: 1 },
    data: { sessionID: "failed" },
  })
  const rerun = await screen.waitForFrame((frame) =>
    frame.includes("3 running"),
  )
  expect(rerun).not.toContain("error")
})

test("multi-digit attention counts wrap as whole labels at 28 columns", async () => {
  const running = Array.from({ length: 10 }, (_, i) =>
    session(`running-${i}`, "root"),
  )
  const waiting = Array.from({ length: 11 }, (_, i) =>
    session(`waiting-${i}`, "root"),
  )
  const failed = Array.from({ length: 12 }, (_, i) => ({
    ...session(`failed-${i}`, "root"),
    outcome: "failed" as const,
  }))
  const f = contextFixture([session("root"), ...running, ...waiting, ...failed])
  f.sessionAPI.active = async () =>
    Object.fromEntries(
      running.map(({ id }) => [id, { type: "running" as const }]),
    )
  f.forms.push(...waiting.map(({ id }) => form(id)))
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 8 },
  )
  const frame = await screen.waitForFrame((frame) =>
    frame.includes("▶ Subagents · 33"),
  )
  const lines = frame.split("\n")
  const labels = ["10 running", "11 waiting", "12 error"]
  const positions = labels.map((label) =>
    lines.findIndex((line) => line.includes(label)),
  )
  expect(positions.every((line) => line >= 0)).toBe(true)
  expect(new Set(positions).size).toBeGreaterThan(1)
  expect(screen.renderer.root.getChildren()[0]?.width).toBeLessThanOrEqual(28)
})

test("attention read failure replaces stale counts and Retry retains Active", async () => {
  const f = contextFixture()
  f.forms.push(form("child"))
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 12 },
  )
  await clickText(screen, "▶ Subagents")
  await clickText(screen, "Active (1)")
  await screen.waitForFrame((frame) => frame.includes("Waiting"))
  const list = f.formAPI.list
  f.formAPI.list = async () => {
    throw new Error("private response")
  }
  f.emit({ id: "reconnect", type: "server.connected", data: {} })
  const failed = await screen.waitForFrame((frame) => frame.includes("Retry"))
  expect(failed).toContain("Unable to load subagents")
  expect(failed).not.toContain("Waiting")
  expect(failed).not.toContain("No active")
  expect(failed).not.toContain("private")
  f.formAPI.list = list
  await clickText(screen, "Retry")
  expect(
    await screen.waitForFrame((frame) => frame.includes("Waiting")),
  ).toContain("[Active (1)]")
  f.forms.length = 0
  f.records[1] = { ...session("child", "root"), outcome: "succeeded" }
  f.emit({
    id: "cancel",
    created: 3,
    type: "form.cancelled",
    data: { sessionID: "child", id: "form" },
  })
  expect(
    await screen.waitForFrame((frame) => frame.includes("No active subagents")),
  ).toContain("[Active (0)]")
})

test("Active stays synchronized while collapsed and restores completed tasks through All", async () => {
  const child = { ...session("child", "root"), title: "Work" }
  const f = contextFixture([session("root"), child])
  f.sessionAPI.active = async () => ({ child: { type: "running" } })
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 10 },
  )
  await clickText(screen, "▶ Subagents")
  await clickText(screen, "Active (1)")
  await screen.waitForFrame((frame) => frame.includes("[Active (1)]"))
  await clickText(screen, "▼ Subagents")
  f.records[1] = { ...child, outcome: "succeeded" }
  f.sessionAPI.active = async () => ({})
  f.emit({
    id: "completed",
    created: 1,
    type: "session.execution.succeeded",
    durable: { aggregateID: "child", seq: 1, version: 1 },
    data: { sessionID: "child" },
  })
  const collapsed = await screen.waitForFrame(
    (frame) => frame.includes("▶ Subagents · 1") && !frame.includes("running"),
  )
  expect(collapsed).not.toContain("Work")
  await clickText(screen, "▶ Subagents")
  const empty = await screen.waitForFrame((frame) =>
    frame.includes("No active subagents"),
  )
  expect(empty).toContain("[Active (0)]")
  expect(empty).toContain("All (1)")
  await clickText(screen, "All (1)")
  const restored = await screen.waitForFrame((frame) => frame.includes("Work"))
  expect(restored).toContain("Done")
  await clickText(screen, "Active (0)")
  f.sessionAPI.active = async () => ({ child: { type: "running" } })
  f.emit({
    id: "rerun",
    created: 2,
    type: "session.execution.started",
    durable: { aggregateID: "child", seq: 2, version: 1 },
    data: { sessionID: "child" },
  })
  expect(
    await screen.waitForFrame((frame) => frame.includes("Running")),
  ).toContain("[Active (1)]")
})

test("Active preference survives root changes and remounts, but is isolated by context", async () => {
  const f = contextFixture([
    session("root"),
    session("child", "root"),
    session("empty"),
  ])
  const [id, setId] = createSignal("root")
  const screen = await testRender(
    () => <Sidebar context={f.context} sessionID={id()} />,
    { width: 28, height: 10 },
  )
  try {
    await clickText(screen, "▶ Subagents")
    await clickText(screen, "Active (0)")
    await screen.waitForFrame((frame) => frame.includes("No active subagents"))
    setId("empty")
    const empty = await screen.waitForFrame((frame) =>
      frame.includes("No subagents"),
    )
    expect(empty).toContain("[Active (0)]")
    expect(empty).toContain("All (0)")
  } finally {
    await screen.dispose()
  }
  await using remount = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 10 },
  )
  expect(
    await remount.waitForFrame((frame) =>
      frame.includes("No active subagents"),
    ),
  ).toContain("[Active (0)]")
  const fresh = contextFixture()
  await using reset = await testRender(
    () => <Sidebar context={fresh.context} sessionID="root" />,
    { width: 28, height: 10 },
  )
  await clickText(reset, "▶ Subagents")
  expect(
    await reset.waitForFrame((frame) => frame.includes("[All (1)]")),
  ).toContain("child")
})

test("renders restored rows, keeps Unicode titles inside 28 columns, navigates on click", async () => {
  const f = contextFixture()
  const child = f.records[1]
  if (child) {
    child.title = "Исследование 界界界 👩‍💻 ".repeat(8)
    child.outcome = "succeeded"
  }
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 10 },
  )
  await screen.waitForFrame((frame) => frame.includes("▶ Subagents"))
  await screen.mockMouse.click(2, 1)
  const frame = await screen.waitForFrame((frame) => frame.includes("Done"))
  expect(frame).toContain("Subagents")
  expect(frame).toContain("Done")
  expect(screen.renderer.root.getChildren()[0]?.width).toBeLessThanOrEqual(28)
  const rowY = frame.split("\n").findIndex((line) => line.includes("Done"))
  await screen.mockMouse.click(2, rowY)
  expect(f.routes).toEqual([{ type: "session", sessionID: "child" }])
})

test("loading, empty, prop change, and cleanup use the real Solid lifecycle", async () => {
  const f = contextFixture([
    session("root"),
    session("other"),
    session("child", "other"),
  ])
  const pending = Promise.withResolvers<ReturnType<typeof session>>()
  const get = f.sessionAPI.get
  f.sessionAPI.get = (input) =>
    input.sessionID === "root" ? pending.promise : get(input)
  const [id, setId] = createSignal("root")
  const screen = await testRender(
    () => <Sidebar context={f.context} sessionID={id()} />,
    { width: 28, height: 10 },
  )
  try {
    await screen.waitForFrame((frame) => frame.includes("▶ Subagents"))
    await screen.mockMouse.click(2, 1)
    await screen.waitForFrame((frame) => frame.includes("Loading"))
    pending.resolve(session("root"))
    expect(
      await screen.waitForFrame((frame) => frame.includes("No subagents")),
    ).toContain("No subagents")
    setId("other")
    expect(
      await screen.waitForFrame((frame) => frame.includes("child")),
    ).toContain("Idle")
  } finally {
    await screen.dispose()
  }
  expect(f.listeners.size).toBe(0)
})

test("failed load offers working retry", async () => {
  const f = contextFixture()
  const get = f.sessionAPI.get
  f.sessionAPI.get = async () => {
    throw new Error("sensitive raw details")
  }
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 10 },
  )
  await screen.waitForFrame((frame) => frame.includes("▶ Subagents"))
  await screen.mockMouse.click(2, 1)
  const frame = await screen.waitForFrame((frame) => frame.includes("Retry"))
  expect(frame).toContain("Unable to load subagents")
  expect(frame).not.toContain("sensitive")
  f.sessionAPI.get = get
  await screen.mockMouse.click(
    2,
    frame.split("\n").findIndex((line) => line.includes("Retry")),
  )
  expect(
    await screen.waitForFrame((frame) => frame.includes("child")),
  ).toContain("Idle")
})

test("starts collapsed, updates counts while hidden and preserves choice on remount", async () => {
  const f = contextFixture()
  const screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 10 },
  )
  try {
    const collapsed = await screen.waitForFrame((frame) =>
      frame.includes("Subagents"),
    )
    expect(collapsed).toContain("▶ Subagents")
    expect(collapsed).not.toContain("child")
    f.sessionAPI.active = async () => ({ child: { type: "running" } })
    f.emit({ id: "connected", type: "server.connected", data: {} })
    const live = await screen.waitForFrame((frame) =>
      frame.includes("1 running"),
    )
    expect(live).toContain("▶ Subagents · 1 · 1 running")
    expect(live).not.toContain("child")
    await screen.mockMouse.click(2, 1)
    expect(
      await screen.waitForFrame((frame) => frame.includes("child")),
    ).toContain("▼ Subagents · 1")
    await screen.mockMouse.click(2, 1)
    expect(
      await screen.waitForFrame((frame) => frame.includes("▶")),
    ).not.toContain("child")
    await screen.mockMouse.click(2, 1)
    await screen.waitForFrame((frame) => frame.includes("child"))
  } finally {
    await screen.dispose()
  }
  await using remount = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 10 },
  )
  expect(
    await remount.waitForFrame((frame) => frame.includes("child")),
  ).toContain("▼ Subagents")
})
