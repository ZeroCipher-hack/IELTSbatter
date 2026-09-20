import { normalizeBand } from "@/lib/utils/scoring";
export interface FullExamBands { listening: number; reading: number; writing: number; speaking: number; }
export function computeFullExamOverall(bands: FullExamBands): number {
  const values = [bands.listening, bands.reading, bands.writing, bands.speaking].map(normalizeBand);
  return normalizeBand(values.reduce((sum, band) => sum + band, 0) / values.length);
}
export function weakestFullExamModules(bands: FullExamBands): Array<keyof FullExamBands> {
  const entries = Object.entries(bands) as Array<[keyof FullExamBands, number]>;
  const minimum = Math.min(...entries.map(([, band]) => band));
  return entries.filter(([, band]) => band === minimum).map(([module]) => module);
}
