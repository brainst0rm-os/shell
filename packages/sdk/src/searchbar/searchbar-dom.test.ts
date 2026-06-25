// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { attachSearchbar } from "./searchbar-dom";

describe("attachSearchbar", () => {
	it("renders a labelled input with the placeholder + aria-label", () => {
		const onChange = vi.fn();
		const h = attachSearchbar({ placeholder: "Find tasks", onChange });

		expect(h.root.tagName).toBe("LABEL");
		expect(h.root.className).toBe("bs-searchbar");
		expect(h.input.type).toBe("search");
		expect(h.input.placeholder).toBe("Find tasks");
		expect(h.input.getAttribute("aria-label")).toBe("Find tasks");
		expect(h.input.autocomplete).toBe("off");
		expect(h.input.spellcheck).toBe(false);
		expect(h.clearButton).toBeNull();
	});

	it("emits onChange on input events", () => {
		const onChange = vi.fn();
		const h = attachSearchbar({ placeholder: "p", onChange });
		h.input.value = "abc";
		h.input.dispatchEvent(new Event("input"));
		expect(onChange).toHaveBeenCalledWith("abc");
	});

	it("renders a hidden clear ✕ until the input has text, then reveals it", () => {
		const onChange = vi.fn();
		const h = attachSearchbar({ placeholder: "p", clearLabel: "Clear", onChange });

		expect(h.clearButton).not.toBeNull();
		const clear = h.clearButton as HTMLButtonElement;
		expect(clear.hidden).toBe(true);

		h.input.value = "x";
		h.input.dispatchEvent(new Event("input"));
		expect(clear.hidden).toBe(false);

		h.input.value = "";
		h.input.dispatchEvent(new Event("input"));
		expect(clear.hidden).toBe(true);
	});

	it('clicking ✕ resets value, fires onChange(""), and refocuses the input', () => {
		const onChange = vi.fn();
		const h = attachSearchbar({
			placeholder: "p",
			clearLabel: "Clear",
			initialValue: "hello",
			onChange,
		});
		document.body.appendChild(h.root);
		expect(h.clearButton?.hidden).toBe(false);

		h.clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(h.input.value).toBe("");
		expect(onChange).toHaveBeenCalledWith("");
		expect(h.clearButton?.hidden).toBe(true);
		expect(document.activeElement).toBe(h.input);
	});

	it("setValue updates the input WITHOUT firing onChange and syncs ✕ visibility", () => {
		const onChange = vi.fn();
		const h = attachSearchbar({ placeholder: "p", clearLabel: "Clear", onChange });

		h.setValue("typed");
		expect(h.input.value).toBe("typed");
		expect(h.getValue()).toBe("typed");
		expect(h.clearButton?.hidden).toBe(false);
		expect(onChange).not.toHaveBeenCalled();

		h.setValue("");
		expect(h.clearButton?.hidden).toBe(true);
	});

	it("dispose removes input + clear listeners", () => {
		const onChange = vi.fn();
		const h = attachSearchbar({ placeholder: "p", clearLabel: "Clear", onChange });
		h.dispose();
		h.input.value = "z";
		h.input.dispatchEvent(new Event("input"));
		expect(onChange).not.toHaveBeenCalled();
	});

	it("honors a custom onClear handler", () => {
		const onClear = vi.fn();
		const onChange = vi.fn();
		const h = attachSearchbar({
			placeholder: "p",
			clearLabel: "Clear",
			initialValue: "x",
			onChange,
			onClear,
		});
		h.clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(onClear).toHaveBeenCalled();
		expect(onChange).not.toHaveBeenCalled();
		expect(h.input.value).toBe("x");
	});
});
