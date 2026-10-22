// src/runtime-manifest.ts
/**
 * Approve the install script of esbuild (the one trusted runtime
 * dependency with a postinstall script) by writing allowScripts into the
 * runtime's manifest BEFORE dependencies are installed: the package
 * manager runs no package script without it, and an esbuild without its
 * script has no binary to run.
 *
 * MIRROR NOTICE: formwork/cli/commands/install.ts in the runtime does the
 * same for the repository-mode installation; the thin CLI cannot import a
 * runtime it is installing. Change both or neither.
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

export function approveRuntimeScripts(runtimeDir: string): void {
  const manifestPath = join(runtimeDir, "package.json");
  const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf-8"));
  if (typeof raw !== "object" || raw === null) return;
  const manifest = raw as Record<string, unknown>;
  manifest["allowScripts"] = { esbuild: true };
  writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );
}
