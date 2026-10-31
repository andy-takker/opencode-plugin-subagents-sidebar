import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkPackage } from "./check-package"

test("validates packed files and rejects missing, extra, and escaping imports", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sidebar-package-test-"))
  const files = [
    "src/model.ts",
    "src/controller.ts",
    "src/opencode-source.ts",
    "src/tui.tsx",
    "README.md",
    "LICENSE",
  ]
  const manifest = {
    name: "sidebar-test",
    version: "0.0.0",
    exports: { "./tui": "./src/tui.tsx" },
    files,
  }
  try {
    for (const file of files)
      await Bun.write(
        join(dir, file),
        file.endsWith(".ts") ? "export {}" : "test",
      )
    await Bun.write(
      join(dir, "src/tui.tsx"),
      'import "./controller"; export default {}',
    )
    await Bun.write(join(dir, "package.json"), JSON.stringify(manifest))
    await expect(checkPackage(dir)).resolves.toBeUndefined()
    await rm(join(dir, "src/controller.ts"))
    await expect(checkPackage(dir)).rejects.toThrow("files")
    await Bun.write(join(dir, "src/controller.ts"), "export {}")
    await Bun.write(join(dir, "extra.txt"), "unintended")
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({ ...manifest, files: [...files, "extra.txt"] }),
    )
    await expect(checkPackage(dir)).rejects.toThrow("files")
    await Bun.write(join(dir, "package.json"), JSON.stringify(manifest))
    await Bun.write(join(dir, "src/tui.tsx"), 'import "../../outside"')
    await expect(checkPackage(dir)).rejects.toThrow("import")
    await Bun.write(join(dir, "src/tui.tsx"), 'import "./missing"')
    await expect(checkPackage(dir)).rejects.toThrow("import")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 30000)
