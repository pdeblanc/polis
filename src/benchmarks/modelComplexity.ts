import {
  measureBirdsFlow,
  measureStarfieldBox,
  measureStarfieldViewport,
  measureTerrainPoint,
} from './complexityMeasurements';

const TERRAIN_DEPTHS = Array.from({ length: 14 }, (_, index) => index + 3);
const STARFIELD_DEPTHS = Array.from({ length: 17 }, (_, index) => index);
const VIEWPORT_SCALES = Array.from({ length: 17 }, (_, index) => index - 8);
const BIRDS_EPOCHS = [0, 1, 2, 3];
const BIRDS_DIFFUSION_RATES = [0, 0.5, 2];

writeTable(
  'birds-flow',
  BIRDS_EPOCHS.flatMap((epoch) =>
    BIRDS_DIFFUSION_RATES.map((diffusionRate) => measureBirdsFlow(epoch, diffusionRate)),
  ),
);

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

function writeTable<Row extends object>(name: string, rows: readonly Row[]): void {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const lines = [`# ${name}`, columns.join('\t')];
  for (const row of rows) {
    lines.push(columns.map((column) => String(row[column as keyof Row])).join('\t'));
  }
  console.log(`${lines.join('\n')}\n`);
}
