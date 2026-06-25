import { describe, expect, it } from "vitest";
import {
	BODY_MAX_LENGTH,
	FeedbackKind,
	type FeedbackPayload,
	FeedbackSensitivity,
	FeedbackValidationError,
	RECENT_LOG_MAX_BYTES,
	TITLE_MAX_LENGTH,
	newRequestId,
	redactPayload,
	validatePayload,
} from "./feedback-payload";

function makePayload(overrides: Partial<FeedbackPayload> = {}): FeedbackPayload {
	return {
		kind: FeedbackKind.Bug,
		title: "Crashed on save",
		body: "Repro steps...",
		sensitivity: FeedbackSensitivity.Anonymous,
		includeRecentLog: false,
		clientVersion: "abc1234",
		clientPlatform: "darwin",
		submittedAt: 1_700_000_000_000,
		requestId: "01H00000000000000000000000",
		...overrides,
	};
}

describe("validatePayload — shape", () => {
	it("accepts a minimal Anonymous payload", () => {
		const result = validatePayload(makePayload());
		expect(result.ok).toBe(true);
	});

	it("rejects non-object input", () => {
		const r = validatePayload(null);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe(FeedbackValidationError.MalformedShape);
	});

	it("rejects array input", () => {
		const r = validatePayload([]);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe(FeedbackValidationError.MalformedShape);
	});

	it("rejects missing kind", () => {
		const { kind: _kind, ...rest } = makePayload();
		const r = validatePayload(rest);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe(FeedbackValidationError.MissingKind);
	});

	it("rejects invalid kind", () => {
		const r = validatePayload({ ...makePayload(), kind: "not-a-kind" });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe(FeedbackValidationError.InvalidKind);
	});

	it("rejects empty title", () => {
		const r = validatePayload(makePayload({ title: "   " }));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe(FeedbackValidationError.TitleEmpty);
	});

	it("rejects title exceeding cap", () => {
		const r = validatePayload(makePayload({ title: "a".repeat(TITLE_MAX_LENGTH + 1) }));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe(FeedbackValidationError.TitleTooLong);
	});

	it("rejects empty body", () => {
		const r = validatePayload(makePayload({ body: "\n\t " }));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe(FeedbackValidationError.BodyEmpty);
	});

	it("rejects body exceeding cap", () => {
		const r = validatePayload(makePayload({ body: "a".repeat(BODY_MAX_LENGTH + 1) }));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe(FeedbackValidationError.BodyTooLong);
	});

	it("rejects missing sensitivity", () => {
		const { sensitivity: _sensitivity, ...rest } = makePayload();
		const r = validatePayload(rest);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe(FeedbackValidationError.MissingSensitivity);
	});

	it("rejects unknown sensitivity", () => {
		const r = validatePayload({ ...makePayload(), sensitivity: "maximum" });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe(FeedbackValidationError.InvalidSensitivity);
	});

	it("rejects invalid contactEmail when IdentityVoluntary", () => {
		const r = validatePayload(
			makePayload({
				sensitivity: FeedbackSensitivity.IdentityVoluntary,
				contactEmail: "not-an-email",
			}),
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe(FeedbackValidationError.InvalidEmail);
	});

	it("accepts a valid contactEmail when IdentityVoluntary", () => {
		const r = validatePayload(
			makePayload({
				sensitivity: FeedbackSensitivity.IdentityVoluntary,
				contactEmail: "me@example.com",
			}),
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.payload.contactEmail).toBe("me@example.com");
	});

	it("ignores contactEmail under Anonymous (validator passes; redactor strips later)", () => {
		const r = validatePayload(
			makePayload({
				sensitivity: FeedbackSensitivity.Anonymous,
				contactEmail: "me@example.com",
			}),
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.payload.contactEmail).toBeUndefined();
	});

	it("rejects non-boolean includeRecentLog", () => {
		const r = validatePayload({ ...makePayload(), includeRecentLog: "true" });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe(FeedbackValidationError.MalformedShape);
	});

	it("rejects missing clientVersion", () => {
		const { clientVersion: _v, ...rest } = makePayload();
		const r = validatePayload(rest);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe(FeedbackValidationError.MissingClientVersion);
	});

	it("rejects missing clientPlatform", () => {
		const { clientPlatform: _p, ...rest } = makePayload();
		const r = validatePayload(rest);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe(FeedbackValidationError.MissingPlatform);
	});

	it("rejects non-finite submittedAt", () => {
		const r = validatePayload({ ...makePayload(), submittedAt: Number.NaN });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe(FeedbackValidationError.MalformedShape);
	});

	it("rejects missing requestId", () => {
		const { requestId: _id, ...rest } = makePayload();
		const r = validatePayload(rest);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toBe(FeedbackValidationError.MissingRequestId);
	});

	it("payload is JSON-roundtrip safe", () => {
		const r = validatePayload(makePayload({ body: "some unicode — emoji 💡 ok" }));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const roundtrip = validatePayload(JSON.parse(JSON.stringify(r.payload)));
		expect(roundtrip.ok).toBe(true);
	});
});

describe("redactPayload — vault path substitution", () => {
	it("replaces literal vault path with <vault>", () => {
		const out = redactPayload(
			makePayload({ body: "Crashed at /Users/alice/MyVault/Notes/foo.md (line 12)" }),
			{ vaultPath: "/Users/alice/MyVault" },
		);
		expect(out.body).toContain("<vault>/Notes/foo.md");
		expect(out.body).not.toContain("/Users/alice/MyVault");
	});

	it("replaces trailing-slash vault path uniformly", () => {
		const out = redactPayload(makePayload({ body: "open /Users/alice/MyVault/Notes/" }), {
			vaultPath: "/Users/alice/MyVault/",
		});
		expect(out.body).toContain("<vault>/Notes/");
	});

	it("replaces ~-expanded vault path when HOME is set", () => {
		const originalHome = process.env.HOME;
		process.env.HOME = "/Users/alice";
		try {
			const out = redactPayload(makePayload({ body: "see ~/MyVault/foo" }), {
				vaultPath: "/Users/alice/MyVault",
			});
			expect(out.body).toContain("<vault>/foo");
		} finally {
			process.env.HOME = originalHome;
		}
	});

	it("collapses unrelated /Users/<name>/ to <home>/", () => {
		const out = redactPayload(makePayload({ body: "log written to /Users/bob/Downloads/foo.txt" }), {
			vaultPath: "/Users/alice/MyVault",
		});
		expect(out.body).toContain("<home>/Downloads/foo.txt");
		expect(out.body).not.toContain("/Users/bob/");
	});

	it("collapses /home/<name>/ on Linux paths", () => {
		const out = redactPayload(makePayload({ body: "/home/alice/notes/bug.md /home/bob/x" }), {
			vaultPath: "/home/alice/Vault",
		});
		expect(out.body).toContain("<home>/notes/bug.md");
		expect(out.body).toContain("<home>/x");
	});

	it("collapses C:\\Users\\<name>\\ Windows prefix", () => {
		const out = redactPayload(makePayload({ body: "C:\\Users\\alice\\AppData\\Local\\Brainstorm" }), {
			vaultPath: "",
		});
		expect(out.body).toContain("<home>\\AppData\\Local\\Brainstorm");
	});
});

describe("redactPayload — credential key scrubbing", () => {
	it("strips proxy.<host>:<port> shape", () => {
		const out = redactPayload(makePayload({ body: "key proxy.example.com:8080 missing" }), {
			vaultPath: "",
		});
		expect(out.body).toContain("<credential>");
		expect(out.body).not.toContain("proxy.example.com");
	});

	it("strips noble.* shape", () => {
		const out = redactPayload(makePayload({ body: "noble.ed25519.foo bad" }), {
			vaultPath: "",
		});
		expect(out.body).toContain("<credential>");
		expect(out.body).not.toContain("noble.ed25519");
	});

	it("strips kr:* shape", () => {
		const out = redactPayload(makePayload({ body: "kr:vault-master-key blew up" }), {
			vaultPath: "",
		});
		expect(out.body).toContain("<credential>");
		expect(out.body).not.toContain("kr:vault-master-key");
	});
});

describe("redactPayload — email scrubbing", () => {
	it("strips every email from body when Anonymous", () => {
		const out = redactPayload(
			makePayload({
				body: "user@example.com also tried ops@vendor.example",
				sensitivity: FeedbackSensitivity.Anonymous,
			}),
			{ vaultPath: "" },
		);
		expect(out.body).not.toContain("user@example.com");
		expect(out.body).not.toContain("ops@vendor.example");
		expect(out.body).toContain("<email>");
	});

	it("preserves the user-typed contactEmail under IdentityVoluntary", () => {
		const out = redactPayload(
			makePayload({
				body: "Reply to me@self.example — other ops@vendor.example",
				sensitivity: FeedbackSensitivity.IdentityVoluntary,
				contactEmail: "me@self.example",
			}),
			{ vaultPath: "" },
		);
		expect(out.body).toContain("me@self.example");
		expect(out.body).not.toContain("ops@vendor.example");
		expect(out.contactEmail).toBe("me@self.example");
	});

	it("strips contactEmail when sensitivity is Anonymous (defense-in-depth)", () => {
		const out = redactPayload(
			{
				...makePayload(),
				sensitivity: FeedbackSensitivity.Anonymous,
				contactEmail: "leaked@example.com",
			} as FeedbackPayload,
			{ vaultPath: "" },
		);
		expect(out.contactEmail).toBeUndefined();
	});
});

describe("redactPayload — recent log excerpt", () => {
	it("drops the excerpt when includeRecentLog is false", () => {
		const out = redactPayload(
			makePayload({
				includeRecentLog: false,
				recentLogExcerpt: "should not survive",
			}),
			{ vaultPath: "" },
		);
		expect(out.recentLogExcerpt).toBeUndefined();
	});

	it("keeps the excerpt when includeRecentLog is true", () => {
		const out = redactPayload(
			makePayload({
				includeRecentLog: true,
				recentLogExcerpt: "real log line",
			}),
			{ vaultPath: "" },
		);
		expect(out.recentLogExcerpt).toBe("real log line");
	});

	it("truncates the excerpt to the last 64 KiB", () => {
		const log = "x".repeat(RECENT_LOG_MAX_BYTES * 2);
		const tail = "TAIL".repeat(8);
		const out = redactPayload(
			makePayload({
				includeRecentLog: true,
				recentLogExcerpt: log + tail,
			}),
			{ vaultPath: "" },
		);
		expect(out.recentLogExcerpt).toBeDefined();
		const encoded = new TextEncoder().encode(out.recentLogExcerpt ?? "");
		expect(encoded.length).toBeLessThanOrEqual(RECENT_LOG_MAX_BYTES + 4);
		expect(out.recentLogExcerpt?.endsWith(tail)).toBe(true);
	});

	it("applies vault + home + credential + email redaction inside the excerpt", () => {
		const out = redactPayload(
			makePayload({
				includeRecentLog: true,
				recentLogExcerpt: "open /Users/alice/Vault/Notes/x.md by ops@vendor.example proxy.h:1080",
			}),
			{ vaultPath: "/Users/alice/Vault" },
		);
		expect(out.recentLogExcerpt).toContain("<vault>/Notes/x.md");
		expect(out.recentLogExcerpt).toContain("<email>");
		expect(out.recentLogExcerpt).toContain("<credential>");
		expect(out.recentLogExcerpt).not.toContain("/Users/alice/Vault");
	});
});

describe("redactPayload — does not mutate input", () => {
	it("returns a fresh object", () => {
		const input = makePayload({ body: "kept verbatim" });
		const out = redactPayload(input, { vaultPath: "" });
		expect(out).not.toBe(input);
		expect(input.body).toBe("kept verbatim");
	});
});

describe("newRequestId", () => {
	it("emits a 26-character id", () => {
		const id = newRequestId(0, () => 0);
		expect(id).toHaveLength(26);
	});

	it("is deterministic when now + random are pinned", () => {
		const a = newRequestId(1_700_000_000_000, () => 0.5);
		const b = newRequestId(1_700_000_000_000, () => 0.5);
		expect(a).toBe(b);
	});

	it("changes when the timestamp advances", () => {
		const a = newRequestId(1_700_000_000_000, () => 0);
		const b = newRequestId(1_700_000_000_001, () => 0);
		expect(a).not.toBe(b);
	});

	it("uses Crockford-base32 alphabet only", () => {
		const id = newRequestId(1_700_000_000_000, () => 0.5);
		expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
	});
});
