import { spyOn } from "bun:test"

// Control only the one-second display clock; leave renderer scheduling real.
export function displayClock(initial: number) {
  let now = initial
  const callbacks = new Map<unknown, () => void>()
  const interval = globalThis.setInterval
  // The project includes DOM, Node and Bun timer overloads; this boundary uses
  // the actual Bun handles returned by the captured runtime function.
  const clear = globalThis.clearInterval as (handle: unknown) => void
  const dateSpy = spyOn(Date, "now").mockImplementation(() => now)
  const intervalSpy = spyOn(globalThis, "setInterval").mockImplementation(((
    handler: TimerHandler,
    delay?: number,
    ...args: unknown[]
  ) => {
    if (delay !== 1_000 || typeof handler !== "function") {
      return interval(handler, delay, ...args)
    }
    const handle = interval(() => {}, 86_400_000)
    handle.unref()
    callbacks.set(handle, () => handler(...args))
    return handle
  }) as typeof globalThis.setInterval)
  const clearSpy = spyOn(globalThis, "clearInterval").mockImplementation(
    (handle) => {
      callbacks.delete(handle)
      clear(handle)
    },
  )
  return {
    get active() {
      return callbacks.size
    },
    advance(ms: number) {
      now += ms
      for (const callback of [...callbacks.values()]) callback()
    },
    [Symbol.dispose]() {
      for (const handle of callbacks.keys()) clear(handle)
      callbacks.clear()
      dateSpy.mockRestore()
      intervalSpy.mockRestore()
      clearSpy.mockRestore()
    },
  }
}
