import type { SessionInfo } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import type { Source } from "./controller"
import type { SessionRecord } from "./model"

function record(info: SessionInfo): SessionRecord {
  return {
    id: info.id,
    time: { created: info.time.created, updated: info.time.updated },
    ...(info.parentID ? { parentID: info.parentID } : {}),
    ...(info.title !== undefined ? { title: info.title } : {}),
    ...(info.outcome ? { outcome: info.outcome } : {}),
  }
}

export function createOpenCodeSource(context: Plugin.Context): Source {
  return {
    async get(id) {
      return record(await context.client.session.get({ sessionID: id }))
    },
    async children(parentID, cursor) {
      const page = await context.client.session.list({
        parentID,
        cursor,
        limit: 100,
        order: "asc",
      })
      return { data: page.data.map(record), next: page.cursor.next ?? null }
    },
    async statuses(ids) {
      const active = await context.client.session.active()
      return new Map(
        ids.map((id) => [
          id,
          active[id]?.type === "running" ? "running" : "idle",
        ]),
      )
    },
    subscribe(listener) {
      return context.data.listen(({ details: event }) => {
        switch (event.type) {
          case "server.connected":
            listener({ kind: "reconnect" })
            break
          case "session.deleted":
            listener({ kind: "delete", id: event.data.sessionID })
            break
          case "session.created":
            listener({
              kind: "created",
              id: event.data.sessionID,
              ...(event.data.parentID ? { parentID: event.data.parentID } : {}),
            })
            break
          case "session.renamed":
          case "session.moved":
          case "session.execution.started":
          case "session.execution.succeeded":
          case "session.execution.failed":
          case "session.execution.interrupted":
          case "session.status":
          case "session.idle":
            listener({ kind: "refresh", id: event.data.sessionID })
        }
      })
    },
  }
}
