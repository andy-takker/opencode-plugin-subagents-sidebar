import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkPackage } from "./check-package"

test("validates packed files and rejects missing, extra, and escaping imports", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sidebar-package-test-"))
  const files = ["dist/tui.js", "README.md", "LICENSE"]
  const manifest = {
    name: "sidebar-test",
    version: "0.0.0",
    exports: { "./tui": "./dist/tui.js" },
    files,
  }
  try {
    for (const file of files)
      await Bun.write(
        join(dir, file),
        file.endsWith(".js") ? "export {}" : "test",
      )
    await Bun.write(join(dir, "package.json"), JSON.stringify(manifest))
    await expect(checkPackage(dir)).resolves.toBeUndefined()
    await rm(join(dir, "dist/tui.js"))
    await expect(checkPackage(dir)).rejects.toThrow("files")
    await Bun.write(join(dir, "dist/tui.js"), "export {}")
    await Bun.write(join(dir, "extra.txt"), "unintended")
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({ ...manifest, files: [...files, "extra.txt"] }),
    )
    await expect(checkPackage(dir)).rejects.toThrow("files")
    await Bun.write(join(dir, "package.json"), JSON.stringify(manifest))
    await Bun.write(join(dir, "dist/tui.js"), 'import "../../outside"')
    await expect(checkPackage(dir)).rejects.toThrow("import")
    await Bun.write(join(dir, "dist/tui.js"), 'import "./missing"')
    await expect(checkPackage(dir)).rejects.toThrow("import")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 30000)
