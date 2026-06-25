/**
 * Graph app i18n manifest — every user-visible string the renderer builds
 * in JS (textContent / title / aria-label / status pill / cycle-button
 * labels). Per ` §Localization` and
 * the shared-fundamentals contract §C: no bare literal in app logic; the
 * default-English manifest lives here and every site goes through `t()`
 * from `./t`.
 *
 * Static markup in `index.html` is the shell-templated chrome and is not
 * JS-built; it is out of this module's surface (it would need a separate
 * static-DOM pass) and is tracked in the app-completion matrix, not here.
 *
 * Keys are dotted by region (`pattern.*`, `export.*`, `local.*`,
 * `status.*`) so the manifest stays grepable as it grows. `{name}`-style
 * params interpolate via `createT`.
 */

export const GRAPH_I18N = {
	// Pattern toolbar
	"pattern.reset": "Show everything",
	"pattern.advisory":
		"Subjects or connections with no type filter match everything — narrow them for a faster, clearer graph.",

	// Export menu
	"export.menu": "Export",
	"export.json": "Copy as JSON",
	"export.dot": "Copy as DOT (Graphviz)",
	"export.graphml": "Copy as GraphML",
	"export.svg": "Copy as SVG",
	"export.copied": "Copied {kind} to clipboard",
	"export.clipboardUnavailable": "Clipboard unavailable",
	"export.saveJson": "Save as JSON…",
	"export.saveDot": "Save as DOT (Graphviz)…",
	"export.saveGraphml": "Save as GraphML…",
	"export.saveSvg": "Save as SVG…",
	"export.savePng": "Save as PNG…",
	"export.saveDialogTitle": "Save graph export",
	"export.saved": "Saved {kind} to {name}",
	"export.saveFailed": "Couldn't save {kind}: {detail}",
	"export.saveUnavailable": "File save unavailable",
	"export.formatLegend": "Format",
	"export.action": "Export",
	"export.cancel": "Cancel",
	"export.destination": "Destination",
	"export.toCopy": "Copy to clipboard",
	"export.toFile": "Save to file",
	"export.fmtJson": "JSON",
	"export.fmtDot": "DOT (Graphviz)",
	"export.fmtGraphml": "GraphML",
	"export.fmtMermaid": "Mermaid",
	"export.fmtSvg": "SVG",
	"export.fmtPng": "PNG",

	// Path view (9.13) — pick two nodes, highlight the shortest connection
	"path.button": "Path between two nodes",
	"path.hint.pickStart": "Path view: click the first node",
	"path.hint.pickEnd": "Now click the second node",
	"path.hint.found": "Shortest path highlighted",
	"path.hint.hopsOne": "Connected in {count} hop",
	"path.hint.hops": "Connected in {count} hops",
	"path.hint.none": "No path connects those two nodes",

	// Show toggles (the plain front-door lens over the primary subject)
	"show.toggle": "Show {type}",
	"show.empty": "No entities in this vault yet.",
	"show.systemGroup": "System",

	// Type picker
	"type.any": "Any type",
	"type.someSelected": "{count} types",
	"type.none": "No types in this vault yet",

	// Subjects
	"subject.name": "Subject {name} name",
	"subject.remove": "Remove subject {name}",
	"subject.add": "Add type",
	"subject.where": "Filter…",
	"subject.whereSummary": "Filter ({count})",
	"subject.whereClear": "Clear property filter",
	"subject.whereAddRow": "Add condition",
	"subject.whereRemoveRow": "Remove condition",
	"subject.wherePropertyPlaceholder": "Property",
	"subject.whereValuePlaceholder": "Value",
	"subject.wherePropertyAria": "Property for subject {name} condition",
	"subject.whereValueAria": "Value for subject {name} condition",
	"subject.whereOpAria": "Comparison for subject {name} condition",
	"subject.whereReadOnly":
		"This filter uses advanced logic — edit it in the Database app to keep its structure.",
	"where.op.$eq": "is",
	"where.op.$neq": "is not",
	"where.op.$contains": "contains",
	"where.op.$notContains": "does not contain",
	"where.op.$gt": "greater than",
	"where.op.$lt": "less than",
	"where.op.$gte": "at least",
	"where.op.$lte": "at most",
	"where.op.$like": "matches (LIKE)",
	"where.op.$notLike": "does not match",
	"where.op.$exists": "is set",
	"where.op.$empty": "is empty",

	// Connections
	"edge.none": "No connections — subjects render independently",
	"edge.add": "Add connection",

	// Status pill
	"status.noVault": "No vault",
	"status.loading": "Loading vault…",
	"status.listMissing": "vaultEntities.list missing",
	"status.empty": "No entities — create a note",
	"status.count": "{count} {noun}",
	"status.entitySingular": "entity",
	"status.entityPlural": "entities",
	"status.patternTooBroad": "Pattern too broad — {message}",
	"status.patternNotRunnable": "Pattern not runnable — {message}",

	// Hover preview card
	"preview.unmatched": "Unmatched",
	"preview.link": "{count} link",
	"preview.links": "{count} links",
	"preview.moreActions": "Node actions",

	// Object menu (shared object-menu chrome + graph extras)
	"menu.open": "Open",
	"menu.pin": "Pin to dashboard",
	"menu.unpin": "Remove from dashboard",
	"menu.region": "Node actions",
	"menu.enterLocalView": "Focus neighbourhood",
	"menu.exitLocalView": "Exit local view",
	"inspector.label": "Selected node",
	"inspector.nameField": "Name",
	"inspector.multi.one": "{count} node selected",
	"inspector.multi.other": "{count} nodes selected",
	"menu.graphActions": "Graph actions",
	"menu.graphRegion": "Graph actions",
	"menu.fitToContent": "Fit graph to view",
	"menu.resetView": "Reset view",
	"menu.resetLayout": "Reset layout",
	"menu.export": "Export…",
	"menu.openFilters": "Filters",
	"menu.openSettings": "Settings",

	// Filters-panel match summary
	"summary.bindings": "Bindings",
	"summary.visibleNodes": "Visible nodes",
	"summary.visibleEdges": "Visible edges",

	// Canvas keyboard navigation (KBN-A-graph). The canvas is a draw surface
	// with no DOM per node, so it presents as a single `role="application"`
	// region; the live-region announcement is what a screen reader speaks on
	// each keyboard focus move (name + position in the ring + degree).
	"canvas.ariaLabel": "Graph canvas",
	"canvas.roleDescription":
		"Interactive graph. Tab or arrow keys move between nodes, Enter opens, Escape leaves.",
	"canvas.focusAnnounce": "{name}, node {index} of {total}, {count} connections",
	"canvas.focusAnnounceOne": "{name}, node {index} of {total}, {count} connection",

	// Local view badge
	"local.label": "Local · {label}",
	"local.depthAria": "Local view depth in hops",
	"local.fewerHops": "Fewer hops",
	"local.decreaseDepth": "Decrease depth",
	"local.moreHops": "More hops",
	"local.increaseDepth": "Increase depth",
	"local.hops": "{count} hop",
	"local.hopsPlural": "{count} hops",
	"local.directionAria": "Local view link direction",
	"local.exit": "Exit local view",
	"local.dirIn": "In",
	"local.dirBoth": "Both",
	"local.dirOut": "Out",
	"local.dirInAria": "Follow inbound links only",
	"local.dirBothAria": "Follow links in both directions",
	"local.dirOutAria": "Follow outbound links only",

	// History reveal cycle button
	"reveal.strict": "Strict",
	"reveal.eased": "Eased",
	"reveal.recent": "Recent",

	// Link reasons — why two objects are connected (edge tooltip, node
	// hover breakdown, legend). Body links + structured property references
	// each get a verb; generic property references fall back to the property
	// name; shared-attribute edges name the shared property (and value).
	"reason.mentions": "Mentions",
	"reason.linksTo": "Links to",
	"reason.contains": "Contains",
	"reason.about": "About",
	"reason.fromMilestone": "From milestone",
	"reason.fromIteration": "From iteration",
	"reason.inProject": "In project",
	"reason.inStage": "In stage",
	"reason.resolves": "Resolves",
	"reason.inRelease": "In release",
	"reason.gatedBy": "Gated by",
	"reason.reference": "References",
	"reason.shares": "Shares {attr}",
	"reason.sharesValue": "Shares {attr}: {value}",
	"reason.sharedAttribute": "Shared attribute",
	// Legend category names
	"reason.categoryBody": "Editor links",
	"reason.categoryReference": "Property references",
	"reason.categoryShared": "Shared attributes",
	// Visible-edge count shown next to a legend swatch
	"legend.count": "{count}",
	// Edge tooltip connectors
	"reason.edgeDirected": "{source} → {dest}",
	"reason.edgeUndirected": "{source} ↔ {dest}",
	// Node hover breakdown: one "Label ×N" segment, joined by " · "
	"reason.breakdownSegment": "{label} ×{count}",

	// Edge hop windows (9.13.4)
	"edge.hops.aria": "Connection {n} hops",
	"edge.hops.direct": "1 hop",
	"edge.hops.upTo": "≤ {n} hops",
	"edge.hops.window": "{m}–{n} hops",

	// Pattern templates (9.13.14)
	"templates.button": "Templates",
	"templates.menu": "Pattern templates",
	"templates.unavailable": "No entities of these types in this vault yet",
	"templates.everything": "Everything",
	"templates.notes": "Notes & journal",
	"templates.work": "Tasks & projects",
	"templates.people": "People & companies",
	"templates.library": "Files & bookmarks",

	// Header chrome (9.13.16 React migration — was static index.html markup).
	"header.appTitle": "Graph",
	"header.filters": "Filters",
	"header.settings": "Settings",
	"header.animate": "Animate timeline",
	"sidebar.aria": "Filters and settings",
	"canvas.wrapAria": "Graph canvas",
	"sidebar.resize": "Resize sidebar",

	// Zoom controls (canvas overlay)
	"zoom.in": "Zoom in",
	"zoom.out": "Zoom out",
	"zoom.reset": "Reset view",

	// Filters panel sections
	"section.show": "Show",
	"section.showHint":
		'Pick what to focus. Everything else dims — or hides, when "Filtered-out entities" is off in Settings. Leave all off to show your whole vault.',
	"section.matches": "Matches",
	"advanced.summary": "Advanced — subjects & connections",
	"section.pattern": "Pattern",
	"section.patternHint":
		"A pattern is one or more subjects (each scoped to entity types) wired by typed connections. Edit the subjects and connections below; the graph updates live.",
	"section.subjects": "Subjects",
	"section.connections": "Connections",

	// Edge editor field aria labels (9.13.16 — were inline English strings)
	"edge.fromAria": "Connection {n} from",
	"edge.dirAria": "Connection {n} direction",
	"edge.toAria": "Connection {n} to",
	"edge.matchAria": "Connection {n} match",
	"edge.removeAria": "Remove connection {n}",

	// Edge editor option labels (were raw wire values "out"/"in"/…)
	"edge.dir.out": "Outgoing",
	"edge.dir.in": "Incoming",
	"edge.dir.both": "Either",
	"edge.match.required": "Required",
	"edge.match.optional": "Optional",
	"edge.match.forbidden": "Forbidden",

	// Settings panel sections + toggles
	"section.appearance": "Appearance",
	"setting.titles": "Titles",
	"setting.arrows": "Arrows",
	"setting.icons": "Icons",
	"section.showOnGraph": "Show on graph",
	"setting.unmatched": "Filtered-out entities (dimmed)",
	"section.localView": "Local view",
	"setting.localMode": "Local graph",
	"setting.localModeHint":
		"Show only one node and its connections out to the depth below, instead of the whole graph. Click a node to re-centre on it; double-click opens the entity.",
	"setting.depth": "Depth (connection hops)",
	"section.forces": "Forces",
	"force.charge": "Repulsion",
	"force.chargeRange": "Repulsion range",
	"force.linkDistance": "Link distance",
	"force.centerStrength": "Center pull",
	"force.collidePadding": "Collision spacing",
	"force.collideStrength": "Collision strength",
	"force.velocityDecay": "Damping",
	"force.maxSpeed": "Max speed",
	"section.layout": "Layout",
	"setting.resetLayout": "Reset layout",
	"setting.resetLayoutHint":
		"Drops pinned positions and re-runs the force simulation from a fresh seed. Use after rearranging many nodes.",

	// Hover preview / edge tooltip / legend region labels
	"legend.aria": "Link reason legend",

	// GraphView (per-view persisted layout, 9.13.6)
	"view.defaultName": "Layout",

	// Drag-to-create-link (9.13.11)
	"link.menuLabel": "Create link",
	"link.menuTitle": "Link to {target}",
	"link.noTypes": "No link types for this target",
	"link.noTypesHint":
		"Add an entity-reference property in Settings → Data to type links to this object.",
	"link.created": "Linked {source} → {target} as {name}",
	"link.already": "Already linked via {name}",
	"link.failed": "Couldn't create the {name} link",
	"link.unavailable": "Link creation needs the shared entities service",

	// History playback (FAB + popover)
	"history.fab": "Show history playback",
	"history.now": "Now",
	"history.dialog": "History playback",
	"history.playPause": "Play / pause",
	"history.cycleSpeed": "Cycle playback speed",
	"history.cycleReveal": "Cycle reveal mode",
	"history.cutoff": "History cutoff",
} as const;

export type GraphI18nKey = keyof typeof GRAPH_I18N;
