import type { SessionInfo } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import type { Source } from "./controller"
import type { LiveStatus, SessionRecord } from "./model"

function record(info: SessionInfo): SessionRecord {
  return {
    id: info.id,
    time: {
      created: info.time.created,
      updated: info.time.updated,
      ...(info.time.busy !== undefined ? { busy: info.time.busy } : {}),
      ...(info.time.idle !== undefined ? { idle: info.time.idle } : {}),
    },
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
    async statuses(ids, isCurrent = () => true) {
      const active = await context.client.session.active()
      const statuses = new Map<string, LiveStatus>(
        ids.map((id) => [
          id,
          active[id]?.type === "running" ? "running" : "idle",
        ]),
      )
      // Session-scoped reads also cover descendants that moved to another
      // location. Location-wide lists would silently miss those requests.
      for (let offset = 0; offset < ids.length; offset += 4) {
        if (!isCurrent()) break
        let failed = false
        const batch = await Promise.allSettled(
          ids.slice(offset, offset + 4).map(async (sessionID) => {
            try {
              const permissions = await context.client.permission.list({
                sessionID,
              })
              if (failed || !isCurrent()) return
              const forms = await context.client.session.form.list({
                sessionID,
              })
              if (
                permissions.some(
                  (request) => request.sessionID === sessionID,
                ) ||
                forms.some((request) => request.sessionID === sessionID)
              ) {
                statuses.set(sessionID, "waiting")
              }
            } catch (error) {
              failed = true
              throw error
            }
          }),
        )
        // Drain siblings before allowing the controller to retry a failed load.
        const rejection = batch.find((result) => result.status === "rejected")
        if (rejection?.status === "rejected") throw rejection.reason
      }
      return statuses
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
          case "permission.asked":
          case "permission.replied":
          case "form.replied":
          case "form.cancelled":
            listener({ kind: "refresh", id: event.data.sessionID })
            break
          case "form.created":
            listener({ kind: "refresh", id: event.data.form.sessionID })
        }
      })
    },
  }
}
