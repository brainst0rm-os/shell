/**
 * Stage 10.7 — dashboard sync-status chip.
 *
 * One chip in the dashboard's right-hand action group: icon + 1-word
 * label colored by `SyncState`. Click opens `<SyncStatusPopover>`.
 * `aria-live="polite"` so screen readers hear state transitions
 * without focus theft. Quiet styling in `LocalOnly` per OQ-210 (no
 * badge, dim icon) — the chip stays discoverable for users who later
 * pair a device.
 *
 * Per the chip-is-a-pure-render rule: this component only reads the
 * hook + dispatches an `onOpen` callback. Mounting the popover is the
 * caller's job (the dashboard owns the `AnimatePresence`).
 */

import { AnimatePresence } from "framer-motion";
import { useState } from "react";
import { t } from "../i18n/t";
import { Icon, IconName } from "../ui/icon";
import { SyncStatusPopover } from "./sync-status-popover";
import { SyncState, type SyncStatusSnapshot, useSyncStatus } from "./use-sync-status";

export type SyncStatusChipProps = {
	/** Test hook — when omitted, the chip reads from `useSyncStatus`.
	 *  When provided, the chip skips the hook and uses the override.
	 *  Stories + tests use this to pin a state. */
	override?: {
		snapshot: SyncStatusSnapshot | null;
		derivedState: SyncState | null;
	};
};

export function iconForState(state: SyncState): IconName {
	switch (state) {
		case SyncState.LocalOnly:
			return IconName.Lock;
		case SyncState.Syncing:
			return IconName.Cloud;
		case SyncState.Stale:
		case SyncState.Offline:
			return IconName.CloudSlash;
		case SyncState.Error:
			return IconName.Warning;
	}
}

export function SyncStatusChip({ override }: SyncStatusChipProps = {}) {
	const live = useSyncStatus();
	const data = override ?? live;
	const [open, setOpen] = useState(false);

	const state = data.derivedState;
	if (!state) return null;

	const label = t(`shell.dashboard.syncStatus.state.${state}`);
	const isLocalOnly = state === SyncState.LocalOnly;

	return (
		<>
			<button
				type="button"
				className={`sync-status-chip sync-status-chip--${state}${isLocalOnly ? " sync-status-chip--quiet" : ""}`}
				onClick={() => setOpen(true)}
				aria-label={t("shell.dashboard.syncStatus.chipLabel")}
				data-testid="sync-status-chip"
				data-state={state}
			>
				<Icon name={iconForState(state)} size={16} />
				<span
					className="sync-status-chip__label"
					aria-live="polite"
					data-testid="sync-status-chip-label"
				>
					{label}
				</span>
			</button>
			<AnimatePresence>
				{open && (
					<SyncStatusPopover
						key="sync-status-popover"
						snapshot={data.snapshot}
						derivedState={state}
						onClose={() => setOpen(false)}
					/>
				)}
			</AnimatePresence>
		</>
	);
}
