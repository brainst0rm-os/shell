/**
 * Shared pieces of the worker-side `MailDriver` implementations (Gmail REST,
 * IMAP/SMTP): the structured error kinds the main process maps back onto
 * broker error names, and the outbound-submission guards — the CR/LF
 * header-injection fail-close and the submissionId → `Message-ID` stamp that
 * makes every driver's send idempotent on the same key (doc 53 §Sending).
 */

import type { OutboundMessage } from "../../main/mailbox/mail-driver";

export const DriverErrorKind = {
	Denied: "Denied",
	Unavailable: "Unavailable",
	Invalid: "Invalid",
} as const;
export type DriverErrorKind = (typeof DriverErrorKind)[keyof typeof DriverErrorKind];

export function driverError(kind: DriverErrorKind, message: string): Error {
	const err = new Error(message);
	err.name = kind;
	return err;
}

/** Fail closed on CR/LF in any outbound header value — a line break here is
 *  header injection into the raw RFC 822 message (e.g. a smuggled `Bcc:`),
 *  not a legitimate value. */
export function assertHeaderSafe(driver: string, field: string, value: string | undefined): void {
	if (value !== undefined && /[\r\n]/.test(value)) {
		throw driverError(DriverErrorKind.Invalid, `${driver}: ${field} contains a line break`);
	}
}

export function assertOutboundHeadersSafe(driver: string, message: OutboundMessage): void {
	assertHeaderSafe(driver, "from", message.from);
	for (const to of message.to) assertHeaderSafe(driver, "to", to);
	for (const cc of message.cc ?? []) assertHeaderSafe(driver, "cc", cc);
	assertHeaderSafe(driver, "subject", message.subject);
	assertHeaderSafe(driver, "inReplyTo", message.inReplyTo);
	for (const ref of message.references ?? []) assertHeaderSafe(driver, "references", ref);
}

export function sanitizeIdToken(submissionId: string): string {
	return submissionId.replace(/[^A-Za-z0-9._-]/g, "");
}

/** The self-stamped RFC 5322 `Message-ID` for an outbound message — derived
 *  from the client-stamped `submissionId` so a resend after a crash carries
 *  the same id and the Sent-folder projection dedupes it. */
export function submissionMessageId(submissionId: string): string {
	return `<${sanitizeIdToken(submissionId)}@brainstorm.local>`;
}
