import Graph from 'graphology';
import {bidirectional} from 'graphology-shortest-path';
import {nodes,relations,type RelationType,type ArtistNode,type Relationship} from '../data/rap-data';
type Data={nodes:ArtistNode[];relations:Relationship[]};
export function makeGraph(allowedTypes:RelationType[], allowedCities:string[],data:Data={nodes,relations}) {
 const g = new Graph({type:'undirected',multi:true});
 data.nodes.filter(n=>allowedCities.length===0||allowedCities.includes(n.city)).forEach(n=>g.addNode(n.id,{label:n.name}));
 data.relations.filter(r=>allowedTypes.includes(r.type)&&g.hasNode(r.source)&&g.hasNode(r.target)).forEach(r=>g.addUndirectedEdgeWithKey(r.id,r.source,r.target,{relation:r.type}));
 return g;
}
export function shortestRoute(from:string,to:string,types:RelationType[],cities:string[],data:Data={nodes,relations}):string[]|null {
 const g=makeGraph(types,cities,data);
 if(!g.hasNode(from)||!g.hasNode(to))return null;
 return bidirectional(g,from,to);
}
