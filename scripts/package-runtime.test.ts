import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { checkPackage } from "./check-package"

test("packed npm entry renders and navigates from node_modules using shared runtime", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sidebar-npm-runtime-"))
  const project = resolve(import.meta.dir, "..")
  try {
    const archive = join(dir, "plugin.tgz")
    await checkPackage(project, archive)
    const modules = join(dir, "node_modules")
    const root = join(modules, "opencode-plugin-subagents-sidebar")
    await mkdir(root, { recursive: true })
    const unpack = Bun.spawnSync([
      "tar",
      "-xzf",
      archive,
      "--strip-components=1",
      "-C",
      root,
    ])
    expect(unpack.exitCode).toBe(0)
    // Model host-owned modules; never copy or bundle a second renderer.
    for (const name of ["@opencode", "@opentui", "solid-js"])
      await symlink(join(project, "node_modules", name), join(modules, name))
    const manifest = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    )
    const entry = join(root, manifest.exports["./tui"])
    const script = join(dir, "smoke.tsx")
    await Bun.write(
      script,
      `
      import { testRender } from "@opentui/solid";
      import { contextFixture } from ${JSON.stringify(join(project, "test/context.ts"))};
      import { Sidebar } from ${JSON.stringify(entry)};
      const fixture = contextFixture();
      await using screen = await testRender(() => <Sidebar context={fixture.context} sessionID="root" />, { width: 28, height: 12 });
      await screen.waitForFrame(frame => frame.includes("▶ Subagents · 1"));
      await screen.mockMouse.click(2, 1);
      await screen.waitForFrame(frame => frame.includes("child") && frame.includes("Idle"));
      const lines = screen.captureCharFrame().split("\\n");
      const y = lines.findIndex(line => line.includes("child"));
      await screen.mockMouse.click(2, y);
      if (fixture.routes[0]?.sessionID !== "child") throw new Error("Wrong navigation target");
      screen.dispose();
      if (fixture.listeners.size !== 0) throw new Error("Leaked subscriptions");
      console.log("PACKED_RUNTIME_OK");
    `,
    )
    const child = Bun.spawn(
      [process.execPath, "--preload", join(project, "test/preload.ts"), script],
      { cwd: dir, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
    expect(stdout).toContain("PACKED_RUNTIME_OK")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 30000)
