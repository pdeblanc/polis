import {
  measureStarfieldBox,
  measureStarfieldViewport,
  measureTerrainPoint,
} from './complexityMeasurements';

const TERRAIN_DEPTHS = Array.from({ length: 14 }, (_, index) => index + 3);
const STARFIELD_DEPTHS = Array.from({ length: 17 }, (_, index) => index);
const VIEWPORT_SCALES = Array.from({ length: 17 }, (_, index) => index - 8);

writeTable(
  'terrain-point',
  TERRAIN_DEPTHS.flatMap((depth) => [
    measureTerrainPoint('square', depth),
    measureTerrainPoint('diamond', depth),
  ]),
);
writeTable(
  'starfield-box',
  STARFIELD_DEPTHS.flatMap((depth) => [
    measureStarfieldBox('box-subdivision', depth),
    measureStarfieldBox('box-expansion', depth),
  ]),
);
writeTable('starfield-viewport', VIEWPORT_SCALES.map((scale) => measureStarfieldViewport(scale)));

function writeTable(name: string, rows: readonly Record<string, unknown>[]): void {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const lines = [`# ${name}`, columns.join('\t')];
  for (const row of rows) {
    lines.push(columns.map((column) => String(row[column])).join('\t'));
  }
  console.log(`${lines.join('\n')}\n`);
}
