import { describe, expect, it } from "vitest";
import {
	type OpenFacts,
	OpenRefusal,
	OpenRung,
	type OpenTarget,
	OpenTargetKind,
	OsHandoffConsent,
	decideOpen,
	isHardBlockedScheme,
	isOpenTargetKind,
	normalizeOpenInput,
} from "./open-resolution";

describe("isHardBlockedScheme", () => {
	it("blocks the fixed floor, case- and colon-insensitively", () => {
		for (const s of ["javascript", "JavaScript:", "DATA", "data:", "vbscript", "about:"]) {
			expect(isHardBlockedScheme(s)).toBe(true);
		}
	});
	it("does not block legitimate schemes", () => {
		for (const s of ["https", "http:", "mailto", "tel:", "geo", "app", "ftp"]) {
			expect(isHardBlockedScheme(s)).toBe(false);
		}
	});
});

describe("normalizeOpenInput", () => {
	it("entityId wins and is an Entity target", () => {
		expect(normalizeOpenInput({ entityId: "ent_1", url: "https://x" })).toEqual({
			kind: OpenTargetKind.Entity,
			entityId: "ent_1",
		});
	});

	it("brainstorm://entity/<id> is Internal carrying the entity id", () => {
		expect(normalizeOpenInput({ url: "brainstorm://entity/ent_9?x=1" })).toEqual({
			kind: OpenTargetKind.Internal,
			uri: "brainstorm://entity/ent_9?x=1",
			entityId: "ent_9",
		});
	});

	it("other brainstorm:// authorities are Internal with no entity id", () => {
		const t = normalizeOpenInput({ url: "brainstorm://cover/abc.png" });
		expect(t).toMatchObject({ kind: OpenTargetKind.Internal });
		expect(t && "entityId" in t && t.entityId).toBeFalsy();
	});

	it("a URL scheme becomes a lowercased Scheme target", () => {
		expect(normalizeOpenInput({ url: "MAILTO:a@b.com" })).toEqual({
			kind: OpenTargetKind.Scheme,
			scheme: "mailto",
			uri: "MAILTO:a@b.com",
		});
	});

	it("file: URL → File target flagged viaFileScheme, in/out of vault", () => {
		expect(
			normalizeOpenInput({ url: "file:///vault/a/notes.md" }, { vaultPath: "/vault/a" }),
		).toEqual({
			kind: OpenTargetKind.File,
			extension: "md",
			path: "/vault/a/notes.md",
			inVault: true,
			viaFileScheme: true,
		});
		expect(
			normalizeOpenInput({ url: "file:///etc/passwd" }, { vaultPath: "/vault/a" }),
		).toMatchObject({
			kind: OpenTargetKind.File,
			inVault: false,
			viaFileScheme: true,
			extension: null,
		});
	});

	it("a plain path is a File target not via the file scheme", () => {
		expect(normalizeOpenInput({ path: "/Users/x/Downloads/report.PDF" })).toEqual({
			kind: OpenTargetKind.File,
			extension: "pdf",
			path: "/Users/x/Downloads/report.PDF",
			inVault: false,
			viaFileScheme: false,
		});
	});

	it("empty input → null (a no-op, never a dead click)", () => {
		expect(normalizeOpenInput({})).toBeNull();
		expect(normalizeOpenInput({ entityId: "", url: "", path: "" })).toBeNull();
	});

	it("isOpenTargetKind narrows the wire strings", () => {
		expect(isOpenTargetKind("scheme")).toBe(true);
		expect(isOpenTargetKind("nope")).toBe(false);
		expect(isOpenTargetKind(7)).toBe(false);
	});
});

const baseFacts: OpenFacts = {
	entityResolvable: false,
	hasStoredDefault: false,
	hasInVaultOpener: false,
	consent: OsHandoffConsent.FirstUse,
	callerMayHandoff: false,
};

describe("decideOpen — the ladder", () => {
	it("internal with an entity id → rung 1 (delegated)", () => {
		const t: OpenTarget = {
			kind: OpenTargetKind.Internal,
			uri: "brainstorm://entity/e",
			entityId: "e",
		};
		expect(decideOpen(t, baseFacts)).toEqual({ rung: OpenRung.InternalResolver, target: t });
	});

	it("internal asset URL (no entity id) → explained refusal, never the OS", () => {
		const t: OpenTarget = { kind: OpenTargetKind.Internal, uri: "brainstorm://cover/x.png" };
		expect(decideOpen(t, baseFacts)).toEqual({
			rung: OpenRung.Refused,
			target: t,
			refusal: OpenRefusal.UnknownTarget,
		});
	});

	it("entity precedence: stored default → opener → universal editor → refuse", () => {
		const t: OpenTarget = { kind: OpenTargetKind.Entity, entityId: "e" };
		expect(decideOpen(t, { ...baseFacts, hasStoredDefault: true }).rung).toBe(OpenRung.StoredDefault);
		expect(decideOpen(t, { ...baseFacts, hasInVaultOpener: true }).rung).toBe(
			OpenRung.InVaultOpeners,
		);
		expect(decideOpen(t, { ...baseFacts, entityResolvable: true }).rung).toBe(
			OpenRung.UniversalEditor,
		);
		expect(decideOpen(t, baseFacts)).toMatchObject({
			rung: OpenRung.Refused,
			refusal: OpenRefusal.NoHandler,
		});
	});

	it("dangerous scheme is unconditionally refused — even with a stored default", () => {
		const t: OpenTarget = {
			kind: OpenTargetKind.Scheme,
			scheme: "javascript",
			uri: "javascript:alert(1)",
		};
		expect(decideOpen(t, { ...baseFacts, hasStoredDefault: true, hasInVaultOpener: true })).toEqual({
			rung: OpenRung.Refused,
			target: t,
			refusal: OpenRefusal.DangerousScheme,
		});
	});

	it("scheme falls outward to OS handoff, consent-gated + cap-gated", () => {
		const t: OpenTarget = { kind: OpenTargetKind.Scheme, scheme: "https", uri: "https://x" };
		// no cap → refuse (not a silent drop)
		expect(decideOpen(t, baseFacts)).toMatchObject({
			rung: OpenRung.Refused,
			refusal: OpenRefusal.NoHandler,
		});
		// cap + first-use → handoff needing the one-time prompt
		expect(decideOpen(t, { ...baseFacts, callerMayHandoff: true })).toEqual({
			rung: OpenRung.OsHandoff,
			target: t,
			needsConsent: true,
		});
		// cap + granted → handoff, no prompt
		expect(
			decideOpen(t, { ...baseFacts, callerMayHandoff: true, consent: OsHandoffConsent.Granted }),
		).toEqual({ rung: OpenRung.OsHandoff, target: t, needsConsent: false });
		// cap + denied → refuse
		expect(
			decideOpen(t, { ...baseFacts, callerMayHandoff: true, consent: OsHandoffConsent.Denied }),
		).toMatchObject({ rung: OpenRung.Refused, refusal: OpenRefusal.NoHandler });
	});

	it("web link routes to the in-app Browser opener by default; the Settings pin sends it to the system browser (Browser link-routing)", () => {
		const t: OpenTarget = {
			kind: OpenTargetKind.Scheme,
			scheme: "https",
			uri: "https://example.com",
		};
		// Browser registered as an https opener ⇒ a web link opens in-app,
		// even though OS handoff is offerable.
		expect(decideOpen(t, { ...baseFacts, hasInVaultOpener: true, callerMayHandoff: true }).rung).toBe(
			OpenRung.InVaultOpeners,
		);
		// A Settings → Default apps pin (Browser or the "system default"
		// sentinel) is a stored default and takes precedence over the opener.
		expect(decideOpen(t, { ...baseFacts, hasStoredDefault: true, hasInVaultOpener: true }).rung).toBe(
			OpenRung.StoredDefault,
		);
	});

	it("out-of-vault file: URL is floor-blocked; an in-vault file is not", () => {
		const out: OpenTarget = {
			kind: OpenTargetKind.File,
			extension: "txt",
			path: "/etc/passwd",
			inVault: false,
			viaFileScheme: true,
		};
		expect(decideOpen(out, { ...baseFacts, callerMayHandoff: true })).toMatchObject({
			rung: OpenRung.Refused,
			refusal: OpenRefusal.DangerousScheme,
		});
		const inv: OpenTarget = { ...out, path: "/v/a.txt", inVault: true };
		expect(decideOpen(inv, { ...baseFacts, hasInVaultOpener: true }).rung).toBe(
			OpenRung.InVaultOpeners,
		);
	});

	it("a plain external path is a legitimate OS handoff (not floor-blocked)", () => {
		const t: OpenTarget = {
			kind: OpenTargetKind.File,
			extension: "pdf",
			path: "/Users/x/d.pdf",
			inVault: false,
			viaFileScheme: false,
		};
		expect(decideOpen(t, { ...baseFacts, callerMayHandoff: true })).toEqual({
			rung: OpenRung.OsHandoff,
			target: t,
			needsConsent: true,
		});
	});

	// Totality — the whole point of doc 57: every (kind, facts) yields
	// exactly one resolution, the function never throws, and the only
	// terminal is an *explained* refusal (a reason is always attached).
	it("is total across the fact space", () => {
		const targets: OpenTarget[] = [
			{ kind: OpenTargetKind.Internal, uri: "brainstorm://entity/e", entityId: "e" },
			{ kind: OpenTargetKind.Internal, uri: "brainstorm://cover/x" },
			{ kind: OpenTargetKind.Entity, entityId: "e" },
			{ kind: OpenTargetKind.Scheme, scheme: "https", uri: "https://x" },
			{ kind: OpenTargetKind.Scheme, scheme: "javascript", uri: "javascript:x" },
			{
				kind: OpenTargetKind.File,
				extension: "pdf",
				path: "/v/a.pdf",
				inVault: true,
				viaFileScheme: false,
			},
			{
				kind: OpenTargetKind.File,
				extension: "pdf",
				path: "/x/a.pdf",
				inVault: false,
				viaFileScheme: true,
			},
		];
		const bools = [false, true];
		const consents = [OsHandoffConsent.FirstUse, OsHandoffConsent.Granted, OsHandoffConsent.Denied];
		const validRungs = new Set(Object.values(OpenRung));
		for (const target of targets) {
			for (const entityResolvable of bools)
				for (const hasStoredDefault of bools)
					for (const hasInVaultOpener of bools)
						for (const callerMayHandoff of bools)
							for (const consent of consents) {
								const r = decideOpen(target, {
									entityResolvable,
									hasStoredDefault,
									hasInVaultOpener,
									callerMayHandoff,
									consent,
								});
								expect(validRungs.has(r.rung)).toBe(true);
								if (r.rung === OpenRung.Refused) {
									expect(Object.values(OpenRefusal)).toContain(r.refusal);
								}
							}
		}
	});
});
