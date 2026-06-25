import { describe, expect, it } from "vitest";
import {
	AUTH_KINDS,
	AuthKind,
	EMAIL_TYPE_URL,
	type EmailDef,
	FOLDER_ROLES,
	FolderRole,
	MAIL_ACCOUNT_TYPE_URL,
	MAIL_FOLDER_TYPE_URL,
	type MailAccountDef,
	MailFlag,
	type MailFolderDef,
	MailIssueCode,
	MailProtocol,
	SYNC_WINDOW_ALL_MAX_MESSAGES,
	SyncWindow,
	deriveThreadKey,
	formatMailAddress,
	isEmailAddress,
	isMailFlag,
	isMailProtocol,
	normalizeAddress,
	parseAddressList,
	parseMailAddress,
	syncWindowDays,
	validateEmail,
	validateMailAccount,
	validateMailFolder,
} from "./mail";

const validImapAccount = (): MailAccountDef => ({
	address: "dana@example.com",
	displayName: "Dana Lee",
	protocol: MailProtocol.Imap,
	authKind: AuthKind.AppPassword,
	incoming: { host: "imap.example.com", port: 993, tls: true },
	outgoing: { host: "smtp.example.com", port: 465, tls: true },
	syncWindow: SyncWindow.Days90,
	enabled: true,
});

const validEmail = (): EmailDef => ({
	accountRef: "acct-1",
	folderRefs: ["folder-inbox"],
	messageId: "<msg-1@example.com>",
	from: [{ address: "sender@example.com", name: "Sender" }],
	to: [{ address: "dana@example.com" }],
	receivedAt: 1_700_000_000_000,
	flags: [MailFlag.Unread],
});

describe("mail contracts — type urls + enums", () => {
	it("freezes the three canonical type urls", () => {
		expect(MAIL_ACCOUNT_TYPE_URL).toBe("brainstorm/MailAccount/v1");
		expect(MAIL_FOLDER_TYPE_URL).toBe("brainstorm/MailFolder/v1");
		expect(EMAIL_TYPE_URL).toBe("brainstorm/Email/v1");
	});

	it("enum guards accept members and reject non-members", () => {
		expect(isMailProtocol(MailProtocol.Imap)).toBe(true);
		expect(isMailProtocol("pop3")).toBe(false);
		expect(isMailFlag(MailFlag.Flagged)).toBe(true);
		expect(isMailFlag("seen")).toBe(false);
		expect(AUTH_KINDS).toContain(AuthKind.OAuth2);
		expect(FOLDER_ROLES).toContain(FolderRole.Inbox);
	});

	it("maps sync windows to day bounds; `all` is unbounded by time but capped by count", () => {
		expect(syncWindowDays(SyncWindow.Days30)).toBe(30);
		expect(syncWindowDays(SyncWindow.Year1)).toBe(365);
		expect(syncWindowDays(SyncWindow.All)).toBeNull();
		expect(SYNC_WINDOW_ALL_MAX_MESSAGES).toBeGreaterThan(0);
	});
});

describe("address parsing + normalisation", () => {
	it("accepts plausible addresses and rejects junk", () => {
		expect(isEmailAddress("a@b.com")).toBe(true);
		expect(isEmailAddress("dana.lee@mail.example.co.uk")).toBe(true);
		expect(isEmailAddress("nope")).toBe(false);
		expect(isEmailAddress("a@@b.com")).toBe(false);
		expect(isEmailAddress("a@b")).toBe(false);
		expect(isEmailAddress("a b@c.com")).toBe(false);
	});

	it("normalises for case-insensitive matching", () => {
		expect(normalizeAddress("  Dana@Example.COM ")).toBe("dana@example.com");
	});

	it("parses display-name and bare forms", () => {
		expect(parseMailAddress("Dana Lee <dana@example.com>")).toEqual({
			address: "dana@example.com",
			name: "Dana Lee",
		});
		expect(parseMailAddress('"Lee, Dana" <dana@example.com>')).toEqual({
			address: "dana@example.com",
			name: "Lee, Dana",
		});
		expect(parseMailAddress("dana@example.com")).toEqual({ address: "dana@example.com" });
		expect(parseMailAddress("not an address")).toBeNull();
	});

	it("splits an address list without breaking on commas inside quotes/angles", () => {
		const list = parseAddressList('"Lee, Dana" <dana@example.com>, bob@example.com');
		expect(list).toEqual([
			{ address: "dana@example.com", name: "Lee, Dana" },
			{ address: "bob@example.com" },
		]);
	});

	it("round-trips through formatMailAddress, quoting names with specials", () => {
		expect(formatMailAddress({ address: "a@b.com" })).toBe("a@b.com");
		expect(formatMailAddress({ address: "a@b.com", name: "Dana" })).toBe("Dana <a@b.com>");
		expect(formatMailAddress({ address: "a@b.com", name: "Lee, Dana" })).toBe(
			'"Lee, Dana" <a@b.com>',
		);
	});
});

describe("deriveThreadKey (OQ-MB-3 precedence)", () => {
	it("prefers the provider thread id", () => {
		expect(
			deriveThreadKey({ messageId: "<m@x>", providerThreadId: "t-99", references: ["<root@x>"] }),
		).toBe("t-99");
	});

	it("falls back to the References root", () => {
		expect(deriveThreadKey({ messageId: "<m3@x>", references: ["<root@x>", "<m2@x>"] })).toBe(
			"root@x",
		);
	});

	it("uses In-Reply-To when there is no References chain", () => {
		expect(deriveThreadKey({ messageId: "<m2@x>", inReplyTo: "<root@x>" })).toBe("root@x");
	});

	it("falls back to the message's own id for a thread of one", () => {
		expect(deriveThreadKey({ messageId: "<solo@x>" })).toBe("solo@x");
	});
});

describe("validateMailAccount — custody invariant + shape", () => {
	it("accepts a well-formed IMAP account", () => {
		expect(validateMailAccount(validImapAccount())).toEqual([]);
	});

	it("rejects a secret-shaped field on the entity (token belongs in Tier 2)", () => {
		const def = { ...validImapAccount(), accessToken: "leaked" } as unknown as MailAccountDef;
		const codes = validateMailAccount(def).map((i) => i.code);
		expect(codes).toContain(MailIssueCode.EmbeddedSecret);
	});

	it("requires both host configs for IMAP", () => {
		const { outgoing: _omit, ...def } = validImapAccount();
		const codes = validateMailAccount(def).map((i) => i.code);
		expect(codes).toContain(MailIssueCode.InvalidHostConfig);
	});

	it("does not require host configs for JMAP", () => {
		const def: MailAccountDef = {
			address: "dana@fastmail.com",
			protocol: MailProtocol.Jmap,
			authKind: AuthKind.OAuth2,
			syncWindow: SyncWindow.All,
			enabled: true,
		};
		expect(validateMailAccount(def)).toEqual([]);
	});

	it("rejects an invalid address and unknown enums", () => {
		const def = {
			...validImapAccount(),
			address: "nope",
			protocol: "pop3",
		} as unknown as MailAccountDef;
		const codes = validateMailAccount(def).map((i) => i.code);
		expect(codes).toContain(MailIssueCode.InvalidAddress);
		expect(codes).toContain(MailIssueCode.InvalidProtocol);
	});
});

describe("validateMailFolder", () => {
	it("accepts a well-formed folder", () => {
		const def: MailFolderDef = {
			accountRef: "acct-1",
			path: "INBOX",
			role: FolderRole.Inbox,
			unreadCount: 3,
		};
		expect(validateMailFolder(def)).toEqual([]);
	});

	it("flags a missing account ref and unknown role", () => {
		const def = {
			accountRef: "",
			path: "",
			role: "weird",
			unreadCount: 0,
		} as unknown as MailFolderDef;
		const codes = validateMailFolder(def).map((i) => i.code);
		expect(codes).toContain(MailIssueCode.MissingAccountRef);
		expect(codes).toContain(MailIssueCode.EmptyFolderPath);
		expect(codes).toContain(MailIssueCode.InvalidFolderRole);
	});
});

describe("validateEmail", () => {
	it("accepts a well-formed received email", () => {
		expect(validateEmail(validEmail())).toEqual([]);
	});

	it("requires a message id, a folder, a sender, and a numeric receivedAt", () => {
		const def = {
			accountRef: "acct-1",
			folderRefs: [],
			messageId: "",
			from: [],
			to: [],
			receivedAt: Number.NaN,
			flags: ["bogus"],
		} as unknown as EmailDef;
		const codes = validateEmail(def).map((i) => i.code);
		expect(codes).toContain(MailIssueCode.EmptyMessageId);
		expect(codes).toContain(MailIssueCode.NoFolderRefs);
		expect(codes).toContain(MailIssueCode.NoSender);
		expect(codes).toContain(MailIssueCode.InvalidReceivedAt);
		expect(codes).toContain(MailIssueCode.InvalidFlag);
	});
});
