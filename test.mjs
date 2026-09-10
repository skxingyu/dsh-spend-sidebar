#!/usr/bin/env node
/**
 * Smoke test for the sidebar-slot conversion.
 *
 * Loads the real lib/client.js through a minimal `window.__ModuleLoader__`
 * stub, applies the plugin against a fake ctx, and asserts the behaviour that
 * this fork exists for: the widget registers into `sidebar.footer.action`
 * instead of mounting a floating root on `document.body`.
 *
 * Run: node test.mjs
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(path.join(HERE, "lib", "client.js"), "utf8");

// --- minimal module loader ------------------------------------------------
const registered = new Map();
globalThis.window = {
	__ModuleLoader__: {
		load({ id, factory }) {
			registered.set(id, factory(makeRequire()));
		}
	}
};

// React is only used for hooks/state shape here; the smoke test never renders
// to a DOM, so a hand-rolled stub is enough and avoids a jsdom dependency.
function makeRequire() {
	return (name) => {
		if (name === "react") {
			return {
				useState: (v) => [typeof v === "function" ? v() : v, () => {}],
				useRef: (v) => ({ current: v }),
				useEffect: () => {},
				useCallback: (fn) => fn,
				useMemo: (fn) => fn()
			};
		}
		// The widget opens its detail view through a react-dom portal, so the
		// module must resolve `react-dom` (and expose createPortal).
		if (name === "react-dom") return { createPortal: (node) => node };
		if (name === "react/jsx-runtime") return { jsx: (t, p) => ({ t, p }) };
		throw new Error(`unexpected require: ${name}`);
	};
}

// `document` is still touched by injectStyles(); record what gets appended so
// we can assert no widget container is created on the body.
const styleTags = [];
const bodyChildren = [];
globalThis.document = {
	head: { appendChild: (el) => styleTags.push(el) },
	body: { appendChild: (el) => bodyChildren.push(el) },
	querySelector: () => null,
	createElement: () => ({ dataset: {}, remove() {}, set textContent(v) { this._t = v; }, get textContent() { return this._t; } })
};

await import(`file://${path.join(HERE, "lib", "client.js").replace(/\\/g, "/")}`);

const mod = registered.get("dsh-spend");
assert.ok(mod, "bundle registered itself as dsh-spend");

// --- fake ctx -------------------------------------------------------------
const registrations = [];
const injectedSlots = [];
const ctx = {
	locale: {
		register: () => {},
		bind: () => (k) => k
	},
	effect(fn) {
		fn();
		return () => {};
	},
	connection: { rpc: { call: () => Promise.resolve({}) } },
	slots: {
		inject(name, fn) {
			injectedSlots.push(name);
			fn();
		},
		register(def, Component) {
			registrations.push({ def, Component });
		}
	}
};

mod.apply(ctx);

// --- assertions -----------------------------------------------------------
assert.deepEqual(
	injectedSlots,
	["sidebar.footer.action"],
	"widget must inject into the sidebar footer slot only"
);

assert.equal(registrations.length, 1, "exactly one slot entry");
const { def, Component } = registrations[0];
assert.equal(def.name, "sidebar.footer.action");
assert.equal(def.id, "usage-stats");
assert.equal(typeof def.order, "number", "order must be a number to sort in the list slot");
assert.equal(typeof Component, "function", "the entry must render a component");

// Billing owns order -10 in this slot; the list sorts ascending, so a greater
// order is what puts this card below it.
assert.ok(def.order > -10, `order ${def.order} must sort after billing's -10`);

// The inject factory is the component's prop source; both props it needs must
// be present, or the widget would crash on first render.
const props = def.inject();
assert.equal(typeof props.t, "function", "inject must supply the translator");
assert.equal(typeof props.query, "function", "inject must supply the query builder");

// The whole point of the change: no floating overlay on document.body.
assert.equal(bodyChildren.length, 0, "no floating widget container on document.body");

// --- card / modal behaviour -----------------------------------------------
const sourceLines = source.split("\n").filter((line) => !line.trimStart().startsWith("*"));

// Scope hover checks to the widget function: the dashboard's charts and
// heatmap legitimately bind pointer handlers for their tooltips.
const widgetStart = sourceLines.findIndex((l) => l.includes("function UsageStatsWidget"));
assert.ok(widgetStart > -1, "widget function must exist");
const widgetBody = sourceLines.slice(widgetStart).join("\n");

// Hover must do nothing: the card may not bind pointer handlers, and the
// hover-preview machinery must be gone entirely.
for (const pattern of [/onMouseEnter/, /onMouseLeave/, /setHovered/, /showPreview/]) {
	assert.ok(!pattern.test(widgetBody), `hover behaviour must be removed from the card (${pattern})`);
}

// Clicking opens the detail view in a portal-rendered modal, not an inline
// panel inside the sidebar column.
assert.ok(sourceLines.some((l) => l.includes("setModalOpen(true)")), "card click opens the modal");
assert.ok(sourceLines.some((l) => l.includes("react_dom.createPortal")), "the modal renders through a portal");
assert.ok(!sourceLines.some((l) => l.includes("className: \"dsu-panel\"")), "the inline sidebar panel is gone");

// Two rows: this month on top, today below.
assert.ok(sourceLines.some((l) => l.includes('t("card.thisMonth")')), "row 1 labels the month");
assert.ok(sourceLines.some((l) => l.includes('t("card.today")')), "row 2 labels the day");
assert.ok(sourceLines.some((l) => l.includes("formatCost(monthCost")), "row 1 shows month cost");
assert.ok(sourceLines.some((l) => l.includes("formatTokens(monthTokens)")), "row 1 shows month tokens");
assert.ok(sourceLines.some((l) => l.includes("formatCost(todayCost")), "row 2 shows today cost");
assert.ok(sourceLines.some((l) => l.includes("formatTokens(todayTokens)")), "row 2 shows today tokens");

// Month-to-date must come from the daily rows, not from `totals`, which
// accumulates every session ever scanned and would overstate the month.
assert.ok(sourceLines.some((l) => l.includes("monthRows.reduce")), "month totals sum the daily rows");

// Both dictionaries must define the new keys, or the card renders key names.
// Match the definition form only ("key": "..."), not the t("key") call sites.
for (const key of ["card.thisMonth", "card.today"]) {
	const definitions = sourceLines.filter((l) => new RegExp(`"${key.replace(".", "\\.")}":\\s*"`).test(l));
	assert.equal(definitions.length, 2, `${key} must be defined in both zh and en`);
}

console.log("✓ registers sidebar.footer.action (order %d, after billing)", def.order);
console.log("✓ supplies { t, query } to the component");
console.log("✓ does not mount a floating overlay on document.body");
console.log("✓ no hover handlers; click opens a portal modal");
console.log("✓ card renders two rows (this month / today)");
console.log("\nall checks passed");
