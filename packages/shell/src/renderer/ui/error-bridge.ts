/**
 * Renderer-side global error bridge — catches every uncaught exception and
 * promise rejection that escapes React's render path and pushes a toast so
 * the user sees it without needing DevTools open.
 *
 * Call `installErrorBridge()` once at app boot (`main.tsx`).
 */

import { ToastKind, pushToast } from "./toasts";

let installed = false;

export function installErrorBridge(): void {
	if (installed) return;
	installed = true;

	window.addEventListener("error", (event) => {
		const message = pickMessage(event.error, event.message);
		console.error("[brainstorm] window.onerror:", event.error ?? event.message);
		pushToast({ kind: ToastKind.Error, title: "Unexpected error", body: message });
	});

	window.addEventListener("unhandledrejection", (event) => {
		const reason = (event as PromiseRejectionEvent).reason;
		const message = pickMessage(reason, "Unhandled promise rejection");
		console.error("[brainstorm] unhandledrejection:", reason);
		pushToast({ kind: ToastKind.Error, title: "Unexpected error", body: message });
	});

	// Main-process exceptions ride the `main:error` IPC channel out of
	// `main/index.ts` and land here so back-end crashes are visible too.
	const bridge = window.brainstorm;
	if (bridge?.mainErrors) {
		bridge.mainErrors.on(({ message }) => {
			pushToast({ kind: ToastKind.Error, title: "Background process error", body: message });
		});
	}
}

function pickMessage(value: unknown, fallback: string): string {
	if (value instanceof Error) return value.message || fallback;
	if (typeof value === "string") return value;
	if (value && typeof value === "object" && "message" in value) {
		const m = (value as { message?: unknown }).message;
		if (typeof m === "string") return m;
	}
	return fallback;
}
