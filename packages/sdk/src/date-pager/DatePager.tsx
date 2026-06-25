/**
 * React twin of `createDatePager` — same DOM, same `.bs-date-pager__*`
 * classes, same RTL caret direction. React apps (Calendar) render through
 * this so their date-axis cluster is bit-identical with the plain-DOM apps'.
 */

import { Icon } from "../icon/icon";
import { IconDirection, IconName } from "../icon/icon-registry";
import type { DatePagerLabels } from "./date-pager";

const DEFAULT_ICON_SIZE = 16;

export type DatePagerProps = {
	labels: DatePagerLabels;
	onToday: () => void;
	onPrev: () => void;
	onNext: () => void;
	/** Optional extra class on the root cluster (host's legacy class). */
	className?: string;
	/** Icon size in px. Defaults to 16. */
	iconSize?: number;
};

export function DatePager({
	labels,
	onToday,
	onPrev,
	onNext,
	className,
	iconSize = DEFAULT_ICON_SIZE,
}: DatePagerProps) {
	const rootClass = className ? `bs-date-pager ${className}` : "bs-date-pager";
	return (
		<div className={rootClass}>
			<button type="button" className="bs-date-pager__today" onClick={onToday}>
				{labels.today}
			</button>
			<button
				type="button"
				className="bs-date-pager__arrow bs-date-pager__arrow--prev"
				aria-label={labels.prev}
				data-bs-tooltip={labels.prev}
				onClick={onPrev}
			>
				<Icon name={IconName.CaretLeft} size={iconSize} direction={IconDirection.Inline} />
			</button>
			<button
				type="button"
				className="bs-date-pager__arrow bs-date-pager__arrow--next"
				aria-label={labels.next}
				data-bs-tooltip={labels.next}
				onClick={onNext}
			>
				<Icon name={IconName.CaretRight} size={iconSize} direction={IconDirection.Inline} />
			</button>
		</div>
	);
}
