/**
 * 13.1b / NAPI-1b — packaged-mode native binary resolution.
 *
 * The pure helpers in `packaged-resolver.cjs` decide where the auto-generated
 * loader picks up the .node file in packaged Electron mode. Dev path stays
 * untouched (resolver returns null, env var is never set).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// CJS module imported from ESM test — Node's interop exposes named exports.
import {
	applyPackagedNativeEnv,
	buildPackagedNativePath,
	getNapiShortname,
	resolvePackagedNativePath,
} from "../packaged-resolver.cjs";

describe("getNapiShortname — maps platform/arch to napi-rs short triple", () => {
	it("returns the darwin short names", () => {
		expect(getNapiShortname("darwin", "arm64")).toBe("darwin-arm64");
		expect(getNapiShortname("darwin", "x64")).toBe("darwin-x64");
	});

	it("returns the win32 short names with msvc abi", () => {
		expect(getNapiShortname("win32", "arm64")).toBe("win32-arm64-msvc");
		expect(getNapiShortname("win32", "x64")).toBe("win32-x64-msvc");
	});

	it("returns the linux short names with gnu abi", () => {
		expect(getNapiShortname("linux", "arm64")).toBe("linux-arm64-gnu");
		expect(getNapiShortname("linux", "x64")).toBe("linux-x64-gnu");
	});

	it("returns null for unsupported platform/arch combinations", () => {
		expect(getNapiShortname("freebsd", "x64")).toBeNull();
		expect(getNapiShortname("darwin", "ia32")).toBeNull();
		expect(getNapiShortname("openharmony", "arm64")).toBeNull();
	});
});

describe("buildPackagedNativePath — constructs the resourcesPath/native/<file> path", () => {
	it("joins resourcesPath + napi shortname into the expected layout", () => {
		expect(buildPackagedNativePath("/Resources", "darwin", "arm64")).toBe(
			join("/Resources", "native", "brainstorm-native.darwin-arm64.node"),
		);
		expect(buildPackagedNativePath("/Resources", "linux", "x64")).toBe(
			join("/Resources", "native", "brainstorm-native.linux-x64-gnu.node"),
		);
	});

	it("returns null when platform/arch is unmapped (no path can be built)", () => {
		expect(buildPackagedNativePath("/Resources", "freebsd", "arm64")).toBeNull();
	});
});

describe("resolvePackagedNativePath — disk-checking entrypoint", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "bs-native-resolve-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns the absolute path when the expected .node exists on disk", () => {
		const nativeDir = join(tempDir, "native");
		mkdirSync(nativeDir, { recursive: true });
		const expected = join(nativeDir, "brainstorm-native.darwin-arm64.node");
		writeFileSync(expected, "fake binary");

		const resolved = resolvePackagedNativePath({
			resourcesPath: tempDir,
			platform: "darwin",
			arch: "arm64",
		});
		expect(resolved).toBe(expected);
	});

	it("returns null when resourcesPath is unset (dev mode)", () => {
		expect(
			resolvePackagedNativePath({
				resourcesPath: undefined,
				platform: "darwin",
				arch: "arm64",
			}),
		).toBeNull();
	});

	it("returns null when resourcesPath is non-string (dev mode)", () => {
		expect(
			resolvePackagedNativePath({
				resourcesPath: 42,
				platform: "darwin",
				arch: "arm64",
			}),
		).toBeNull();
	});

	it("returns null when resourcesPath is set but the expected file is missing (graceful fallback to dev loader)", () => {
		const resolved = resolvePackagedNativePath({
			resourcesPath: tempDir,
			platform: "darwin",
			arch: "arm64",
		});
		expect(resolved).toBeNull();
	});

	it("returns null when the platform/arch is unsupported", () => {
		expect(
			resolvePackagedNativePath({
				resourcesPath: tempDir,
				platform: "freebsd",
				arch: "x64",
			}),
		).toBeNull();
	});
});

describe("applyPackagedNativeEnv — sets NAPI_RS_NATIVE_LIBRARY_PATH idempotently", () => {
	let tempDir: string;
	let savedEnv: string | undefined;
	let savedResourcesPath: unknown;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "bs-native-env-"));
		savedEnv = process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
		savedResourcesPath = (process as unknown as Record<string, unknown>).resourcesPath;
		// biome-ignore lint/performance/noDelete: `delete` is the only way to truly unset an env var (assigning undefined coerces to the string "undefined")
		delete process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
		if (savedEnv === undefined) {
			// biome-ignore lint/performance/noDelete: same reason as above
			delete process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
		} else {
			process.env.NAPI_RS_NATIVE_LIBRARY_PATH = savedEnv;
		}
		if (savedResourcesPath === undefined) {
			// biome-ignore lint/performance/noDelete: tests stub process.resourcesPath as a fake property; restoring needs delete
			delete (process as unknown as Record<string, unknown>).resourcesPath;
		} else {
			(process as unknown as Record<string, unknown>).resourcesPath = savedResourcesPath;
		}
	});

	it("sets the env var when a packaged binary exists for the current host", () => {
		const nativeDir = join(tempDir, "native");
		mkdirSync(nativeDir, { recursive: true });
		const shortname = getNapiShortname(process.platform, process.arch);
		if (!shortname) {
			// Unsupported host — applyPackagedNativeEnv can't find a binary; assert
			// it stays a no-op rather than skipping the test entirely.
			(process as unknown as Record<string, unknown>).resourcesPath = tempDir;
			const result = applyPackagedNativeEnv();
			expect(result).toBeNull();
			expect(process.env.NAPI_RS_NATIVE_LIBRARY_PATH).toBeUndefined();
			return;
		}
		const expected = join(nativeDir, `brainstorm-native.${shortname}.node`);
		writeFileSync(expected, "fake binary");
		(process as unknown as Record<string, unknown>).resourcesPath = tempDir;

		const result = applyPackagedNativeEnv();
		expect(result).toBe(expected);
		expect(process.env.NAPI_RS_NATIVE_LIBRARY_PATH).toBe(expected);
	});

	it("is a no-op when no packaged binary exists (dev mode)", () => {
		// process.resourcesPath remains unset.
		const result = applyPackagedNativeEnv();
		expect(result).toBeNull();
		expect(process.env.NAPI_RS_NATIVE_LIBRARY_PATH).toBeUndefined();
	});

	it("does not clobber an already-set env var (user override)", () => {
		const userPath = "/user/override/brainstorm-native.darwin-arm64.node";
		process.env.NAPI_RS_NATIVE_LIBRARY_PATH = userPath;
		const nativeDir = join(tempDir, "native");
		mkdirSync(nativeDir, { recursive: true });
		const shortname = getNapiShortname(process.platform, process.arch) ?? "darwin-arm64";
		writeFileSync(join(nativeDir, `brainstorm-native.${shortname}.node`), "fake binary");
		(process as unknown as Record<string, unknown>).resourcesPath = tempDir;

		const result = applyPackagedNativeEnv();
		expect(result).toBe(userPath);
		expect(process.env.NAPI_RS_NATIVE_LIBRARY_PATH).toBe(userPath);
	});
});
