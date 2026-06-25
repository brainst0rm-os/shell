/**
 * `brainstorm/open-resolution/v1` — the pure half of the open-resolution
 * contract (docs/platform/57-open-resolution.md).
 *
 * Opening any piece of content is a **total function**: every openable
 * target has exactly one defined resolution; "nothing happens" is not a
 * reachable state — the only terminal is an *explained* refusal. This
 * module owns the side-effect-free core of that function:
 *
 *   - the closed set of target kinds + `normalizeOpenInput` (whatever the
 *     user clicked → one `OpenTarget`),
 *   - the fixed dangerous-scheme hard-block floor (`isHardBlockedScheme`),
 *   - the terminating ladder *decision* (`decideOpen`) — given the facts
 *     the shell gathered (is there a stored default? an in-vault opener?
 *     OS-handoff consent? may the caller hand off?), which rung fires and
 *     what the resolution is.
 *
 * The impure half (gathering those facts from the openers registry /
 * default store / capability ledger, then executing — delegating to the
 * IntentsBus, calling `shell.openExternal`, raising the consent prompt)
 * is the shell-side `OpenResolver` (OpenRes-1b). Keeping the ladder pure
 * here makes totality a property test, not a hope, and lets the SDK
 * surface the same explainer ("why did this open here?") the shell shows.
 *
 * Leaf module — depends only on `enum-guard` (no index-barrel cycle).
 */

import { enumGuard } from "./enum-guard";

/** The closed set of things the resolver can be asked to open. Wire form
 *  is the string value (the openers registry's extended `targetKind`
 *  reuses `Scheme`/`File` verbatim). */
export enum OpenTargetKind {
	/** `brainstorm://…` — always in-vault, always resolvable, never OS,
	 *  never prompted (doc 30/31 linking resolver owns it). */
	Internal = "internal",
	/** A Brainstorm entity addressed by id → resolved to its type. */
	Entity = "entity",
	/** A URL scheme (`https:`, `mailto:`, `tel:`, custom `app://`, …). */
	Scheme = "scheme",
	/** A file, keyed by extension (+ sniffed MIME). */
	File = "file",
}

export const OPEN_TARGET_KINDS = [
	OpenTargetKind.Internal,
	OpenTargetKind.Entity,
	OpenTargetKind.Scheme,
	OpenTargetKind.File,
] as const;

export const isOpenTargetKind = enumGuard(OPEN_TARGET_KINDS);

export type OpenTarget =
	| { kind: OpenTargetKind.Internal; uri: string; entityId?: string }
	| { kind: OpenTargetKind.Entity; entityId: string }
	| { kind: OpenTargetKind.Scheme; scheme: string; uri: string }
	| {
			kind: OpenTargetKind.File;
			/** Lowercased, dot-less extension, or null when the path has none. */
			extension: string | null;
			path: string;
			/** True when the path resolves *inside* the open vault. */
			inVault: boolean;
			/** True when this came from an explicit `file:` URL (vs. a plain
			 *  filesystem path / file entity). An out-of-vault `file:` URL is
			 *  on the security floor (doc 57 §Security floor) — a malicious
			 *  entity must not be able to point one at `/etc/passwd`; a plain
			 *  external path (a download, an attachment) is a legitimate OS
			 *  handoff. */
			viaFileScheme: boolean;
	  };

/**
 * The dangerous-scheme hard-block floor (doc 57 §Security floor). These
 * have no legitimate place in a clicked value and are pure exploit
 * vectors: never offered, never prompted, never handed to the OS — they
 * are unconditionally rung 6. A fixed floor, **not** user-relaxable
 * (OQ-OR-2: only a signed org policy in v2 may ever widen the *allowed*
 * set, and never these). `file:` outside the vault is also floor-blocked
 * but is decided in `decideOpen` (it needs the in-vault fact), not here.
 */
export const HARD_BLOCKED_SCHEMES: ReadonlySet<string> = new Set([
	"javascript",
	"data",
	"vbscript",
	"about",
]);

/** True iff `scheme` (with or without a trailing `:`, any case) is on the
 *  unconditional hard-block floor. */
export function isHardBlockedScheme(scheme: string): boolean {
	return HARD_BLOCKED_SCHEMES.has(scheme.replace(/:$/, "").toLowerCase());
}

/** Whatever the user clicked, normalized. Exactly one field set wins, in
 *  this precedence: explicit `entityId` → `brainstorm:`/scheme `url` →
 *  `deepLink` → filesystem `path`. */
export type OpenInput = {
	entityId?: string;
	url?: string;
	deepLink?: string;
	path?: string;
};

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

function extensionOf(pathOrUrl: string): string | null {
	const clean = pathOrUrl.split(/[?#]/)[0] ?? pathOrUrl;
	const base = clean.split(/[/\\]/).pop() ?? clean;
	const dot = base.lastIndexOf(".");
	if (dot <= 0 || dot === base.length - 1) return null;
	return base.slice(dot + 1).toLowerCase();
}

/** Does `filePath` resolve inside `vaultPath`? Pure prefix test on
 *  normalized separators — the shell passes a real absolute vault path. */
function isInVault(filePath: string, vaultPath: string | undefined): boolean {
	if (!vaultPath) return false;
	const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
	const f = norm(filePath);
	const v = norm(vaultPath);
	return f === v || f.startsWith(`${v}/`);
}

/**
 * Normalize a clicked value into one `OpenTarget`, or `null` when there
 * is genuinely nothing to open (an empty input — *not* an error: the
 * caller treats `null` as a no-op, never a dead click on real content).
 *
 * `brainstorm://entity/<id>` is `Internal` *and* carries the `entityId`
 * so rung 1 hands straight to the entity ladder; other `brainstorm://`
 * authorities are `Internal` with no `entityId` (asset URLs — the
 * resolver refuses them as non-user-openable rather than leaking them).
 */
export function normalizeOpenInput(
	input: OpenInput,
	ctx?: { vaultPath?: string },
): OpenTarget | null {
	const entityId =
		typeof input.entityId === "string" && input.entityId.length > 0 ? input.entityId : undefined;
	if (entityId) return { kind: OpenTargetKind.Entity, entityId };

	const raw =
		(typeof input.url === "string" && input.url.length > 0 && input.url) ||
		(typeof input.deepLink === "string" && input.deepLink.length > 0 && input.deepLink) ||
		"";

	if (raw) {
		const schemeMatch = SCHEME_RE.exec(raw);
		const scheme = schemeMatch?.[1]?.toLowerCase();
		if (scheme === "brainstorm") {
			const m = /^brainstorm:\/\/entity\/([^/?#]+)/i.exec(raw);
			const id = m?.[1] ? decodeURIComponent(m[1]) : undefined;
			return id
				? { kind: OpenTargetKind.Internal, uri: raw, entityId: id }
				: { kind: OpenTargetKind.Internal, uri: raw };
		}
		if (scheme === "file") {
			const p = raw.replace(/^file:\/\//i, "");
			return {
				kind: OpenTargetKind.File,
				extension: extensionOf(p),
				path: p,
				inVault: isInVault(p, ctx?.vaultPath),
				viaFileScheme: true,
			};
		}
		if (scheme) return { kind: OpenTargetKind.Scheme, scheme, uri: raw };
	}

	const path = typeof input.path === "string" && input.path.length > 0 ? input.path : undefined;
	if (path) {
		return {
			kind: OpenTargetKind.File,
			extension: extensionOf(path),
			path,
			inVault: isInVault(path, ctx?.vaultPath),
			viaFileScheme: false,
		};
	}
	return null;
}

/** The exhaustive, terminating ladder. First match wins (doc 57). */
export enum OpenRung {
	InternalResolver = "internal-resolver",
	StoredDefault = "stored-default",
	InVaultOpeners = "in-vault-openers",
	UniversalEditor = "universal-editor",
	OsHandoff = "os-handoff",
	Refused = "refused",
}

/** Why a target hit the terminal refusal rung — always *explained*,
 *  never silent. */
export enum OpenRefusal {
	/** On the hard-block floor (`javascript:`/`data:`/…, out-of-vault
	 *  `file:`). Never offered, never prompted. */
	DangerousScheme = "dangerous-scheme",
	/** A non-user-openable internal asset URL, or a target the OS can't
	 *  mean either. */
	UnknownTarget = "unknown-target",
	/** Nothing in the vault claims it and the caller may not hand off to
	 *  the OS (no `system.open-external`) or the user declined. */
	NoHandler = "no-handler",
}

/** First-use-per-protocol OS-handoff consent state (doc 57 §System
 *  default), as the shell's per-vault memory records it for a scheme /
 *  extension. */
export enum OsHandoffConsent {
	/** "Always" was chosen for this scheme/extension — hand off now. */
	Granted = "granted",
	/** Never asked yet — the resolver must raise the one-time prompt. */
	FirstUse = "first-use",
	/** "No" was chosen and remembered — refuse (until cleared). */
	Denied = "denied",
}

/** The user's response to a first-use OS-handoff prompt. The wire form
 *  is the string value (`"allow"` / `"deny"` / `"cancel"`) so the same
 *  enum is consumed main-side (decision producer), preload-side (wire
 *  type), and renderer-side (modal). `Allow` / `Deny` are sticky — the
 *  bus persists them; `Cancel` leaves the consent unset so the next
 *  attempt re-prompts. */
export enum OsHandoffPromptDecision {
	Allow = "allow",
	Deny = "deny",
	Cancel = "cancel",
}

/** Multi-candidate "Open with…" picker (OpenRes-1c slice 6). When the
 *  resolver lands on the `InVaultOpeners` rung with 2+ candidates, the
 *  bus raises a picker so the user chooses which app handles the open
 *  rather than the bus auto-picking the primary / first-registered.
 *  `Pick` carries the chosen `appId` (which may be `OS_HANDOFF_APP_ID`
 *  for "open with system default", when handoff is permitted) plus a
 *  `remember` flag — when true, the bus persists the choice as a
 *  `(open, signature)` default so the next attempt skips the picker.
 *  `Cancel` returns an explained refusal and persists nothing. */
export enum OpenWithDecisionKind {
	Pick = "pick",
	Cancel = "cancel",
}

/** One row in the "Open with…" picker. `appId` is the candidate's id
 *  (or `OS_HANDOFF_APP_ID` for the OS-handoff option, when handoff is
 *  permitted for this dispatch). `label` is the human-readable name the
 *  modal renders (the bus resolves it from the apps repo / manifests).
 *  `kind` carries the opener priority so the modal can hint a default. */
export type OpenWithCandidate = {
	appId: string;
	label: string;
	kind: "primary" | "secondary" | "os-handoff";
};

/** Wire form of the picker response. Object shape (not a bare enum)
 *  because `Pick` carries two pieces of information — the chosen app
 *  and whether to remember the choice. */
export type OpenWithDecision =
	| { kind: OpenWithDecisionKind.Pick; appId: string; remember: boolean }
	| { kind: OpenWithDecisionKind.Cancel };

/** Discriminator on the `<kind>:<value>` os-handoff consent signature
 *  (persisted as keys in `dashboard.osHandoffConsent`). String-valued so
 *  the enum value IS the wire form — `${OsHandoffSignatureKind.Scheme}:mailto`
 *  reads as `"scheme:mailto"`. */
export enum OsHandoffSignatureKind {
	Scheme = "scheme",
	Ext = "ext",
}

/** Sentinel app id used for "Open with the operating system" — stored in
 *  the dashboard `defaultHandlers` map when the user pins `https:` /
 *  `pdf` / etc. to the OS rather than an in-vault handler. Distinct from
 *  `null` (= "automatic / built-in pick"); storing this sentinel makes
 *  the choice explicit and survives a future opener registration that
 *  would otherwise win the built-in pick. The IntentsBus reads this
 *  sentinel from `resolveDefaultHandler` and short-circuits the
 *  `OpenRung.StoredDefault` arm to the OS-handoff branch — the user
 *  already pinned OS as their default, that IS their consent. */
export const OS_HANDOFF_APP_ID = "__os__";

/** Human label the renderer shows for the OS-handoff pick. Centralised
 *  with the sentinel so the chip and the option text never drift. */
export const OS_HANDOFF_APP_LABEL = "Open with system default";

/** Parse an os-handoff signature into its `kind` + `value` pair, or
 *  `null` if the signature is malformed (no `:` or unknown kind). The
 *  parser is forgiving — `value` may be empty (e.g. `ext:`). */
export function parseOsHandoffSignature(
	signature: string,
): { kind: OsHandoffSignatureKind; value: string } | null {
	const colon = signature.indexOf(":");
	if (colon === -1) return null;
	const kind = signature.slice(0, colon);
	const value = signature.slice(colon + 1);
	if (kind === OsHandoffSignatureKind.Scheme) {
		return { kind: OsHandoffSignatureKind.Scheme, value };
	}
	if (kind === OsHandoffSignatureKind.Ext) {
		return { kind: OsHandoffSignatureKind.Ext, value };
	}
	return null;
}

/** Inverse of `parseOsHandoffSignature` — the canonical producer. Used by
 *  the open-resolution path when building the consent-memory key. */
export function osHandoffSignature(kind: OsHandoffSignatureKind, value: string): string {
	return `${kind}:${value}`;
}

/** Facts the shell gathers before deciding (the impure half supplies
 *  these; the decision below is pure). */
export type OpenFacts = {
	/** The entity id resolved to a real type (rung-4 universal-editor is
	 *  only reachable for a real object). */
	entityResolvable: boolean;
	/** A stored user default (doc 26 `(open, target)` store) exists. */
	hasStoredDefault: boolean;
	/** At least one in-vault opener is registered for this target. */
	hasInVaultOpener: boolean;
	/** OS-handoff consent memory for this scheme/extension. */
	consent: OsHandoffConsent;
	/** The caller holds `system.open-external` (shell/first-party user
	 *  clicks exercise it implicitly; an app/agent must hold it). */
	callerMayHandoff: boolean;
};

export type OpenResolution =
	/** Delegate to the in-vault path (linking resolver for `Internal`,
	 *  the IntentsBus for entity/scheme/file openers + the Notes
	 *  universal-editor fallback). `rung` is which rung fired — surfaced
	 *  verbatim by the "why did this open here?" explainer. */
	| {
			rung:
				| OpenRung.InternalResolver
				| OpenRung.StoredDefault
				| OpenRung.InVaultOpeners
				| OpenRung.UniversalEditor;
			target: OpenTarget;
	  }
	/** Hand off to the OS. `needsConsent` ⇒ the resolver must raise the
	 *  one-time per-protocol prompt *before* the handoff (and record the
	 *  answer); `false` ⇒ consent already granted, hand off now. Every
	 *  handoff is an audited egress event (doc 38). */
	| { rung: OpenRung.OsHandoff; target: OpenTarget; needsConsent: boolean }
	/** The only terminal. Always carries a machine-readable reason so the
	 *  surface can render an explained, inline refusal — never a no-op. */
	| { rung: OpenRung.Refused; target: OpenTarget; refusal: OpenRefusal };

/**
 * The ladder, pure. Given a normalized target and the gathered facts,
 * returns the single resolution. Total by construction — every
 * `(kind, facts)` yields exactly one `OpenResolution`; the property
 * tests assert it never throws and never returns a non-terminal "maybe".
 *
 * Rungs 4 and 5 are mutually exclusive by kind: entities/internal fall
 * *inward* (universal editor); external schemes/files fall *outward*
 * (OS handoff). That is what keeps the function total without ever
 * leaking a Brainstorm object to an external handler or trapping an
 * external URL with no in-vault claimant.
 */
export function decideOpen(target: OpenTarget, facts: OpenFacts): OpenResolution {
	switch (target.kind) {
		case OpenTargetKind.Internal: {
			// Rung 1. `brainstorm://entity/<id>` hands to the entity ladder;
			// any other authority is a non-user-openable asset URL → an
			// explained refusal (never leaked to the OS).
			if (target.entityId) return { rung: OpenRung.InternalResolver, target };
			return { rung: OpenRung.Refused, target, refusal: OpenRefusal.UnknownTarget };
		}
		case OpenTargetKind.Entity: {
			if (facts.hasStoredDefault) return { rung: OpenRung.StoredDefault, target };
			if (facts.hasInVaultOpener) return { rung: OpenRung.InVaultOpeners, target };
			// Rung 4 — fall inward to the universal editor (Notes). Never
			// the OS for an entity. A real entity always lands somewhere.
			if (facts.entityResolvable) return { rung: OpenRung.UniversalEditor, target };
			return { rung: OpenRung.Refused, target, refusal: OpenRefusal.NoHandler };
		}
		case OpenTargetKind.Scheme: {
			if (isHardBlockedScheme(target.scheme)) {
				return { rung: OpenRung.Refused, target, refusal: OpenRefusal.DangerousScheme };
			}
			if (facts.hasStoredDefault) return { rung: OpenRung.StoredDefault, target };
			if (facts.hasInVaultOpener) return { rung: OpenRung.InVaultOpeners, target };
			return osHandoffOrRefuse(target, facts);
		}
		case OpenTargetKind.File: {
			// An out-of-vault `file:` URL is on the security floor (doc 57):
			// a malicious entity must not be able to point one at an
			// arbitrary host path. A plain external path (a download, an
			// attachment) is a legitimate OS handoff, and an in-vault file
			// resolves like any other vault content.
			if (target.viaFileScheme && !target.inVault) {
				return { rung: OpenRung.Refused, target, refusal: OpenRefusal.DangerousScheme };
			}
			if (target.path === "") {
				return { rung: OpenRung.Refused, target, refusal: OpenRefusal.UnknownTarget };
			}
			if (facts.hasStoredDefault) return { rung: OpenRung.StoredDefault, target };
			if (facts.hasInVaultOpener) return { rung: OpenRung.InVaultOpeners, target };
			return osHandoffOrRefuse(target, facts);
		}
	}
}

function osHandoffOrRefuse(target: OpenTarget, facts: OpenFacts): OpenResolution {
	if (!facts.callerMayHandoff || facts.consent === OsHandoffConsent.Denied) {
		return { rung: OpenRung.Refused, target, refusal: OpenRefusal.NoHandler };
	}
	return {
		rung: OpenRung.OsHandoff,
		target,
		needsConsent: facts.consent !== OsHandoffConsent.Granted,
	};
}
