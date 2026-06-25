/**
 * OS-native notification bridge (settings overhaul, Track C). Raises an
 * Electron `Notification` for an app notification when the shell window is not
 * focused — when it *is* focused the bell + dock unread badges already cover
 * it, so a native popup would be redundant and noisy.
 *
 * Electron is imported here (the only place), mirroring how the tray's Electron
 * `Tray`/`Menu` wiring is isolated. The pure `UiNotifyHost` calls this through
 * an injected `osNotify` dependency, so the host itself stays Electron-free and
 * unit-testable. Global on/off + DND/mute gating happen in the host before this
 * is ever called; this layer only adds the focus guard + the actual OS call.
 */

import { Notification } from "electron";
import type { UiNotification } from "./notify-host";

export type OsNotifierOptions = {
	/** True when a shell/app window currently has focus — used to skip the
	 *  redundant native popup. */
	isShellFocused: () => boolean;
};

/** Build the `osNotify` dependency for the `UiNotifyHost`. Returns a no-op when
 *  the platform doesn't support notifications. */
export function makeOsNotifier(options: OsNotifierOptions): (notification: UiNotification) => void {
	return (notification: UiNotification) => {
		try {
			if (!Notification.isSupported()) return;
			if (options.isShellFocused()) return;
			const native = new Notification({
				title: notification.title,
				...(notification.body !== undefined ? { body: notification.body } : {}),
				silent: false,
			});
			native.show();
		} catch (error) {
			// A native-notification failure must never break the post path.
			console.warn("[brainstorm] OS notification failed", error);
		}
	};
}
