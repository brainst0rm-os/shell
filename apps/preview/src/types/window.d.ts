import type { PreviewContextSibling } from "../host/runtime";
import type { PreviewContext } from "./preview-context";

declare global {
	interface Window {
		/** Dev-only console / Playwright probe. Stable surface stripped in a
		 *  future hardening pass — not part of the public API. */
		__previewHost?:
			| {
					getCursor: () => number;
					goTo: (index: number) => void;
					focusById: (id: string) => void;
					getContextLabel: () => string | null;
					applyContext: (
						context: PreviewContext | null,
						siblings?: ReadonlyArray<PreviewContextSibling>,
						focusId?: string,
					) => void;
			  }
			| undefined;
	}
}
