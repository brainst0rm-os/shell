/**
 * Filter rule for copying an app bundle into a vault.
 *
 * An app's source directory at dev time (and even in some packaged-from-source
 * cases) contains tooling alongside the shippable bundle — `node_modules/`,
 * `src/`, `vite.config.ts`, lockfiles, etc. `node_modules/` in particular is
 * actively hostile to `fs.cp { recursive: true }` because Bun's hoisted
 * symlink tree includes self-referential paths (e.g. the typescript package's
 * own `node_modules/typescript` is a symlink back into the global store),
 * which `fs.cp` rejects with `ERR_FS_CP_EINVAL` — "cannot copy a directory
 * to a subdirectory of self".
 *
 * Only the runtime payload should land in `<vault>/apps/<id>/<version>/`:
 * the `manifest.json`, the bundle output the manifest's `entry` points at
 * (typically `dist/`), and any assets it references (icons, etc.). The
 * filter below denylists top-level names that are unambiguously dev-only.
 * Anything we haven't seen in the wild ships through, since a future app may
 * legitimately want an unfamiliar top-level directory.
 */

import { relative, sep } from "node:path";

const DEV_ONLY_TOP_LEVEL_NAMES: ReadonlySet<string> = new Set([
	"node_modules",
	"src",
	"tests",
	"test",
	".git",
	".gitignore",
	".gitattributes",
	".DS_Store",
	"package.json",
	"package-lock.json",
	"bun.lock",
	"bun.lockb",
	"yarn.lock",
	"pnpm-lock.yaml",
	"tsconfig.json",
	"tsconfig.app.json",
	"tsconfig.node.json",
	"vite.config.ts",
	"vite.config.js",
	"vite.config.mjs",
	"rollup.config.ts",
	"rollup.config.js",
	"esbuild.config.ts",
	"esbuild.config.js",
	"vitest.config.ts",
	"vitest.config.js",
	".size-limit.json",
	"biome.json",
	".prettierrc",
	".prettierrc.json",
	".eslintrc",
	".eslintrc.json",
	"eslint.config.js",
	"eslint.config.ts",
	"README.md",
	"CHANGELOG.md",
	"LICENSE",
]);

/**
 * Decide whether an entry inside an app's source bundle should be copied
 * into the installed bundle. The check fires on the top-level segment only;
 * once a top-level entry is allowed, its descendants are copied verbatim.
 *
 * Pass the absolute bundle root (the directory `cp` was invoked with) and
 * the absolute path of the current entry — the same arguments `fs.cp`'s
 * filter callback receives.
 */
export function shouldCopyBundleEntry(bundleDir: string, src: string): boolean {
	if (src === bundleDir) return true;
	const rel = relative(bundleDir, src);
	if (rel.length === 0 || rel.startsWith("..")) return true;
	// Sourcemaps are dev-only and never used from the installed copy
	// (devtools resolves them from source in dev; the file:// vault copy
	// can't serve them usefully anyway). They're also the bulk of a
	// sourcemap-enabled app's `dist` — Graph's was 1523 `.map` files /
	// ~half of a 3046-file tree — so copying + hashing them is what made
	// the seed's install step slow/fragile for the heaviest app. Drop
	// them at any depth.
	if (src.endsWith(".map")) return false;
	const top = rel.split(sep)[0] ?? "";
	return !DEV_ONLY_TOP_LEVEL_NAMES.has(top);
}

export { DEV_ONLY_TOP_LEVEL_NAMES };
