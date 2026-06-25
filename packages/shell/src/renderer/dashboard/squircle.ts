/**
 * iOS-style squircle silhouette. We approximate the G2-continuous
 * superellipse with `border-radius` because at the dashboard's 64px icon
 * size the visual difference from a true squircle is well below 1px and
 * a single CSS property keeps the render path simple (no mask-image, no
 * extra SVG layer to composite). If we ever go large (e.g. icon-preview
 * popovers at 256px+) we should swap to `mask-image: url(<inline-svg>)`
 * with the 8-segment cubic-bezier path Apple uses.
 *
 * 22.37% is the proportion Apple's icon-mask asset settles on for the
 * iOS 7+ app icon at every standard size; it's the closest border-radius
 * value that matches the squircle's apex tangent.
 */

export const SQUIRCLE_RADIUS_PERCENT = "22.37%";
