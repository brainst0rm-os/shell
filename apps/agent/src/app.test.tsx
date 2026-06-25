// @vitest-environment jsdom
/**
 * Agent chrome smoke test — the header carries the object ⋯ menu LAST in
 * `.app-header__right` (the cross-app contract): disabled with no active
 * conversation, live once one exists.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentApp, unavailableMessage } from "./app";
import { flush, renderInto } from "./test/render";

describe("unavailableMessage (F-259 provider-aware guidance)", () => {
	it("points the local model at `ollama serve`", () => {
		const msg = unavailableMessage("ollama");
		expect(msg).toContain("ollama serve");
		expect(msg).not.toContain("API key");
	});

	it("points a cloud provider at its API key, named", () => {
		const msg = unavailableMessage("anthropic");
		expect(msg).toContain("API key");
		expect(msg).toContain("Anthropic Claude");
		expect(msg).not.toContain("ollama serve");
	});

	it("gives general setup guidance for AUTO (no pinned provider)", () => {
		const msg = unavailableMessage(undefined);
		expect(msg).toContain("No AI model could be reached");
		expect(msg).not.toContain("ollama serve");
	});

	it("falls back to the bare id for an unknown cloud provider", () => {
		const msg = unavailableMessage("mystery");
		expect(msg).toContain("mystery");
		expect(msg).toContain("API key");
	});
});

let handle: Awaited<ReturnType<typeof renderInto>> | null = null;

beforeEach(() => {
	// jsdom has no scrollIntoView; the transcript auto-scroll calls it.
	Element.prototype.scrollIntoView = vi.fn();
});

afterEach(async () => {
	await handle?.unmount();
	handle = null;
	window.brainstorm = undefined;
});

function installShell(conversations: Array<{ id: string; title: string }>): void {
	const snapshot = {
		entities: conversations.map((c) => ({
			id: c.id,
			type: "brainstorm/Conversation/v1",
			properties: { title: c.title },
			createdAt: 1,
			updatedAt: 1,
			deletedAt: null,
			ownerAppId: "io.brainstorm.agent",
		})),
		links: [],
	};
	window.brainstorm = {
		capabilities: [],
		services: {
			vaultEntities: {
				list: async () => snapshot,
				onChange: () => ({ unsubscribe: () => undefined }),
			},
		},
	} as unknown as typeof window.brainstorm;
}

describe("AgentApp header", () => {
	it("standalone: the ⋯ is the LAST element of .app-header__right and disabled (no conversation)", async () => {
		handle = await renderInto(<AgentApp />);
		await flush();
		const right = handle.container.querySelector<HTMLElement>(".app-header__right");
		expect(right).not.toBeNull();
		const last = right?.lastElementChild as HTMLButtonElement;
		expect(last.classList.contains("bs-object-menu__more")).toBe(true);
		// F-271: the unavailable ⋯ uses aria-disabled (NOT native `disabled`) so it
		// stays hoverable/focusable for its explanatory tooltip.
		expect(last.disabled).toBe(false);
		expect(last.getAttribute("aria-disabled")).toBe("true");
		// New chat stays first — content action before the ⋯.
		expect(right?.firstElementChild?.getAttribute("aria-label")).toBe("New chat");
	});

	it("with an active conversation the ⋯ is enabled and still LAST", async () => {
		installShell([{ id: "conv_1", title: "Renewals" }]);
		handle = await renderInto(<AgentApp />);
		await flush();
		await flush();
		const right = handle.container.querySelector<HTMLElement>(".app-header__right");
		const last = right?.lastElementChild as HTMLButtonElement;
		expect(last.classList.contains("bs-object-menu__more")).toBe(true);
		expect(last.disabled).toBe(false);
		expect(handle.container.querySelector(".app-header__title")?.textContent).toBe("Renewals");
	});
});

describe("AgentApp composer context", () => {
	function installWithMessage(): void {
		const snapshot = {
			entities: [
				{
					id: "conv_1",
					type: "brainstorm/Conversation/v1",
					properties: { title: "Renewals" },
					createdAt: 1,
					updatedAt: 1,
					deletedAt: null,
					ownerAppId: "io.brainstorm.agent",
				},
				{
					id: "msg_1",
					type: "brainstorm/Message/v1",
					properties: {
						conversation: "conv_1",
						role: "user",
						body: "what does this say?",
						createdAt: "2026-06-20T00:00:00.000Z",
						seq: 0,
						attachments: [
							{ kind: "entity", ref: "ent_1", label: "Q3 Spec", entityType: "brainstorm/Note/v1" },
						],
					},
					createdAt: 2,
					updatedAt: 2,
					deletedAt: null,
					ownerAppId: "io.brainstorm.agent",
				},
			],
			links: [],
		};
		window.brainstorm = {
			capabilities: ["entities.read:*"],
			services: {
				vaultEntities: {
					list: async () => snapshot,
					onChange: () => ({ unsubscribe: () => undefined }),
				},
			},
		} as unknown as typeof window.brainstorm;
	}

	it("renders the add-context button in the composer", async () => {
		installShell([{ id: "conv_1", title: "Renewals" }]);
		handle = await renderInto(<AgentApp />);
		await flush();
		await flush();
		const attach = handle.container.querySelector(".bs-composer-context__attach");
		expect(attach).not.toBeNull();
		expect(attach?.getAttribute("aria-label")).toBe("Add context");
	});

	it("renders attachment chips on a persisted user turn, labelled and clickable", async () => {
		installWithMessage();
		handle = await renderInto(<AgentApp />);
		await flush();
		await flush();
		const rail = handle.container.querySelector('[data-testid="agent-attachments"]');
		expect(rail).not.toBeNull();
		const chip = rail?.querySelector(".agent__attachment--link") as HTMLButtonElement;
		expect(chip).not.toBeNull();
		expect(chip.textContent).toContain("Q3 Spec");
		expect(chip.getAttribute("data-bs-tooltip")).toBe("Open Q3 Spec");
		expect(chip.getAttribute("aria-label")).toBe("Open Q3 Spec");
	});
});
