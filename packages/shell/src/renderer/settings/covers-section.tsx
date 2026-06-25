/**
 * Settings → Covers section (B7.2). The vault's uploaded-cover library:
 * preview + delete, plus an upload zone that seeds new content-addressed
 * cover images. Unlike Wallpaper there is no global "apply" — a cover is
 * a per-object property (`properties.cover`), set from the object's own
 * `<CoverPicker>`. This surface is the library manager (the wallpaper /
 * icon-library gallery pattern) so users can prune unused uploads.
 *
 * "Where-used" (which objects reference each cover) lands with the
 * entities-service write half (B7.2c / B7.3); until then this is a
 * straight content store manager.
 */

import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n/t";
import { Button } from "../ui/button";
import { ConfirmVariant, confirm } from "../ui/confirm";
import { IconName } from "../ui/icon";
import { IconButton, IconButtonSize } from "../ui/icon-button";

type UploadedCover = { url: string; thumbUrl: string };

export function CoversSection() {
	const [pendingUpload, setPendingUpload] = useState(false);
	const [uploaded, setUploaded] = useState<readonly UploadedCover[]>([]);

	const refreshUploaded = useCallback(async () => {
		const list = await window.brainstorm.covers.list();
		setUploaded(list.map((entry) => ({ url: entry.url, thumbUrl: entry.thumbUrl })));
	}, []);

	useEffect(() => {
		void refreshUploaded();
	}, [refreshUploaded]);

	const uploadImage = async () => {
		setPendingUpload(true);
		try {
			const result = await window.brainstorm.covers.uploadFromDialog();
			if (result?.url) await refreshUploaded();
		} finally {
			setPendingUpload(false);
		}
	};

	const deleteUploaded = async (url: string) => {
		const confirmed = await confirm({
			title: t("shell.settings.covers.deleteConfirm.title"),
			body: t("shell.settings.covers.deleteConfirm.body"),
			confirmLabel: t("shell.actions.delete"),
			confirmVariant: ConfirmVariant.Destructive,
		});
		if (!confirmed) return;
		const ok = await window.brainstorm.covers.delete(url);
		if (ok) await refreshUploaded();
	};

	return (
		<>
			<section className="settings__section">
				<h4 className="settings__section-title">{t("shell.settings.covers.uploaded")}</h4>
				{uploaded.length > 0 ? (
					<div className="settings__swatch-grid">
						{uploaded.map((entry) => (
							<UploadedCoverSwatch
								key={entry.url}
								thumbUrl={entry.thumbUrl}
								onDelete={() => void deleteUploaded(entry.url)}
							/>
						))}
					</div>
				) : (
					<p className="settings__hint">{t("shell.settings.covers.empty")}</p>
				)}
			</section>

			<section className="settings__section">
				<h4 className="settings__section-title">{t("shell.settings.covers.upload")}</h4>
				<CoverDropzone onUploadClick={uploadImage} pending={pendingUpload} />
			</section>
		</>
	);
}

function UploadedCoverSwatch({
	thumbUrl,
	onDelete,
}: {
	thumbUrl: string;
	onDelete: () => void;
}) {
	return (
		<div className="settings__swatch settings__swatch--uploaded">
			<span
				className="settings__swatch-fill"
				style={{ background: `center / cover no-repeat url(${cssUrl(thumbUrl)})` }}
				aria-hidden="true"
			/>
			<div className="settings__swatch-actions">
				<IconButton
					icon={IconName.Close}
					label={t("shell.settings.covers.deleteUploaded")}
					size={IconButtonSize.Sm}
					onClick={onDelete}
				/>
			</div>
		</div>
	);
}

function cssUrl(value: string | undefined | null): string {
	const safe = value ?? "";
	return `"${safe.replace(/"/g, '\\"')}"`;
}

function CoverDropzone({
	onUploadClick,
	pending,
}: {
	onUploadClick: () => Promise<void> | void;
	pending: boolean;
}) {
	const [dragging, setDragging] = useState(false);

	const handleDragEnter = (e: React.DragEvent) => {
		e.preventDefault();
		if (Array.from(e.dataTransfer.items).some((it) => it.kind === "file")) setDragging(true);
	};
	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = "copy";
	};
	const handleDragLeave = (e: React.DragEvent) => {
		if (e.currentTarget === e.target) setDragging(false);
	};
	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setDragging(false);
		if (e.dataTransfer.files.length > 0) void onUploadClick();
	};

	return (
		<div
			className={`settings__dropzone${dragging ? " settings__dropzone--active" : ""}`}
			onDragEnter={handleDragEnter}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			<p className="settings__dropzone-hint">{t("shell.settings.covers.dropHint")}</p>
			<Button onClick={() => void onUploadClick()} disabled={pending}>
				{pending ? t("shell.common.loading") : t("shell.settings.covers.imageUpload")}
			</Button>
		</div>
	);
}
