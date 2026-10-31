export type SessionRecord = {
  id: string
  parentID?: string
  title?: string
  time: { created: number; updated: number }
  outcome?: "succeeded" | "failed" | "interrupted"
}

export type LiveStatus = "running" | "waiting" | "idle" | "unknown"
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
    const outcome = {
      succeeded: "Done",
      failed: "Error",
      interrupted: "Interrupted",
    } as const
    return {
      id: session.id,
      title: session.title?.trim() || session.id,
      active: active(session.id),
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
