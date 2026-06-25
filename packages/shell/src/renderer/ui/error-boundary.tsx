/**
 * ErrorBoundary — catches render-time exceptions from any React subtree and
 * surfaces them as a recovery card instead of crashing the whole renderer.
 *
 * The card shows the error message, the full stack + React component stack in a
 * scrollable trace area, and a Copy button (so a bug report carries the trace
 * verbatim). Also forwards the error to the toast host so the user sees a
 * transient notification (matches `window.onerror` / `unhandledrejection`
 * handling wired in `error-bridge.ts`).
 *
 * Wrap the App root in this; place additional ones around large subtrees
 * that ought to fail independently (Settings, Launcher, app windows).
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n/t";
import { Button } from "./button";
import { ToastKind, pushToast } from "./toasts";

type State = { error: Error | null; componentStack: string | null; copied: boolean };

type Props = {
	children: ReactNode;
	/** Optional override for the fallback UI. Receives the captured error and
	 *  a reset() that re-mounts the subtree. */
	fallback?: (error: Error, reset: () => void) => ReactNode;
};

export class ErrorBoundary extends Component<Props, State> {
	override state: State = { error: null, componentStack: null, copied: false };
	private copiedTimer: ReturnType<typeof setTimeout> | null = null;

	static getDerivedStateFromError(error: Error): Partial<State> {
		return { error };
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error("[brainstorm] React error boundary caught:", error, info);
		this.setState({ componentStack: info.componentStack ?? null });
		pushToast({
			kind: ToastKind.Error,
			title: "Something went wrong",
			body: error.message || String(error),
		});
	}

	override componentWillUnmount(): void {
		if (this.copiedTimer) clearTimeout(this.copiedTimer);
	}

	/** The full copyable trace: stack first, then the React component stack
	 *  (which names the failing component — e.g. `at LocaleGate`). */
	private traceText(): string {
		const { error, componentStack } = this.state;
		if (!error) return "";
		const head = error.stack ?? `${error.name}: ${error.message}`;
		return componentStack ? `${head}\n\nComponent stack:${componentStack}` : head;
	}

	private copyTrace = (): void => {
		void navigator.clipboard?.writeText(this.traceText())?.then(
			() => {
				this.setState({ copied: true });
				if (this.copiedTimer) clearTimeout(this.copiedTimer);
				this.copiedTimer = setTimeout(() => this.setState({ copied: false }), 2000);
			},
			() => {
				/* clipboard blocked — the trace stays selectable for manual copy */
			},
		);
	};

	reset = (): void => {
		if (this.copiedTimer) clearTimeout(this.copiedTimer);
		this.copiedTimer = null;
		this.setState({ error: null, componentStack: null, copied: false });
	};

	override render(): ReactNode {
		const { error, copied } = this.state;
		if (!error) return this.props.children;
		if (this.props.fallback) return this.props.fallback(error, this.reset);
		return (
			<div className="error-boundary" role="alert">
				<div className="error-boundary__inner">
					<h2 className="error-boundary__title">{t("shell.errorBoundary.title")}</h2>
					<p className="error-boundary__message">{error.message || String(error)}</p>
					<pre className="error-boundary__trace" aria-label={t("shell.errorBoundary.trace")}>
						{this.traceText()}
					</pre>
					<div className="error-boundary__actions">
						<Button onClick={this.copyTrace}>
							{copied ? t("shell.errorBoundary.copied") : t("shell.errorBoundary.copy")}
						</Button>
						<Button onClick={this.reset}>{t("shell.errorBoundary.retry")}</Button>
					</div>
				</div>
			</div>
		);
	}
}
