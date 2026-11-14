import type {ArtistNode, Relationship, Work} from './types';

/**
 * 一条审核通过的投稿。字段与 server/domain.mjs 的 compose() 输入保持一一对应：
 * entityId ← SQLite 的 entity_id，payload ← 校验后写入 approved.payload 的完整实体。
 * 这里用对象而非 JSON 字符串，是因为前端直接消费静态 JSON 文件。
 */
export interface ApprovedRecord {
  entityId: string;
  kind: 'artist' | 'relationship';
  payload: ArtistNode | Relationship;
  submissionId?: string;
  reviewedAt?: string;
}

export interface ApprovedFile {
  generatedAt?: string | null;
  source?: string;
  records: ApprovedRecord[];
}

/** 表格导入的覆盖文件：比审核文件多一个「下架」名单。 */
export interface OverrideFile extends ApprovedFile {
  retired?: string[];
}

export interface Collection {
  nodes: ArtistNode[];
  relations: Relationship[];
  works: Work[];
}

/**
 * 应用表格里的人工编辑：先按下架名单剔除，再按 id 覆盖/追加。
 * 下架一个人会连带剔除他的所有关系，否则图上会出现指向空节点的线。
 */
export function applyOverrides(base: Collection, file: OverrideFile | null | undefined): Collection {
  const records = file?.records ?? [];
  const retired = new Set(file?.retired ?? []);
  if (!records.length && !retired.size) return base;

  const alive: Collection = retired.size
    ? {
        nodes: base.nodes.filter(node => !retired.has(node.id)),
        relations: base.relations.filter(
          relation => !retired.has(relation.id) && !retired.has(relation.source) && !retired.has(relation.target),
        ),
        works: base.works.filter(work => !work.artistIds.every(id => retired.has(id))),
      }
    : base;

  return applyApproved(alive, records);
}

/**
 * 把审核通过的内容叠到基线之上。
 * 语义必须与 server/domain.mjs 的 compose() 一致：同 id 覆盖、新 id 追加、
 * 带 track 的关系补一条作品记录（否则相关作品在作品库里看不到）。
 */
export function applyApproved(base: Collection, records: ApprovedRecord[]): Collection {
  if (!records.length) return base;

  const artistPatch = new Map<string, ArtistNode>();
  const relationPatch = new Map<string, Relationship>();
  for (const record of records) {
    if (!record?.payload || !record.entityId) continue;
    if (record.kind === 'artist') artistPatch.set(record.entityId, record.payload as ArtistNode);
    else if (record.kind === 'relationship') relationPatch.set(record.entityId, record.payload as Relationship);
  }

  // map 覆盖保住原有顺序，聚落布局和关系数排序才不会因为一次审核而整体跳动。
  const knownNodeIds = new Set(base.nodes.map(node => node.id));
  const nodes = [
    ...base.nodes.map(node => artistPatch.get(node.id) || node),
    ...[...artistPatch.values()].filter(node => !knownNodeIds.has(node.id)),
  ];

  const knownRelationIds = new Set(base.relations.map(relation => relation.id));
  const relations = [
    ...base.relations.map(relation => relationPatch.get(relation.id) || relation),
    ...[...relationPatch.values()].filter(relation => !knownRelationIds.has(relation.id)),
  ];

  const works = [...base.works];
  const workIndex = new Map(works.map((work, index) => [work.id, index]));
  const nameById = new Map(nodes.map(node => [node.id, node.name]));
  for (const record of records) {
    if (record.kind !== 'relationship') continue;
    const edge = record.payload as Relationship;
    if (!edge.track) continue;
    const ids = [edge.source, edge.target];
    const work: Work = {
      ...edge.track,
      artistIds: ids,
      creditedAs: ids.map(id => nameById.get(id) || id).join(' / '),
      album: '',
      evidence: edge.evidence,
    };
    const at = workIndex.get(edge.track.id);
    if (at === undefined) {
      workIndex.set(edge.track.id, works.length);
      works.push(work);
    } else {
      works[at] = work;
    }
  }

  return {nodes, relations, works};
}
