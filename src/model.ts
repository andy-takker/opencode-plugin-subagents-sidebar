export type SessionRecord = {
  id: string
  parentID?: string
  title?: string
  time: { created: number; updated: number; busy?: number; idle?: number }
  outcome?: "succeeded" | "failed" | "interrupted"
}

export type LiveStatus = "running" | "waiting" | "idle" | "unknown"
export type ExecutionDuration = { start: number; end?: number }
export type Row = {
  id: string
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

function executionDuration(
  session: SessionRecord,
  live: LiveStatus,
): ExecutionDuration | undefined {
  const { busy, idle } = session.time
  if (
    live === "unknown" ||
    busy === undefined ||
    !Number.isFinite(busy) ||
    busy < 0 ||
    (idle !== undefined && (!Number.isFinite(idle) || idle < 0))
  )
    return undefined

  // busy starts the latest execution; idle can still belong to the previous one.
  if (idle !== undefined && idle >= busy) {
    if (live === "running" || !session.outcome) return undefined
    return { start: busy, end: idle }
  }
  if (live === "running" || live === "waiting") return { start: busy }
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
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i] ?? "") ?? []) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      queue.push(child.id)
      descendants.push(child)
    }
  }
  const active = (id: string) =>
    statuses.get(id) === "running" || statuses.get(id) === "waiting"
  descendants.sort(
    (a, b) =>
      Number(active(b.id)) - Number(active(a.id)) ||
      a.time.created - b.time.created ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  return descendants.map((session) => {
    const live = statuses.get(session.id) ?? "unknown"
    const duration = executionDuration(session, live)
    const outcome = {
      succeeded: "Done",
      failed: "Error",
      interrupted: "Interrupted",
    } as const
    return {
      id: session.id,
      title: session.title?.trim() || session.id,
      active: active(session.id),
      ...(duration ? { duration } : {}),
      status:
        live === "waiting"
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
