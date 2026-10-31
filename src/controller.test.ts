import { expect, test } from "bun:test"
import {
  type Change,
  createController,
  type Source,
  type View,
} from "./controller"
import type { LiveStatus, SessionRecord } from "./model"

function session(id: string, parentID?: string): SessionRecord {
  return {
    id,
    ...(parentID ? { parentID } : {}),
    time: { created: 1, updated: 1 },
  }
}
function deferred<T>() {
  return Promise.withResolvers<T>()
}
function fixture(records = [session("root"), session("child", "root")]) {
  let listener: (change: Change) => void = () => {}
  const views: View[] = []
  const status = new Map<string, LiveStatus>()
  const calls = { get: [] as string[], children: 0, statuses: 0 }
  let stops = 0
  const source: Source = {
    async get(id) {
      calls.get.push(id)
      const result = records.find((r) => r.id === id)
      if (!result) throw new Error("not found")
      return result
    },
    async children(id, cursor) {
      calls.children++
      const children = records.filter((r) => r.parentID === id)
      const offset = Number(cursor ?? 0)
      return {
        data: children.slice(offset, offset + 50),
        next: children.length > offset + 50 ? String(offset + 50) : null,
      }
    },
    async statuses(ids) {
      calls.statuses++
      return new Map(ids.map((id) => [id, status.get(id) ?? "idle"]))
    },
    subscribe(fn) {
      listener = fn
      return () => {
        stops++
        listener = () => {}
      }
    },
  }
  const controller = createController(source, (view) => views.push(view))
  return {
    records,
    source,
    controller,
    views,
    status,
    calls,
    emit: (change: Change) => listener(change),
    stops: () => stops,
    last: () => views.at(-1),
  }
}

// All fixture I/O resolves as microtasks; an event-loop turn drains event work
// without adding a timing assumption or a test-only controller API.
const settleEvents = () => new Promise<void>((resolve) => setImmediate(resolve))

test("unrelated bursts resolve ancestry once without reloading the visible tree", async () => {
  const f = fixture([
    session("root"),
    session("child", "root"),
    session("other"),
    session("outside", "other"),
  ])
  await f.controller.select("root")
  const before = { ...f.calls, get: [...f.calls.get] }
  for (let i = 0; i < 100; i++) f.emit({ kind: "refresh", id: "outside" })
  await settleEvents()
  expect(f.calls.get.slice(before.get.length)).toEqual(["outside", "other"])
  expect(f.calls.children).toBe(before.children)
  expect(f.calls.statuses).toBe(before.statuses)
  for (let i = 0; i < 100; i++) f.emit({ kind: "refresh", id: "outside" })
  f.emit({ kind: "delete", id: "outside" })
  await settleEvents()
  expect(f.calls.get.slice(before.get.length)).toEqual(["outside", "other"])
  expect(f.calls.children).toBe(before.children)
  expect(f.last()?.rows.map((row) => row.id)).toEqual(["child"])
  f.controller.dispose()
})

test("created parent hints ignore unrelated roots and discover nested children", async () => {
  const f = fixture()
  await f.controller.select("root")
  const before = f.calls.children
  f.emit({ kind: "created", id: "other" })
  f.emit({ kind: "created", id: "outside", parentID: "other" })
  await settleEvents()
  expect(f.calls.children).toBe(before)
  f.records.push(session("nested", "child"), session("deep", "nested"))
  f.emit({ kind: "created", id: "nested", parentID: "child" })
  f.emit({ kind: "created", id: "deep", parentID: "nested" })
  await settleEvents()
  expect(f.last()?.rows.map((row) => row.id)).toEqual([
    "child",
    "deep",
    "nested",
  ])
  f.controller.dispose()
})

test("unknown relevant ancestry and failed lookups conservatively reconcile", async () => {
  const f = fixture()
  await f.controller.select("root")
  f.records.push(session("parent", "child"), session("new", "parent"))
  f.emit({ kind: "refresh", id: "new" })
  await settleEvents()
  expect(f.last()?.rows.map((row) => row.id)).toEqual([
    "child",
    "new",
    "parent",
  ])
  f.records.push(session("missed", "root"))
  f.emit({ kind: "refresh", id: "temporarily-unavailable" })
  await settleEvents()
  expect(f.last()?.rows.map((row) => row.id)).toContain("missed")
  f.controller.dispose()
})

test("unrelated events cannot invalidate an in-flight visible snapshot", async () => {
  const f = fixture()
  await f.controller.select("root")
  f.emit({ kind: "created", id: "other" })
  await settleEvents()
  const pending = deferred<ReadonlyMap<string, LiveStatus>>()
  const entered = deferred<void>()
  f.source.statuses = () => {
    entered.resolve()
    return pending.promise
  }
  const load = f.controller.refresh()
  await entered.promise
  const reads = f.calls.children
  for (let i = 0; i < 100; i++) f.emit({ kind: "refresh", id: "other" })
  pending.resolve(new Map([["child", "running"]]))
  await load
  expect(f.calls.children).toBe(reads)
  expect(f.last()?.rows[0]?.status).toBe("Running")
  f.controller.dispose()
})

test("unknown lookup work is bounded, deduplicated and discarded on root switch", async () => {
  const f = fixture([session("root"), session("b"), session("b-child", "b")])
  await f.controller.select("root")
  const pending = deferred<SessionRecord>()
  const entered = deferred<void>()
  const get = f.source.get
  let active = 0
  let peak = 0
  let lookups = 0
  f.source.get = async (id) => {
    if (!id.startsWith("unknown")) return get(id)
    lookups++
    active++
    peak = Math.max(peak, active)
    entered.resolve()
    try {
      return await pending.promise
    } finally {
      active--
    }
  }
  for (let i = 0; i < 100; i++)
    f.emit({ kind: "refresh", id: `unknown-${i % 10}` })
  expect(lookups).toBeGreaterThan(0)
  await entered.promise
  expect(peak).toBeLessThanOrEqual(4)
  await f.controller.select("b")
  const reads = f.calls.children
  pending.resolve(session("unknown-0", "root"))
  await settleEvents()
  expect(f.calls.children).toBe(reads)
  expect(lookups).toBeLessThanOrEqual(4)
  expect(f.last()?.rows.map((row) => row.id)).toEqual(["b-child"])
  f.controller.dispose()
})

test("reconnect clears unrelated ancestry and restores missed descendants", async () => {
  const f = fixture([session("root"), session("outside")])
  await f.controller.select("root")
  f.emit({ kind: "refresh", id: "outside" })
  await settleEvents()
  f.records.push(session("new", "root"))
  f.emit({ kind: "reconnect" })
  await settleEvents()
  expect(f.last()?.rows.map((row) => row.id)).toEqual(["new"])
  const before = f.calls.get.length
  f.emit({ kind: "refresh", id: "outside" })
  await settleEvents()
  expect(f.calls.get.slice(before)).toEqual(["outside"])
  f.controller.dispose()
})

test("new children arriving during initial pagination are not lost", async () => {
  const f = fixture()
  const pending = deferred<{ data: SessionRecord[] }>()
  const entered = deferred<void>()
  const children = f.source.children
  f.source.children = () => {
    f.source.children = children
    entered.resolve()
    return pending.promise
  }
  const load = f.controller.select("root")
  await entered.promise
  f.records.push(session("new", "child"))
  f.emit({ kind: "created", id: "new", parentID: "child" })
  pending.resolve({ data: [session("child", "root")] })
  await load
  await settleEvents()
  expect(f.last()?.rows.map((row) => row.id)).toEqual(["child", "new"])
  f.controller.dispose()
})

test("known relevant events update titles, outcomes and deletion without manual retry", async () => {
  const f = fixture()
  await f.controller.select("root")
  f.records[1] = {
    ...session("child", "root"),
    title: "Renamed",
    outcome: "failed",
  }
  f.emit({ kind: "refresh", id: "child" })
  await settleEvents()
  expect(f.last()?.rows[0]).toMatchObject({ title: "Renamed", status: "Error" })
  f.status.set("child", "running")
  f.emit({ kind: "refresh", id: "child" })
  await settleEvents()
  expect(f.last()?.rows[0]?.status).toBe("Running")
  f.emit({ kind: "delete", id: "child" })
  await settleEvents()
  expect(f.last()?.rows).toEqual([])
  f.controller.dispose()
})

test("disposing cancels queued ancestry work and prevents late refreshes", async () => {
  const f = fixture()
  await f.controller.select("root")
  const pending = deferred<SessionRecord>()
  const get = f.source.get
  const lookups: string[] = []
  f.source.get = (id) => {
    lookups.push(id)
    return id === "unknown" ? pending.promise : get(id)
  }
  f.emit({ kind: "refresh", id: "unknown" })
  f.emit({ kind: "refresh", id: "queued" })
  f.controller.dispose()
  const views = f.views.length
  const reads = f.calls.children
  pending.resolve(session("unknown", "root"))
  await settleEvents()
  expect(lookups).toEqual(["unknown"])
  expect(f.views).toHaveLength(views)
  expect(f.calls.children).toBe(reads)
})

test("cyclic unknown ancestry falls back to a tree refresh without looping", async () => {
  const f = fixture([session("root"), session("a", "b"), session("b", "a")])
  await f.controller.select("root")
  f.records.push(session("missed", "root"))
  f.emit({ kind: "refresh", id: "a" })
  await settleEvents()
  expect(f.last()?.rows.map((row) => row.id)).toEqual(["missed"])
  expect(f.calls.get.filter((id) => id === "a")).toHaveLength(1)
  expect(f.calls.get.filter((id) => id === "b")).toHaveLength(1)
  f.controller.dispose()
})

test("restores paginated nested family when opening a child or revisiting", async () => {
  const f = fixture([
    session("root"),
    ...Array.from({ length: 51 }, (_, i) => session(`c${i}`, "root")),
    session("nested", "c50"),
    session("other"),
  ])
  await f.controller.select("nested")
  expect(f.last()?.rootID).toBe("root")
  expect(f.last()?.rows).toHaveLength(52)
  await f.controller.select("other")
  expect(f.last()?.rows).toEqual([])
  await f.controller.select("c50")
  expect(f.last()?.rows).toHaveLength(52)
  f.controller.dispose()
})

test("late root A response cannot replace root B", async () => {
  const f = fixture([session("a"), session("b"), session("b-child", "b")])
  const pending = deferred<SessionRecord>()
  const get = f.source.get
  f.source.get = (id) => (id === "a" ? pending.promise : get(id))
  const a = f.controller.select("a")
  await f.controller.select("b")
  pending.resolve(session("a"))
  await a
  expect(f.last()?.rootID).toBe("b")
  expect(f.last()?.rows.map((r) => r.id)).toEqual(["b-child"])
  f.controller.dispose()
})

test("deletion during read cannot resurrect a session from a stale page", async () => {
  const f = fixture()
  const pending = deferred<{ data: SessionRecord[] }>()
  f.source.children = (id) =>
    id === "root" ? pending.promise : Promise.resolve({ data: [] })
  const load = f.controller.select("root")
  f.emit({ kind: "delete", id: "child" })
  pending.resolve({ data: [session("child", "root")] })
  await load
  expect(f.last()?.rows).toEqual([])
  f.controller.dispose()
})

test("dispose blocks late publish and unsubscribes exactly once", async () => {
  const f = fixture()
  const pending = deferred<SessionRecord>()
  f.source.get = () => pending.promise
  const load = f.controller.select("root")
  f.controller.dispose()
  f.controller.dispose()
  const count = f.views.length
  pending.resolve(session("root"))
  await load
  expect(f.views).toHaveLength(count)
  expect(f.stops()).toBe(1)
})

test("events during reads trigger reconciliation; rerun changes same row", async () => {
  const f = fixture()
  await f.controller.select("root")
  f.status.set("child", "running")
  f.emit({ kind: "refresh", id: "child" })
  await f.controller.refresh()
  expect(f.last()?.rows[0]?.status).toBe("Running")
  f.status.set("child", "idle")
  const child = f.records.find((r) => r.id === "child")
  if (child) child.outcome = "succeeded"
  f.emit({ kind: "refresh", id: "child" })
  await f.controller.refresh()
  expect(f.last()?.rows.map((r) => r.status)).toEqual(["Done"])
  f.records.push(session("new", "root"))
  f.emit({ kind: "reconnect" })
  await f.controller.refresh()
  expect(f.last()?.rows.map((r) => r.id)).toEqual(["child", "new"])
  f.controller.dispose()
})

test("errors are distinct from empty; retry recovers", async () => {
  const f = fixture()
  const get = f.source.get
  f.source.get = async () => {
    throw new Error("offline")
  }
  await f.controller.select("root")
  expect(f.last()?.phase).toBe("error")
  f.source.get = get
  await f.controller.refresh()
  expect(f.last()?.phase).toBe("ready")
  expect(f.last()?.rows).toHaveLength(1)
  f.controller.dispose()
})

test("cyclic parents and repeated cursors fail instead of looping", async () => {
  const f = fixture([session("a", "b"), session("b", "a")])
  await f.controller.select("a")
  expect(f.last()?.phase).toBe("error")
  f.source.get = async () => session("root")
  f.source.children = async () => ({ data: [], next: "again" })
  await f.controller.select("root")
  expect(f.last()?.phase).toBe("error")
  f.controller.dispose()
})

test("tree reads have bounded concurrency", async () => {
  const f = fixture([
    session("root"),
    ...Array.from({ length: 20 }, (_, i) => session(`c${i}`, "root")),
  ])
  const children = f.source.children
  let active = 0
  let peak = 0
  f.source.children = async (id, cursor) => {
    active++
    peak = Math.max(peak, active)
    await Promise.resolve()
    const result = await children(id, cursor)
    active--
    return result
  }
  await f.controller.select("root")
  expect(peak).toBeLessThanOrEqual(4)
  expect(f.last()?.rows).toHaveLength(20)
  f.controller.dispose()
})

test.each(["failed", "running"] as const)(
  "never publishes an invalidated successful snapshot after %s",
  async (latest) => {
    const f = fixture()
    f.records[1] = { ...session("child", "root"), outcome: "succeeded" }
    f.status.set("child", "running")
    await f.controller.select("root")
    const entered = deferred<void>()
    const pending = deferred<ReadonlyMap<string, LiveStatus>>()
    const statuses = f.source.statuses
    f.source.statuses = () => {
      f.source.statuses = statuses
      entered.resolve()
      return pending.promise
    }
    const refresh = f.controller.refresh()
    await entered.promise
    f.records[1] = { ...session("child", "root"), outcome: "failed" }
    f.status.set("child", latest === "running" ? "running" : "idle")
    f.emit({ kind: "refresh", id: "child" })
    pending.resolve(new Map([["child", "idle"]]))
    await refresh
    expect(
      f.views.flatMap((view) => view.rows.map((row) => row.status)),
    ).not.toContain("Done")
    expect(f.last()?.rows[0]?.status).toBe(
      latest === "running" ? "Running" : "Error",
    )
    f.controller.dispose()
  },
)

test("failed batches drain pending siblings before reconciliation", async () => {
  const f = fixture([
    session("root"),
    ...Array.from({ length: 4 }, (_, i) => session(`c${i}`, "root")),
  ])
  const children = f.source.children
  const entered = deferred<void>()
  const pending = Array.from({ length: 4 }, () => deferred<void>())
  let calls = 0
  let active = 0
  let peak = 0
  f.source.children = async (id, cursor) => {
    active++
    peak = Math.max(peak, active)
    try {
      if (id !== "root" && calls < 4) {
        const gate = pending[calls++]
        if (calls === 4) entered.resolve()
        await gate?.promise
      }
      return await children(id, cursor)
    } finally {
      active--
    }
  }
  const load = f.controller.select("root")
  await entered.promise
  f.emit({ kind: "refresh", id: "child" })
  pending[0]?.reject(new Error("offline"))
  // Drain microtasks so a faulty early-rejection refresh can start its next batch.
  for (let i = 0; i < 30; i++) await Promise.resolve()
  for (const gate of pending.slice(1)) gate.resolve()
  await load
  expect(peak).toBeLessThanOrEqual(4)
  expect(active).toBe(0)
  expect(f.last()?.rows).toHaveLength(4)
  f.controller.dispose()
})
