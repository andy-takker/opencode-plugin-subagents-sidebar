import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { contextFixture, session } from "../test/context"
import { Sidebar } from "./tui"

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
