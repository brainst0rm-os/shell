/**
 * `<Welcome>` menu — the join-vault entry is reachable on first run (pairing a
 * brand-new device is a first-run path); only the recent-vaults list is gated
 * on an existing vault. Rendered at the SSR layer (effects are no-ops there).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultEntry } from "../../preload";

const allVaults: VaultEntry[] = [];

vi.mock("../vault-context", () => ({
	useVault: () => ({
		current: null,
		allVaults,
		create: vi.fn(),
		openByPath: vi.fn(),
		pickFolder: vi.fn(),
		defaultPath: vi.fn().mockResolvedValue(""),
		checkPath: vi.fn().mockResolvedValue(null),
		activate: vi.fn(),
	}),
}));

const { Welcome, isVaultNameTaken } = await import("./welcome");

function fakeVault(id: string): VaultEntry {
	return {
		id,
		name: `Vault ${id}`,
		color: "#14b8a6",
		path: `/vaults/${id}`,
		lastOpenedAt: 1_700_000_000_000,
		format: "1.0",
	};
}

beforeEach(() => {
	allVaults.length = 0;
});

afterEach(() => {
	allVaults.length = 0;
});

describe("Welcome menu", () => {
	it("shows the join-vault entry on first run (no vaults) but hides the recent list", () => {
		const html = renderToStaticMarkup(<Welcome />);
		expect(html).toContain('data-testid="welcome-join-vault"');
		expect(html).not.toContain("welcome__recent");
	});

	it("shows the 'Migrating from…' entry on first run (IE-3)", () => {
		const html = renderToStaticMarkup(<Welcome />);
		expect(html).toContain('data-testid="welcome-migrate"');
	});

	it("shows the recent list once a vault exists (join entry stays visible)", () => {
		allVaults.push(fakeVault("a"));
		const html = renderToStaticMarkup(<Welcome />);
		expect(html).toContain('data-testid="welcome-join-vault"');
		expect(html).toContain("welcome__recent");
	});
});

describe("isVaultNameTaken", () => {
	const vaults = [{ name: "Personal" }, { name: "Work Notes" }];

	it("flags an existing name case- and whitespace-insensitively", () => {
		expect(isVaultNameTaken(vaults, "Personal")).toBe(true);
		expect(isVaultNameTaken(vaults, "  personal ")).toBe(true);
		expect(isVaultNameTaken(vaults, "WORK NOTES")).toBe(true);
	});

	it("allows a fresh or empty name", () => {
		expect(isVaultNameTaken(vaults, "Research")).toBe(false);
		expect(isVaultNameTaken(vaults, "")).toBe(false);
		expect(isVaultNameTaken(vaults, "   ")).toBe(false);
		expect(isVaultNameTaken([], "Personal")).toBe(false);
	});
});
