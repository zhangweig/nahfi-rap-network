import {createContext,useContext,useEffect,useState,useCallback,type ReactNode} from 'react';
import {nodes,relations,works,type ArtistNode,type Relationship,type Work} from '../data/rap-data';
export interface Dataset {nodes:ArtistNode[];relations:Relationship[];works:Work[];revisions:Record<string,string>}
export async function api<T=any>(path:string,body?:unknown):Promise<T>{
  const response=await fetch(`/api${path}`,{credentials:'same-origin',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  let result;try{result=await response.json();}catch{throw new Error('投稿服务尚未连接，请使用 npm run dev 启动完整服务');}
  if(!response.ok)throw new Error(result.error||'请求失败');return result;
}
const initial={nodes,relations,works,revisions:{}};
const Context=createContext<{data:Dataset;online:boolean;checked:boolean;refresh:()=>Promise<void>}>({data:initial,online:false,checked:false,refresh:async()=>{}});
export function DatasetProvider({children}:{children:ReactNode}){
  const [data,setData]=useState<Dataset>(initial),[online,setOnline]=useState(false);
  // `checked` flips after the first probe: a static build (GitHub Pages) has no API,
  // and the UI should hide the write paths instead of offering buttons that always fail.
  const [checked,setChecked]=useState(false);
  const refresh=useCallback(async()=>{try{const result=await api<Dataset>('/data');setData(result);setOnline(true);}catch{setOnline(false);}finally{setChecked(true);}},[]);
  useEffect(()=>{void refresh();const timer=setInterval(refresh,30_000);const focus=()=>void refresh();window.addEventListener('focus',focus);return()=>{clearInterval(timer);window.removeEventListener('focus',focus);};},[refresh]);
  return <Context.Provider value={{data,online,checked,refresh}}>{children}</Context.Provider>;
}
export const useDataset=()=>useContext(Context);
