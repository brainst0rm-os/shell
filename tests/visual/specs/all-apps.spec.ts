/**
 * Visual harness — captures every (spec × state × theme) PNG in one
 * Electron session.
 *
 * Run via `bun run screenshots`. Output lands in
 * `.screenshots/<run-id>/<spec>--<state>--<theme>.png`. A `manifest.json`
 * is emitted alongside the PNGs listing what was captured and any
 * per-capture errors — keeps the loop fast (one failing app doesn't kill
 * the whole pass).
 *
 * `BS_VISUAL_ONLY=<spec-id>` narrows the run to one spec id (matches both
 * shell ids like `dashboard` and app ids like `io.brainstorm.notes`).
 * `BS_VISUAL_THEMES=light` / `=dark` narrows the theme axis.
 */

import { existsSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "@playwright/test";
import { captureAppState, captureShellState } from "../lib/capture";
import { launchShell } from "../lib/launch-shell";
import { ensureVaultAndSeed } from "../lib/seed-vault";
import { ALL_SPECS, THEMES, type VisualTheme } from "../lib/state-registry";
import { setTheme } from "../lib/theme";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_ROOT = join(REPO_ROOT, ".screenshots", RUN_ID);
const LATEST_LINK = join(REPO_ROOT, ".screenshots", "latest");

function applyEnvFilters(): {
	specFilter: ReadonlySet<string> | null;
	themes: ReadonlyArray<VisualTheme>;
} {
	const only = process.env.BS_VISUAL_ONLY?.trim();
	const specFilter = only
		? new Set(
				only
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean),
			)
		: null;
	const themeEnv = process.env.BS_VISUAL_THEMES?.trim();
	const themes = themeEnv
		? (themeEnv.split(",").map((t) => t.trim()) as VisualTheme[]).filter((t): t is VisualTheme =>
				THEMES.includes(t as VisualTheme),
			)
		: THEMES;
	return { specFilter, themes: themes.length ? themes : THEMES };
}

function matchesFilter(
	spec: { kind: string; id?: string; appId?: string },
	filter: ReadonlySet<string> | null,
): boolean {
	if (!filter) return true;
	const key =
		spec.kind === "shell" ? (spec as { id: string }).id : (spec as { appId: string }).appId;
	return filter.has(key);
}

type CaptureRecord = {
	spec: string;
	state: string;
	theme: VisualTheme;
	file: string;
	ok: boolean;
	error?: string;
	durationMs: number;
};

test("capture all visual states", async () => {
	test.setTimeout(20 * 60 * 1000);
	const { specFilter, themes } = applyEnvFilters();
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-visual-"));
	const records: CaptureRecord[] = [];
	try {
		const { app } = await launchShell({ userDataDir });
		try {
			const dashboard = await app.firstWindow({ timeout: 60_000 });
			await dashboard.waitForLoadState("load", { timeout: 60_000 });
			await ensureVaultAndSeed(dashboard, userDataDir);

			for (const theme of themes) {
				await setTheme(dashboard, theme);
				for (const spec of ALL_SPECS) {
					if (!matchesFilter(spec, specFilter)) continue;
					for (const state of spec.states) {
						const specKey = spec.kind === "shell" ? spec.id : spec.appId;
						const fileName = `${specKey}--${state.name}--${theme}.png`;
						const outPath = join(OUT_ROOT, fileName);
						const t0 = Date.now();
						let ok = true;
						let error: string | undefined;
						try {
							if (spec.kind === "shell") {
								await captureShellState({ dashboard, spec, state, outPath });
							} else {
								await captureAppState({ app, dashboard, spec, state, outPath });
							}
						} catch (err) {
							ok = false;
							error = (err as Error).message;
						}
						records.push({
							spec: specKey,
							state: state.name,
							theme,
							file: fileName,
							ok,
							durationMs: Date.now() - t0,
							...(error ? { error } : {}),
						});
						const status = ok ? "ok" : "FAIL";
						console.log(
							`[visual] ${status} ${fileName} (${Date.now() - t0}ms)${error ? ` — ${error}` : ""}`,
						);
					}
				}
			}
		} finally {
			await app.close();
		}
	} finally {
		const manifest = {
			runId: RUN_ID,
			startedAt: new Date().toISOString(),
			outDir: OUT_ROOT,
			records,
		};
		try {
			writeFileSync(join(OUT_ROOT, "manifest.json"), JSON.stringify(manifest, null, 2));
		} catch {}
		updateLatestPointer();
		rmSync(userDataDir, { recursive: true, force: true });
		const failed = records.filter((r) => !r.ok);
		console.log(
			`[visual] run complete — ${records.length - failed.length}/${records.length} captures ok (out: ${OUT_ROOT})`,
		);
		if (failed.length > 0) {
			console.log(`[visual] ${failed.length} failures:`);
			for (const f of failed) console.log(`  - ${f.spec}/${f.state}/${f.theme}: ${f.error}`);
		}
	}
});

function updateLatestPointer(): void {
	// existsSync follows symlinks, so a dangling .screenshots/latest from a
	// prior failed run is reported as missing and we'd skip the unlink and
	// then fail symlinkSync because the link node still exists. Unlink
	// unconditionally and ignore ENOENT.
	try {
		unlinkSync(LATEST_LINK);
	} catch {}
	try {
		symlinkSync(OUT_ROOT, LATEST_LINK, "dir");
	} catch {
		try {
			writeFileSync(`${LATEST_LINK}.txt`, OUT_ROOT);
		} catch {}
	}
}
