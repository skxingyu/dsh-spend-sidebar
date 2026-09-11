#!/usr/bin/env node
/**
 * Verifies the billing-catalog port end to end:
 *
 *   1. the catalog data file is present, non-empty, and covers the providers
 *      billing ships (regenerated via tools/build-catalog.mjs);
 *   2. autoRatesFor serves catalog rows first and expands aliases, so a raw
 *      logged id (`deepseek-v4-flash`) resolves to the same price as its
 *      billing key (`flash`);
 *   3. costOf converts native-currency rows into the display currency using
 *      the same `{USD, CNY}` quote shape the host serves — a CNY row shown in
 *      USD divides by the rate, a USD row shown in CNY multiplies;
 *   4. rows without a `currency` (the legacy knowledge rows) pass through
 *      untouched regardless of conversion.
 *
 * Run: node test-catalog.mjs
 */
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const knowledge = await import(`file://${path.join(HERE, "lib", "knowledge.js").replace(/\\/g, "/")}`);
const stats = await import(`file://${path.join(HERE, "lib", "stats.js").replace(/\\/g, "/")}`);

// --- 1. catalog data present and populated --------------------------------
const catalogPath = path.join(HERE, "lib", "model-catalog-data.json");
await access(catalogPath);
const catalog = (await import(`file://${catalogPath.replace(/\\/g, "/")}`, { with: { type: "json" } })).default;
assert.ok(catalog.usdToCny > 0, "catalog carries a USD→CNY rate");
const providerCount = Object.keys(catalog.providers).length;
const rowCount = Object.values(catalog.providers).reduce((n, rows) => n + rows.length, 0);
assert.ok(providerCount >= 20, `catalog covers >=20 providers (got ${providerCount})`);
assert.ok(rowCount >= 70, `catalog carries >=70 priced rows (got ${rowCount})`);
assert.ok(Object.keys(catalog.aliases).length >= 80, "catalog carries the alias table");

// Every catalog row declares a known currency.
for (const [provider, rows] of Object.entries(catalog.providers)) {
	for (const row of rows) {
		assert.ok(row.currency === "CNY" || row.currency === "USD", `${provider}/${row.model}: currency must be CNY|USD`);
		assert.ok(row.inputPerMillion >= 0 && row.outputPerMillion >= 0, `${provider}/${row.model}: prices non-negative`);
	}
}

// --- 2. autoRatesFor: catalog first, aliases expanded ----------------------
// The billing catalog prices DeepSeek in CNY; the legacy knowledge row assumed
// USD. The catalog row must win and carry the native currency.
const deepseekRates = knowledge.autoRatesFor("deepseek");
const flashRow = deepseekRates.find((row) => row.model === "flash");
assert.ok(flashRow, "catalog `flash` row served");
assert.equal(flashRow.currency, "CNY", "flash keeps its native CNY pricing");
// Billing's 2026-09-10 repricing: off-peak input 1 CNY, peak 2 CNY.
assert.equal(flashRow.schedule.offPeak.inputPerMillion, 1, "flash off-peak = billing's current 1 CNY");
assert.equal(flashRow.schedule.peak.inputPerMillion, 2, "flash peak = billing's current 2 CNY");

// Alias expansion: the logged id gets its own row with identical pricing.
const aliasRow = deepseekRates.find((row) => row.model === "deepseek-v4-flash");
assert.ok(aliasRow, "logged id deepseek-v4-flash resolves through aliases");
assert.equal(aliasRow.inputPerMillion, flashRow.inputPerMillion, "alias row prices identically to the catalog key");
assert.equal(aliasRow.currency, "CNY", "alias row keeps native currency");

// No duplicate rows for one id.
const ids = deepseekRates.map((row) => row.model);
assert.equal(new Set(ids).size, ids.length, "no duplicate model rows for one provider");

// --- 3. costOf converts native currency ------------------------------------
const usdToCny = 6.79;
const rates = { USD: 1, CNY: usdToCny };
const converter = stats.currencyConverter(rates, "USD");
// The host always passes a default row; mirror that here.
const fallback = { inputPerMillion: 0, outputPerMillion: 0, cacheReadPerMillion: 0, cacheWritePerMillion: 0 };
const sample = { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, model: "flash", provider: "deepseek", time: undefined };

// No schedule hit without a timestamp → base (peak) CNY price of 2.
const usdCost = stats.costOf(sample, deepseekRates, fallback, converter).cost;
// 2 CNY per million → USD at 6.79.
assert.ok(Math.abs(usdCost - 2 / usdToCny) < 1e-9, `CNY row shown in USD divides by the rate (${usdCost} ≈ ${2 / usdToCny})`);

// Display in CNY: the row is already CNY → factor 1.
const cnyConverter = stats.currencyConverter(rates, "CNY");
const cnyCost = stats.costOf(sample, deepseekRates, fallback, cnyConverter).cost;
assert.ok(Math.abs(cnyCost - 2) < 1e-9, `CNY row shown in CNY passes through (${cnyCost})`);

// A USD-priced row displayed in CNY multiplies by the rate.
const usdRow = { model: "usd-model", inputPerMillion: 2, outputPerMillion: 0, cacheReadPerMillion: 0, cacheWritePerMillion: 0, currency: "USD" };
const usdSample = { ...sample, model: "usd-model" };
const usdRowCost = stats.costOf(usdSample, [usdRow], fallback, cnyConverter).cost;
assert.ok(Math.abs(usdRowCost - 2 * usdToCny) < 1e-9, `USD row shown in CNY multiplies by the rate (${usdRowCost})`);

// --- 4. legacy rows (no currency) pass through untouched --------------------
const legacy = { model: "legacy", inputPerMillion: 5, outputPerMillion: 15, cacheReadPerMillion: 0.5, cacheWritePerMillion: 0 };
const legacySample = { ...sample, model: "legacy" };
const legacyCost = stats.costOf(legacySample, [legacy], fallback, cnyConverter).cost;
assert.equal(legacyCost, 5, "row without currency is taken at face value");

// No converter supplied → face value (back-compat for callers that skip rates).
const plainCost = stats.costOf(usdSample, [usdRow], fallback, undefined).cost;
assert.equal(plainCost, 2, "no converter → row used as-is");

console.log(`✓ catalog: ${providerCount} providers, ${rowCount} rows, rate ${catalog.usdToCny}`);
console.log("✓ catalog rows win over legacy knowledge (flash = CNY 1/2 off-peak/peak)");
console.log("✓ alias deepseek-v4-flash → flash prices identically");
console.log("✓ costOf converts CNY↔USD both ways via the host's quote object");
console.log("✓ legacy rows without currency stay face-value");
console.log("\nall checks passed");
