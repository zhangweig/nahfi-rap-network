import Graph from 'graphology';
import {bidirectional} from 'graphology-shortest-path';
import {nodes,relations,type RelationType} from '../data/rap-data';
export function makeGraph(allowedTypes:RelationType[], allowedCities:string[]) {
 const g = new Graph({type:'undirected',multi:true});
 nodes.filter(n=>allowedCities.length===0||allowedCities.includes(n.city)).forEach(n=>g.addNode(n.id,{label:n.name}));
 relations.filter(r=>allowedTypes.includes(r.type)&&g.hasNode(r.source)&&g.hasNode(r.target)).forEach(r=>g.addUndirectedEdgeWithKey(r.id,r.source,r.target,{relation:r.type}));
 return g;
}
export function shortestRoute(from:string,to:string,types:RelationType[],cities:string[]):string[]|null {
 const g=makeGraph(types,cities);
 if(!g.hasNode(from)||!g.hasNode(to))return null;
 return bidirectional(g,from,to);
}
