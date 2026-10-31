export type SessionRecord = {
  id: string
  parentID?: string
  title?: string
  time: { created: number; updated: number; busy?: number; idle?: number }
  outcome?: "succeeded" | "failed" | "interrupted"
}

export type LiveStatus =
  | "running"
  | "idle"
  | "unknown"
  | { type: "waiting"; execution: "running" | "idle" }
export type ExecutionDuration = { start: number; end?: number }
export type Row = {
  id: string
  parentID?: string
  title: string
  status:
    | "Running"
    | "Waiting"
    | "Done"
    | "Error"
    | "Interrupted"
    | "Idle"
    | "Unknown"
  active: boolean
  duration?: ExecutionDuration
}

export type TreeRow = Row & { prefix: string; context: boolean }

export function treeRows(rows: readonly Row[], activeOnly: boolean): TreeRow[] {
  // buildRows supplies a cycle-free preorder, so one reverse pass keeps ancestors.
  const keep = new Set<string>()
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (!row || (activeOnly && !row.active && !keep.has(row.id))) continue
    keep.add(row.id)
    if (row.parentID) keep.add(row.parentID)
  }
  const children = new Map<string | undefined, Row[]>()
  for (const row of rows) {
    if (!keep.has(row.id)) continue
    const siblings = children.get(row.parentID) ?? []
    siblings.push(row)
    children.set(row.parentID, siblings)
  }
  type Entry = { row: Row; depth: number; last: boolean; prefix: string }
  const stack: Entry[] = []
  const pushChildren = (parent?: Entry) => {
    const siblings = children.get(parent?.row.id) ?? []
    const depth = parent ? parent.depth + 1 : 0
    for (let i = siblings.length - 1; i >= 0; i--) {
      const row = siblings[i]
      if (!row) continue
      const last = i === siblings.length - 1
      const connector = last ? "└─ " : "├─ "
      const prefix =
        depth === 0
          ? ""
          : depth === 1
            ? connector
            : depth === 2
              ? `${parent?.last ? "   " : "│  "}${connector}`
              : `…  ${connector}`
      stack.push({ row, depth, last, prefix })
    }
  }
  pushChildren()
  const result: TreeRow[] = []
  while (stack.length) {
    const entry = stack.pop()
    if (!entry) break
    result.push({
      ...entry.row,
      prefix: entry.prefix,
      context: activeOnly && !entry.row.active,
    })
    pushChildren(entry)
  }
  return result
}

function executionDuration(
  session: SessionRecord,
  live: LiveStatus,
): ExecutionDuration | undefined {
  const execution = typeof live === "object" ? live.execution : live
  const { busy, idle } = session.time
  if (
    execution === "unknown" ||
    busy === undefined ||
    !Number.isFinite(busy) ||
    busy < 0 ||
    (idle !== undefined && (!Number.isFinite(idle) || idle < 0))
  )
    return undefined

  // busy starts the latest execution; idle can still belong to the previous one.
  if (idle !== undefined && idle >= busy) {
    if (execution === "running" || !session.outcome) return undefined
    return { start: busy, end: idle }
  }
  if (execution === "running") return { start: busy }
  return undefined
}

export function formatDuration(
  duration: ExecutionDuration | undefined,
  now: number,
): string {
  if (!duration) return "—"
  const { start, end = now } = duration
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(now) ||
    start < 0 ||
    end < start ||
    end > now
  )
    return "—"
  const seconds = Math.floor((end - start) / 1_000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const pad = (value: number) => String(value).padStart(2, "0")
  if (days >= 1_000) return "999d+"
  if (days) return `${days}d${pad(hours % 24)}h`
  if (hours) return `${hours}h${pad(minutes % 60)}m`
  if (minutes) return `${minutes}m${pad(seconds % 60)}s`
  return `${seconds}s`
}

export function buildRows(
  rootID: string,
  sessions: readonly SessionRecord[],
  statuses: ReadonlyMap<string, LiveStatus>,
): Row[] {
  const records = new Map(sessions.map((session) => [session.id, session]))
  const children = new Map<string, SessionRecord[]>()
  for (const session of records.values()) {
    if (!session.parentID) continue
    const siblings = children.get(session.parentID) ?? []
    siblings.push(session)
    children.set(session.parentID, siblings)
  }
  const visited = new Set([rootID])
  const queue = [rootID]
  const descendants: SessionRecord[] = []
  const tree = new Map<string, SessionRecord[]>()
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i] ?? "") ?? []) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      queue.push(child.id)
      descendants.push(child)
      const siblings = tree.get(queue[i] ?? "") ?? []
      siblings.push(child)
      tree.set(queue[i] ?? "", siblings)
    }
  }
  const active = (id: string) => {
    const live = statuses.get(id)
    return live === "running" || typeof live === "object"
  }
  const activeBranches = new Set<string>()
  for (let i = descendants.length - 1; i >= 0; i--) {
    const row = descendants[i]
    if (!row || (!active(row.id) && !activeBranches.has(row.id))) continue
    activeBranches.add(row.id)
    if (row.parentID) activeBranches.add(row.parentID)
  }
  for (const siblings of tree.values())
    siblings.sort(
      (a, b) =>
        Number(activeBranches.has(b.id)) - Number(activeBranches.has(a.id)) ||
        a.time.created - b.time.created ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
  const ordered: SessionRecord[] = []
  const stack = [...(tree.get(rootID) ?? [])].reverse()
  while (stack.length) {
    const row = stack.pop()
    if (!row) break
    ordered.push(row)
    const nested = tree.get(row.id) ?? []
    for (let i = nested.length - 1; i >= 0; i--) {
      const child = nested[i]
      if (child) stack.push(child)
    }
  }
  return ordered.map((session) => {
    const live = statuses.get(session.id) ?? "unknown"
    const duration = executionDuration(session, live)
    const outcome = {
      succeeded: "Done",
      failed: "Error",
      interrupted: "Interrupted",
    } as const
    return {
      id: session.id,
      ...(session.parentID && session.parentID !== rootID
        ? { parentID: session.parentID }
        : {}),
      title: session.title?.trim() || session.id,
      active: active(session.id),
      ...(duration ? { duration } : {}),
      status:
        typeof live === "object"
          ? "Waiting"
          : live === "running"
            ? "Running"
            : live === "unknown"
              ? "Unknown"
              : session.outcome
                ? outcome[session.outcome]
                : "Idle",
    }
  })
}
