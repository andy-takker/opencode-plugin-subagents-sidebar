import { expect, test } from "bun:test"
import {
  buildRows,
  formatDuration,
  type LiveStatus,
  type SessionRecord,
} from "./model"

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

test.each([
  [0, "0s"],
  [999, "0s"],
  [1_000, "1s"],
  [59_999, "59s"],
  [60_000, "1m00s"],
  [192_000, "3m12s"],
  [3_599_999, "59m59s"],
  [3_600_000, "1h00m"],
  [3_900_000, "1h05m"],
  [86_399_999, "23h59m"],
  [86_400_000, "1d00h"],
  [183_600_000, "2d03h"],
  [86_400_000_000, "999d+"],
] as const)("duration formatting %dms → %s", (elapsed, expected) => {
  expect(formatDuration({ start: 10_000 }, 10_000 + elapsed)).toBe(expected)
  expect(
    formatDuration({ start: 10_000, end: 10_000 + elapsed }, 99_999_999_999),
  ).toBe(expected)
})

test("unknown, inconsistent or future timing never renders a misleading duration", () => {
  expect(formatDuration(undefined, 20_000)).toBe("—")
  expect(formatDuration({ start: 21_000 }, 20_000)).toBe("—")
  expect(formatDuration({ start: 10_000, end: 21_000 }, 20_000)).toBe("—")
  expect(formatDuration({ start: 10_000, end: 9_000 }, 20_000)).toBe("—")
  expect(formatDuration({ start: NaN }, 20_000)).toBe("—")
  expect(formatDuration({ start: 10_000 }, Infinity)).toBe("—")
})

test.each([
  ["running", 10_000, undefined, undefined, { start: 10_000 }],
  ["running", 10_000, 9_000, "failed", { start: 10_000 }],
  ["waiting", 10_000, 9_000, "failed", { start: 10_000 }],
  ["waiting", 10_000, 15_000, "succeeded", { start: 10_000, end: 15_000 }],
  ["idle", 10_000, 15_000, "succeeded", { start: 10_000, end: 15_000 }],
  ["idle", 10_000, 15_000, "failed", { start: 10_000, end: 15_000 }],
  ["idle", 10_000, 10_000, "interrupted", { start: 10_000, end: 10_000 }],
  ["idle", 10_000, 9_000, "succeeded", undefined],
  ["idle", 10_000, 15_000, undefined, undefined],
  ["idle", 10_000, undefined, "failed", undefined],
  ["running", 10_000, 15_000, "succeeded", undefined],
  ["unknown", 10_000, 15_000, "succeeded", undefined],
  ["running", undefined, undefined, undefined, undefined],
  ["running", NaN, undefined, undefined, undefined],
  ["running", -1, undefined, undefined, undefined],
  ["waiting", 10_000, Infinity, undefined, undefined],
  ["waiting", 10_000, -1, undefined, undefined],
  ["waiting", 10_000, 15_000, undefined, undefined],
] as const)(
  "execution timing %s / busy %s / idle %s / outcome %s",
  (live, busy, idle, outcome, expected) => {
    const child = {
      ...record("child", "root", 1, outcome),
      time: {
        created: 1,
        updated: 999_999,
        ...(busy !== undefined ? { busy } : {}),
        ...(idle !== undefined ? { idle } : {}),
      },
    }
    expect(
      buildRows(
        "root",
        [child],
        new Map<string, LiveStatus>([["child", live]]),
      )[0]?.duration,
    ).toEqual(expected)
  },
)
