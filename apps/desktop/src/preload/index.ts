/**
 * F01 deliberately exposes no runtime bridge. F04 owns the validated,
 * allowlisted privileged contract; keeping this entry typed and empty
 * prevents the renderer from acquiring a privileged escape hatch by accident.
 */
export type PrMonitorPreloadApi = Record<never, never>;

export {};
