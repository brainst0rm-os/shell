// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { type Diagnostic, DiagnosticCode, DiagnosticSeverity } from "../logic/diagnostics";
import { renderDiagnosticsList } from "./diagnostics-list";

const t = (key: string, params?: Record<string, string>) =>
	params ? `${key}:${Object.values(params).join(",")}` : key;

function diag(over: Partial<Diagnostic> = {}): Diagnostic {
	return {
		severity: DiagnosticSeverity.Warning,
		code: DiagnosticCode.TrailingWhitespace,
		line: 3,
		...over,
	};
}

describe("renderDiagnosticsList", () => {
	it("shows a clean state with no diagnostics", () => {
		const el = renderDiagnosticsList({ diagnostics: [], t, onReveal: vi.fn() });
		expect(el.querySelector(".editor__diagnostics-head")?.textContent).toBe("diagnostics.clean");
		expect(el.querySelector(".editor__diagnostics-list")).toBeNull();
	});

	it("lists each diagnostic with severity class + line", () => {
		const el = renderDiagnosticsList({
			diagnostics: [
				diag({
					severity: DiagnosticSeverity.Error,
					code: DiagnosticCode.UnmatchedBracket,
					line: 1,
					params: { ch: ")" },
				}),
				diag(),
			],
			t,
			onReveal: vi.fn(),
		});
		expect(el.querySelector(".editor__diagnostic--error")).not.toBeNull();
		expect(el.querySelector(".editor__diagnostic--warning")).not.toBeNull();
		expect(el.querySelectorAll(".editor__diagnostic")).toHaveLength(2);
	});

	it("localises the message from the diagnostic code + params (no baked prose)", () => {
		const el = renderDiagnosticsList({
			diagnostics: [
				diag({ code: DiagnosticCode.UnmatchedBracket, params: { ch: ")" } }),
				diag({ code: DiagnosticCode.TrailingWhitespace }),
			],
			t,
			onReveal: vi.fn(),
		});
		const msgs = [...el.querySelectorAll(".editor__diagnostic-msg")].map((n) => n.textContent);
		expect(msgs).toContain("diagnostics.msg.unmatchedBracket:)");
		expect(msgs).toContain("diagnostics.msg.trailingWhitespace");
	});

	it("reveals the line on click", () => {
		const onReveal = vi.fn();
		const el = renderDiagnosticsList({ diagnostics: [diag({ line: 7 })], t, onReveal });
		el.querySelector<HTMLButtonElement>(".editor__diagnostic")?.click();
		expect(onReveal).toHaveBeenCalledWith(7);
	});
});
