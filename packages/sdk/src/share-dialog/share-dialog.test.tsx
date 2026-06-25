// @vitest-environment jsdom
/**
 * Collab-C5 — `<ShareDialog>` over mocked `sharing` + `roster` services:
 * renders the member list, an Owner adds by pasted code (→ `sharing.share`,
 * reloads), revokes a member (→ `sharing.revoke`), and mints their own invite
 * code (→ `sharing.createInvite`). A non-manager sees the read-only list with no
 * add section + no revoke affordances.
 */

import type { RosterMember, RosterService, SharingService } from "@brainstorm/sdk-types";
import { RosterRole } from "@brainstorm/sdk-types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareDialog, type ShareDialogLabels } from "./share-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LABELS: ShareDialogLabels = {
	title: "Share",
	membersHeading: "People with access",
	you: "you",
	roleOwner: "Owner",
	roleEditor: "Can edit",
	roleViewer: "Can view",
	revoke: "Remove",
	addHeading: "Add people",
	codePlaceholder: "Paste an invite code",
	canEdit: "Can edit",
	canView: "Can view",
	add: "Add",
	inviteHeading: "Your invite code",
	getCode: "Get my invite code",
	copy: "Copy",
	copied: "Copied",
	inviteHint: "Share this code so someone can add you.",
	shareFailed: "Couldn't share.",
	revokeFailed: "Couldn't remove.",
	loadFailed: "Couldn't load members.",
	done: "Done",
};

function member(
	pubkey: string,
	role: RosterRole,
	isSelf = false,
	displayName?: string,
): RosterMember {
	return {
		pubkey,
		role,
		isSelf,
		fingerprint: `ed25519:${pubkey}`,
		...(displayName ? { displayName } : {}),
	};
}

const flush = () =>
	act(async () => {
		await Promise.resolve();
	});

/** Set a controlled input's value through React's tracked native setter so its
 *  `onChange` fires (a bare `input.value = …` is invisible to React). */
function typeInto(input: HTMLInputElement, value: string): void {
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
	setter?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ShareDialog", () => {
	let host: HTMLDivElement;
	let root: Root;
	let sharing: {
		createInvite: ReturnType<typeof vi.fn<SharingService["createInvite"]>>;
		share: ReturnType<typeof vi.fn<SharingService["share"]>>;
		revoke: ReturnType<typeof vi.fn<SharingService["revoke"]>>;
	};
	let roster: { members: ReturnType<typeof vi.fn<RosterService["members"]>> };

	beforeEach(() => {
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
		sharing = {
			createInvite: vi.fn<SharingService["createInvite"]>(async () => "INVITE-TOKEN-XYZ"),
			share: vi.fn<SharingService["share"]>(async () => []),
			revoke: vi.fn<SharingService["revoke"]>(async () => []),
		};
		roster = {
			members: vi.fn<RosterService["members"]>(async () => [
				member("owner1", RosterRole.Owner, true, "Mira"),
				member("guest1", RosterRole.Editor, false, "Marcus"),
			]),
		};
	});

	afterEach(() => {
		act(() => root.unmount());
		host.remove();
		vi.restoreAllMocks();
	});

	async function mount(canManage: boolean): Promise<void> {
		await act(async () => {
			root.render(
				<ShareDialog
					entityId="ent_1"
					entityType="brainstorm/Note/v1"
					sharing={sharing}
					roster={roster}
					canManage={canManage}
					labels={LABELS}
					onClose={() => undefined}
				/>,
			);
		});
		await flush();
	}

	const rows = () => host.querySelectorAll<HTMLElement>(".bs-share__member");
	const codeInput = () =>
		host.querySelector<HTMLInputElement>(".bs-share__add .bs-share__code-input");
	const addBtn = () =>
		[...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Add");

	it("renders the member list from roster.members (self tagged)", async () => {
		await mount(true);
		expect(roster.members).toHaveBeenCalledWith("ent_1");
		expect(rows().length).toBe(2);
		expect(host.textContent).toContain("Mira (you)");
		expect(host.textContent).toContain("Marcus");
	});

	it("Owner adds by pasted code → sharing.share with the chosen role, then reloads", async () => {
		await mount(true);
		const input = codeInput();
		if (!input) throw new Error("expected code input for a manager");
		await act(async () => typeInto(input, "PASTED-CODE"));
		await act(async () => addBtn()?.click());
		await flush();
		expect(sharing.share).toHaveBeenCalledWith({
			entityId: "ent_1",
			type: "brainstorm/Note/v1",
			invite: "PASTED-CODE",
			role: RosterRole.Editor,
		});
		// Reloaded after the share (initial mount + post-share).
		expect(roster.members.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it("Owner revokes a non-owner member → sharing.revoke", async () => {
		await mount(true);
		const revokeBtn = host.querySelector<HTMLButtonElement>(".bs-share__revoke");
		if (!revokeBtn) throw new Error("expected a revoke button for the editor");
		await act(async () => revokeBtn.click());
		await flush();
		expect(sharing.revoke).toHaveBeenCalledWith({
			entityId: "ent_1",
			type: "brainstorm/Note/v1",
			member: "guest1",
		});
	});

	it("mints the local invite code through sharing.createInvite", async () => {
		await mount(true);
		const getBtn = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
			(b) => b.textContent === "Get my invite code",
		);
		if (!getBtn) throw new Error("expected the get-code button");
		await act(async () => getBtn.click());
		await flush();
		expect(sharing.createInvite).toHaveBeenCalled();
		const readonly = host.querySelector<HTMLInputElement>(".bs-share__invite .bs-share__code-input");
		expect(readonly?.value).toBe("INVITE-TOKEN-XYZ");
	});

	it("a non-manager sees no add section and no revoke affordances", async () => {
		await mount(false);
		expect(rows().length).toBe(2);
		expect(codeInput()).toBeNull();
		expect(host.querySelector(".bs-share__revoke")).toBeNull();
	});
});
