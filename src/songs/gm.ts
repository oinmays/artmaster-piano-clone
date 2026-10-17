/** General MIDI instrument names and families (T26 — stub; programs are 0-based, 0 = Acoustic Grand Piano). */
export type GmFamily =
  | 'piano' | 'chromatic' | 'organ' | 'guitar' | 'bass' | 'strings' | 'ensemble' | 'brass'
  | 'reed' | 'pipe' | 'synth lead' | 'synth pad' | 'synth effects' | 'ethnic' | 'percussive' | 'sound effects';

/** "Acoustic Grand Piano" for 0. */
export function gmName(_program: number): string {
  throw new Error('T26: gmName not built yet');
}
/** 'piano' for 0–7, 'bass' for 32–39, 'strings' for 40–47 … */
export function gmFamily(_program: number): GmFamily {
  throw new Error('T26: gmFamily not built yet');
}
/** Pianos, electric pianos, harpsichord/clavinet, organs: parts a pianist would play. */
export function isKeys(_program: number): boolean {
  throw new Error('T26: isKeys not built yet');
}
