/**
 * Feedback-3 v2 — auto-popup on changelog version bump.
 *
 * Surfaces once per dashboard mount when the bundled changelog's newest
 * release is strictly newer than the vault's `lastSeenChangelogVersion`
 * snapshot field. Any dismiss path (Got it, Escape, backdrop click)
 * writes the newest version through the dashboard bridge so the popover
 * stays hidden until the next bundled release ships.
 *
 * The popover defaults to showing the newest release but lets the user
 * page back through every release in the bundle via Previous / Next.
 * It's the only surface for the changelog — Settings doesn't carry a
 * What's-new section anymore.
 *
 * Decide-once: the gating runs the first time both the snapshot and the
 * changelog are ready. Subsequent snapshot pushes never re-open the
 * popover, otherwise `lastSeenChangelogVersion` flipping under us would
 * unmount + remount the surface.
 */

import { AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Changelog, ChangelogRelease } from "../../preload";
import { t } from "../i18n/t";
import { useShortcut } from "../shortcuts/use-shortcut";
import { Button, ButtonVariant } from "../ui/button";
import { Popover } from "../ui/popover";
import { PopoverBodyPadding, PopoverSize } from "../ui/popover-types";
import { pickPopoverRelease } from "./changelog-gating";
import "./whats-new-popover.css";
import { WhatsNewRelease } from "./whats-new-release";

export type WhatsNewPopoverProps = {
	/** Snapshot field; `null`/`undefined` means the user has never opened
	 *  the changelog. The component waits for `snapshotReady` before
	 *  consulting it. */
	readonly lastSeenChangelogVersion: string | null | undefined;
	/** `true` once the first dashboard snapshot has arrived. Without it
	 *  every user would briefly see the popover on every restart. */
	readonly snapshotReady: boolean;
	/** Monotonic counter — the parent increments it to force the popover
	 *  open from outside (Help → "See what's new"). Each new value re-opens
	 *  on the newest release regardless of `lastSeenChangelogVersion`, so a
	 *  user who already dismissed it can still revisit. Bumping below the
	 *  current value is a no-op. */
	readonly manualOpenSignal?: number;
	/** Injection seam for tests + a future "see the popup again" devtool
	 *  — exposes the IPC fetch so the component stays a thin shell. */
	readonly fetchChangelog?: () => Promise<Changelog>;
	/** Injection seam mirroring `fetchChangelog`. */
	readonly recordSeenVersion?: (version: string) => Promise<void>;
};

export function WhatsNewPopover({
	lastSeenChangelogVersion,
	snapshotReady,
	manualOpenSignal,
	fetchChangelog,
	recordSeenVersion,
}: WhatsNewPopoverProps) {
	const [changelog, setChangelog] = useState<Changelog | null>(null);
	const [openingRelease, setOpeningRelease] = useState<ChangelogRelease | null>(null);
	const [pageIndex, setPageIndex] = useState(0);
	const decidedRef = useRef(false);
	const lastManualSignalRef = useRef<number | undefined>(manualOpenSignal);

	const fetchRef = useRef(fetchChangelog);
	fetchRef.current = fetchChangelog;
	const recordRef = useRef(recordSeenVersion);
	recordRef.current = recordSeenVersion;

	useEffect(() => {
		let cancelled = false;
		const doFetch = fetchRef.current ?? (() => window.brainstorm.help.getChangelog());
		void doFetch()
			.then((next) => {
				if (!cancelled) setChangelog(next);
			})
			.catch(() => {
				// Fetch errors keep the popover hidden — Settings → What's new
				// surfaces the same error to anyone who navigates there.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (decidedRef.current) return;
		if (!snapshotReady) return;
		if (changelog === null) return;
		decidedRef.current = true;
		const picked = pickPopoverRelease(changelog, lastSeenChangelogVersion);
		if (picked) {
			setOpeningRelease(picked);
			const newestIndex = changelog.releases.findIndex((r) => r.version === picked.version);
			setPageIndex(newestIndex >= 0 ? newestIndex : 0);
		}
	}, [changelog, snapshotReady, lastSeenChangelogVersion]);

	useEffect(() => {
		if (manualOpenSignal === undefined) return;
		if (manualOpenSignal === lastManualSignalRef.current) return;
		if (!changelog || changelog.releases.length === 0) return;
		const newest = changelog.releases[0];
		if (!newest) return;
		// Only record the signal AFTER we know we'll act on it; otherwise a
		// click fired before the changelog fetch resolves is silently swallowed
		// — the ref would skip the replay-on-load that the `changelog` dep
		// triggers.
		lastManualSignalRef.current = manualOpenSignal;
		setOpeningRelease(newest);
		setPageIndex(0);
	}, [manualOpenSignal, changelog]);

	const releases = changelog?.releases ?? [];
	const totalPages = releases.length;
	const safeIndex = Math.min(Math.max(pageIndex, 0), Math.max(totalPages - 1, 0));
	const currentRelease = releases[safeIndex] ?? null;

	const newestVersionToRecord = useMemo(() => openingRelease?.version ?? null, [openingRelease]);

	const markSeenAndClose = () => {
		if (newestVersionToRecord === null) return;
		const record =
			recordRef.current ??
			((version: string) => window.brainstorm.dashboard.setLastSeenChangelogVersion(version));
		void record(newestVersionToRecord).catch((err) => {
			// Non-fatal — the gate retries on the next dashboard mount.
			console.warn("[shell] setLastSeenChangelogVersion failed:", err);
		});
		setOpeningRelease(null);
	};

	const canPrev = safeIndex < totalPages - 1; // older
	const canNext = safeIndex > 0; // newer
	const goPrev = () => {
		if (canPrev) setPageIndex(safeIndex + 1);
	};
	const goNext = () => {
		if (canNext) setPageIndex(safeIndex - 1);
	};

	const popoverOpen = openingRelease !== null && currentRelease !== null;
	useShortcut("shell/popover.confirm", markSeenAndClose, { enabled: popoverOpen });
	useShortcut("shell/list.previous-horizontal", goPrev, { enabled: popoverOpen && canPrev });
	useShortcut("shell/list.next-horizontal", goNext, { enabled: popoverOpen && canNext });

	return (
		<AnimatePresence mode="wait">
			{popoverOpen && currentRelease !== null && (
				<Popover
					key="whats-new-popover"
					title={t("shell.whatsNew.popover.title")}
					onClose={markSeenAndClose}
					size={PopoverSize.Large}
					bodyPadding={PopoverBodyPadding.Comfortable}
					testId="whats-new-popover"
					footer={
						<div className="whats-new-popover__actions">
							<div className="whats-new-popover__pager">
								<Button
									variant={ButtonVariant.Ghost}
									onClick={goPrev}
									disabled={!canPrev}
									data-testid="whats-new-popover-prev"
								>
									{t("shell.whatsNew.popover.previous")}
								</Button>
								{totalPages > 1 && (
									<span className="whats-new-popover__pager-indicator" aria-live="polite">
										{t("shell.whatsNew.popover.pageIndicator", {
											current: totalPages - safeIndex,
											total: totalPages,
										})}
									</span>
								)}
								<Button
									variant={ButtonVariant.Ghost}
									onClick={goNext}
									disabled={!canNext}
									data-testid="whats-new-popover-next"
								>
									{t("shell.whatsNew.popover.next")}
								</Button>
							</div>
							<div className="whats-new-popover__primary">
								<Button variant={ButtonVariant.Primary} onClick={markSeenAndClose}>
									{t("shell.whatsNew.popover.dismiss")}
								</Button>
							</div>
						</div>
					}
				>
					<WhatsNewRelease release={currentRelease} />
				</Popover>
			)}
		</AnimatePresence>
	);
}
