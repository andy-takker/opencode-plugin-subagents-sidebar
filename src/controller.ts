import {
  buildRows,
  type LiveStatus,
  type Row,
  type SessionRecord,
} from "./model"

export type SessionPage = { data: SessionRecord[]; next?: string | null }
export type Change =
  | { kind: "refresh" | "delete"; id: string }
  | { kind: "created"; id: string; parentID?: string }
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
  const newScope = () => ({
    rootID: undefined as string | undefined,
    parents: new Map<string, string | undefined>(),
    pending: new Set<string>(),
  })
  let scope = newScope()
  let resolving = false

  // Parentage is immutable in the public API: session.moved changes location,
  // not ancestry. Discard this cache on selection changes and reconnect.
  function membership(id: string, state = scope): boolean | undefined {
    if (!state.rootID) return undefined
    const visited = new Set<string>()
    let current: string | undefined = id
    while (current) {
      if (current === state.rootID) return true
      if (visited.has(current) || !state.parents.has(current)) return undefined
      visited.add(current)
      current = state.parents.get(current)
    }
    return false
  }

  async function resolveMembership(id: string, state: typeof scope) {
    const visited = new Set<string>()
    let current = id
    while (!disposed && scope === state) {
      const known = membership(current, state)
      if (known !== undefined) return known
      if (visited.has(current)) throw new Error("Cyclic session parents")
      visited.add(current)
      if (!state.parents.has(current)) {
        const info = await source.get(current)
        if (disposed || scope !== state) return false
        if (info.id !== current) throw new Error("Unexpected session response")
        // A creation event may have supplied newer knowledge during the read.
        if (!state.parents.has(current))
          state.parents.set(current, info.parentID)
      }
      const parent = state.parents.get(current)
      if (!parent) return false
      current = parent
    }
    return false
  }

  async function resolvePending() {
    if (resolving) return
    resolving = true
    try {
      // One ancestry walk at a time bounds extra I/O and deduplicates bursts.
      // Known relevant events bypass this queue and update immediately.
      while (!disposed && scope.pending.size) {
        const state = scope
        const id = state.pending.values().next().value
        if (!id) break
        let relevant = true
        try {
          relevant = await resolveMembership(id, state)
        } catch {
          // Unknown ancestry is not proof that an event can be discarded.
        }
        const unhandled = state.pending.delete(id)
        if (!disposed && scope === state && unhandled && relevant)
          void refresh()
      }
    } finally {
      resolving = false
    }
  }

  async function load(id: string, current: number, invalidated: () => boolean) {
    const state = scope
    let failed = false
    const valid = () =>
      !disposed && generation === current && !failed && !invalidated()
    let root = await source.get(id)
    if (!valid()) return
    state.parents.set(root.id, root.parentID)
    const ancestors = new Set([id])
    while (root.parentID && valid()) {
      if (ancestors.has(root.parentID))
        throw new Error("Cyclic session parents")
      ancestors.add(root.parentID)
      root = await source.get(root.parentID)
      if (!valid()) return
      state.parents.set(root.id, root.parentID)
    }
    if (!valid()) return
    state.rootID = root.id
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
                state.parents.set(child.id, child.parentID)
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
    // A lifecycle event may have arrived before its child was discovered. Do
    // not publish that pre-event page while a slower point lookup is pending.
    // Consume it once so the retry can proceed without waiting for the lookup.
    let discoveredEvent = false
    for (const id of state.pending) {
      if (membership(id, state) === true) {
        state.pending.delete(id)
        discoveredEvent = true
      }
    }
    if (discoveredEvent) {
      void refresh()
      return
    }
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
    if (change.kind === "reconnect") {
      scope = newScope()
      void refresh()
      return
    }
    if (change.kind === "delete") deleted.add(change.id)
    if (change.kind === "created") scope.parents.set(change.id, change.parentID)
    const relevant = membership(change.id)
    if (relevant === false) return
    if (relevant === true || !scope.rootID || change.kind === "delete") {
      void refresh()
      return
    }
    scope.pending.add(change.id)
    void resolvePending()
  })

  return {
    select(sessionID: string): Promise<void> {
      if (disposed) return Promise.resolve()
      if (selected !== sessionID) {
        generation++
        selected = sessionID
        scope = newScope()
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
      scope = newScope()
      stop()
    },
  }
}
