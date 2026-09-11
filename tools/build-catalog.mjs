#!/usr/bin/env node
/**
 * Build lib/model-catalog-data.json from the billing plugin's live catalog.
 *
 * Source of truth: kenz1117/dsh-ui-usage-billing src/client/pricing.ts
 * (MODEL_CATALOG + MODEL_KEY_ALIASES + USD_TO_CNY), imported directly with
 * Node's native type stripping so the values are exactly what billing ships —
 * no manual transcription of 76 entries.
 *
 * Usage:
 *   node tools/build-catalog.mjs <path/to/dsh-ui-usage-billing>   # write
 *   node tools/build-catalog.mjs <path> --check                   # preview
 *
 * Mapping into this fork's rate shape (see knowledge.js):
 *   billing price.input     -> inputPerMillion
 *   billing price.cacheHit  -> cacheReadPerMillion
 *   billing price.output    -> outputPerMillion
 *   billing price.offPeak   -> schedule.offPeak
 *   billing peakHours text  -> schedule.peakHours (parsed "09:00-12:00 / ...")
 * plus `currency` per row ("CNY" | "USD"): rows keep their NATIVE currency and
 * the estimator converts (the whole point of this port — the old table assumed
 * everything was USD, which silently under-counted the 57 CNY-priced models).
 *
 * Rows skipped on purpose: `retired` (kept out of billing's own rate panel
 * too); promos and extraRows are display-only details with no surface here —
 * the `estimated` flag is kept.
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const billingRoot = process.argv[2];
if (billingRoot === undefined) {
	console.error("usage: node tools/build-catalog.mjs <path/to/dsh-ui-usage-billing> [--check]");
	process.exit(1);
}

const pricingUrl = pathToFileURL(path.resolve(billingRoot, "src/client/pricing.ts")).href;
const mod = await import(pricingUrl);
const { USD_TO_CNY } = mod;
const MODEL_CATALOG = mod.MODEL_CATALOG;
const MODEL_KEY_ALIASES = mod.MODEL_KEY_ALIASES;

if (!Array.isArray(MODEL_CATALOG) || MODEL_CATALOG.length === 0) throw new Error("MODEL_CATALOG missing/empty");

// billing "09:00-12:00 / 14:00-18:00" -> [[9,12],[14,18]]
function parsePeakHours(text) {
	if (typeof text !== "string") return undefined;
	const hours = [];
	for (const part of text.split("/")) {
		const [from, to] = part.trim().split("-").map((edge) => Number(edge.split(":")[0]));
		if (Number.isFinite(from) && Number.isFinite(to)) hours.push([from, to]);
	}
	return hours.length > 0 ? hours : undefined;
}

function toRate(entry) {
	const price = entry.price;
	const row = {
		model: entry.key,
		inputPerMillion: price.input,
		outputPerMillion: price.output,
		cacheReadPerMillion: price.cacheHit,
		cacheWritePerMillion: 0,
		currency: price.currency ?? "CNY",
	};
	const peakHours = parsePeakHours(entry.peakHours);
	if (price.offPeak !== undefined && peakHours !== undefined) {
		row.schedule = {
			peakHours,
			peak: {
				inputPerMillion: price.input,
				outputPerMillion: price.output,
				cacheReadPerMillion: price.cacheHit,
				cacheWritePerMillion: 0,
			},
			offPeak: {
				inputPerMillion: price.offPeak.input,
				outputPerMillion: price.offPeak.output,
				cacheReadPerMillion: price.offPeak.cacheHit,
				cacheWritePerMillion: 0,
			},
		};
	}
	if (entry.estimated === true) row.estimated = true;
	return row;
}

// Provider display label -> this fork's canonical provider id
// (must match knowledge.js's PROVIDER_KNOWLEDGE keys / alias targets).
const PROVIDER_ID = {
	DeepSeek: "deepseek",
	OpenAI: "openai",
	Anthropic: "anthropic",
	Google: "google",
	xAI: "xai",
	"智谱 AI": "zhipu",
	月之暗面: "moonshot",
	MiniMax: "minimax",
	阿里通义: "qwen",
	腾讯混元: "hunyuan",
	字节豆包: "doubao",
	百度文心: "baidu",
	科大讯飞: "iflytek",
	商汤: "sensenova",
	阶跃星辰: "stepfun",
	零一万物: "yi",
	百川智能: "baichuan",
	面壁智能: "modelbest",
	小米: "xiaomi",
	小红书: "rednote",
	美团: "meituan",
	"Mistral AI": "mistral",
	Meta: "meta",
	Cohere: "cohere",
	Custom: "custom",
};

const byProvider = new Map();
const skipped = [];
for (const entry of MODEL_CATALOG) {
	if (entry.retired === true) {
		skipped.push(`${entry.provider}/${entry.key} (retired)`);
		continue;
	}
	const provider = PROVIDER_ID[entry.provider];
	if (provider === undefined) {
		skipped.push(`${entry.provider}/${entry.key} (unmapped provider label)`);
		continue;
	}
	if (!byProvider.has(provider)) byProvider.set(provider, []);
	byProvider.get(provider).push(toRate(entry));
}

const out = {
	generatedFrom: "kenz1117/dsh-ui-usage-billing src/client/pricing.ts (MODEL_CATALOG)",
	usdToCny: USD_TO_CNY,
	providers: Object.fromEntries([...byProvider.entries()].sort(([a], [b]) => a.localeCompare(b))),
	aliases: MODEL_KEY_ALIASES,
};

const rows = Object.values(out.providers).reduce((n, r) => n + r.length, 0);
console.log(`providers: ${Object.keys(out.providers).length}, rows: ${rows}, aliases: ${Object.keys(out.aliases).length}, skipped: ${skipped.length}`);
for (const line of skipped) console.log(`  skipped ${line}`);

if (process.argv.includes("--check")) {
	console.log(JSON.stringify(out.providers.deepseek, null, 2));
} else {
	writeFileSync(path.join(process.cwd(), "lib", "model-catalog-data.json"), `${JSON.stringify(out, null, 2)}\n`);
	console.log("written lib/model-catalog-data.json");
}
