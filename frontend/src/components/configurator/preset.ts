/** A combo's pictured design for one product — seeds a configurator's selections.
 *  Same shape the customizer produces, so it round-trips. */
export type PresetConfig = {
  color?: { id?: number };
  corner?: { id?: number };
  center?: { id?: number };
  inside?: { id?: number };
  static?: { id?: number };
  dupatta?: { id?: number; lace_type?: string; text_lines?: number };
};

/**
 * The preset id, but only if that option still exists.
 * An option deleted after the combo was built must never break the configurator.
 */
export function validId(presetId: number | undefined, ids: number[]): number | null {
  return presetId != null && ids.includes(presetId) ? presetId : null;
}

/** Match a dupatta preset to a live option — by id, else by lace + lines. */
export function matchDupatta<T extends { id: number; lace_type: string; text_lines: number }>(
  preset: PresetConfig["dupatta"],
  opts: T[],
): T | undefined {
  if (!preset) return undefined;
  return (
    opts.find((o) => o.id === preset.id) ??
    opts.find((o) => o.lace_type === preset.lace_type && o.text_lines === preset.text_lines)
  );
}
