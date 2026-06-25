/**
 * Documented performance budgets from
 * `docs/shell/12-shell-architecture.md §Performance budgets`.
 *
 * Each entry is the assertion target for one perf-harness spec. The env-var
 * overrides (BS_BUDGET_*) exist so a slower CI runner can relax a ceiling
 * without code edits — the doc itself says "lower-end hardware is 2-3x
 * relaxed" — but the in-code default MUST track the doc number.
 */

export type Budget = {
	readonly id: string;
	readonly description: string;
	readonly medianMs: number;
};

function envBudget(envKey: string, fallbackMs: number): number {
	const raw = process.env[envKey];
	if (!raw) return fallbackMs;
	const parsed = Number.parseFloat(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

export const BUDGETS = {
	coldStart: {
		id: "cold-start-to-dashboard-first-paint",
		description: "Cold start to dashboard first paint",
		// docs/shell/12-shell-architecture.md:242 "<300ms" (2020-era M1 baseline).
		medianMs: envBudget("BS_BUDGET_COLD_START_MS", 300),
	},
	warmStart: {
		id: "warm-start-to-dashboard-first-paint",
		description: "Warm start to dashboard first paint",
		// docs/shell/12-shell-architecture.md:243 "<150ms".
		medianMs: envBudget("BS_BUDGET_WARM_START_MS", 150),
	},
	coldAppLaunch: {
		id: "cold-app-launch-to-interactive",
		description: "Cold app launch to interactive",
		// docs/shell/12-shell-architecture.md:244 "<800ms".
		medianMs: envBudget("BS_BUDGET_COLD_APP_LAUNCH_MS", 800),
	},
	warmAppLaunch: {
		id: "warm-app-launch-to-interactive",
		description: "Warm app launch to interactive",
		// docs/shell/12-shell-architecture.md:245 "<200ms".
		medianMs: envBudget("BS_BUDGET_WARM_APP_LAUNCH_MS", 200),
	},
	ipcRttMedian: {
		id: "ipc-rtt-median",
		description: "IPC round-trip latency (median)",
		// docs/shell/12-shell-architecture.md:247 "<2ms median".
		medianMs: envBudget("BS_BUDGET_IPC_RTT_MEDIAN_MS", 2),
	},
	ipcRttP99: {
		id: "ipc-rtt-p99",
		description: "IPC round-trip latency (p99)",
		// docs/shell/12-shell-architecture.md:248 "<8ms p99".
		medianMs: envBudget("BS_BUDGET_IPC_RTT_P99_MS", 8),
	},
	launcherAppsKeystroke: {
		id: "launcher-apps-keystroke",
		description:
			"Launcher palette keystroke→paint for the apps section. Apps row renders from a sync-cached apps.listInstalled() array — no debounce — so this matches the docs/shell/12-shell-architecture.md:246 raw 50ms budget directly.",
		medianMs: envBudget("BS_BUDGET_LAUNCHER_APPS_KEY_MS", 50),
	},
	launcherEntitiesKeystroke: {
		id: "launcher-entities-keystroke",
		description:
			"Launcher palette keystroke→paint for the entities section. Pays the intentional SEARCH_DEBOUNCE_MS=120ms in launcher.tsx before query dispatch; the 170ms budget is debounce + the doc's 50ms paint headroom. Asserting 50ms directly here would gate on something the launcher never does.",
		medianMs: envBudget("BS_BUDGET_LAUNCHER_ENTITIES_KEY_MS", 170),
	},
	editorKeystrokeToPaint: {
		id: "editor-keystroke-to-paint",
		description: "Editor input latency (key to paint, in editor app)",
		// docs/shell/12-shell-architecture.md:249 / 13-frontend-stack.md:193 design
		// target "<16ms". Operational floor is 17ms because a single keystroke that
		// triggers a paint is vsync-bound on a 60Hz display (refresh ~16.67ms), so a
		// <16ms median is structurally unreachable on the dev hardware the perf
		// harness runs on. Matches the `sustainedFrameTime` bump rationale below.
		// Higher-refresh monitors (120Hz/144Hz) blow past 17ms naturally; the budget
		// remains a floor. Reconcile with the doc target if the harness ever runs
		// on >60Hz CI hardware.
		medianMs: envBudget("BS_BUDGET_EDITOR_KEY_PAINT_MS", 17),
	},
	editorKeystrokeToPaintDogfood: {
		id: "editor-keystroke-to-paint-dogfood",
		description:
			"Notes editor keystroke→paint on a dogfood-sized doc (200 top-level blocks). Phase-1 virtualization (13.4a.1) keystones must keep this within the operational 17ms floor (the 16ms structural budget is unreachable on 60Hz, see existing budget comment).",
		medianMs: envBudget("BS_BUDGET_EDITOR_KEY_PAINT_DOGFOOD_MS", 17),
	},
	idleCpu: {
		id: "idle-cpu",
		description:
			'Idle CPU usage (no app running), summed across the main + dashboard processes as a percentage of one core. docs/shell/12-shell-architecture.md:252 "<0.5%". The `medianMs` field carries the percent threshold (the Budget type is generic; the unit is %, not ms — see the producing spec). The shell is allowed to be busy for a short settle window after first paint, so the spec samples a quiet window well after boot.',
		medianMs: envBudget("BS_BUDGET_IDLE_CPU_PCT", 0.5),
	},
	idleRam: {
		id: "idle-ram",
		description:
			'Idle RAM (shell + dashboard, no apps), the summed working set of the main + dashboard-renderer processes in MB. docs/shell/12-shell-architecture.md:253 "<250MB". `medianMs` carries the MB threshold (generic Budget type; unit is MB).',
		medianMs: envBudget("BS_BUDGET_IDLE_RAM_MB", 250),
	},
	perAppRendererRam: {
		id: "per-app-renderer-ram",
		description:
			'Per-app renderer baseline RAM — the working set of a freshly-launched first-party app\'s renderer process in MB, isolated from the shell. docs/shell/12-shell-architecture.md:254 "<80MB". `medianMs` carries the MB threshold (generic Budget type; unit is MB).',
		medianMs: envBudget("BS_BUDGET_PER_APP_RAM_MB", 80),
	},
	ydocUpdateToDisk: {
		id: "ydoc-update-to-disk",
		description:
			'Y.Doc update applied → durable on disk, p99 latency in ms. docs/shell/12-shell-architecture.md:255 / docs/data/18-storage-and-search.md:290 "<50ms p99". Covered headlessly by packages/shell/src/main/integration/stress.test.ts (the ydoc-store append→persist path); recorded here so the budget has a home in the perf-result schema.',
		medianMs: envBudget("BS_BUDGET_YDOC_PERSIST_P99_MS", 50),
	},
	sustainedFrameTime: {
		id: "sustained-frame-time",
		description: "Sustained rAF→rAF frame interval during a gesture (≤60fps)",
		// A 60Hz display refreshes every ~16.67ms, so any rAF-based measurement
		// is hard-floored at that interval — `<16ms` is unreachable even on a
		// no-op page. 17ms gates "we sustained 60fps with no dropped frames" on
		// a 60Hz monitor. Higher-refresh monitors (120Hz/144Hz) blow past it
		// naturally; the budget remains a floor. Distinct from
		// `editorKeystrokeToPaint`: that is a single key→paint *latency*, this
		// is a sustained *interval*.
		medianMs: envBudget("BS_BUDGET_SUSTAINED_FRAME_MS", 17),
	},
} as const satisfies Record<string, Budget>;

export type BudgetId = (typeof BUDGETS)[keyof typeof BUDGETS]["id"];
