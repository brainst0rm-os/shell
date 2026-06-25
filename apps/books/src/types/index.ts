/**
 * The Books type-level surface frozen by the 9.21.1 scaffold. Renderer +
 * logic import from here; the entity contracts don't change as the
 * renderer evolves (9.21.2 swaps the preview reader for the epub.js one).
 */

export { IconKind, type Icon } from "./icon";
export {
	type Locator,
	type LocatorRange,
	makeLocator,
	compareLocators,
	locatorsEqual,
	normalizeRange,
	rangeIsCollapsed,
	serializeLocator,
	parseLocator,
	serializeRange,
	parseRange,
} from "./locator";
export {
	BookFormat,
	type Book,
	type ReadingState,
	emptyReadingState,
} from "./book";
export {
	HighlightColor,
	type Highlight,
	HIGHLIGHT_COLORS,
} from "./highlight";
