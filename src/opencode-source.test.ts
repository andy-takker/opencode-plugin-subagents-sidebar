import { expect, test } from "bun:test"
import { contextFixture, session } from "../test/context"
import type { Change } from "./controller"
import { createOpenCodeSource } from "./opencode-source"

test("SDK adapter uses exact parent and cursor, with no location filter", async () => {
  const child = {
    ...session("child", "root"),
    location: { directory: "/different" },
    outcome: "succeeded" as const,
  }
  const f = contextFixture([session("root"), child])
  f.sessionAPI.list = async (input) => {
    f.requests.push(input)
    return { data: [child], cursor: { next: "opaque-next" } }
  }
  const source = createOpenCodeSource(f.context)
  const page = await source.children("root", "opaque-first")
  expect(f.requests).toEqual([
    { parentID: "root", cursor: "opaque-first", limit: 100, order: "asc" },
  ])
  expect(page.next).toBe("opaque-next")
  expect(page.data[0]).toEqual({
    id: "child",
    parentID: "root",
    outcome: "succeeded",
    time: { created: 1, updated: 1 },
  })
  expect((await source.get("child")).id).toBe("child")
  f.sessionAPI.active = async () => ({ child: { type: "running" } })
  expect([...(await source.statuses(["child", "root"]))]).toEqual([
    ["child", "running"],
    ["root", "idle"],
  ])
})

test("failed active snapshot never becomes an idle success", async () => {
  const f = contextFixture()
  f.sessionAPI.active = async () => {
    throw new Error("offline")
  }
  await expect(
    createOpenCodeSource(f.context).statuses(["child"]),
  ).rejects.toThrow("offline")
})

test("lifecycle and reconnect events refresh; token deltas do not", () => {
  const f = contextFixture()
  const changes: Change[] = []
  const stop = createOpenCodeSource(f.context).subscribe((change) =>
    changes.push(change),
  )
  const durable = { aggregateID: "child", seq: 1, version: 1 as const }
  f.emit({
    id: "e1",
    created: 1,
    type: "session.execution.started",
    durable,
    data: { sessionID: "child" },
  })
  f.emit({
    id: "e2",
    created: 2,
    type: "session.renamed",
    durable,
    data: { sessionID: "child", title: "New name" },
  })
  f.emit({
    id: "e3",
    created: 3,
    type: "session.deleted",
    durable: { ...durable, version: 2 },
    data: { sessionID: "child" },
  })
  f.emit({ id: "e4", type: "server.connected", data: {} })
  f.emit({
    id: "e5",
    created: 5,
    type: "session.text.delta",
    data: {
      sessionID: "child",
      assistantMessageID: "m",
      ordinal: 0,
      delta: "token",
    },
  })
  expect(changes).toEqual([
    { kind: "refresh", id: "child" },
    { kind: "refresh", id: "child" },
    { kind: "delete", id: "child" },
    { kind: "reconnect" },
  ])
  stop()
  expect(f.listeners.size).toBe(0)
})
