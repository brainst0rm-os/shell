// @vitest-environment jsdom
/**
 * Tests for the React `<Checkbox>` — the twin of `createCheckbox`. Asserts the
 * shared chrome (label + painted box over a hidden native input), the
 * controlled checked / indeterminate / disabled states, and the boolean
 * `onChange` flow, so every app's checkbox stays identical.
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Checkbox } from "./checkbox";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
});

const input = () => host.querySelector<HTMLInputElement>(".checkbox__input");

describe("<Checkbox>", () => {
	it("renders the shared chrome with the label", () => {
		act(() => root.render(<Checkbox label="Enable" checked={false} onChange={() => {}} />));
		expect(host.querySelector("label.checkbox")).not.toBeNull();
		expect(host.querySelector(".checkbox__box")).not.toBeNull();
		expect(host.querySelector(".checkbox__label")?.textContent).toBe("Enable");
	});

	it("reflects the controlled checked state on the native input", () => {
		act(() => root.render(<Checkbox checked ariaLabel="x" onChange={() => {}} />));
		expect(input()?.checked).toBe(true);
	});

	it("emits the new boolean on toggle", () => {
		const onChange = vi.fn();
		act(() => root.render(<Checkbox checked={false} ariaLabel="x" onChange={onChange} />));
		const el = input();
		if (!el) throw new Error("missing input");
		act(() => el.click());
		expect(onChange).toHaveBeenCalledWith(true);
	});

	it("drives the native indeterminate flag", () => {
		act(() =>
			root.render(<Checkbox checked={false} indeterminate ariaLabel="x" onChange={() => {}} />),
		);
		expect(input()?.indeterminate).toBe(true);
	});

	it("marks the disabled state on label and input", () => {
		act(() => root.render(<Checkbox checked={false} disabled ariaLabel="x" onChange={() => {}} />));
		expect(host.querySelector("label.checkbox--disabled")).not.toBeNull();
		expect(input()?.disabled).toBe(true);
	});

	it("forwards className and testId", () => {
		act(() =>
			root.render(
				<Checkbox checked={false} ariaLabel="x" className="custom" testId="cb" onChange={() => {}} />,
			),
		);
		expect(host.querySelector("label.checkbox.custom")).not.toBeNull();
		expect(host.querySelector('[data-testid="cb"]')).not.toBeNull();
	});
});
