import type {ArtistNode, Relationship, Work} from './types';
import {seedNodes, seedRelations} from './seed';
import {reportNodes, reportOverrides, reportRelations} from './report';
import catalog from './catalog.json';
import nameOnly from './name-only.json';
import xlsxProvinces from './xlsx-province.json';
import crewRelations from './crew-relations.json';
import lateNodes from './late-nodes.json';
import community from './community-approved.json';
import sheetOverrides from './sheet-overrides.json';
import {applyApproved, applyOverrides, type ApprovedFile, type OverrideFile} from './merge-approved';
import {provinceOf} from '../lib/province';
export type {ArtistNode, Relationship, RelationType, Work, Evidence} from './types';
export const datasetUpdatedAt = '2026-11-14';

const xlsxAssignments = new Map(xlsxProvinces.assignments.map(item => [item.id, item]));
/** 按用户名单的籍贯省份覆盖；原城市留作溯源。已经一致的具体城市保持不动。 */
const applyXlsxProvince = (node:ArtistNode):ArtistNode => {
  const assign = xlsxAssignments.get(node.id);
  if (!assign || provinceOf(node.city) === assign.province) return node;
  return {
    ...node,
    city: assign.province,
    xlsxProvince: {
      province: assign.province, originalCity: node.city, row: assign.row,
      verify: assign.verify, origin: assign.origin, note: assign.note,
    },
  };
};
const importedNodes:ArtistNode[] = catalog.artists as ArtistNode[];
const baseIds = new Set([...seedNodes.map(node => node.id), ...importedNodes.map(node => node.id)]);
const baseNodes:ArtistNode[] = [
  ...seedNodes.map(node => {
    const imported = importedNodes.find(item => item.id === node.id);
    return imported ? {...node, aliases:[...new Set([...(node.aliases || []), ...(imported.aliases || [])])], catalogArtistIds:imported.catalogArtistIds, sources:imported.sources} : node;
  }),
  ...importedNodes.filter(node => !seedNodes.some(seed => seed.id === node.id)),
  ...reportNodes.filter(node => !baseIds.has(node.id)),
  // 先补名字：只建节点，不带作品、关系或头像。未标地域的会进「地域待考据」名单，
  // 已标地域的直接出现在对应省份框；全部名字都能被搜索到，后续逐项补齐资料即可。
  ...(nameOnly.artists as ArtistNode[]),
  ...(crewRelations.groups as ArtistNode[]),
].map(node => {
  // Report-sourced or well-documented locations win over a bare 未标注 marker.
  const patch = reportOverrides[node.id];
  const withReport = patch && (node.city === '未标注' || patch.city !== undefined) ? {...node, ...patch} : node;
  return applyXlsxProvince(withReport);
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
// 名单里明确标注的厂牌关系：组合归属记 member，历史/经纪/角色措辞记 affiliation。
const crewEdges:Relationship[] = crewRelations.relations as Relationship[];
const baseRelations:Relationship[] = [...seedRelations, ...reportRelations, ...catalogRelations, ...crewEdges];

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

/**
 * 同一艺人在不同来源各建了一条节点（报告里的浅档案 + 平台目录的完整档案）。
 * 这里在组装末尾统一到一条 canonical ID：保留资料更全的主节点，把别名与描述
 * 并入，再把关系端点重定向过去。数据源文件不动，仍可按 id 溯源各条的来历。
 * 注意：邓典（pending-190，河南流行歌手）与邓典果DDG（ddg，成都说唱）是两个
 * 不同的人，不在合并范围内。
 */
const CANONICAL: Record<string,string> = {wanida:'vinida', yanghesu:'keyng'};

function canonicalize(nodes:ArtistNode[], rels:Relationship[], works:Work[]) {
  const redirect = (id:string) => CANONICAL[id] || id;
  const byId = new Map(nodes.map(node => [node.id, node]));
  // 把别名节点的 aliases / description 信息并入主节点，避免丢报告里的线索。
  for (const [from, to] of Object.entries(CANONICAL)) {
    const dup = byId.get(from);
    const main = byId.get(to);
    if (!main) continue;
    if (dup) {
      main.aliases = [...new Set([...(main.aliases || []), ...(dup.aliases || []), dup.name])];
      const extra = dup.description?.trim();
      if (extra && !main.description.includes(extra)) {
        main.description = `${main.description}\n${extra}`;
      }
    }
  }
  const kept = nodes.filter(node => !CANONICAL[node.id]);
  const remapIds = (ids:string[]) => [...new Set(ids.map(redirect))];
  return {
    nodes: kept,
    relations: rels.map(rel => {
      const source = redirect(rel.source), target = redirect(rel.target);
      const changed = source !== rel.source || target !== rel.target;
      return changed ? {...rel, source, target, id: `${rel.id}~canon`} : rel;
    }).filter(rel => rel.source !== rel.target), // 合并后若出现自环则丢弃
    works: works.map(work => {
      const artistIds = remapIds(work.artistIds);
      return artistIds.length === work.artistIds.length && artistIds.every((id,i) => id === work.artistIds[i])
        ? work : {...work, artistIds};
    }),
  };
}
const canon = canonicalize(merged.nodes, merged.relations, merged.works);

/**
 * 追加区（late-nodes.json）必须挂在整条流水线的最后一步。
 * 节点下标就是卡面档案号（serial），这样新收录的人只会拿到更大的号，
 * 已有编号永不后移；如果插到上面任何一段（catalog / report / name-only / 厂牌），
 * 后面所有人的号都会整体 +1。
 */
const lateArtists = lateNodes.artists as ArtistNode[];
const lateGroups = lateNodes.groups as ArtistNode[];

// 按省份名单是用户明确指定的口径，最后再叠一次，确保盖过旧的飞书人工编辑。
export const nodes:ArtistNode[] = [...canon.nodes.map(applyXlsxProvince), ...lateArtists, ...lateGroups];
export const relations:Relationship[] = [...canon.relations, ...(lateNodes.relations as Relationship[])];

/**
 * 后建档者的作品署名补丁：目录抓取时这些人还没有节点，平台署名里他们的名字被丢掉了。
 * 补档后把 artistIds 补回去，creditedAs 始终保留平台原文，不做改写。
 */
const workPatches = new Map<string,string[]>();
for (const patch of lateNodes.workPatches) workPatches.set(patch.id, patch.addArtistIds);

export const works:Work[] = canon.works.map(work => {
  const extra = workPatches.get(work.id);
  if (!extra) return work;
  return {...work, artistIds:[...new Set([...work.artistIds, ...extra])]};
});
export const workById = new Map(works.map(work => [work.id, work]));
export const nodeById = new Map(nodes.map(node => [node.id, node]));
export const cities = [...new Set(nodes.map(node => node.city))].sort((a,b) => a === '未标注' ? 1 : b === '未标注' ? -1 : a.localeCompare(b,'zh-CN'));
export const trackCount = works.length;
export const artistCount = nodes.filter(node => node.kind === 'artist').length;
