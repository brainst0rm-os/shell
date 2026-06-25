/**
 * 14.34 — first-party catalog publisher. Packs every built first-party app's
 * bundle into a signed `.brainstorm` archive and emits a catalog index with the
 * real sha256 + signature (replacing catalog-edge's dev placeholders), so the
 * shell's CatalogClient → InstallEngine path works end-to-end against a local
 * catalog-edge.
 *
 *   bun tools/publish-first-party-catalog.ts            # → out/catalog/
 *   CATALOG_OUT=… CATALOG_PUBLISHER_SEED=<hex64> bun tools/publish-first-party-catalog.ts
 *
 * Apps must be built first (`bun run build:apps`). The publisher seed is a CI
 * secret for real releases; a fixed dev seed otherwise. Per docs/apps/59
 * §The publish pipeline.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIRST_PARTY_APPS } from "../packages/shell/src/main/apps/first-party";
import {
	buildPublishedBundle,
	publisherKeyForSeed,
	readAppBundleFiles,
} from "../packages/shell/src/main/catalog/catalog-publish";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPS_DIR = join(HERE, "..", "apps");
const OUT_DIR = process.env.CATALOG_OUT ?? join(HERE, "..", "out", "catalog");
const ASSET_BASE = process.env.CATALOG_ASSET_BASE ?? "http://127.0.0.1:8788/assets";

function seedFromEnv(): Uint8Array {
	const hex = process.env.CATALOG_PUBLISHER_SEED;
	if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) {
		const out = new Uint8Array(32);
		for (let i = 0; i < 32; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		return out;
	}
	// Dev publisher seed (distinct from the catalog index-signing key).
	return new Uint8Array(32).fill(11);
}

type ManifestMeta = { id: string; name: string; version: string; summary?: string };

function readManifestMeta(files: ReadonlyMap<string, Uint8Array>): ManifestMeta {
	const raw = files.get("manifest.json");
	if (!raw) throw new Error("bundle has no manifest.json");
	const m = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
	if (typeof m.id !== "string" || typeof m.version !== "string") {
		throw new Error("manifest.json missing id/version");
	}
	const meta: ManifestMeta = {
		id: m.id,
		name: typeof m.name === "string" ? m.name : m.id,
		version: m.version,
	};
	if (typeof m.description === "string" && m.description.length > 0) meta.summary = m.description;
	return meta;
}

async function main(): Promise<void> {
	const seed = seedFromEnv();
	const publisherKey = publisherKeyForSeed(seed);
	await mkdir(OUT_DIR, { recursive: true });

	const listings: Record<string, unknown>[] = [];
	const errors: string[] = [];

	for (const app of FIRST_PARTY_APPS) {
		const bundleDir = join(APPS_DIR, app.dir);
		try {
			const files = await readAppBundleFiles(bundleDir);
			const meta = readManifestMeta(files);
			const published = buildPublishedBundle(files, seed);
			const fileName = `${meta.id}-${meta.version}.brainstorm`;
			await writeFile(join(OUT_DIR, fileName), published.bytes);
			// Also emit the manifest (+ icon) at <dir>/ so the catalog serves them
			// for the detail page + the update engine's capability-diff fetch.
			await mkdir(join(OUT_DIR, app.dir), { recursive: true });
			const manifestBytes = files.get("manifest.json");
			if (manifestBytes) await writeFile(join(OUT_DIR, app.dir, "manifest.json"), manifestBytes);
			const iconBytes = files.get("icon.svg");
			if (iconBytes) await writeFile(join(OUT_DIR, app.dir, "icon.svg"), iconBytes);
			listings.push({
				id: meta.id,
				kind: "app",
				publisherKey,
				name: meta.name,
				...(meta.summary ? { summary: meta.summary } : {}),
				iconUrl: `${ASSET_BASE}/${app.dir}/icon.svg`,
				channels: { stable: meta.version },
				versions: {
					[meta.version]: {
						manifestUrl: `${ASSET_BASE}/${app.dir}/manifest.json`,
						bundleUrl: `${ASSET_BASE}/${fileName}`,
						sha256: published.sha256,
						signature: published.signature,
						sdk: "1",
						minShell: "1.0.0",
					},
				},
				firstParty: true,
			});
			console.log(
				`packed ${fileName} (${published.bytes.length} bytes, sha ${published.sha256.slice(0, 8)})`,
			);
		} catch (e) {
			errors.push(`${app.dir}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	await writeFile(
		join(OUT_DIR, "catalog-index.json"),
		`${JSON.stringify({ catalogId: "brainstorm-official", listings }, null, 2)}\n`,
	);
	console.log(
		`\nPublished ${listings.length} apps → ${OUT_DIR}/ (publisher ${publisherKey.slice(0, 24)}…)`,
	);
	for (const e of errors) console.warn(`skipped: ${e}`);
}

await main();
