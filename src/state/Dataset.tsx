import {createContext,useContext,useEffect,useState,useCallback,type ReactNode} from 'react';
import {nodes,relations,works,type ArtistNode,type Relationship,type Work} from '../data/rap-data';
import {SEED_BEEFS,type BeefEvent} from '../data/beefs';
export interface RatingStat {average:number;count:number}
export interface Dataset {nodes:ArtistNode[];relations:Relationship[];works:Work[];beefs:BeefEvent[];ratings:Record<string,RatingStat>;revisions:Record<string,string>}

/**
 * 页面托管在 GitHub Pages，投稿 API 跑在别处（Cloudflare Workers），所以接口地址要能外部注入。
 * 留空时走同源 `/api`，本地 `npm run dev` 的行为完全不变。
 */
const API_BASE=String(import.meta.env.VITE_API_BASE??'').replace(/\/+$/,'');
const TOKEN_KEY='nahfi-owner-token';

/** 审核台会话。跨站请求带不了 SameSite cookie，所以换成 Authorization 头，存在本地。 */
export const ownerToken={
  get(){try{return localStorage.getItem(TOKEN_KEY);}catch{return null;}},
  set(token:string){try{localStorage.setItem(TOKEN_KEY,token);}catch{/* 隐私模式下忽略 */}},
  clear(){try{localStorage.removeItem(TOKEN_KEY);}catch{/* 隐私模式下忽略 */}}
};

export async function api<T=any>(path:string,body?:unknown):Promise<T>{
  const token=ownerToken.get();
  const headers:Record<string,string>={};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(token)headers.Authorization=`Bearer ${token}`;
  const init:RequestInit={headers,signal:AbortSignal.timeout(20_000),credentials:API_BASE?'omit':'same-origin'};
  if(body!==undefined){init.method='POST';init.body=JSON.stringify(body);}
  let response:Response;
  try{response=await fetch(`${API_BASE}/api${path}`,init);}
  catch{throw new Error('投稿服务连接失败，请检查网络后重试');}
  let result;try{result=await response.json();}catch{throw new Error('投稿服务尚未连接，请使用 npm run dev 启动完整服务');}
  if(!response.ok){
    // 会话过期时清掉本地 token，避免审核台一直卡在「已登录但接口 401」。
    if(response.status===401)ownerToken.clear();
    throw new Error(result.error||'请求失败');
  }
  return result;
}
const initial={nodes,relations,works,beefs:SEED_BEEFS,ratings:{},revisions:{}};
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
