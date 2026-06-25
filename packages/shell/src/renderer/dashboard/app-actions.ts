/**
 * Shared dashboard app actions — the one uninstall flow used by every surface
 * that can remove an app (the dashboard icon context menu and the all-apps
 * grid context menu). Keeps the confirm → uninstall → toast sequence in a
 * single place so the two menus can't drift on wording or behaviour.
 */

import { t } from "../i18n/t";
import { ConfirmVariant, confirm } from "../ui/confirm";
import { ToastKind, pushToast } from "../ui/toasts";

/** Confirm, then uninstall the app and report the outcome via a toast. */
export async function confirmAndUninstallApp(appId: string, appName: string): Promise<void> {
	const accepted = await confirm({
		title: t("shell.dashboard.iconMenu.uninstallConfirm.title", { name: appName }),
		body: t("shell.dashboard.iconMenu.uninstallConfirm.body", { name: appName }),
		confirmLabel: t("shell.dashboard.iconMenu.uninstall"),
		confirmVariant: ConfirmVariant.Destructive,
	});
	if (!accepted) return;
	const result = await window.brainstorm.apps.uninstall(appId);
	if (result.ok) {
		pushToast({
			kind: ToastKind.Success,
			title: t("shell.dashboard.iconMenu.uninstallToast.title"),
			body: t("shell.dashboard.iconMenu.uninstallToast.body", { name: appName }),
		});
	} else {
		pushToast({
			kind: ToastKind.Error,
			title: t("shell.dashboard.iconMenu.uninstallToast.failTitle"),
			body: result.reason ?? "Unknown error",
		});
	}
}
