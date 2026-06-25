import { MessageRole } from "@brainstorm/sdk-types";
import { describe, expect, it } from "vitest";
import {
	AGENT_SYSTEM_PROMPT,
	type TranscriptMessage,
	buildAiMessages,
	deriveConversationTitle,
	sortMessages,
} from "../src/logic/transcript";

const msg = (over: Partial<TranscriptMessage>): TranscriptMessage => ({
	id: "m",
	role: MessageRole.User,
	body: "",
	createdAt: "2026-06-07T00:00:00.000Z",
	...over,
});

describe("sortMessages", () => {
	it("orders by createdAt, then seq, then id", () => {
		const out = sortMessages([
			msg({ id: "b", createdAt: "2026-06-07T00:00:02.000Z" }),
			msg({ id: "a", createdAt: "2026-06-07T00:00:01.000Z" }),
			msg({ id: "c", createdAt: "2026-06-07T00:00:01.000Z", seq: 2 }),
			msg({ id: "d", createdAt: "2026-06-07T00:00:01.000Z", seq: 1 }),
		]);
		expect(out.map((m) => m.id)).toEqual(["a", "d", "c", "b"]);
	});
});

describe("buildAiMessages", () => {
	it("prepends the system prompt and keeps user/assistant turns in order", () => {
		const out = buildAiMessages([
			msg({ id: "1", role: MessageRole.User, body: "Hi", createdAt: "2026-06-07T00:00:01.000Z" }),
			msg({
				id: "2",
				role: MessageRole.Assistant,
				body: "Hello",
				createdAt: "2026-06-07T00:00:02.000Z",
			}),
		]);
		expect(out).toEqual([
			{ role: MessageRole.System, content: AGENT_SYSTEM_PROMPT },
			{ role: MessageRole.User, content: "Hi" },
			{ role: MessageRole.Assistant, content: "Hello" },
		]);
	});

	it("skips tool/system rows and coerces an unknown role to user", () => {
		const out = buildAiMessages([
			msg({ id: "1", role: "tool", body: "tool out", createdAt: "2026-06-07T00:00:01.000Z" }),
			msg({ id: "2", role: "weird", body: "kept", createdAt: "2026-06-07T00:00:02.000Z" }),
		]);
		expect(out).toEqual([
			{ role: MessageRole.System, content: AGENT_SYSTEM_PROMPT },
			{ role: MessageRole.User, content: "kept" },
		]);
	});
});

describe("deriveConversationTitle", () => {
	it("uses the first non-empty line", () => {
		expect(deriveConversationTitle("\n  Plan the launch  \nmore", "fallback")).toBe(
			"Plan the launch",
		);
	});

	it("truncates a long line with an ellipsis", () => {
		const long = "x".repeat(80);
		const out = deriveConversationTitle(long, "fallback");
		expect(out.length).toBe(60);
		expect(out.endsWith("…")).toBe(true);
	});

	it("falls back when the body is blank", () => {
		expect(deriveConversationTitle("   \n  ", "New conversation")).toBe("New conversation");
	});
});
