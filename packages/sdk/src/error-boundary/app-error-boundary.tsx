/**
 * AppErrorBoundary — the last-resort net for a sandboxed app's React tree.
 *
 * Without one, a single render-time throw (a malformed entity, an unexpected
 * null on a cold path) unmounts the WHOLE tree and the app paints blank — the
 * user sees "nothing", with no clue what failed. This catches the throw,
 * surfaces the message + a reload affordance, and logs the component stack to
 * the console (so the shell's error-log capture + DevTools both get it).
 *
 * Mount it once per app in `main.tsx`, directly around the root component.
 * Labels default to English; pass `labels` to route them through the app's
 * own `t()`.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import "./app-error-boundary.css";

export type AppErrorBoundaryLabels = {
	title: string;
	reload: string;
};

const DEFAULT_LABELS: AppErrorBoundaryLabels = {
	title: "Something went wrong",
	reload: "Reload",
};

export type AppErrorBoundaryProps = {
	children: ReactNode;
	/** App id for the console log prefix (e.g. "calendar"). */
	appName?: string;
	labels?: Partial<AppErrorBoundaryLabels>;
};

type State = { error: Error | null };

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, State> {
	override state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error(`[${this.props.appName ?? "app"}] render error:`, error, info.componentStack);
	}

	override render(): ReactNode {
		const { error } = this.state;
		if (!error) return this.props.children;
		const labels = { ...DEFAULT_LABELS, ...this.props.labels };
		return (
			<div className="bs-app-error" role="alert">
				<div className="bs-app-error__panel">
					{/* Self-contained glyph — an error state must paint even when the
					    icon registry / providers are the thing that failed. */}
					<svg
						className="bs-app-error__icon"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth={1.75}
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
						focusable="false"
					>
						<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
						<line x1="12" y1="9" x2="12" y2="13" />
						<line x1="12" y1="17" x2="12.01" y2="17" />
					</svg>
					<h1 className="bs-app-error__title">{labels.title}</h1>
					<p className="bs-app-error__message">{error.message || String(error)}</p>
					<button
						type="button"
						className="bs-btn"
						data-bs-primary=""
						onClick={() => window.location.reload()}
					>
						{labels.reload}
					</button>
				</div>
			</div>
		);
	}
}
