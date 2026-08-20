import { useEffect, useMemo, useState } from "react";
import {
  Sighting,
  SightingBudgetExceededError,
  SightingResolutionLimitError,
} from "../helpers/birdsSighting";
import { useFramePerformance } from "../helpers/useFramePerformance";
import { useUrlNumberParameter, useUrlSeed } from "../helpers/urlState";
import { useViewport2D } from "../helpers/useViewport2D";
import {
  Birds,
  type BirdsFlowListResult,
  type BirdsFlowSample,
  type BirdsPopulationResolution,
  type BirdsPopulationSample,
} from "../models/birds/birds";
import {
  screenToWorld,
  worldToScreen,
  type Size2D,
  type ViewportState,
} from "../utils/geometry/viewport2d";
import { CacheControl, type CacheUsage } from "./CacheControl";
import { PerformanceControl } from "./PerformanceControl";
import { ModelParameterControl } from "./ModelParameterControl";
import { SeedControl } from "./SeedControl";
import { ViewportFrame } from "./ViewportFrame";

const DEFAULT_SEED = "Polis 3";
const DEFAULT_DIFFUSION_RATE = 0.5;
const DEFAULT_POPULATION_DENSITY = 2;
const INITIAL_VIEWPORT: ViewportState = {
  centerX: 0,
  centerY: 0,
  area: 16_384,
};
const TARGET_CELL_PIXELS = 64;
const TARGET_TIME_STEP_PIXELS = 128;
const MAX_RENDER_SAMPLES = 1_000;
const TIME_ZOOM_EXPONENT = 2;
const TIME_WORLD_SCALE = 1 / 64;
const FLOW_REFERENCE_STEP_PIXELS = 50;
const TRACKED_STEPS_PER_DIRECTION = 3;
const TRACKED_STEP_QUERY_BUDGET = 256;
const TRACKED_STEP_REFINEMENT_BUDGET = 16;

interface HoveredPopulationCell {
  readonly max: number;
  readonly min: number;
  readonly time: number;
}

interface TrackedTrajectory {
  readonly flows: BirdsFlowListResult;
  readonly partial: false | "budget" | "numeric-resolution";
}

export function BirdsCanvas() {
  const [seed, setSeed] = useUrlSeed(DEFAULT_SEED);
  const [populationDensity, setPopulationDensity] = useUrlNumberParameter(
    "density",
    DEFAULT_POPULATION_DENSITY,
    isNonnegative,
  );
  const [diffusionRate, setDiffusionRate] = useUrlNumberParameter(
    "diffusion",
    DEFAULT_DIFFUSION_RATE,
    isNonnegative,
  );
  const birds = useMemo(
    () => new Birds(seed, populationDensity, diffusionRate),
    [diffusionRate, populationDensity, seed],
  );
  const viewport = useViewport2D(INITIAL_VIEWPORT, {
    verticalScale: TIME_WORLD_SCALE,
    verticalZoomExponent: TIME_ZOOM_EXPONENT,
  });
  const { cursor, prepareContext, size, state, world } = viewport;
  const resolution = useMemo(
    () => birdsRenderResolution(birds, size, world, state),
    [birds, size, state, world],
  );
  const hoveredSpatialIndex =
    resolution === undefined
      ? undefined
      : Math.floor(cursor.x / resolution.cellWidth);
  const hoveredTimeIndex =
    resolution === undefined
      ? undefined
      : Math.round(cursor.y / resolution.timeStep);
  const hoveredCell = useMemo(
    () =>
      resolution === undefined ||
      hoveredSpatialIndex === undefined ||
      hoveredTimeIndex === undefined
        ? undefined
        : populationCellAt(hoveredSpatialIndex, hoveredTimeIndex, resolution),
    [hoveredSpatialIndex, hoveredTimeIndex, resolution],
  );
  const hoveredPopulation = useMemo(
    () =>
      hoveredCell === undefined || resolution === undefined
        ? undefined
        : populationAt(birds, hoveredCell, resolution),
    [birds, hoveredCell, resolution],
  );
  const [showFlows, setShowFlows] = useState(true);
  const flowResolution = useMemo(
    () =>
      resolution === undefined
        ? undefined
        : birds.resolveFlowResolution({
            targetSourceWidth: resolution.cellWidth,
            targetDestinationWidth: resolution.cellWidth,
            targetDuration: resolution.timeStep,
          }),
    [birds, resolution],
  );
  const hoveredFlows = useMemo(
    () => {
      if (!showFlows || hoveredCell === undefined || flowResolution === undefined) {
        return undefined;
      }
      const outflows = birds.queryOutflows({
        source: hoveredCell,
        resolution: flowResolution,
      });
      if (outflows.kind === "size-limit") return outflows;
      const inflows = birds.queryInflows({
        destination: hoveredCell,
        resolution: flowResolution,
      });
      if (inflows.kind === "size-limit") return inflows;
      return {
        flows: [...inflows.flows, ...outflows.flows],
        kind: "flows",
        resolution: flowResolution,
      } satisfies BirdsFlowListResult;
    },
    [birds, flowResolution, hoveredCell, showFlows],
  );
  const [tracked, setTracked] = useState<{
    readonly birds: Birds;
    readonly sighting: Sighting;
  }>();
  const trackedSighting = tracked?.birds === birds ? tracked.sighting : undefined;
  const trackedTrajectory = useMemo(
    () =>
      trackedSighting === undefined
        ? undefined
        : buildTrackedTrajectory(birds, trackedSighting),
    [birds, trackedSighting],
  );
  const [cacheUsage, setCacheUsage] = useState<CacheUsage>(() =>
    birds.getCacheUsage(),
  );
  const { measureFrame, performance } = useFramePerformance();

  useEffect(() => {
    const context = prepareContext();
    if (context === null) return;
    measureFrame(() =>
      drawBirds(
        context,
        size,
        world,
        state,
        birds,
        resolution,
        hoveredCell,
        hoveredFlows,
        trackedTrajectory,
        populationDensity,
      ),
    );
    updateCacheUsage(setCacheUsage, birds.getCacheUsage());
  }, [
    birds,
    hoveredCell,
    hoveredFlows,
    measureFrame,
    populationDensity,
    prepareContext,
    resolution,
    size,
    state,
    trackedTrajectory,
    world,
  ]);

  return (
    <>
      <title>{`Birds (${seed})`}</title>
      <ViewportFrame
        axisLabels={{ x: "x", y: "t" }}
        canvasLabel="Pannable spacetime population view with future upward"
        coordinateDisplay={
          hoveredCell === undefined
            ? undefined
            : {
                formattedX: `[${formatResolution(hoveredCell.min)}, ${formatResolution(hoveredCell.max)})`,
                formattedY: formatResolution(hoveredCell.time),
                xOperator: "∈",
              }
        }
        coordinateFooter={
          <span className="birds-sighting-control">
            <span>
              {hoveredPopulation === undefined
                ? "Population = —"
                : `Population = ${hoveredPopulation}`}
            </span>
            {trackedTrajectory?.partial ? (
              <span className="birds-sighting-status">
                {trackedTrajectory.partial === "budget"
                  ? "Partial track (budget reached)"
                  : "Partial track (numeric resolution reached)"}
              </span>
            ) : null}
          </span>
        }
        onCanvasClick={(event) => {
          if (resolution === undefined) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const point = screenToWorld(
            {
              x: ((event.clientX - bounds.left) / bounds.width) * size.width,
              y: ((event.clientY - bounds.top) / bounds.height) * size.height,
            },
            size,
            state,
            TIME_ZOOM_EXPONENT,
            TIME_WORLD_SCALE,
          );
          const cell = populationCellAt(
            Math.floor(point.x / resolution.cellWidth),
            Math.round(point.y / resolution.timeStep),
            resolution,
          );
          if (trajectoryContainsCell(trackedTrajectory, trackedSighting, cell)) {
            setTracked(undefined);
            return;
          }
          if (populationAt(birds, cell, resolution) === 0) return;
          setTracked({
            birds,
            sighting: Sighting.select({
              birds,
              cell,
              resolution,
              seed: `${seed} · sighting`,
            }),
          });
        }}
        viewport={viewport}
      >
        <SeedControl seed={seed} setSeed={setSeed} />
        <ModelParameterControl
          ariaLabel="Population density"
          label="ρ"
          setValue={setPopulationDensity}
          value={populationDensity}
        />
        <ModelParameterControl
          ariaLabel="Diffusion rate"
          label="D"
          setValue={setDiffusionRate}
          value={diffusionRate}
        />
        <span>
          Δx = {formatResolution(resolution?.cellWidth)} · Δt ={" "}
          {formatResolution(resolution?.timeStep)}
        </span>
        <CacheControl
          usage={cacheUsage}
          clearCache={() => {
            birds.clearCache();
            setCacheUsage(birds.getCacheUsage());
          }}
        />
        <PerformanceControl performance={performance} />
        <label>
          <input
            type="checkbox"
            checked={showFlows}
            onChange={(event) => setShowFlows(event.target.checked)}
          />{" "}
          Flows
        </label>
      </ViewportFrame>
    </>
  );
}

function buildTrackedTrajectory(
  birds: Birds,
  origin: Sighting,
): TrackedTrajectory | undefined {
  const resolution = birds.resolveFlowResolution({
    targetSourceWidth: origin.resolution.cellWidth,
    targetDestinationWidth: origin.resolution.cellWidth,
    targetDuration: origin.resolution.timeStep,
  });
  if (resolution === undefined) return undefined;

  const before: BirdsFlowSample[] = [];
  const after: BirdsFlowSample[] = [];
  let partial: TrackedTrajectory["partial"] = false;
  let current = origin;
  for (let index = 0; index < TRACKED_STEPS_PER_DIRECTION; index += 1) {
    try {
      const previous = current.prev(trackedStepOptions());
      before.unshift({ count: 1, source: previous.cell, destination: current.cell });
      current = previous;
    } catch (error) {
      if (error instanceof SightingBudgetExceededError) partial = "budget";
      else if (error instanceof SightingResolutionLimitError) partial = "numeric-resolution";
      else throw error;
      break;
    }
  }

  current = origin;
  for (let index = 0; index < TRACKED_STEPS_PER_DIRECTION; index += 1) {
    try {
      const next = current.next(trackedStepOptions());
      after.push({ count: 1, source: current.cell, destination: next.cell });
      current = next;
    } catch (error) {
      if (error instanceof SightingBudgetExceededError) partial = "budget";
      else if (error instanceof SightingResolutionLimitError) partial = "numeric-resolution";
      else throw error;
      break;
    }
  }

  return {
    flows: { flows: [...before, ...after], kind: "flows", resolution },
    partial,
  };
}

function trackedStepOptions() {
  return {
    maxQueries: TRACKED_STEP_QUERY_BUDGET,
    maxRefinements: TRACKED_STEP_REFINEMENT_BUDGET,
  } as const;
}

function trajectoryContainsCell(
  trajectory: TrackedTrajectory | undefined,
  origin: Sighting | undefined,
  cell: HoveredPopulationCell,
): boolean {
  if (origin !== undefined && cellContainsEndpoint(cell, origin.cell)) return true;
  if (trajectory?.flows.kind !== "flows") return false;
  return trajectory.flows.flows.some(
    ({ source, destination }) =>
      cellContainsEndpoint(cell, source) || cellContainsEndpoint(cell, destination),
  );
}

function cellContainsEndpoint(
  cell: HoveredPopulationCell,
  endpoint: BirdsFlowSample["source"],
): boolean {
  const center = (endpoint.min + endpoint.max) / 2;
  return endpoint.time === cell.time && center >= cell.min && center < cell.max;
}

function drawBirds(
  context: CanvasRenderingContext2D,
  size: Size2D,
  world: Size2D,
  viewport: ViewportState,
  birds: Birds,
  resolution: BirdsPopulationResolution | undefined,
  hoveredCell: HoveredPopulationCell | undefined,
  hoveredFlows: BirdsFlowListResult | undefined,
  trackedTrajectory: TrackedTrajectory | undefined,
  populationDensity: number,
): number {
  drawBackground(context, size, viewport);
  const bounds = {
    minX: viewport.centerX - world.width / 2,
    maxX: viewport.centerX + world.width / 2,
    minTime: viewport.centerY - world.height / 2,
    maxTime: viewport.centerY + world.height / 2,
  };
  if (resolution === undefined) return 0;
  const firstTimeIndex = Math.floor(bounds.minTime / resolution.timeStep);
  const finalTimeIndex = Math.ceil(bounds.maxTime / resolution.timeStep);
  const firstCellIndex = Math.floor(bounds.minX / resolution.cellWidth);
  const finalCellIndex = Math.ceil(bounds.maxX / resolution.cellWidth);
  const rows = finalTimeIndex - firstTimeIndex + 1;
  const columns = finalCellIndex - firstCellIndex;
  if (
    !Number.isSafeInteger(rows) ||
    !Number.isSafeInteger(columns) ||
    rows <= 0 ||
    columns <= 0 ||
    rows * columns > MAX_RENDER_SAMPLES
  ) {
    drawLimitMessage(context, size);
    return 0;
  }

  let queries = 0;
  for (
    let timeIndex = firstTimeIndex;
    timeIndex <= finalTimeIndex;
    timeIndex += 1
  ) {
    const result = birds.queryPopulation({
      min: bounds.minX,
      max: bounds.maxX,
      time: timeIndex * resolution.timeStep,
      resolution,
    });
    if (result.kind === "size-limit") {
      drawLimitMessage(context, size);
      return queries;
    }
    for (const sample of result.samples) {
      drawPopulationSample(
        context,
        size,
        viewport,
        result.sampledTime,
        resolution,
        sample,
        populationDensity,
      );
      queries += 1;
    }
  }
  if (hoveredCell !== undefined) {
    drawHoveredCell(context, size, viewport, resolution, hoveredCell);
  }
  if (hoveredFlows?.kind === "flows") {
    drawFlows(context, size, viewport, hoveredFlows);
    queries += hoveredFlows.flows.length;
  } else if (hoveredFlows?.kind === "size-limit") {
    drawFlowLimitMessage(context, size);
  }
  if (trackedTrajectory?.flows.kind === "flows") {
    drawFlows(context, size, viewport, trackedTrajectory.flows);
  }
  drawDirection(context);
  return queries;
}

function drawFlows(
  context: CanvasRenderingContext2D,
  size: Size2D,
  viewport: ViewportState,
  result: Extract<BirdsFlowListResult, { readonly kind: "flows" }>,
): void {
  const maximumCount = Math.max(1, ...result.flows.map(({ count }) => count));
  const renderedFlows: RenderedFlow[] = [];
  for (const flow of result.flows) {
    const sourceCenter = worldToScreen(
      {
        x: (flow.source.min + flow.source.max) / 2,
        y: flow.source.time,
      },
      size,
      viewport,
      TIME_ZOOM_EXPONENT,
      TIME_WORLD_SCALE,
    );
    const destinationCenter = worldToScreen(
      {
        x: (flow.destination.min + flow.destination.max) / 2,
        y: flow.destination.time,
      },
      size,
      viewport,
      TIME_ZOOM_EXPONENT,
      TIME_WORLD_SCALE,
    );
    const strength = Math.sqrt(flow.count / maximumCount);
    const centerDistance = Math.hypot(
      destinationCenter.x - sourceCenter.x,
      destinationCenter.y - sourceCenter.y,
    );
    if (centerDistance === 0) continue;
    const directionX = (destinationCenter.x - sourceCenter.x) / centerDistance;
    const directionY = (destinationCenter.y - sourceCenter.y) / centerDistance;
    const perpendicularX = -directionY;
    const perpendicularY = directionX;
    const zoomThicknessScale = Math.sqrt(
      Math.abs(destinationCenter.y - sourceCenter.y) / FLOW_REFERENCE_STEP_PIXELS,
    );
    const lineWidth = (1.5 + 3 * strength) * zoomThicknessScale;
    const haloLineWidth = lineWidth + 4 * zoomThicknessScale;
    const haloForwardPadding = 6 * zoomThicknessScale;
    const sourceSize = flowTileSize(
      flow.source,
      result.resolution.duration,
      size,
      viewport,
    );
    const destinationSize = flowTileSize(
      flow.destination,
      result.resolution.duration,
      size,
      viewport,
    );
    const sourceInset = centerSubtileBoundaryDistance(
      directionX,
      directionY,
      sourceSize,
    );
    const destinationInset = centerSubtileBoundaryDistance(
      directionX,
      directionY,
      destinationSize,
    );
    const source = {
      x: sourceCenter.x + directionX * (sourceInset + haloLineWidth / 2),
      y: sourceCenter.y + directionY * (sourceInset + haloLineWidth / 2),
    };
    const destination = {
      x: destinationCenter.x - directionX * (destinationInset + haloForwardPadding),
      y: destinationCenter.y - directionY * (destinationInset + haloForwardPadding),
    };
    const distance = Math.hypot(destination.x - source.x, destination.y - source.y);
    if (distance <= 0) continue;
    const arrowLength = Math.min(
      (10 + 3 * strength) * zoomThicknessScale,
      distance * 0.5,
    );
    const shaftEnd = {
      x: destination.x - directionX * arrowLength,
      y: destination.y - directionY * arrowLength,
    };
    const color = `rgb(255 222 142 / ${0.55 + 0.45 * strength})`;
    renderedFlows.push({
      arrowLength,
      color,
      destination,
      directionX,
      directionY,
      haloForwardPadding,
      lineWidth,
      perpendicularX,
      perpendicularY,
      shaftEnd,
      source,
      strength,
      zoomThicknessScale,
    });
  }

  for (const flow of renderedFlows) {
    const arrowWidth = (7 + 3 * flow.strength) * flow.zoomThicknessScale;
    const haloScale = 1 + (3 * flow.haloForwardPadding) / (2 * flow.arrowLength);
    const haloTip = {
      x: flow.destination.x + flow.directionX * flow.haloForwardPadding,
      y: flow.destination.y + flow.directionY * flow.haloForwardPadding,
    };
    context.lineCap = "round";
    context.strokeStyle = "rgb(3 7 12 / 88%)";
    context.lineWidth = flow.lineWidth + 4 * flow.zoomThicknessScale;
    context.beginPath();
    context.moveTo(flow.source.x, flow.source.y);
    context.lineTo(flow.shaftEnd.x, flow.shaftEnd.y);
    context.stroke();
    drawArrowheadTriangle(
      context,
      haloTip,
      flow.directionX,
      flow.directionY,
      flow.perpendicularX,
      flow.perpendicularY,
      {
        color: "rgb(3 7 12 / 92%)",
        length: flow.arrowLength * haloScale,
        width: arrowWidth * haloScale,
      },
    );
  }

  for (const flow of renderedFlows) {
    context.strokeStyle = flow.color;
    context.lineWidth = flow.lineWidth;
    context.beginPath();
    context.moveTo(flow.source.x, flow.source.y);
    context.lineTo(flow.shaftEnd.x, flow.shaftEnd.y);
    context.stroke();
    drawArrowheadTriangle(
      context,
      flow.destination,
      flow.directionX,
      flow.directionY,
      flow.perpendicularX,
      flow.perpendicularY,
      {
        color: flow.color,
        length: flow.arrowLength,
        width: (7 + 3 * flow.strength) * flow.zoomThicknessScale,
      },
    );
  }
}

function drawArrowheadTriangle(
  context: CanvasRenderingContext2D,
  tip: Point,
  directionX: number,
  directionY: number,
  perpendicularX: number,
  perpendicularY: number,
  style: {
    readonly color: string;
    readonly length: number;
    readonly width: number;
  },
): void {
  const baseX = tip.x - directionX * style.length;
  const baseY = tip.y - directionY * style.length;
  context.fillStyle = style.color;
  context.beginPath();
  context.moveTo(tip.x, tip.y);
  context.lineTo(
    baseX + perpendicularX * (style.width / 2),
    baseY + perpendicularY * (style.width / 2),
  );
  context.lineTo(
    baseX - perpendicularX * (style.width / 2),
    baseY - perpendicularY * (style.width / 2),
  );
  context.fill();
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface RenderedFlow {
  readonly arrowLength: number;
  readonly color: string;
  readonly destination: Point;
  readonly directionX: number;
  readonly directionY: number;
  readonly haloForwardPadding: number;
  readonly lineWidth: number;
  readonly perpendicularX: number;
  readonly perpendicularY: number;
  readonly shaftEnd: Point;
  readonly source: Point;
  readonly strength: number;
  readonly zoomThicknessScale: number;
}

function flowTileSize(
  cell: BirdsFlowSample["source"],
  duration: number,
  size: Size2D,
  viewport: ViewportState,
): Size2D {
  const centerX = (cell.min + cell.max) / 2;
  const left = worldToScreen(
    { x: cell.min, y: cell.time },
    size,
    viewport,
    TIME_ZOOM_EXPONENT,
    TIME_WORLD_SCALE,
  );
  const right = worldToScreen(
    { x: cell.max, y: cell.time },
    size,
    viewport,
    TIME_ZOOM_EXPONENT,
    TIME_WORLD_SCALE,
  );
  const top = worldToScreen(
    { x: centerX, y: cell.time + duration / 2 },
    size,
    viewport,
    TIME_ZOOM_EXPONENT,
    TIME_WORLD_SCALE,
  );
  const bottom = worldToScreen(
    { x: centerX, y: cell.time - duration / 2 },
    size,
    viewport,
    TIME_ZOOM_EXPONENT,
    TIME_WORLD_SCALE,
  );
  return { width: Math.abs(right.x - left.x), height: Math.abs(bottom.y - top.y) };
}

function centerSubtileBoundaryDistance(
  directionX: number,
  directionY: number,
  tile: Size2D,
): number {
  const horizontalDistance =
    directionX === 0 ? Number.POSITIVE_INFINITY : tile.width / 6 / Math.abs(directionX);
  const verticalDistance =
    directionY === 0 ? Number.POSITIVE_INFINITY : tile.height / 6 / Math.abs(directionY);
  return Math.min(horizontalDistance, verticalDistance);
}

function populationCellAt(
  spatialIndex: number,
  timeIndex: number,
  resolution: BirdsPopulationResolution,
): HoveredPopulationCell {
  const min = spatialIndex * resolution.cellWidth;
  return {
    min,
    max: min + resolution.cellWidth,
    time: timeIndex * resolution.timeStep,
  };
}

function populationAt(
  birds: Birds,
  cell: HoveredPopulationCell,
  resolution: BirdsPopulationResolution,
): number | undefined {
  const result = birds.queryPopulation({
    min: cell.min,
    max: cell.max,
    time: cell.time,
    resolution,
  });
  return result.kind === "population-profile"
    ? result.samples[0]?.count
    : undefined;
}

function birdsRenderResolution(
  birds: Birds,
  size: Size2D,
  world: Size2D,
  viewport: ViewportState,
): BirdsPopulationResolution | undefined {
  const requested = birds.resolvePopulationResolution({
    targetCellWidth: (world.width / size.width) * TARGET_CELL_PIXELS,
    targetTimeStep: (world.height / size.height) * TARGET_TIME_STEP_PIXELS,
  });
  if (requested === undefined) return undefined;
  const bounds = {
    minX: viewport.centerX - world.width / 2,
    maxX: viewport.centerX + world.width / 2,
    minTime: viewport.centerY - world.height / 2,
    maxTime: viewport.centerY + world.height / 2,
  };
  const nearby = birds.getNearbyPopulationResolutions(requested, 16);
  let selected = nearby[0] ?? requested;
  for (const candidate of nearby) {
    if (candidate.cellWidth < requested.cellWidth) break;
    const columns =
      Math.ceil(bounds.maxX / candidate.cellWidth) -
      Math.floor(bounds.minX / candidate.cellWidth);
    const rows =
      Math.ceil(bounds.maxTime / candidate.timeStep) -
      Math.floor(bounds.minTime / candidate.timeStep) +
      1;
    if (columns * rows > MAX_RENDER_SAMPLES) break;
    selected = candidate;
  }
  return selected;
}

function drawBackground(
  context: CanvasRenderingContext2D,
  size: Size2D,
  viewport: ViewportState,
): void {
  context.fillStyle = "#080d13";
  context.fillRect(0, 0, size.width, size.height);
  const origin = worldToScreen(
    { x: 0, y: 0 },
    size,
    viewport,
    TIME_ZOOM_EXPONENT,
    TIME_WORLD_SCALE,
  );
  context.strokeStyle = "#29394a";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(origin.x, 0);
  context.lineTo(origin.x, size.height);
  context.stroke();
}

function drawPopulationSample(
  context: CanvasRenderingContext2D,
  size: Size2D,
  viewport: ViewportState,
  time: number,
  resolution: BirdsPopulationResolution,
  sample: BirdsPopulationSample,
  populationDensity: number,
): void {
  const left = worldToScreen(
    { x: sample.interval.min, y: time },
    size,
    viewport,
    TIME_ZOOM_EXPONENT,
    TIME_WORLD_SCALE,
  );
  const right = worldToScreen(
    { x: sample.interval.max, y: time },
    size,
    viewport,
    TIME_ZOOM_EXPONENT,
    TIME_WORLD_SCALE,
  );
  const nextTime = worldToScreen(
    { x: 0, y: time + resolution.timeStep },
    size,
    viewport,
    TIME_ZOOM_EXPONENT,
    TIME_WORLD_SCALE,
  );
  const rowSpacing = Math.abs(nextTime.y - left.y);
  const thickness = Math.max(1, Math.ceil(rowSpacing) + 1);
  const expected = populationDensity * resolution.cellWidth;
  const intensity = expected === 0 ? 0 : 1 - Math.exp(-sample.count / expected);
  context.fillStyle = `rgb(105 215 255 / ${0.08 + 0.92 * intensity})`;
  context.fillRect(
    left.x,
    left.y - thickness / 2,
    Math.max(1, right.x - left.x),
    thickness,
  );
}

function drawHoveredCell(
  context: CanvasRenderingContext2D,
  size: Size2D,
  viewport: ViewportState,
  resolution: BirdsPopulationResolution,
  cell: HoveredPopulationCell,
): void {
  const topLeft = worldToScreen(
    { x: cell.min, y: cell.time + resolution.timeStep / 2 },
    size,
    viewport,
    TIME_ZOOM_EXPONENT,
    TIME_WORLD_SCALE,
  );
  const bottomRight = worldToScreen(
    { x: cell.max, y: cell.time - resolution.timeStep / 2 },
    size,
    viewport,
    TIME_ZOOM_EXPONENT,
    TIME_WORLD_SCALE,
  );
  context.strokeStyle = "#fff0bd";
  context.lineWidth = 2;
  context.strokeRect(
    Math.round(topLeft.x) + 0.5,
    Math.round(topLeft.y) + 0.5,
    Math.round(bottomRight.x - topLeft.x),
    Math.round(bottomRight.y - topLeft.y),
  );
}

function drawDirection(context: CanvasRenderingContext2D): void {
  const x = 18;
  const top = 66;
  context.strokeStyle = "rgb(173 225 255 / 72%)";
  context.fillStyle = "rgb(190 231 255 / 82%)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(x, top + 30);
  context.lineTo(x, top);
  context.lineTo(x - 4, top + 7);
  context.moveTo(x, top);
  context.lineTo(x + 4, top + 7);
  context.stroke();
  context.font = "11px ui-monospace, monospace";
  context.fillText("future", x + 8, top + 5);
}

function drawLimitMessage(
  context: CanvasRenderingContext2D,
  size: Size2D,
): void {
  context.fillStyle = "rgb(255 196 107 / 88%)";
  context.font = "12px ui-monospace, monospace";
  context.textAlign = "center";
  context.fillText(
    "View exceeds the population rendering budget",
    size.width / 2,
    size.height / 2,
  );
  context.textAlign = "start";
}

function drawFlowLimitMessage(
  context: CanvasRenderingContext2D,
  size: Size2D,
): void {
  context.fillStyle = "rgb(255 196 107 / 88%)";
  context.font = "11px ui-monospace, monospace";
  context.textAlign = "center";
  context.fillText(
    "Flow envelope exceeds the overlay budget",
    size.width / 2,
    18,
  );
  context.textAlign = "start";
}

function updateCacheUsage(
  setUsage: (update: (current: CacheUsage) => CacheUsage) => void,
  next: CacheUsage,
): void {
  setUsage((current) =>
    current.entries === next.entries && current.capacity === next.capacity
      ? current
      : next,
  );
}

function formatResolution(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value === 0) return "0";
  if (Math.abs(value) < 0.001 || Math.abs(value) >= 10_000) {
    return value.toExponential(2);
  }
  return String(value);
}

function isNonnegative(value: number): boolean {
  return value >= 0;
}
