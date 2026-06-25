/**
 * Settings → AI panel (11.9). Manages BYO cloud-provider API keys through the
 * privileged dashboard bridge (`window.brainstorm.aiSettings`) — the dashboard
 * is not a sandboxed app, so it uses direct ipcMain, not the broker. The raw
 * key is write-only: we send it on Save and only ever read back a
 * configured/not boolean, never the key itself (11.6 custody). The local model
 * (Ollama) needs no key, so it isn't listed here.
 */

import {
	ANTHROPIC_PROVIDER_ID,
	GEMINI_PROVIDER_ID,
	GLM_PROVIDER_ID,
	MISTRAL_PROVIDER_ID,
	OPENAI_PROVIDER_ID,
} from "@brainstorm/sdk-types";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AiSettingsView } from "../../preload";
import { t } from "../i18n/t";
import { Button, ButtonSize, ButtonVariant } from "../ui/button";
import { Popover } from "../ui/popover";
import { PopoverBodyPadding, PopoverSize } from "../ui/popover-types";
import { McpServersSection } from "./mcp-panel";
import { SettingRow, SettingSelect } from "./settings-controls";
import "./ai-panel.css";

/** Sentinel select value for "no pinned default" (the built-in local model). */
const AUTO_ROUTING_VALUE = "auto";

/** A managed cloud provider. `monogram` is the single-glyph avatar face; the
 *  per-provider accent is keyed off `id` via CSS `data-provider`. */
type ProviderMeta = {
	id: string;
	nameKey: string;
	hintKey: string;
	monogram: string;
};

/** The cloud providers whose keys this panel manages (mirrors the main-side
 *  `KNOWN_CLOUD_PROVIDER_IDS`). Label/help are i18n; the id is the wire value. */
const CLOUD_PROVIDERS: ReadonlyArray<ProviderMeta> = [
	{
		id: ANTHROPIC_PROVIDER_ID,
		nameKey: "shell.settings.ai.anthropic.name",
		hintKey: "shell.settings.ai.anthropic.hint",
		monogram: "A",
	},
	{
		id: OPENAI_PROVIDER_ID,
		nameKey: "shell.settings.ai.openai.name",
		hintKey: "shell.settings.ai.openai.hint",
		monogram: "O",
	},
	{
		id: GLM_PROVIDER_ID,
		nameKey: "shell.settings.ai.glm.name",
		hintKey: "shell.settings.ai.glm.hint",
		monogram: "z",
	},
	{
		id: MISTRAL_PROVIDER_ID,
		nameKey: "shell.settings.ai.mistral.name",
		hintKey: "shell.settings.ai.mistral.hint",
		monogram: "M",
	},
	{
		id: GEMINI_PROVIDER_ID,
		nameKey: "shell.settings.ai.gemini.name",
		hintKey: "shell.settings.ai.gemini.hint",
		monogram: "G",
	},
];

/** A provider tile in the grid: monogram avatar + name + a key-status dot.
 *  Clicking opens the credential popover. */
function ProviderTile({
	provider,
	configured,
	onOpen,
}: { provider: ProviderMeta; configured: boolean; onOpen: () => void }) {
	return (
		<button
			type="button"
			className="settings__ai-tile"
			data-testid={`ai-provider-${provider.id}`}
			data-provider={provider.id}
			data-configured={configured}
			onClick={onOpen}
			title={t(provider.nameKey)}
		>
			<span className="settings__ai-avatar" aria-hidden="true">
				{provider.monogram}
				<span className="settings__ai-dot" />
			</span>
			<span className="settings__ai-tile-name">{t(provider.nameKey)}</span>
			<span className="settings__ai-tile-status">
				{configured ? t("shell.settings.ai.statusConfigured") : t("shell.settings.ai.statusUnset")}
			</span>
		</button>
	);
}

/** The credential editor, shown in the shared modal popover when a tile is
 *  picked. The key is write-only: typed in, saved, never read back. */
function ProviderKeyPopover({
	provider,
	configured,
	onClose,
	onChanged,
}: {
	provider: ProviderMeta;
	configured: boolean;
	onClose: () => void;
	onChanged: () => void | Promise<void>;
}) {
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const inputId = useId();

	const save = async () => {
		if (draft.trim().length === 0) return;
		setBusy(true);
		try {
			if (await window.brainstorm.aiSettings.setProviderKey(provider.id, draft.trim())) {
				await onChanged();
				onClose();
			}
		} finally {
			setBusy(false);
		}
	};

	const clear = async () => {
		setBusy(true);
		try {
			await window.brainstorm.aiSettings.clearProviderKey(provider.id);
			await onChanged();
			onClose();
		} finally {
			setBusy(false);
		}
	};

	return (
		<Popover
			title={t(provider.nameKey)}
			onClose={onClose}
			size={PopoverSize.Small}
			bodyPadding={PopoverBodyPadding.Comfortable}
			fitContent
			initialFocusRef={inputRef}
			testId={`ai-key-popover-${provider.id}`}
			footer={
				<>
					{configured && (
						<Button
							variant={ButtonVariant.Ghost}
							danger
							size={ButtonSize.Sm}
							className="popover__footer-lead"
							onClick={() => void clear()}
							disabled={busy}
						>
							{t("shell.settings.ai.clear")}
						</Button>
					)}
					<Button
						variant={ButtonVariant.Primary}
						size={ButtonSize.Sm}
						onClick={() => void save()}
						disabled={busy || draft.trim().length === 0}
					>
						{t("shell.settings.ai.save")}
					</Button>
				</>
			}
		>
			<form
				className="settings__ai-key-form"
				onSubmit={(e) => {
					e.preventDefault();
					void save();
				}}
			>
				<div className="settings__ai-key-id" data-provider={provider.id} data-configured={configured}>
					<span className="settings__ai-avatar" aria-hidden="true">
						{provider.monogram}
						<span className="settings__ai-dot" />
					</span>
					<span className="settings__ai-key-status-pill">
						{configured ? t("shell.settings.ai.statusConfigured") : t("shell.settings.ai.statusUnset")}
					</span>
				</div>
				<p className="settings__hint">{t(provider.hintKey)}</p>
				<label className="settings__ai-key-label" htmlFor={inputId}>
					{t("shell.settings.ai.keyLabel")}
				</label>
				<input
					id={inputId}
					ref={inputRef}
					className="settings__input"
					type="password"
					autoComplete="off"
					spellCheck={false}
					value={draft}
					placeholder={
						configured ? t("shell.settings.ai.replacePlaceholder") : t("shell.settings.ai.keyPlaceholder")
					}
					onChange={(e) => setDraft(e.target.value)}
					aria-label={t("shell.settings.ai.keyLabel")}
				/>
			</form>
		</Popover>
	);
}

/** The provider grid: one tile per cloud provider, each opening a credential
 *  popover. Key-configured state is loaded once and refreshed after a change so
 *  every tile's status dot stays live. */
function ProviderGrid() {
	const [configured, setConfigured] = useState<Record<string, boolean>>({});
	const [openId, setOpenId] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		const entries = await Promise.all(
			CLOUD_PROVIDERS.map(
				async (p) => [p.id, await window.brainstorm.aiSettings.hasProviderKey(p.id)] as const,
			),
		);
		setConfigured(Object.fromEntries(entries));
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const open = CLOUD_PROVIDERS.find((p) => p.id === openId) ?? null;

	return (
		<div className="settings__field" data-testid="ai-providers">
			<div className="settings__ai-grid">
				{CLOUD_PROVIDERS.map((p) => (
					<ProviderTile
						key={p.id}
						provider={p}
						configured={configured[p.id] ?? false}
						onOpen={() => setOpenId(p.id)}
					/>
				))}
			</div>
			{open && (
				<ProviderKeyPopover
					provider={open}
					configured={configured[open.id] ?? false}
					onClose={() => setOpenId(null)}
					onChanged={refresh}
				/>
			)}
		</div>
	);
}

type UsageRow = {
	appId: string;
	calls: number;
	errors: number;
	totalTokens: number;
	lastSeenMs: number;
};

/** 11.9 — the default-provider routing picker. `null` (Automatic) keeps the
 *  built-in local model; a cloud choice routes there (and fails closed if its
 *  key isn't set — the rows above show that). */
function RoutingSection({
	settings,
	onChange,
}: { settings: AiSettingsView | null; onChange: (providerId: string | null) => void }) {
	const value = settings?.defaultProvider ?? AUTO_ROUTING_VALUE;
	const options = [
		{ value: AUTO_ROUTING_VALUE, label: t("shell.settings.ai.routingAuto") },
		...CLOUD_PROVIDERS.map((p) => ({ value: p.id, label: t(p.nameKey) })),
	];
	return (
		<div className="settings__field" data-testid="ai-routing">
			<SettingRow
				title={t("shell.settings.ai.routingTitle")}
				description={t("shell.settings.ai.routingHint")}
				control={
					<SettingSelect
						value={value}
						options={options}
						ariaLabel={t("shell.settings.ai.routingTitle")}
						onChange={(next) => onChange(next === AUTO_ROUTING_VALUE ? null : next)}
					/>
				}
			/>
		</div>
	);
}

/** One app's row: usage stat (if any) + the current budget, opening the budget
 *  editor popover when picked (mirrors the provider-tile → key-popover pattern
 *  so the section stays a calm read-only list, not a grid of live inputs). */
function BudgetRow({
	appId,
	usage,
	maxTokens,
	onOpen,
}: {
	appId: string;
	usage: UsageRow | undefined;
	maxTokens: number;
	onOpen: () => void;
}) {
	return (
		<li className="settings__ai-usage-row">
			<button
				type="button"
				className="settings__ai-usage-trigger"
				data-testid={`ai-budget-${appId}`}
				onClick={onOpen}
			>
				<span className="settings__ai-usage-app">{appId}</span>
				{usage && (
					<span className="settings__ai-usage-stat">
						{t("shell.settings.ai.usageCalls", { count: usage.calls })} ·{" "}
						{t("shell.settings.ai.usageTokens", { count: usage.totalTokens })}
					</span>
				)}
				<span
					className="settings__ai-budget-value"
					data-set={maxTokens > 0}
					title={t("shell.settings.ai.budgetEdit")}
				>
					{maxTokens > 0
						? t("shell.settings.ai.budgetCurrent", { count: maxTokens })
						: t("shell.settings.ai.budgetNone")}
				</span>
			</button>
		</li>
	);
}

/** The per-app token-budget editor, shown in the shared popover. */
function BudgetPopover({
	appId,
	maxTokens,
	onClose,
	onSet,
}: {
	appId: string;
	maxTokens: number;
	onClose: () => void;
	onSet: (appId: string, maxTokens: number) => void;
}) {
	const [draft, setDraft] = useState(maxTokens > 0 ? String(maxTokens) : "");
	const inputRef = useRef<HTMLInputElement>(null);
	const inputId = useId();
	const parsed = Number.parseInt(draft, 10);
	const valid = Number.isFinite(parsed) && parsed > 0;

	const save = () => {
		if (!valid) return;
		onSet(appId, parsed);
		onClose();
	};
	const clear = () => {
		onSet(appId, 0);
		onClose();
	};

	return (
		<Popover
			title={appId}
			onClose={onClose}
			size={PopoverSize.Small}
			bodyPadding={PopoverBodyPadding.Comfortable}
			fitContent
			initialFocusRef={inputRef}
			testId={`ai-budget-popover-${appId}`}
			footer={
				<>
					{maxTokens > 0 && (
						<Button
							variant={ButtonVariant.Ghost}
							danger
							size={ButtonSize.Sm}
							className="popover__footer-lead"
							onClick={clear}
						>
							{t("shell.settings.ai.budgetClear")}
						</Button>
					)}
					<Button
						variant={ButtonVariant.Primary}
						size={ButtonSize.Sm}
						onClick={save}
						disabled={!valid || parsed === maxTokens}
					>
						{t("shell.settings.ai.budgetSet")}
					</Button>
				</>
			}
		>
			<form
				className="settings__ai-key-form"
				onSubmit={(e) => {
					e.preventDefault();
					save();
				}}
			>
				<p className="settings__hint">{t("shell.settings.ai.budgetHint")}</p>
				<label className="settings__ai-key-label" htmlFor={inputId}>
					{t("shell.settings.ai.budgetUnit")}
				</label>
				<input
					id={inputId}
					ref={inputRef}
					className="settings__input"
					type="number"
					min={0}
					inputMode="numeric"
					value={draft}
					placeholder={t("shell.settings.ai.budgetPlaceholder")}
					onChange={(e) => setDraft(e.target.value)}
					aria-label={`${appId} ${t("shell.settings.ai.budgetUnit")}`}
				/>
			</form>
		</Popover>
	);
}

/** Usage summary (11.8) + per-app token budgets (11.9). Rows are the union of
 *  apps that have made AI calls and apps that already carry a budget. */
function UsageAndBudgetsSection({
	usage,
	settings,
	onSetBudget,
}: {
	usage: readonly UsageRow[];
	settings: AiSettingsView | null;
	onSetBudget: (appId: string, maxTokens: number) => void;
}) {
	const [openAppId, setOpenAppId] = useState<string | null>(null);
	const budgets = settings?.appBudgets ?? {};
	const appIds = [...new Set([...usage.map((u) => u.appId), ...Object.keys(budgets)])].sort();
	if (appIds.length === 0) return null; // nothing to budget or report yet

	const usageById = new Map(usage.map((u) => [u.appId, u]));
	return (
		<div className="settings__field" data-testid="ai-budgets">
			<div className="settings__field-head">
				<span className="settings__field-label">{t("shell.settings.ai.budgetTitle")}</span>
			</div>
			<p className="settings__hint">{t("shell.settings.ai.budgetHint")}</p>
			<ul className="settings__ai-usage-list">
				{appIds.map((appId) => (
					<BudgetRow
						key={appId}
						appId={appId}
						usage={usageById.get(appId)}
						maxTokens={budgets[appId]?.maxTokens ?? 0}
						onOpen={() => setOpenAppId(appId)}
					/>
				))}
			</ul>
			{openAppId !== null && (
				<BudgetPopover
					appId={openAppId}
					maxTokens={budgets[openAppId]?.maxTokens ?? 0}
					onClose={() => setOpenAppId(null)}
					onSet={onSetBudget}
				/>
			)}
		</div>
	);
}

export function AiPanel() {
	const [usage, setUsage] = useState<readonly UsageRow[]>([]);
	const [settings, setSettings] = useState<AiSettingsView | null>(null);

	useEffect(() => {
		// Guard against a version-skewed preload (dev HMR reloads the renderer
		// but not the Electron preload until a full restart). A missing optional
		// bridge method must degrade, never crash the whole Settings panel.
		const bridge = window.brainstorm.aiSettings;
		let live = true;
		if (typeof bridge?.usage === "function") {
			void bridge.usage().then((u) => live && setUsage(u));
		}
		if (typeof bridge?.getSettings === "function") {
			void bridge.getSettings().then((s) => live && setSettings(s));
		}
		return () => {
			live = false;
		};
	}, []);

	const setDefaultProvider = useCallback((providerId: string | null) => {
		void window.brainstorm.aiSettings
			.setDefaultProvider?.(providerId)
			.then((s) => s && setSettings(s));
	}, []);

	const setBudget = useCallback((appId: string, maxTokens: number) => {
		void window.brainstorm.aiSettings
			.setAppBudget?.(appId, maxTokens)
			.then((s) => s && setSettings(s));
	}, []);

	return (
		<section className="settings__section">
			<h4 className="settings__section-title">{t("shell.settings.ai.title")}</h4>
			<p className="settings__hint">{t("shell.settings.ai.intro")}</p>
			<ProviderGrid />
			<RoutingSection settings={settings} onChange={setDefaultProvider} />
			<McpServersSection />
			<UsageAndBudgetsSection usage={usage} settings={settings} onSetBudget={setBudget} />
		</section>
	);
}
