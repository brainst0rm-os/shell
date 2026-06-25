/** A transient one-line banner under the workflows toolbar (export / import
 *  feedback). The tone drives the colour modifier class. */
export enum StatusTone {
	Info = "info",
	Warn = "warn",
}

export type StatusBanner = { message: string; tone: StatusTone };
