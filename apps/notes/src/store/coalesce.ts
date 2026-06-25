/**
 * Trailing-debounce coalescer for staleness callbacks.
 *
 * `schedule()` (re)arms a single trailing timer — the run fires `delayMs`
 * after the LAST `schedule()`, collapsing a burst of signals into one run.
 * `cancel()` drops any pending run; effect cleanups MUST call it so a
 * teardown inside the debounce window can't fire the run after unmount
 * (the `vaultEntities.onChange` → `setNotes`-after-unmount leak this guards).
 */
export function createTrailingCoalescer(
	run: () => void,
	delayMs: number,
): { schedule: () => void; cancel: () => void } {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const cancel = (): void => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};
	return {
		schedule: () => {
			cancel();
			timer = setTimeout(() => {
				timer = null;
				run();
			}, delayMs);
		},
		cancel,
	};
}
