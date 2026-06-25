/**
 * Task properties inspector — a thin adapter over the SHARED
 * `@brainstorm/sdk/properties-panel`, mirroring the Bookmarks panel. It maps
 * the task's bridged fields (see `task-properties.ts`) to the generic `rows`
 * the shared panel renders; all chrome (glass slide-over, header, grid rows)
 * lives in the SDK component, identical to Notes / Journal / Bookmarks.
 *
 * The bridged rows are display-only — a task's priority / date / project are
 * edited via the detail's chips, so this panel is a clean at-a-glance summary
 * that also surfaces fields the chips don't (status, created, updated) —
 * EXCEPT Assignee (F-152), set/cleared right here through the shared
 * Person/v1 entity-ref picker cell.
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
	type TaskValueContext,
	boundCustomDefs,
	parseAssigneeValue,
	taskToValues,
	unboundCustomDefs,
} from "../properties/task-properties";
import { getBrainstorm } from "../storage/runtime";
import type { Task } from "../types/task";

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
	/** Persists an assignee pick / clear. Absent (preview / no repository) →
	 *  the row renders read-only like the rest. */
	onAssigneeChange?: (assigneeId: string | null) => void;
	/** Persists the task's custom vault-property bag (9.14.16). Absent
	 *  (preview / no repository) → custom rows render read-only and the
	 *  add-property affordance hides. */
	onValuesChange?: (next: ValuesMap) => void;
} & TaskValueContext;

export function TaskPropertiesPanel({
	task,
	open,
	onClose,
	onAssigneeChange,
	onValuesChange,
	priorityLabel,
	projectName,
	statusLabel,
}: TaskPropertiesPanelProps): React.ReactElement {
	const { properties: catalog, ready } = usePropertyStore();
	const addButtonRef = useRef<HTMLButtonElement | null>(null);

	const values = taskToValues(task, { priorityLabel, projectName, statusLabel });
	const rows: PropertiesPanelRow[] = TASK_PROPERTY_DEFS.map((def) => {
		if (def.key === TASK_PROP_KEY.assignee && onAssigneeChange) {
			return {
				def,
				value: readValue(values, def),
				onChange: (next: unknown) => onAssigneeChange(parseAssigneeValue(next)),
			};
		}
		return { def, value: readValue(values, def), readOnly: true };
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
