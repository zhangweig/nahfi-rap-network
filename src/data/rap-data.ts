import type {ArtistNode, Relationship, Work} from './types';
import {seedNodes, seedRelations} from './seed';
import catalog from './catalog.json';
export type {ArtistNode, Relationship, RelationType, Work, Evidence} from './types';
export const datasetUpdatedAt = '2026-11-13';

const importedNodes:ArtistNode[] = catalog.artists as ArtistNode[];
export const nodes:ArtistNode[] = [
  ...seedNodes.map(node => {
    const imported = importedNodes.find(item => item.id === node.id);
    return imported ? {...node, aliases:[...new Set([...(node.aliases || []), ...(imported.aliases || [])])], catalogArtistIds:imported.catalogArtistIds, sources:imported.sources} : node;
  }),
  ...importedNodes.filter(node => !seedNodes.some(seed => seed.id === node.id)),
];

// Preserve the original evidence records and merge their per-pair track references.
const legacyWorks = new Map<string,Work>();
for (const edge of seedRelations) {
  if (!edge.track) continue;
  const work = legacyWorks.get(edge.track.id) || {
    ...edge.track, artistIds:[], creditedAs:'', album:'', evidence:edge.evidence,
  };
  work.artistIds = [...new Set([...work.artistIds, edge.source, edge.target])];
  work.creditedAs = work.artistIds.map(id => nodes.find(node => node.id === id)!.name).join('、');
  legacyWorks.set(work.id, work);
}
export const works:Work[] = [...legacyWorks.values(), ...catalog.works as Work[]];
export const workById = new Map(works.map(work => [work.id, work]));
export const nodeById = new Map(nodes.map(node => [node.id, node]));

// Only artists explicitly credited on this exact recording are connected.
// A group credit never expands into all its members.
const catalogRelations:Relationship[] = (catalog.works as Work[]).flatMap(work =>
  work.artistIds.flatMap((source, index) => work.artistIds.slice(index + 1).map(target => ({
    id:`${work.id}-${source}-${target}`, source, target, type:'collaboration' as const,
    label:`《${work.title}》· ${work.version}`, track:{id:work.id,title:work.title,year:work.year,version:work.version},
    evidence:work.evidence, status:'verified' as const,
  })))
);
export const relations:Relationship[] = [...seedRelations, ...catalogRelations];
export const cities = [...new Set(nodes.map(node => node.city))].sort((a,b) => a === '未标注' ? 1 : b === '未标注' ? -1 : a.localeCompare(b,'zh-CN'));
export const trackCount = works.length;
export const artistCount = nodes.filter(node => node.kind === 'artist').length;
