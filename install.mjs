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
 *   1. get the plugin payload into <profile>/node_modules/dsh-spend-sidebar
 *   2. append it to `dsh.profile.bundles`, which is what actually loads it
 *      (`desktopBundleList` only filters the existing list — it never derives
 *      it from `dependencies`, so this step is required)
 *
 * HOW the payload gets there depends on whether the profile is pnpm-managed
 * (a `node_modules/.modules.yaml` exists — the `web` profile is; `desktop` is
 * not):
 *
 *   - pnpm-managed: declare `"dsh-spend-sidebar": "file:<checkout>"` in
 *     `dependencies` and let `pnpm install` link it.
 *   - otherwise: copy the payload in as a plain directory.
 *
 * Why the split. pnpm OWNS `node_modules`: when it decides the directory needs
 * rebuilding it deletes the whole thing and recreates it from the lockfile, so
 * anything it does not track — including a hand-copied plugin directory — is
 * silently destroyed. That is not hypothetical; it is exactly how the `web`
 * profile broke: `pnpm install` recreated `node_modules`, `dsh-spend-sidebar`
 * vanished while its `dsh.profile.bundles` entry stayed, and every launch then
 * died with `cannot resolve profile bundle "dsh-spend-sidebar"` until the
 * launcher's 180s readiness poll timed out.
 *
 * A `file:` spec is tracked by the lockfile, so pnpm restores it on every
 * install — verified by deleting `node_modules` outright and re-installing.
 * The cost is that the checkout path becomes a persistent contract: moving
 * this directory breaks the next `pnpm install`. That is the deliberate
 * trade — a path that must stay put beats a plugin that disappears — and it
 * only applies to pnpm-managed profiles, where the plain copy was not durable
 * anyway.
 *
 * DSH itself needs no `dependencies` entry: it resolves each bundle with plain
 * Node module resolution from the profile directory and then reads
 * `dsh.bundle.patch` from the found manifest (`package-overlay-*.js`,
 * `readCandidate`). The entry exists purely to keep pnpm from deleting it.
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
import { cp, readFile, writeFile, access, readdir, rm } from "node:fs/promises";
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

// Whether pnpm owns this profile's node_modules (see the header). Decided here
// because install, dry-run, and uninstall all branch on it.
const pnpmManaged = await exists(path.join(profileDir, "node_modules", ".modules.yaml"));

// --- uninstall ------------------------------------------------------------
if (UNINSTALL) {
	const bundles = (manifest.dsh?.profile?.bundles ?? []).filter((b) => b !== PKG);
	// Drop the `file:` entry too, so pnpm stops tracking (and re-linking) a
	// plugin the profile no longer loads.
	const dependencies = { ...(manifest.dependencies ?? {}) };
	delete dependencies[PKG];
	// Put the upstream back so uninstalling does not leave the profile without
	// any usage plugin. Only if its files are actually there -- a bundle entry
	// pointing at a missing package fails the whole plugin tree at startup.
	const upstreamDir = path.join(profileDir, "node_modules", UPSTREAM_PKG);
	const canRestore = await exists(upstreamDir);
	const restored = canRestore && !bundles.includes(UPSTREAM_PKG);
	if (restored) bundles.push(UPSTREAM_PKG);
	if (DRY_RUN) {
		console.log("\nwould remove : the bundle entry for " + PKG);
		if (Object.hasOwn(manifest.dependencies ?? {}, PKG)) console.log(`would remove : the dependencies entry (${manifest.dependencies[PKG]})`);
		console.log(restored
			? `would restore: ${UPSTREAM_PKG} to the bundle list`
			: `would NOT restore ${UPSTREAM_PKG} (not on disk — install it with \`dsh plugin add ${UPSTREAM_PKG}\`)`);
		process.exit(0);
	}
	await writeFile(profilePkgPath, `${JSON.stringify({ ...manifest, dependencies, dsh: { ...manifest.dsh, profile: { ...manifest.dsh.profile, bundles } } }, null, 2)}\n`, "utf8");
	console.log(`\n✓ unregistered ${PKG}`);
	if (restored) console.log(`  restored ${UPSTREAM_PKG} to the bundle list`);
	else console.log(`  ⚠ ${UPSTREAM_PKG} is not on disk — run \`dsh plugin add ${UPSTREAM_PKG}\` if you want it back`);
	console.log(pnpmManaged
		? `  run \`pnpm install\` to unlink it from node_modules`
		: `  ${target} was left in place — delete it manually if you want it gone`);
	process.exit(0);
}

// --- install --------------------------------------------------------------
if (DRY_RUN) {
	const current = manifest.dsh?.profile?.bundles ?? [];
	if (pnpmManaged) {
		console.log(`\nwould set dependencies      : ${PKG} = file:${HERE.replace(/\\/g, "/")}`);
		console.log(`would run                   : pnpm install --no-frozen-lockfile (in ${profileDir})`);
	} else {
		console.log("\nwould copy:");
		for (const rel of await packageFiles()) console.log(`  ${rel}`);
		console.log(`  (recursively, for lib/)`);
	}
	console.log(`would append to bundles    : ${PKG}`);
	if (current.includes(UPSTREAM_PKG)) {
		console.log(`would REMOVE from bundles  : ${UPSTREAM_PKG} (both register \`usageStats\`)`);
	}
	if (Object.hasOwn(manifest.dependencies ?? {}, UPSTREAM_PKG)) {
		console.log(`would REMOVE from deps     : ${UPSTREAM_PKG}`);
	}
	process.exit(0);
}

// 1. payload
//
// A pnpm-managed profile gets a `file:` dependency in step 2 and lets pnpm do
// the linking; only a non-pnpm profile is copied to directly, because there
// `node_modules` is ours to populate and nothing will prune it.
if (!pnpmManaged) {
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

// Drop the upstream from `dependencies` too. A pnpm-managed profile (the web
// one) declares it there, and leaving it behind means `pnpm install`
// reinstalls a package nothing loads. Safe to drop even though the bundle
// entry is what loads plugins: module resolution finds the fork by its own
// directory name.
const dependencies = { ...(manifest.dependencies ?? {}) };
const depRemoved = Object.hasOwn(dependencies, UPSTREAM_PKG);
delete dependencies[UPSTREAM_PKG];

// The `file:` entry that keeps pnpm from deleting the plugin. See the header
// for why this is required and what it costs. Paths in package.json are
// POSIX-style even on Windows, so normalize the separators.
const fileSpec = `file:${HERE.replace(/\\/g, "/")}`;
if (pnpmManaged) dependencies[PKG] = fileSpec;

const backup = `${profilePkgPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
await cp(profilePkgPath, backup, { force: true });
await writeFile(profilePkgPath, `${JSON.stringify({
	...manifest,
	dependencies,
	dsh: { ...manifest.dsh, profile: { ...manifest.dsh.profile, bundles } }
}, null, 2)}\n`, "utf8");

// Let pnpm materialize the `file:` link. --no-frozen-lockfile is required:
// adding the specifier makes the lockfile out of date by definition, and pnpm
// refuses to proceed otherwise (CI=true makes that refusal the default).
//
// Success is judged by the payload landing on disk, NOT by pnpm's exit code:
// pnpm exits non-zero for `ERR_PNPM_IGNORED_BUILDS` whenever any dependency
// has a build script that has not been approved, which is a pre-existing
// property of a profile (the web one carries four) and says nothing about
// whether this link was created.
//
// pnpm does NOT link on a Windows-hoisted layout: it snapshots the directory
// when the `file:` spec is first installed, then later runs report "Already up
// to date" and keep the STALE copy even under --force. Without the rm below, a
// re-run after editing the source looks successful while shipping the old code.
if (pnpmManaged) {
	const { spawnSync } = await import("node:child_process");
	await rm(target, { recursive: true, force: true });
	spawnSync("pnpm", ["install", "--no-frozen-lockfile"], {
		cwd: profileDir,
		stdio: "inherit",
		shell: true
	});
	if (!(await exists(path.join(target, "lib", "client.js")))) {
		console.error(`\n✗ pnpm did not link ${PKG} from ${HERE}`);
		console.error(`  the profile was still updated; fix the path or re-run with \`dsh plugin --profile ${profile} install\``);
		process.exit(1);
	}
}

console.log(`\n✓ installed ${PKG}`);
console.log(`  bundles : ${bundles.length} entries${kept.includes(PKG) ? " (already present)" : " (+1)"}`);
console.log(`  payload : ${pnpmManaged ? `pnpm file: dependency -> ${HERE}` : `copied to ${target}`}`);
if (removed.length > 0 || depRemoved) {
	const what = [removed.length > 0 ? "bundle list" : null, depRemoved ? "dependencies" : null].filter(Boolean).join(" + ");
	console.log(`  replaced: removed ${UPSTREAM_PKG} from ${what}`);
	// Report what is actually on disk rather than promising a rollback copy:
	// the directory may already be gone (the Desktop recovery flow can remove
	// a plugin outright, and `pnpm install` prunes unreferenced packages).
	const upstreamDir = path.join(profileDir, "node_modules", UPSTREAM_PKG);
	if (await exists(upstreamDir)) {
		console.log(`            ${upstreamDir} left on disk — restore by swapping the two names back`);
	} else {
		console.log(`            ${upstreamDir} is NOT on disk; re-install it with \`dsh plugin add ${UPSTREAM_PKG}\` to roll back`);
	}
}
console.log(`  backup  : ${path.basename(backup)}`);
console.log("\n  restart DSH Desktop: the host half is composed at startup");
