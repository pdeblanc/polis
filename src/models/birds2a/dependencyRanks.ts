import { EXPANSION_TIME_PER_WIDTH_SQUARED, type ExpansionCell } from './expansion';
import { birds2aScale, classifyBirds2aCell, classifyBirds2aCellSubdivision, classifyBirds2aFlow,
  type Birds2aCell, type Birds2aFlow } from './classifiers';
import { classifyBirds2aFlowTimeSubdivision, classifyBirds2aFlowSpaceSubdivision,
  classifyBirds2aInflowSubdivision, classifyBirds2aOutflowSubdivision } from './ownerClassifiers';

export type Birds2aDependencyNode =
  | { readonly role: 'cell' | 'cell-subdivision' | 'outflow-subdivision' | 'inflow-subdivision'; readonly cell: Birds2aCell }
  | { readonly role: 'flow' | 'temporal-subdivision' | 'flow-space-subdivision'; readonly flow: Birds2aFlow };
export type Birds2aQueryNode = { readonly role: 'cell'; readonly cell: Birds2aCell }
  | { readonly role: 'flow'; readonly flow: Birds2aFlow };
export interface Birds2aDependencyBounds {
  readonly ceilingWidth: number;
  readonly timeRadius: number;
}
export interface Birds2aDependencyEdge {
  readonly dependent: Birds2aDependencyNode;
  readonly dependency: Birds2aDependencyNode;
}

/** Diagnostic proof context, not a model limit. See BIRDS_2A_DEPENDENCIES.md. */
export function birds2aDependencyBounds(root: Birds2aQueryNode, origin: ExpansionCell): Birds2aDependencyBounds {
  const cells = root.role === 'cell' ? [root.cell] : [root.flow.source, root.flow.destination];
  if (root.role === 'cell' ? !classifyBirds2aCell(root.cell, origin) : !classifyBirds2aFlow(root.flow, origin)) {
    throw new RangeError('Invalid Birds 2a dependency root');
  }
  const widthExponent = Math.max(Math.log2(origin.max - origin.min) + 1,
    ...cells.map((cell) => Math.log2(cell.max - cell.min)));
  const time = Math.max(...cells.map((cell) => Math.abs(cell.time)));
  const exponent = Math.max(widthExponent, time === 0 ? -Infinity
    : Math.ceil((Math.log2(time) - Math.log2(EXPANSION_TIME_PER_WIDTH_SQUARED)) / 2));
  const ceilingWidth = 2 ** exponent, timeRadius = EXPANSION_TIME_PER_WIDTH_SQUARED * ceilingWidth ** 2;
  if (!birds2aScale(ceilingWidth) || !Number.isFinite(timeRadius) || time > timeRadius) {
    throw new RangeError('Dependency proof window exceeds numeric geometry');
  }
  return { ceilingWidth, timeRadius };
}

/** Natural-number rank. Expansion facts have rank zero. No production query uses
 * this arithmetic; observers/tests can check every evaluated dependency edge. */
export function birds2aDependencyRank(
  node: Birds2aDependencyNode, origin: ExpansionCell, bounds: Birds2aDependencyBounds,
): number | undefined {
  const cells = 'cell' in node ? [node.cell] : [node.flow.source, node.flow.destination];
  if (cells.some((cell) => Math.abs(cell.time) > bounds.timeRadius || cell.max - cell.min > bounds.ceilingWidth)) {
    throw new Error('Dependency escaped its proof window');
  }
  const rank = (width: number, order: number) => {
    const level = Math.log2(bounds.ceilingWidth) - Math.log2(width);
    if (!Number.isInteger(level) || level < 0) throw new Error('Dependency exceeded its coarse rank ceiling');
    return 15 * level + order + 1;
  };
  if ('cell' in node) {
    const width = node.cell.max - node.cell.min;
    if (node.role === 'cell') {
      const construction = classifyBirds2aCell(node.cell, origin);
      if (!construction) return undefined;
      if (construction.kind === 'expansion') return 0;
      return construction.kind === 'spatial-child' ? rank(2 * width, 10) : rank(width, 8);
    }
    if (node.role === 'cell-subdivision') {
      const owner = classifyBirds2aCellSubdivision(node.cell, origin);
      return !owner ? undefined : owner.kind === 'expansion' ? 0 : rank(width, 9);
    }
    const owner = (node.role === 'outflow-subdivision' ? classifyBirds2aOutflowSubdivision : classifyBirds2aInflowSubdivision)(node.cell, origin);
    return owner ? rank(width, 11) : undefined;
  }
  const width = node.flow.source.max - node.flow.source.min;
  if (node.role === 'temporal-subdivision') {
    const owner = classifyBirds2aFlowTimeSubdivision(node.flow, origin);
    return owner ? rank(width, owner.stage === 'A' ? 2 : 5) : undefined;
  }
  if (node.role === 'flow-space-subdivision') {
    return classifyBirds2aFlowSpaceSubdivision(node.flow, origin) ? rank(width, 13) : undefined;
  }
  const construction = classifyBirds2aFlow(node.flow, origin);
  if (!construction) return undefined;
  switch (construction.kind) {
    case 'expansion': return 0;
    case 'spatial-reconciliation': return rank(2 * width, 14);
    case 'source-subdivision': return rank(2 * width, 12);
    case 'destination-subdivision': return rank(width, 12);
    case 'temporal-aggregation': return rank(width, construction.stage === 'B' ? 4 : 7);
  }
}
