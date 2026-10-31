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
  let stops = 0
  const source: Source = {
    async get(id) {
      const result = records.find((r) => r.id === id)
      if (!result) throw new Error("not found")
      return result
    },
    async children(id, cursor) {
      const children = records.filter((r) => r.parentID === id)
      const offset = Number(cursor ?? 0)
      return {
        data: children.slice(offset, offset + 50),
        next: children.length > offset + 50 ? String(offset + 50) : null,
      }
    },
    async statuses(ids) {
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
    emit: (change: Change) => listener(change),
    stops: () => stops,
    last: () => views.at(-1),
  }
}

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
