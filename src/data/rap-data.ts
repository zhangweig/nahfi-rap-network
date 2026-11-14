import type {ArtistNode, Relationship, Work} from './types';
import {seedNodes, seedRelations} from './seed';
import {reportNodes, reportOverrides, reportRelations} from './report';
import catalog from './catalog.json';
import community from './community-approved.json';
import sheetOverrides from './sheet-overrides.json';
import {applyApproved, applyOverrides, type ApprovedFile, type OverrideFile} from './merge-approved';
export type {ArtistNode, Relationship, RelationType, Work, Evidence} from './types';
export const datasetUpdatedAt = '2026-11-14';

const importedNodes:ArtistNode[] = catalog.artists as ArtistNode[];
const baseIds = new Set([...seedNodes.map(node => node.id), ...importedNodes.map(node => node.id)]);
const baseNodes:ArtistNode[] = [
  ...seedNodes.map(node => {
    const imported = importedNodes.find(item => item.id === node.id);
    return imported ? {...node, aliases:[...new Set([...(node.aliases || []), ...(imported.aliases || [])])], catalogArtistIds:imported.catalogArtistIds, sources:imported.sources} : node;
  }),
  ...importedNodes.filter(node => !seedNodes.some(seed => seed.id === node.id)),
  ...reportNodes.filter(node => !baseIds.has(node.id)),
].map(node => {
  // Report-sourced or well-documented locations win over a bare 未标注 marker.
  const patch = reportOverrides[node.id];
  return patch && (node.city === '未标注' || patch.city !== undefined) ? {...node, ...patch} : node;
});

// Preserve the original evidence records and merge their per-pair track references.
const legacyWorks = new Map<string,Work>();
for (const edge of seedRelations) {
  if (!edge.track) continue;
  const work = legacyWorks.get(edge.track.id) || {
    ...edge.track, artistIds:[], creditedAs:'', album:'', evidence:edge.evidence,
  };
  work.artistIds = [...new Set([...work.artistIds, edge.source, edge.target])];
  work.creditedAs = work.artistIds.map(id => baseNodes.find(node => node.id === id)!.name).join('、');
  legacyWorks.set(work.id, work);
}
const baseWorks:Work[] = [...legacyWorks.values(), ...catalog.works as Work[]];

// Only artists explicitly credited on this exact recording are connected.
// A group credit never expands into all its members.
const catalogRelations:Relationship[] = (catalog.works as Work[]).flatMap(work =>
  work.artistIds.flatMap((source, index) => work.artistIds.slice(index + 1).map(target => ({
    id:`${work.id}-${source}-${target}`, source, target, type:'collaboration' as const,
    label:`《${work.title}》· ${work.version}`, track:{id:work.id,title:work.title,year:work.year,version:work.version},
    evidence:work.evidence, status:'verified' as const,
  })))
);
const baseRelations:Relationship[] = [...seedRelations, ...reportRelations, ...catalogRelations];

// 站长在飞书里审核通过的内容（scripts/feishu-pull.mjs 生成）。
// 空文件时完全等价于改动前的行为。
// 表格（scripts/sheet-import.mjs 生成）是本地的最终人工编辑，叠在社区审核结果之上。
const withSheet = applyOverrides(
  {nodes: baseNodes, relations: baseRelations, works: baseWorks},
  sheetOverrides as OverrideFile,
);
const merged = applyApproved(
  withSheet,
  (community as ApprovedFile).records ?? [],
);

/** 未叠加任何人工编辑的基线，供导入脚本做「只写改动行」的比对。 */
export const baseDataset = {nodes: baseNodes, relations: baseRelations, works: baseWorks};

export const nodes:ArtistNode[] = merged.nodes;
export const relations:Relationship[] = merged.relations;
export const works:Work[] = merged.works;
export const workById = new Map(works.map(work => [work.id, work]));
export const nodeById = new Map(nodes.map(node => [node.id, node]));
export const cities = [...new Set(nodes.map(node => node.city))].sort((a,b) => a === '未标注' ? 1 : b === '未标注' ? -1 : a.localeCompare(b,'zh-CN'));
export const trackCount = works.length;
export const artistCount = nodes.filter(node => node.kind === 'artist').length;
