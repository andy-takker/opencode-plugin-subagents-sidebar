import { expect, test } from "bun:test"
import { contextFixture, form, permission, session } from "../test/context"
import { type Change, createController, type View } from "./controller"
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

test("session get and paginated children preserve last execution timestamps", async () => {
  const child = {
    ...session("child", "root"),
    time: { created: 1, updated: 99_999, busy: 20_000, idle: 19_000 },
  }
  const f = contextFixture([session("root"), child])
  const source = createOpenCodeSource(f.context)
  expect((await source.get("child")).time).toEqual(child.time)
  expect((await source.children("root")).data[0]?.time).toEqual(child.time)
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

test("creation events preserve parent hints, including explicit new roots", () => {
  const f = contextFixture()
  const changes: Change[] = []
  const stop = createOpenCodeSource(f.context).subscribe((change) =>
    changes.push(change),
  )
  for (const info of [session("new-root"), session("child", "root")]) {
    f.emit({
      id: `created-${info.id}`,
      created: 1,
      type: "session.created",
      durable: { aggregateID: info.id, seq: 1, version: 1 },
      data: {
        sessionID: info.id,
        projectID: info.projectID,
        location: info.location,
        ...(info.parentID ? { parentID: info.parentID } : {}),
        slug: info.id,
        version: "2.2.5",
      },
    })
  }
  expect(changes).toEqual([
    { kind: "created", id: "new-root" },
    { kind: "created", id: "child", parentID: "root" },
  ])
  stop()
})

test("pending permissions and forms override running, deduplicate sessions, and clear on resolution", async () => {
  const f = contextFixture()
  f.sessionAPI.active = async () => ({ child: { type: "running" } })
  f.permissions.push(
    permission("child", "p1"),
    permission("child", "p2"),
    permission("foreign"),
  )
  f.forms.push(form("child"), form("idle-child"))
  const source = createOpenCodeSource(f.context)
  expect([...(await source.statuses(["child", "idle-child", "root"]))]).toEqual(
    [
      ["child", "waiting"],
      ["idle-child", "waiting"],
      ["root", "idle"],
    ],
  )
  expect(f.attentionRequests).toContainEqual({
    kind: "permission",
    sessionID: "child",
  })
  expect(f.attentionRequests).toContainEqual({
    kind: "form",
    sessionID: "idle-child",
  })
  f.permissions.length = 0
  expect((await source.statuses(["child"])).get("child")).toBe("waiting")
  f.forms.length = 0
  expect((await source.statuses(["child"])).get("child")).toBe("running")
  f.sessionAPI.active = async () => ({})
  expect((await source.statuses(["child"])).get("child")).toBe("idle")
})

test.each(["permission", "form"] as const)(
  "failed or unavailable %s reads are not no-pending snapshots",
  async (kind) => {
    const f = contextFixture()
    const api = kind === "permission" ? f.permissionAPI : f.formAPI
    api.list = async () => {
      throw new Error("endpoint unavailable")
    }
    await expect(
      createOpenCodeSource(f.context).statuses(["child"]),
    ).rejects.toThrow("endpoint unavailable")
  },
)

test("attention events map their session ids and unsubscribe normally", () => {
  const f = contextFixture()
  const changes: Change[] = []
  const stop = createOpenCodeSource(f.context).subscribe((change) =>
    changes.push(change),
  )
  const envelope = { id: "e", created: 1 }
  f.emit({ ...envelope, type: "permission.asked", data: permission("child") })
  f.emit({
    ...envelope,
    type: "permission.replied",
    data: { sessionID: "child", requestID: "permission", reply: "once" },
  })
  f.emit({ ...envelope, type: "form.created", data: { form: form("nested") } })
  f.emit({
    ...envelope,
    type: "form.replied",
    data: { sessionID: "nested", id: "form", answer: { answer: "yes" } },
  })
  f.emit({
    ...envelope,
    type: "form.cancelled",
    data: { sessionID: "nested", id: "form" },
  })
  expect(changes).toEqual(
    ["child", "child", "nested", "nested", "nested"].map((id) => ({
      kind: "refresh",
      id,
    })),
  )
  stop()
  f.emit({ ...envelope, type: "permission.asked", data: permission("child") })
  expect(changes).toHaveLength(5)
})

test("attention requests stay bounded and a failed batch drains before rejecting", async () => {
  const f = contextFixture()
  const gate = Promise.withResolvers<void>()
  let active = 0
  let peak = 0
  let reads = 0
  f.permissionAPI.list = async ({ sessionID }) => {
    reads++
    active++
    peak = Math.max(peak, active)
    try {
      if (sessionID === "0") throw new Error("failed")
      await gate.promise
      return []
    } finally {
      active--
    }
  }
  let settled = false
  const result = createOpenCodeSource(f.context)
    .statuses(Array.from({ length: 10 }, (_, i) => String(i)))
    .catch((error: unknown) => {
      settled = true
      return error
    })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(reads).toBe(4)
  expect(settled).toBe(false)
  gate.resolve()
  expect(await result).toBeInstanceOf(Error)
  expect(active).toBe(0)
  expect(peak).toBeLessThanOrEqual(4)
  expect(reads).toBe(4)
})

test("attention reads cover every requested session beyond one batch", async () => {
  const f = contextFixture()
  f.forms.push(form("9"))
  const ids = Array.from({ length: 10 }, (_, i) => String(i))
  const statuses = await createOpenCodeSource(f.context).statuses(ids)
  expect(statuses.get("9")).toBe("waiting")
  expect([...statuses.keys()]).toEqual(ids)
  expect(f.attentionRequests).toHaveLength(20)
  expect(
    f.attentionRequests.every((request) => Object.keys(request).length === 2),
  ).toBe(true)
})

test("disposing a tree drains in-flight attention reads without starting more", async () => {
  const f = contextFixture([
    session("root"),
    ...Array.from({ length: 10 }, (_, i) => session(String(i), "root")),
  ])
  const entered = Promise.withResolvers<void>()
  const gate = Promise.withResolvers<void>()
  let reads = 0
  f.permissionAPI.list = async () => {
    if (++reads === 4) entered.resolve()
    await gate.promise
    return []
  }
  const views: View[] = []
  const controller = createController(createOpenCodeSource(f.context), (view) =>
    views.push(view),
  )
  const loading = controller.select("root")
  await entered.promise
  controller.dispose()
  gate.resolve()
  await loading
  expect(reads).toBe(4)
  expect(f.attentionRequests).toEqual([])
  expect(views.map((view) => view.phase)).toEqual(["loading"])
})

test.each([true, false])(
  "attention event invalidates an in-flight %s pending snapshot",
  async (initiallyWaiting) => {
    const f = contextFixture()
    f.sessionAPI.active = async () => ({ child: { type: "running" } })
    if (initiallyWaiting) f.permissions.push(permission("child"))
    const entered = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    const list = f.permissionAPI.list
    let held = false
    f.permissionAPI.list = async (input) => {
      const snapshot = await list(input)
      if (input.sessionID === "child" && !held) {
        held = true
        entered.resolve()
        await gate.promise
      }
      return snapshot
    }
    const views: View[] = []
    const controller = createController(
      createOpenCodeSource(f.context),
      (view) => views.push(view),
    )
    try {
      const loading = controller.select("root")
      await entered.promise
      if (initiallyWaiting) {
        f.permissions.length = 0
        f.emit({
          id: "reply",
          created: 1,
          type: "permission.replied",
          data: { sessionID: "child", requestID: "permission", reply: "once" },
        })
      } else {
        f.permissions.push(permission("child"))
        f.emit({
          id: "asked",
          created: 1,
          type: "permission.asked",
          data: permission("child"),
        })
      }
      gate.resolve()
      await loading
      const published = views
        .filter((view) => view.phase === "ready")
        .map((view) => view.rows[0]?.status)
      expect(published).toEqual([initiallyWaiting ? "Running" : "Waiting"])
    } finally {
      gate.resolve()
      controller.dispose()
    }
  },
)

test("reconnect restores missed pending state and unrelated attention does not reload the tree", async () => {
  const f = contextFixture([
    session("root"),
    session("child", "root"),
    session("other"),
    session("foreign", "other"),
  ])
  const views: View[] = []
  const controller = createController(createOpenCodeSource(f.context), (view) =>
    views.push(view),
  )
  try {
    await controller.select("root")
    const reads = f.requests.length
    const attentionReads = f.attentionRequests.length
    f.forms.push(form("foreign"))
    f.emit({
      id: "foreign",
      created: 1,
      type: "form.created",
      data: { form: form("foreign") },
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(f.requests).toHaveLength(reads)
    expect(f.attentionRequests).toHaveLength(attentionReads)
    f.forms.push(form("child"))
    f.emit({ id: "reconnect", type: "server.connected", data: {} })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(views.at(-1)?.rows.map((row) => row.status)).toEqual(["Waiting"])
    f.forms.length = 0
    f.emit({ id: "again", type: "server.connected", data: {} })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(views.at(-1)?.rows.map((row) => row.status)).toEqual(["Idle"])
  } finally {
    controller.dispose()
  }
})
