import {nodes, works, relations, nodeById, type Work, type ArtistNode, type RelationType,type Relationship} from '../data/rap-data';

export const normalize = (value:string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s._·-]+/g, '');
export const artistMatches = (node:ArtistNode, query:string) =>
  [node.name, ...(node.aliases || [])].some(value => normalize(value).includes(normalize(query)));
export const workMatches = (work:Work, query:string,artistMap:Map<string,ArtistNode>=nodeById) => {
  const needle = normalize(query);
  return [work.title, work.album, work.creditedAs, ...(work.searchAliases || []), ...work.artistIds.flatMap(id => {
    const artist = artistMap.get(id);
    return artist ? [artist.name, ...(artist.aliases || [])] : [];
  })].some(value => normalize(value).includes(needle));
};
export const worksByArtist = new Map(nodes.map(node => [node.id, works.filter(work => work.artistIds.includes(node.id))]));
export const relationCounts = new Map(nodes.map(node => [node.id, relations.filter(edge => edge.source === node.id || edge.target === node.id).length]));

// Aggregate only the drawing. The evidence graph keeps every recording as its own edge.
export function makeRenderData(types:RelationType[], city:string,data:{nodes:ArtistNode[];relations:Relationship[]}={nodes,relations}) {
  const {nodes,relations}=data;
  const nodeById=new Map(nodes.map(n=>[n.id,n]));
  const visible = nodes.filter(node => city === '全部城市' || node.city === city);
  const ids = new Set(visible.map(node => node.id));
  const bundles = new Map<string,{id:string;source:string;target:string;type:RelationType;labels:string[]}>();
  for (const edge of relations) {
    if (!types.includes(edge.type) || !ids.has(edge.source) || !ids.has(edge.target)) continue;
    const [source,target] = [edge.source,edge.target].sort();
    const key = `${source}|${target}|${edge.type}`;
    const bundle = bundles.get(key) || {id:key,source,target,type:edge.type,labels:[]};
    bundle.labels.push(edge.label);
    bundles.set(key,bundle);
  }
  const links = [...bundles.values()].map(bundle => ({
    ...bundle, count:bundle.labels.length,
    label:`${nodeById.get(bundle.source)!.name} ↔ ${nodeById.get(bundle.target)!.name}：${bundle.labels.join('；')}`,
    curvature:bundle.type === 'collaboration' && [...bundles.values()].some(other => other.source === bundle.source && other.target === bundle.target && other.type !== bundle.type) ? .18 : 0,
  }));
  return {nodes:visible.map(node => ({...node})),links};
}
