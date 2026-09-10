#!/usr/bin/env node
/**
 * Install this modified dsh-spend into the live DSH desktop profile.
 *
 * dsh-spend normally renders a floating pill on `document.body`; this copy
 * registers the standard `sidebar.footer.action` slot instead, so the card
 * sits above the settings row in the left sidebar (the position
 * @kenz1117/dsh-ui-usage-billing uses).
 *
 * `dsh.profile.patchReload: "live"` in the profile package.json means the host
 * picks the change up without a restart; a page refresh reloads the client
 * bundle. Re-run after `dsh plugin update` / npm reinstalls, which overwrite
 * the target directory.
 *
 * Usage: node install.mjs [--profile <name>] [--dry-run]
 */
import { cp, readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes("--dry-run");

function argValue(flag) {
	const at = ARGS.indexOf(flag);
	return at === -1 ? undefined : ARGS[at + 1];
}

const profile = argValue("--profile") ?? "desktop";
const profilesRoot = path.join(os.homedir(), ".dsh", "profiles");
const profileDir = path.join(profilesRoot, profile);
const target = path.join(profileDir, "node_modules", "dsh-spend");

/** Files that make up the plugin; the rest of the source tree is not shipped. */
const FILES = ["package.json", "cordis.patch.yml", "LICENSE"];

async function exists(p) {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

if (!(await exists(target))) {
	console.error(`✗ plugin not found at ${target}`);
	console.error("  Install it first with: dsh plugin add dsh-spend");
	process.exit(1);
}

// The bundle list is what actually loads the plugin. Report it rather than
// silently patching it: a missing entry is a user decision, not a file copy.
const profilePkgPath = path.join(profileDir, "package.json");
let bundles = [];
try {
	const pkg = JSON.parse(await readFile(profilePkgPath, "utf8"));
	bundles = pkg?.dsh?.profile?.bundles ?? [];
} catch {
	// A missing/unreadable profile package.json is reported below, not fatal here.
}

console.log(`profile : ${profileDir}`);
console.log(`target  : ${target}`);
console.log(`mode    : ${DRY_RUN ? "dry-run (no writes)" : "install"}`);

if (!bundles.includes("dsh-spend")) {
	console.warn('⚠ "dsh-spend" is not in dsh.profile.bundles — the plugin will not load.');
}

if (DRY_RUN) {
	console.log("\nwould copy:");
	for (const rel of FILES) console.log(`  ${rel}`);
	console.log("  lib/**");
	process.exit(0);
}

// Copy the plugin payload. cp with recursive:true merges directories, which is
// what we want: lib/providers/ is part of the tree and must land too.
await cp(path.join(HERE, "lib"), path.join(target, "lib"), { recursive: true, force: true });
for (const rel of FILES) {
	const from = path.join(HERE, rel);
	if (await exists(from)) await cp(from, path.join(target, rel), { force: true });
}

console.log("\n✓ installed");
console.log("  refresh the DSH Web GUI to pick up the client bundle");
