import { resolve } from "node:path";

/**
 * Shared per-app Vite build settings — the React app track every first-party
 * app uses (see docs/apps/notes/40-app-build.md). All 19 app configs were
 * byte-identical in shape; this is the single source of truth for everything
 * except the `react()` plugin (each app keeps that one line, since
 * `@vitejs/plugin-react` resolves from the app's own node_modules, not here).
 *
 * Source lives under `<appDir>/src`; the build reads `src/index.html` and emits
 * to `<appDir>/dist`. `base: "./"` keeps asset references relative so the shell
 * loads the renderer over `file://`, and the `<meta>` CSP `script-src 'self'`
 * is compatible with Vite's hashed `./assets/<name>-<hash>.js` output.
 *
 * MINIFY: an app's eager chunk is parsed + executed on every window open, so
 * unminified multi-MB renderers were the dominant app-open latency. We minify
 * (esbuild), which means a shell error-log frame now reads `index-<hash>.js:1:N`
 * rather than real file:line. `sourcemap: true` emits a `.map` next to each
 * bundle in the app's *source* `dist/` — but `main/apps/bundle-filter.ts` strips
 * every `.map` when copying into the installed/seeded vault copy (Graph alone
 * emitted 1523 of them), so the running app carries no map. To resolve a
 * captured frame, load the matching `.map` from the source `dist/` by hand; the
 * shell error-log does not resolve sourcemaps itself.
 */
export function appBuildConfig(appDir: string) {
	return {
		root: resolve(appDir, "src"),
		base: "./",
		build: {
			outDir: resolve(appDir, "dist"),
			emptyOutDir: true,
			minify: "esbuild",
			sourcemap: true,
			// Electron 41 ships Chromium 130 — skip ancient-browser polyfills.
			target: "chrome130",
			rollupOptions: {
				input: resolve(appDir, "src/index.html"),
			},
		},
	} as const;
}
