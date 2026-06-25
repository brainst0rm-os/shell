// @vitest-environment jsdom
import { act, useRef, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegionId } from "./region-id";
import { useRegionNavigation } from "./use-region-navigation";

function Harness({ onChange, disabled }: { onChange?: (id: string) => void; disabled?: boolean }) {
	const aRef = useRef<HTMLDivElement>(null);
	const bRef = useRef<HTMLDivElement>(null);
	const cRef = useRef<HTMLDivElement>(null);
	const [active, setActive] = useState<string | null>(null);
	useRegionNavigation({
		regions: [
			{ id: RegionId.DashboardGrid, label: "Dashboard", ref: aRef },
			{ id: RegionId.VaultSwitcher, label: "Vault", ref: bRef },
			{ id: RegionId.SystemTray, label: "Tray", ref: cRef },
		],
		activeRegionId: active,
		onActiveRegionIdChange: (id) => {
			setActive(id);
			onChange?.(id);
		},
		...(disabled !== undefined ? { disabled } : {}),
	});
	return (
		<div>
			<div ref={aRef} tabIndex={-1} data-testid="region-a">
				A
			</div>
			<div ref={bRef} tabIndex={-1} data-testid="region-b">
				B
			</div>
			<div ref={cRef} tabIndex={-1} data-testid="region-c">
				C
			</div>
		</div>
	);
}

describe("useRegionNavigation", () => {
	let host: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
	});

	afterEach(() => {
		act(() => root.unmount());
		host.remove();
	});

	const press = (init: KeyboardEventInit) =>
		document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
	const q = (sel: string) => host.querySelector<HTMLElement>(`[data-testid="${sel}"]`);

	it("F6 advances to the first region and focuses it", () => {
		const onChange = vi.fn();
		act(() => root.render(<Harness onChange={onChange} />));
		act(() => press({ key: "F6" }));
		expect(onChange).toHaveBeenCalledWith(RegionId.DashboardGrid);
		expect(document.activeElement).toBe(q("region-a"));
	});

	it("F6 cycles through regions in order", () => {
		const onChange = vi.fn();
		act(() => root.render(<Harness onChange={onChange} />));
		act(() => press({ key: "F6" }));
		act(() => press({ key: "F6" }));
		act(() => press({ key: "F6" }));
		expect(onChange).toHaveBeenLastCalledWith(RegionId.SystemTray);
		expect(document.activeElement).toBe(q("region-c"));
	});

	it("F6 wraps from the last back to the first", () => {
		const onChange = vi.fn();
		act(() => root.render(<Harness onChange={onChange} />));
		act(() => press({ key: "F6" }));
		act(() => press({ key: "F6" }));
		act(() => press({ key: "F6" }));
		act(() => press({ key: "F6" }));
		expect(onChange).toHaveBeenLastCalledWith(RegionId.DashboardGrid);
	});

	it("Shift+F6 retreats and wraps to the last from empty", () => {
		const onChange = vi.fn();
		act(() => root.render(<Harness onChange={onChange} />));
		act(() => press({ key: "F6", shiftKey: true }));
		expect(onChange).toHaveBeenLastCalledWith(RegionId.SystemTray);
		expect(document.activeElement).toBe(q("region-c"));
	});

	it("disabled=true ignores F6 entirely", () => {
		const onChange = vi.fn();
		act(() => root.render(<Harness onChange={onChange} disabled />));
		act(() => press({ key: "F6" }));
		expect(onChange).not.toHaveBeenCalled();
	});

	it("cleanup removes the document keydown listener", () => {
		const onChange = vi.fn();
		act(() => root.render(<Harness onChange={onChange} />));
		act(() => root.unmount());
		act(() => press({ key: "F6" }));
		expect(onChange).not.toHaveBeenCalled();
	});

	it("F6 lands on the new first region after the active region is removed", () => {
		// Harness with a removable middle region. We start at B, then drop it
		// from the regions array; F6 should land on A (the new first), not skip
		// to C — that was the pre-fix bug where regionInit fell back to A and
		// regionNext advanced one further.
		function RemovableHarness({ onChange }: { onChange: (id: string) => void }) {
			const aRef = useRef<HTMLDivElement>(null);
			const bRef = useRef<HTMLDivElement>(null);
			const cRef = useRef<HTMLDivElement>(null);
			const [removeB, setRemoveB] = useState(false);
			const [active, setActive] = useState<string | null>(RegionId.VaultSwitcher);
			useRegionNavigation({
				regions: removeB
					? [
							{ id: RegionId.DashboardGrid, label: "Dashboard", ref: aRef },
							{ id: RegionId.SystemTray, label: "Tray", ref: cRef },
						]
					: [
							{ id: RegionId.DashboardGrid, label: "Dashboard", ref: aRef },
							{ id: RegionId.VaultSwitcher, label: "Vault", ref: bRef },
							{ id: RegionId.SystemTray, label: "Tray", ref: cRef },
						],
				activeRegionId: active,
				onActiveRegionIdChange: (id) => {
					setActive(id);
					onChange(id);
				},
			});
			return (
				<div>
					<div ref={aRef} tabIndex={-1} data-testid="region-a" />
					{removeB ? null : <div ref={bRef} tabIndex={-1} data-testid="region-b" />}
					<div ref={cRef} tabIndex={-1} data-testid="region-c" />
					<button type="button" onClick={() => setRemoveB(true)} data-testid="remove-b" />
				</div>
			);
		}
		const onChange = vi.fn();
		act(() => root.render(<RemovableHarness onChange={onChange} />));
		act(() => {
			host.querySelector<HTMLButtonElement>('[data-testid="remove-b"]')?.click();
		});
		act(() => press({ key: "F6" }));
		expect(onChange).toHaveBeenLastCalledWith(RegionId.DashboardGrid);
		expect(document.activeElement).toBe(q("region-a"));
	});
});
