#!/usr/bin/env node
/**
 * Install dsh-spend-sidebar into a DSH profile as a STANDALONE plugin.
 *
 * This fork is self-contained: it does not depend on, extend, or require the
 * upstream `dsh-spend` package. It ships its own host half, its own client
 * bundle id, and its own cordis row id (`usage-stats-sidebar`), so it can be
 * installed alongside upstream or on its own.
 *
 * What it does, in order:
 *   1. copy the plugin payload into <profile>/node_modules/dsh-spend-sidebar
 *   2. append it to `dsh.profile.bundles`, which is what actually loads it
 *      (`desktopBundleList` only filters the existing list — it never derives
 *      it from `dependencies`, so this step is required)
 *
 * No `dependencies` entry is written. DSH resolves each bundle with plain Node
 * module resolution from the profile directory and then reads
 * `dsh.bundle.patch` from the found manifest (`package-overlay-*.js`,
 * `readCandidate`), so a plain directory is enough. Declaring a `file:` spec
 * instead would make the path a persistent contract: moving this checkout
 * would break the next `pnpm install`, which the copy step has already made
 * unnecessary.
 *
 * Verified in the loader: the found manifest's `name` must equal the bundle
 * name exactly, so the directory name and package.json name must both stay
 * `dsh-spend-sidebar`.
 *
 * Step 2 edits a profile file, so the script backs up package.json first and
 * is idempotent: re-running never duplicates an entry.
 *
 * Usage: node install.mjs [--profile <name>] [--dry-run] [--uninstall]
 */
import { cp, readFile, writeFile, access, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = "dsh-spend-sidebar";
/** The fork replaced this package; both must never be bundled at once. */
const UPSTREAM_PKG = "dsh-spend";
const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes("--dry-run");
const UNINSTALL = ARGS.includes("--uninstall");

function argValue(flag) {
	const at = ARGS.indexOf(flag);
	return at === -1 ? undefined : ARGS[at + 1];
}

const profile = argValue("--profile") ?? "desktop";
const profileDir = path.join(os.homedir(), ".dsh", "profiles", profile);
const target = path.join(profileDir, "node_modules", PKG);
const profilePkgPath = path.join(profileDir, "package.json");

/** Top-level files that make up the plugin (lib/ is copied separately). */
const FILES = ["package.json", "cordis.patch.yml", "LICENSE", "README.md"];

async function exists(p) {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

async function packageFiles() {
	// The built plugin ships only `lib` + manifest bits; copy `lib` wholesale.
	return ["lib"].concat(FILES.filter((f) => f !== "README.md"));
}

async function readProfile() {
	try {
		return JSON.parse(await readFile(profilePkgPath, "utf8"));
	} catch {
		return null;
	}
}

console.log(`profile : ${profileDir}`);
console.log(`target  : ${target}`);
console.log(`mode    : ${DRY_RUN ? "dry-run (no writes)" : UNINSTALL ? "uninstall" : "install"}`);

const manifest = await readProfile();
if (manifest === null) {
	console.error(`✗ no readable profile package.json at ${profilePkgPath}`);
	process.exit(1);
}

// --- uninstall ------------------------------------------------------------
if (UNINSTALL) {
	const bundles = (manifest.dsh?.profile?.bundles ?? []).filter((b) => b !== PKG);
	if (DRY_RUN) {
		console.log("\nwould remove: the bundle entry, and the node_modules directory");
		process.exit(0);
	}
	await writeFile(profilePkgPath, `${JSON.stringify({ ...manifest, dsh: { ...manifest.dsh, profile: { ...manifest.dsh.profile, bundles } } }, null, 2)}\n`, "utf8");
	console.log(`\n✓ unregistered ${PKG}`);
	console.log(`  ${target} was left in place — delete it manually if you want it gone`);
	process.exit(0);
}

// --- install --------------------------------------------------------------
const files = await packageFiles();
if (DRY_RUN) {
	const current = manifest.dsh?.profile?.bundles ?? [];
	console.log("\nwould copy:");
	for (const rel of files) console.log(`  ${rel}`);
	console.log(`  (recursively, for lib/)`);
	console.log(`would append to bundles    : ${PKG}`);
	if (current.includes(UPSTREAM_PKG)) {
		console.log(`would REMOVE from bundles  : ${UPSTREAM_PKG} (both register \`usageStats\`)`);
	}
	process.exit(0);
}

// 1. payload
await cp(HERE, target, {
	recursive: true,
	force: true,
	// Only ship what the plugin needs: copying the whole repo would drag in
	// .git and the test file.
	filter: (src) => {
		const rel = path.relative(HERE, src);
		if (rel === "") return true;
		const top = rel.split(path.sep)[0];
		return ["lib", "package.json", "cordis.patch.yml", "LICENSE"].includes(top);
	}
});
if (!(await exists(path.join(target, "lib", "client.js")))) {
	console.error(`✗ copy failed: ${path.join(target, "lib", "client.js")} missing`);
	process.exit(1);
}

// 2. Bundle list.
//
// Two things matter here:
//
//   - The fork must be appended (and third-party order preserved).
//   - The upstream `dsh-spend` MUST be removed if present. Both host halves
//     register the Cordis service `usageStats`, and a service may only be
//     provided once, so leaving both bundled makes the whole plugin tree fail
//     to load: `service "usageStats" has been registered`. Giving the fork a
//     distinct row id does NOT avoid this -- distinct ids mean both rows are
//     active, where a shared id would have made one shadow the other.
//
// Raising the disable flag is not an option: Desktop only honours
// `disabledBundles` from plugin-management state when the market provider is
// `community`, and otherwise forces the set empty.
const currentBundles = manifest.dsh?.profile?.bundles ?? [];
const removed = currentBundles.filter((b) => b === UPSTREAM_PKG);
const kept = currentBundles.filter((b) => b !== UPSTREAM_PKG);
const bundles = kept.includes(PKG) ? kept : [...kept, PKG];

const backup = `${profilePkgPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
await cp(profilePkgPath, backup, { force: true });
await writeFile(profilePkgPath, `${JSON.stringify({
	...manifest,
	dsh: { ...manifest.dsh, profile: { ...manifest.dsh.profile, bundles } }
}, null, 2)}\n`, "utf8");

console.log(`\n✓ installed ${PKG}`);
console.log(`  bundles : ${bundles.length} entries${kept.includes(PKG) ? " (already present)" : " (+1)"}`);
if (removed.length > 0) {
	console.log(`  replaced: removed ${UPSTREAM_PKG} from the bundle list`);
	console.log(`            (${path.join(profileDir, "node_modules", UPSTREAM_PKG)} left on disk)`);
}
console.log(`  backup  : ${path.basename(backup)}`);
console.log("\n  restart DSH Desktop: the host half is composed at startup");
