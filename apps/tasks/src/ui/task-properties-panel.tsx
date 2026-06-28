/**
 * Task properties inspector — a thin adapter over the SHARED
 * `@brainstorm/sdk/properties-panel`, mirroring the Bookmarks panel. It maps
 * the task's bridged fields (see `task-properties.ts`) to the generic `rows`
 * the shared panel renders; all chrome (glass slide-over, header, grid rows)
 * lives in the SDK component, identical to Notes / Journal / Bookmarks.
 *
 * Every bridged row is edited in-place through its shared cell (status /
 * priority / tags via the vocabulary TagCell, scheduled / due via the DateCell,
 * project / assignee via the entity-ref Link cell, estimate / logged via the
 * Duration Number cell); created / updated stay read-only. Each cell's edited
 * value flows through a `task-properties` parser back to the typed `Task`
 * patch supplied by the host.
 *
 * Custom fields (9.14.16): below the bridged rows, the task's bound vault
 * properties (`task.values`) render as fully-editable rows through the same
 * shared cells, with a remove affordance and an "Add property" anchored menu
 * over the unbound catalog defs — the same model Notes / Journal entities
 * use, so a property created once in the vault catalog works on tasks too.
 */

import { EntityCommentsPanel } from "@brainstorm/editor";
import type { PropertyDef, PropertyValueByValueType } from "@brainstorm/sdk-types";
import { ValueType } from "@brainstorm/sdk-types";
import { IconName } from "@brainstorm/sdk/icon";
import { MenuAlign } from "@brainstorm/sdk/menus";
import { type AnchoredMenuItem, openAnchoredMenu } from "@brainstorm/sdk/object-menu";
import { PropertiesPanel, type PropertiesPanelRow } from "@brainstorm/sdk/properties-panel";
import {
	type ValuesMap,
	bindValue,
	clearValue,
	readValue,
	usePropertyStore,
	writeValue,
} from "@brainstorm/sdk/property-ui";
import { useRef } from "react";
import { t } from "../i18n/t";
import {
	TASK_PROPERTY_DEFS,
	TASK_PROP_KEY,
	boundCustomDefs,
	parseAssigneeValue,
	parseDateValue,
	parseDurationValue,
	parsePriorityValue,
	parseProjectValue,
	parseStatusValue,
	parseTagsValue,
	taskToValues,
	unboundCustomDefs,
} from "../properties/task-properties";
import { getBrainstorm } from "../storage/runtime";
import type { Priority, Task } from "../types/task";

/** The SDK property-kind glyph for each value type, so the add-property
 *  picker rows carry the same type icon Notes' picker shows (each row is a
 *  distinct kind, so the icon is meaningful, not uniform decoration). */
const VALUE_TYPE_ICON: Record<ValueType, IconName> = {
	[ValueType.Text]: IconName.KindText,
	[ValueType.Number]: IconName.KindNumber,
	[ValueType.Boolean]: IconName.KindBoolean,
	[ValueType.Date]: IconName.KindDate,
	[ValueType.EntityRef]: IconName.KindLink,
	[ValueType.RichText]: IconName.KindText,
};

export type TaskPropertiesPanelProps = {
	task: Task;
	open: boolean;
	onClose: () => void;
	/** Per-field persisters. Each is absent (preview / no repository) → that
	 *  row renders read-only. Created / updated have no setter by design. */
	onStatusChange?: (statusKey: string | null) => void;
	onPriorityChange?: (priority: Priority) => void;
	onScheduledChange?: (at: number | null) => void;
	onDueChange?: (at: number | null) => void;
	onProjectChange?: (projectId: string | null) => void;
	onAssigneeChange?: (assigneeId: string | null) => void;
	onEstimateChange?: (minutes: number | null) => void;
	onLoggedChange?: (minutes: number | null) => void;
	onTagsChange?: (tags: string[]) => void;
	/** Persists the task's custom vault-property bag (9.14.16). Absent
	 *  (preview / no repository) → custom rows render read-only and the
	 *  add-property affordance hides. */
	onValuesChange?: (next: ValuesMap) => void;
};

export function TaskPropertiesPanel({
	task,
	open,
	onClose,
	onStatusChange,
	onPriorityChange,
	onScheduledChange,
	onDueChange,
	onProjectChange,
	onAssigneeChange,
	onEstimateChange,
	onLoggedChange,
	onTagsChange,
	onValuesChange,
}: TaskPropertiesPanelProps): React.ReactElement {
	const { properties: catalog, ready } = usePropertyStore();
	const addButtonRef = useRef<HTMLButtonElement | null>(null);

	const values = taskToValues(task);
	// Each bridged field maps its cell's raw edited value through a parser back
	// to the typed `Task` patch. An absent persister leaves the row read-only.
	const editable: Record<string, ((next: unknown) => void) | undefined> = {
		[TASK_PROP_KEY.status]: onStatusChange && ((n) => onStatusChange(parseStatusValue(n))),
		[TASK_PROP_KEY.priority]: onPriorityChange && ((n) => onPriorityChange(parsePriorityValue(n))),
		[TASK_PROP_KEY.scheduled]: onScheduledChange && ((n) => onScheduledChange(parseDateValue(n))),
		[TASK_PROP_KEY.due]: onDueChange && ((n) => onDueChange(parseDateValue(n))),
		[TASK_PROP_KEY.project]: onProjectChange && ((n) => onProjectChange(parseProjectValue(n))),
		[TASK_PROP_KEY.assignee]: onAssigneeChange && ((n) => onAssigneeChange(parseAssigneeValue(n))),
		[TASK_PROP_KEY.estimate]: onEstimateChange && ((n) => onEstimateChange(parseDurationValue(n))),
		[TASK_PROP_KEY.logged]: onLoggedChange && ((n) => onLoggedChange(parseDurationValue(n))),
		[TASK_PROP_KEY.tags]: onTagsChange && ((n) => onTagsChange(parseTagsValue(n))),
	};
	const rows: PropertiesPanelRow[] = TASK_PROPERTY_DEFS.map((def) => {
		const onChange = editable[def.key];
		return onChange
			? { def, value: readValue(values, def), onChange }
			: { def, value: readValue(values, def), readOnly: true };
	});

	// Custom vault-property rows (9.14.16) — editable through the same cells.
	const customValues = task.values ?? {};
	for (const def of boundCustomDefs(task.values, catalog)) {
		rows.push({
			def,
			value: readValue(customValues, def),
			...(onValuesChange
				? {
						onChange: (next: unknown) =>
							onValuesChange(
								writeValue(
									customValues,
									def as PropertyDef & { valueType: ValueType },
									next as PropertyValueByValueType[ValueType],
								),
							),
						onRemove: () => onValuesChange(clearValue(customValues, def.key)),
					}
				: { readOnly: true }),
		});
	}

	const unbound = onValuesChange && ready ? unboundCustomDefs(task.values, catalog) : [];
	const openAddMenu = (): void => {
		const anchor = addButtonRef.current;
		if (!anchor || unbound.length === 0 || !onValuesChange) return;
		const rect = anchor.getBoundingClientRect();
		const items: AnchoredMenuItem[] = unbound.map((def) => ({
			label: def.name,
			icon: VALUE_TYPE_ICON[def.valueType],
			onSelect: () =>
				onValuesChange(bindValue(customValues, def as PropertyDef & { valueType: ValueType })),
		}));
		openAnchoredMenu({ x: rect.left, y: rect.bottom }, items, {
			menuLabel: t("tasks.props.add"),
			anchor,
			align: MenuAlign.Start,
		});
	};

	const services = getBrainstorm()?.services ?? null;
	return (
		<aside
			className={open ? "bs-props bs-props--open glass--strong" : "bs-props glass--strong"}
			aria-label={t("tasks.detail.properties")}
			aria-hidden={!open}
			{...(open ? {} : { inert: true })}
		>
			<EntityCommentsPanel
				services={services}
				documentId={task.id}
				properties={({ tabbed }) => (
					<PropertiesPanel
						title={t("tasks.detail.properties")}
						rows={rows}
						entityId={task.id}
						{...(tabbed
							? { hideHeader: true }
							: { onClose, closeLabel: t("tasks.header.inspector.hide") })}
						removeLabel={(name) => t("tasks.props.remove", { name })}
						{...(unbound.length > 0 ? { onAdd: openAddMenu, addLabel: t("tasks.props.add") } : {})}
						addButtonRef={addButtonRef}
					/>
				)}
			/>
		</aside>
	);
}
