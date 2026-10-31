import type { OpenCodeEvent, SessionInfo } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { RGBA } from "@opentui/core"

export function session(id: string, parentID?: string): SessionInfo {
  return {
    id,
    ...(parentID ? { parentID } : {}),
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    location: { directory: "/project" },
  }
}

export function contextFixture(
  records: SessionInfo[] = [session("root"), session("child", "root")],
) {
  const listeners = new Set<(event: { details: OpenCodeEvent }) => void>()
  const routes: unknown[] = []
  const requests: unknown[] = []
  const color = RGBA.fromHex("#ffffff")
  const sessionAPI: Pick<
    Plugin.Context["client"]["session"],
    "get" | "list" | "active"
  > = {
    async get({ sessionID }) {
      const record = records.find((r) => r.id === sessionID)
      if (!record) throw new Error("missing")
      return record
    },
    async list(input) {
      requests.push(input)
      return {
        data: records.filter((r) => r.parentID === input?.parentID),
        cursor: {},
      }
    },
    async active() {
      return {}
    },
  }
  // Only the public boundary consumed by the plugin is doubled; response/event
  // fixtures retain the SDK types so API drift is caught by typecheck.
  const context = {
    client: { session: sessionAPI },
    data: {
      listen(fn: (event: { details: OpenCodeEvent }) => void) {
        listeners.add(fn)
        return () => {
          listeners.delete(fn)
        }
      },
    },
    ui: {
      router: {
        navigate(route: unknown) {
          routes.push(route)
        },
      },
    },
    theme: {
      text: {
        base: color,
        muted: color,
        feedback: {
          success: { base: color },
          error: { base: color },
          warning: { base: color },
          info: { base: color },
        },
      },
    },
  } as unknown as Plugin.Context
  return {
    context,
    sessionAPI,
    records,
    routes,
    requests,
    listeners,
    emit: (event: OpenCodeEvent) => {
      for (const fn of listeners) fn({ details: event })
    },
  }
}
