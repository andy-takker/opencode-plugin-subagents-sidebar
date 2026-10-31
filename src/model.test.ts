import { expect, test } from "bun:test"
import { buildRows, type SessionRecord } from "./model"

function record(
  id: string,
  parentID?: string,
  created = 1,
  outcome?: SessionRecord["outcome"],
): SessionRecord {
  return {
    id,
    time: { created, updated: created },
    ...(parentID ? { parentID } : {}),
    ...(outcome ? { outcome } : {}),
  }
}

test("only descendants, nested children included, running first", () => {
  const sessions = [
    record("root"),
    record("idle", "root"),
    record("running", "root", 2),
    record("nested", "idle", 3),
    record("other"),
    record("foreign", "other"),
  ]
  expect(
    buildRows("root", sessions, new Map([["running", "running"]])).map(
      (r) => r.id,
    ),
  ).toEqual(["running", "idle", "nested"])
  expect(buildRows("other", sessions, new Map()).map((r) => r.id)).toEqual([
    "foreign",
  ])
})

test("equal creation times sort by id; duplicates and disconnected cycles are safe", () => {
  const sessions = [
    record("b", "root"),
    record("a", "root"),
    record("a", "root"),
    record("x", "y"),
    record("y", "x"),
  ]
  expect(buildRows("root", sessions, new Map()).map((r) => r.id)).toEqual([
    "a",
    "b",
  ])
  expect(buildRows("x", sessions, new Map()).map((r) => r.id)).toEqual(["y"])
})

test("missing and blank titles use the session id", () => {
  expect(
    buildRows(
      "root",
      [{ ...record("a", "root"), title: "  " }, record("b", "root")],
      new Map(),
    ).map((r) => r.title),
  ).toEqual(["a", "b"])
})

test.each([
  ["running", "succeeded", "Running"],
  ["running", "failed", "Running"],
  ["waiting", "failed", "Waiting"],
  ["waiting", "succeeded", "Waiting"],
  ["waiting", undefined, "Waiting"],
  ["idle", "succeeded", "Done"],
  ["idle", "failed", "Error"],
  ["idle", "interrupted", "Interrupted"],
  ["idle", undefined, "Idle"],
  ["unknown", undefined, "Unknown"],
  ["unknown", "succeeded", "Unknown"],
] as const)("%s / %s → %s", (live, outcome, expected) => {
  expect(
    buildRows(
      "root",
      [record("child", "root", 1, outcome)],
      new Map([["child", live]]),
    )[0]?.status,
  ).toBe(expected)
})

test("waiting is active and shares deterministic active-first ordering", () => {
  const rows = buildRows(
    "root",
    [
      record("failed", "root", 0, "failed"),
      record("waiting", "root", 1),
      record("running", "root", 2),
    ],
    new Map([
      ["failed", "idle"],
      ["waiting", "waiting"],
      ["running", "running"],
    ]),
  )
  expect(rows.map(({ id, active }) => ({ id, active }))).toEqual([
    { id: "waiting", active: true },
    { id: "running", active: true },
    { id: "failed", active: false },
  ])
})
