import { describe, expect, it } from "vitest";
import { FileHandleMode, FileHandleRegistry } from "./file-handle-registry";

/** Deterministic registry: monotonic clock + sequential token source. */
function reg() {
	let t = 0;
	let n = 0;
	return new FileHandleRegistry(
		() => ++t,
		() => `tok${++n}`,
	);
}

describe("mint", () => {
	it("is idempotent per (app, path, mode) — persist + reuse", () => {
		const r = reg();
		const a = r.mint("app.a", "/v/x.txt", FileHandleMode.Read);
		const b = r.mint("app.a", "/v/x.txt", FileHandleMode.Read);
		expect(a).toBe(b);
		expect(r.size).toBe(1);
	});

	it("distinguishes by app, path, and mode", () => {
		const r = reg();
		const t1 = r.mint("app.a", "/v/x", FileHandleMode.Read);
		const t2 = r.mint("app.b", "/v/x", FileHandleMode.Read);
		const t3 = r.mint("app.a", "/v/y", FileHandleMode.Read);
		const t4 = r.mint("app.a", "/v/x", FileHandleMode.ReadWrite);
		expect(new Set([t1, t2, t3, t4]).size).toBe(4);
		expect(r.size).toBe(4);
	});

	it("never reuses a token even if the source collides", () => {
		let calls = 0;
		// First two calls return the same string; registry must retry.
		const r = new FileHandleRegistry(
			() => 1,
			() => (++calls <= 2 ? "dupe" : `u${calls}`),
		);
		const a = r.mint("app.a", "/a", FileHandleMode.Read);
		const b = r.mint("app.b", "/b", FileHandleMode.Read);
		expect(a).toBe("dupe");
		expect(b).not.toBe("dupe");
		expect(r.resolve("app.b", "dupe")).toBeNull();
	});

	it("the token is opaque — it does not embed the path", () => {
		const r = reg();
		const tok = r.mint("app.a", "/secret/vault/path.txt", FileHandleMode.Read);
		expect(tok).not.toContain("secret");
		expect(tok).not.toContain("path");
	});
});

describe("resolve — fail-closed", () => {
	it("returns path/mode only for the owning app", () => {
		const r = reg();
		const tok = r.mint("app.a", "/v/x.txt", FileHandleMode.ReadWrite);
		expect(r.resolve("app.a", tok)).toEqual({
			path: "/v/x.txt",
			mode: FileHandleMode.ReadWrite,
		});
		// Cross-app token theft → null (not the path).
		expect(r.resolve("app.b", tok)).toBeNull();
	});

	it("returns null for an unknown or revoked token", () => {
		const r = reg();
		const tok = r.mint("app.a", "/v/x", FileHandleMode.Read);
		expect(r.resolve("app.a", "nope")).toBeNull();
		r.revoke(tok);
		expect(r.resolve("app.a", tok)).toBeNull();
	});
});

describe("canWrite", () => {
	it("is true only for a read-write handle owned by the app", () => {
		const r = reg();
		const ro = r.mint("app.a", "/v/r", FileHandleMode.Read);
		const rw = r.mint("app.a", "/v/w", FileHandleMode.ReadWrite);
		expect(r.canWrite("app.a", ro)).toBe(false);
		expect(r.canWrite("app.a", rw)).toBe(true);
		expect(r.canWrite("app.b", rw)).toBe(false);
		expect(r.canWrite("app.a", "ghost")).toBe(false);
	});
});

describe("revoke", () => {
	it("revoke returns false for an unknown token, frees the grant for re-mint", () => {
		const r = reg();
		expect(r.revoke("ghost")).toBe(false);
		const a = r.mint("app.a", "/v/x", FileHandleMode.Read);
		expect(r.revoke(a)).toBe(true);
		// A fresh mint after revoke yields a NEW token (old one stays dead).
		const b = r.mint("app.a", "/v/x", FileHandleMode.Read);
		expect(b).not.toBe(a);
		expect(r.resolve("app.a", a)).toBeNull();
		expect(r.resolve("app.a", b)).not.toBeNull();
	});

	it("revokeAllForApp is app-scoped and returns the count", () => {
		const r = reg();
		r.mint("app.a", "/1", FileHandleMode.Read);
		r.mint("app.a", "/2", FileHandleMode.ReadWrite);
		const keep = r.mint("app.b", "/3", FileHandleMode.Read);
		expect(r.revokeAllForApp("app.a")).toBe(2);
		expect(r.size).toBe(1);
		expect(r.resolve("app.b", keep)).not.toBeNull();
		expect(r.revokeAllForApp("app.a")).toBe(0);
	});
});

describe("list (privileged Settings view)", () => {
	it("filters by app, includes the path, ordered oldest-first then path", () => {
		const r = reg();
		r.mint("app.a", "/z", FileHandleMode.Read); // createdAt 1
		r.mint("app.b", "/m", FileHandleMode.Read); // createdAt 2
		r.mint("app.a", "/a", FileHandleMode.ReadWrite); // createdAt 3
		expect(r.list().map((h) => h.path)).toEqual(["/z", "/m", "/a"]);
		const onlyA = r.list("app.a");
		expect(onlyA.map((h) => h.path)).toEqual(["/z", "/a"]);
		expect(onlyA[0]).toMatchObject({ appId: "app.a", path: "/z", mode: FileHandleMode.Read });
	});
});

describe("resolveAny — shell-internal cross-app lookup (handleFromIntent)", () => {
	it("returns the owning app + path/mode without requiring the caller to know the owner", () => {
		const r = reg();
		const tok = r.mint("app.a", "/v/x", FileHandleMode.ReadWrite);
		expect(r.resolveAny(tok)).toMatchObject({
			appId: "app.a",
			path: "/v/x",
			mode: FileHandleMode.ReadWrite,
		});
	});
	it("returns null for unknown / revoked tokens", () => {
		const r = reg();
		const tok = r.mint("app.a", "/v/x", FileHandleMode.Read);
		expect(r.resolveAny("ghost")).toBeNull();
		r.revoke(tok);
		expect(r.resolveAny(tok)).toBeNull();
	});
});

describe("onChange (Settings panel signal)", () => {
	it("fires on mint, revoke, and revokeAllForApp; unsubscribe stops it", () => {
		const r = reg();
		let calls = 0;
		const off = r.onChange(() => {
			calls += 1;
		});
		r.mint("app.a", "/v/x", FileHandleMode.Read);
		expect(calls).toBe(1);
		// Re-minting the same grant is idempotent but still fires? No — the
		// existing token short-circuits before notify(). Make sure that
		// doesn't fire a spurious change.
		r.mint("app.a", "/v/x", FileHandleMode.Read);
		expect(calls).toBe(1);
		r.mint("app.a", "/v/y", FileHandleMode.Read);
		expect(calls).toBe(2);
		const first = r.list()[0];
		if (!first) throw new Error("expected at least one handle");
		r.revoke(first.token);
		expect(calls).toBe(3);
		r.revokeAllForApp("app.a");
		expect(calls).toBe(4);
		// revokeAllForApp with no matches is a silent no-op.
		r.revokeAllForApp("nobody");
		expect(calls).toBe(4);
		off();
		r.mint("app.a", "/v/z", FileHandleMode.Read);
		expect(calls).toBe(4);
	});
	it("a throwing listener does not stop sibling listeners", () => {
		const r = reg();
		let okCalls = 0;
		r.onChange(() => {
			throw new Error("boom");
		});
		r.onChange(() => {
			okCalls += 1;
		});
		// The mint must succeed; the warn is best-effort.
		r.mint("app.a", "/v/x", FileHandleMode.Read);
		expect(okCalls).toBe(1);
	});
});
