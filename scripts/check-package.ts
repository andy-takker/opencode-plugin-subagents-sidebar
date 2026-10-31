import { constants } from "node:fs"
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"

const files = ["LICENSE", "README.md", "package.json", "dist/tui.js"].sort()

function run(cmd: string[], cwd: string): string {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0)
    throw new Error(`${cmd[0]} failed: ${result.stderr}`)
  return result.stdout.toString()
}

/** Validate the actual archive; optionally retain those exact bytes for publishing. */
export async function checkPackage(
  directory: string,
  output?: string,
): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), "sidebar-pack-"))
  try {
    const packed = JSON.parse(
      run(
        [
          "npm",
          "pack",
          resolve(directory),
          "--json",
          "--ignore-scripts",
          "--pack-destination",
          temp,
        ],
        temp,
      ),
    ) as { filename: string; files: { path: string }[] }[]
    const pack = packed[0]
    if (
      !pack ||
      JSON.stringify(pack.files.map((file) => file.path).sort()) !==
        JSON.stringify(files)
    ) {
      throw new Error("Unexpected package files (missing or extra)")
    }
    const archive = join(temp, pack.filename)
    run(["tar", "-xzf", archive, "-C", temp], temp)
    const root = join(temp, "package")
    const manifest = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    )
    if (manifest.exports?.["./tui"] !== "./dist/tui.js")
      throw new Error("Invalid ./tui export")
    for (const file of files.filter((file) => /\.js$/.test(file))) {
      const source = await readFile(join(root, file), "utf8")
      const imports = new Bun.Transpiler({
        loader: "js",
      }).scanImports(source)
      for (const item of imports) {
        if (!item.path.startsWith(".") && !item.path.startsWith("/")) continue
        const target = relative(root, resolve(root, dirname(file), item.path))
        if (![target, `${target}.js`].some((path) => files.includes(path))) {
          throw new Error(
            `Unresolved or escaping import in ${file}: ${item.path}`,
          )
        }
      }
    }
    if (output)
      await copyFile(archive, resolve(output), constants.COPYFILE_EXCL)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== "--output"))
    throw new Error("Usage: check-package.ts [--output archive.tgz]")
  await checkPackage(process.cwd(), args[1])
  console.log("Package verified: exact files, ./tui export, internal imports")
}
