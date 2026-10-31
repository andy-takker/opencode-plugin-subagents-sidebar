import {
  buildRows,
  type LiveStatus,
  type Row,
  type SessionRecord,
} from "./model"

export type SessionPage = { data: SessionRecord[]; next?: string | null }
export type Change =
  | { kind: "refresh" | "delete"; id: string }
  | { kind: "reconnect" }
export type Source = {
  get(id: string): Promise<SessionRecord>
  children(parentID: string, cursor?: string): Promise<SessionPage>
  statuses(ids: readonly string[]): Promise<ReadonlyMap<string, LiveStatus>>
  subscribe(listener: (change: Change) => void): () => void
}
export type View = {
  phase: "loading" | "ready" | "error"
  rootID?: string
  rows: Row[]
  error?: string
}

export function createController(
  source: Source,
  publish: (view: View) => void,
) {
  let generation = 0
  let selected: string | undefined
  let disposed = false
  let job:
    | { generation: number; dirty: boolean; promise: Promise<void> }
    | undefined
  const deleted = new Set<string>()

  async function load(id: string, current: number, invalidated: () => boolean) {
    let failed = false
    const valid = () =>
      !disposed && generation === current && !failed && !invalidated()
    let root = await source.get(id)
    const ancestors = new Set([id])
    while (root.parentID && valid()) {
      if (ancestors.has(root.parentID))
        throw new Error("Cyclic session parents")
      ancestors.add(root.parentID)
      root = await source.get(root.parentID)
    }
    if (!valid()) return
    const sessions = new Map<string, SessionRecord>([[root.id, root]])
    const queue = [root.id]
    // A bounded breadth-first queue avoids unbounded Promise.all on wide trees.
    while (queue.length && valid()) {
      const batch = await Promise.allSettled(
        queue
          .splice(0, 4)
          .map(async (parentID) => {
            let cursor: string | undefined
            const cursors = new Set<string>()
            do {
              if (!valid() || deleted.has(parentID)) return
              const page = await source.children(parentID, cursor)
              if (!valid()) return
              for (const child of page.data) {
                if (
                  child.parentID !== parentID ||
                  deleted.has(child.id) ||
                  sessions.has(child.id)
                )
                  continue
                sessions.set(child.id, child)
                queue.push(child.id)
              }
              cursor = page.next ?? undefined
              if (cursor && cursors.has(cursor))
                throw new Error("Repeated session cursor")
              if (cursor) cursors.add(cursor)
            } while (cursor)
          })
          .map((worker) =>
            worker.catch((error: unknown) => {
              failed = true
              throw error
            }),
          ),
      )
      const rejection = batch.find((result) => result.status === "rejected")
      if (rejection?.status === "rejected") throw rejection.reason
    }
    if (!valid()) return
    const statuses = await source.statuses([...sessions.keys()])
    if (!valid()) return
    for (const id of deleted) sessions.delete(id)
    publish({
      phase: "ready",
      rootID: root.id,
      rows: buildRows(root.id, [...sessions.values()], statuses),
    })
  }

  function refresh(): Promise<void> {
    if (disposed || !selected) return Promise.resolve()
    if (job?.generation === generation) {
      job.dirty = true
      return job.promise
    }
    const id = selected
    const current = generation
    const next = {
      generation: current,
      dirty: false,
      promise: Promise.resolve(),
    }
    job = next
    next.promise = (async () => {
      do {
        next.dirty = false
        try {
          await load(id, current, () => next.dirty)
        } catch {
          if (!disposed && current === generation && !next.dirty) {
            publish({
              phase: "error",
              rows: [],
              error: "Unable to load subagents",
            })
          }
        }
      } while (next.dirty && !disposed && current === generation)
      if (job === next) job = undefined
    })()
    return next.promise
  }

  const stop = source.subscribe((change) => {
    if (disposed) return
    if (change.kind === "delete") deleted.add(change.id)
    void refresh()
  })

  return {
    select(sessionID: string): Promise<void> {
      if (disposed) return Promise.resolve()
      if (selected !== sessionID) {
        generation++
        selected = sessionID
        publish({ phase: "loading", rows: [] })
      }
      return refresh()
    },
    refresh,
    dispose() {
      if (disposed) return
      disposed = true
      generation++
      deleted.clear()
      stop()
    },
  }
}
