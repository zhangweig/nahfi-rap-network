import {createContext,useContext,useEffect,useState,useCallback,useMemo,useRef,type ReactNode} from 'react';
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

/**
 * 用 revisions（每个 node/relation 的内容指纹）+ ratings 汇总出一个稳定的整体签名。
 * 轮询时只有签名变了才 setData —— 否则 setData 每次都给新对象引用，
 * context value 一变，所有 consumer（含 ~7000 元素的关系网）都会整棵重渲染。
 */
const dataSignature=(d:Dataset):string=>{
  const rev=d.revisions||{};
  const ratings=d.ratings||{};
  let parts='r:'+Object.keys(rev).length+';';
  for(const key in rev) parts+=key+'='+rev[key]+'|';
  parts+='@'+Object.keys(ratings).length+';';
  for(const key in ratings) parts+=key+'='+ratings[key].average+'/'+ratings[key].count+'|';
  parts+='@n'+d.nodes.length+',rel'+d.relations.length+',w'+d.works.length+',b'+(d.beefs?.length||0);
  return parts;
};

/*
 * context 拆成两个，且 Provider 的 value 都保持稳定引用：
 *  - DataContext  : 整份数据，只有内容签名变化时才换引用（低频）。
 *  - StatusContext: {online,checked,refresh}，refresh 是稳定函数；online/checked
 *    只在初次探测与登录态切换时更新。
 * 这样高频轮询不会把「刷新函数」也塞进变化引用里连带所有 consumer 重渲染。
 * 两个独立 hook 让只读数据的组件（关系网/名录/首屏）不必订阅状态变化。
 */
const DataContext=createContext<Dataset>(initial);
const StatusContext=createContext<{online:boolean;checked:boolean;refresh:()=>Promise<void>}>({online:false,checked:false,refresh:async()=>{}});

export function DatasetProvider({children}:{children:ReactNode}){
  const [data,setData]=useState<Dataset>(initial);
  const [online,setOnline]=useState(false);
  const [checked,setChecked]=useState(false);
  const signature=useRef<string>(dataSignature(initial));

  const refresh=useCallback(async()=>{
    try{
      const result=await api<Dataset>('/data');
      const next=dataSignature(result);
      if(next!==signature.current){signature.current=next;setData(result);}
      setOnline(true);
    }catch{setOnline(false);}
    finally{setChecked(true);}
  },[]);

  useEffect(()=>{
    let timer:ReturnType<typeof setInterval>|null=null;
    const start=()=>{if(timer===null)timer=setInterval(()=>void refresh(),30_000);};
    const stop=()=>{if(timer!==null){clearInterval(timer);timer=null;}};
    // 页面不可见时停掉轮询：后台标签页既没人看，又在白白消耗 Workers 额度与电量。
    const onVisibility=()=>{if(document.hidden)stop();else{void refresh();start();}};
    void refresh();
    start();
    document.addEventListener('visibilitychange',onVisibility);
    return()=>{stop();document.removeEventListener('visibilitychange',onVisibility);};
  },[refresh]);

  // 状态 value 只在三个字段真变化时换引用，避免把 data consumer 也拉着重渲染。
  const status=useMemo(()=>({online,checked,refresh}),[online,checked,refresh]);

  return <StatusContext.Provider value={status}>
    <DataContext.Provider value={data}>{children}</DataContext.Provider>
  </StatusContext.Provider>;
}

/** 只订阅数据。关系网/名录/首屏等重组件用它，避免被 online/checked 变化波及。 */
export const useDatasetData=()=>useContext(DataContext);
/** 只订阅连接状态与刷新函数。投稿入口、页脚、审核台等轻量 UI 用它。 */
export const useDatasetStatus=()=>useContext(StatusContext);
/** 兼容旧调用：一次拿到全部字段。新代码优先用上面两个细粒度 hook。 */
export const useDataset=()=>({data:useContext(DataContext),...useContext(StatusContext)});
