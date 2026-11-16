import {useEffect,useState} from 'react';
import type {ArtistNode} from '../data/types';

/**
 * 头像替换接口，按优先级取：
 * 1. node.avatarUrl（表格「头像」列或审核台里的直链）；
 * 2. src/assets/avatars/<人物id>.png（把图片丢进这个目录就自动生效，支持 png/webp/jpg）；
 * 3. 都没有 -> 用 id 生成的随机像素头像（现阶段的默认值）。
 */
const localAvatars=import.meta.glob('../assets/avatars/*.{png,webp,jpg,jpeg}',{eager:true,query:'?url',import:'default'}) as Record<string,string>;
const localAvatarById=new Map(Object.entries(localAvatars).map(([path,url])=>[path.split('/').pop()!.replace(/\.[^.]+$/,''),url]));

export const avatarPath=(node:ArtistNode)=>node.avatarUrl||localAvatarById.get(node.id)||'';

const hashOf=(value:string)=>{let h=7;for(let i=0;i<value.length;i+=1)h=(h*31+value.charCodeAt(i))%100003;return h;};

const HAIR=['#1b1714','#2f231a','#4a2f1c','#6b4326','#171a24','#8a6a3f','#3a2a3f'];
const SKIN=['#e8c09a','#d9ad85','#c08f66','#f0cdaa'];
const ACCENT=['#ffc93c','#35d6ff','#ff3d6e','#35ff9e','#b07cff','#ffffff'];

export interface PixelSpec{hair:string;skin:string;shirt:string;style:number;glasses:boolean;chain:boolean;hat:string|null;}

export function pixelSpec(node:ArtistNode):PixelSpec{
  const h=hashOf(node.id);
  return {
    hair:HAIR[h%HAIR.length],
    skin:SKIN[(h>>3)%SKIN.length],
    shirt:node.color,
    style:h%4,
    glasses:h%5===0,
    chain:h%3===0,
    hat:h%7===0?ACCENT[(h>>2)%ACCENT.length]:null,
  };
}

/** 16×16 grid, snapped to whole pixels so it stays crisp at any zoom. */
export function drawPixelPerson(ctx:CanvasRenderingContext2D,x:number,y:number,size:number,color:string){
  const p=size/16;
  ctx.save();
  ctx.translate(Math.round(x-size/2),Math.round(y-size/2));
  const rect=(a:number,b:number,w:number,h:number,c:string)=>{ctx.fillStyle=c;ctx.fillRect(Math.round(a*p),Math.round(b*p),Math.max(1,Math.round(w*p)),Math.max(1,Math.round(h*p)));};
  rect(4,12,3,3,'#2c3d4d');rect(9,12,3,3,'#2c3d4d');
  rect(4,15,3,1,'#1d2a35');rect(9,15,3,1,'#1d2a35');
  rect(4,8,8,5,color);rect(4,8,8,1,'rgba(255,255,255,.22)');
  rect(3,9,1,3,color);rect(12,9,1,3,color);
  rect(3,12,1,1,'#e0b48c');rect(12,12,1,1,'#e0b48c');
  rect(5,3,6,5,'#e8c09a');rect(5,7,6,1,'#d3a87f');
  rect(4,1,8,3,'#2b2118');rect(4,3,1,3,'#2b2118');rect(11,3,1,3,'#2b2118');
  rect(4,1,8,1,'#3b2d20');
  rect(6,5,1,1,'#2b2118');rect(9,5,1,1,'#2b2118');
  rect(7,7,2,1,'#b98463');rect(7,8,2,1,'rgba(255,255,255,.34)');
  ctx.restore();
}

export function Avatar({node,large=false}:{node:ArtistNode;large?:boolean}){
  const [failed,setFailed]=useState(false);const path=avatarPath(node);useEffect(()=>setFailed(false),[path]);
  const {hair,skin,shirt,style,glasses,chain,hat}=pixelSpec(node);
  return <span className={`pixel-avatar ${large?'large':''}`} style={{backgroundColor:node.color+'22'}}>
    {path&&!failed?<img src={path} alt={`${node.name}头像`} draggable={false} onError={()=>setFailed(true)}/>:<svg viewBox="0 0 16 16" shapeRendering="crispEdges" role="img" aria-label={`${node.name}占位头像`}>
      <path fill="#26313d" d="M4 12h3v3H4zM9 12h3v3H9z"/>
      <path fill="#141d26" d="M4 15h3v1H4zM9 15h3v1H9z"/>
      <path fill={shirt} d="M4 8h8v4H4zM3 9h1v3H3zM12 9h1v3h-1z"/>
      <path fill="#ffffff30" d="M4 8h8v1H4z"/>
      <path fill="#00000026" d="M4 11h8v1H4z"/>
      <path fill={skin} d="M7 7h2v2H7zM3 12h1v1H3zM12 12h1v1h-1z"/>
      <path fill={skin} d="M5 3h6v5H5z"/>
      <path fill="#00000018" d="M5 7h6v1H5z"/>
      <path fill={skin} d="M4 4h1v2H4zM11 4h1v2h-1z"/>
      {style===0&&<path fill={hair} d="M4 1h8v3H4zM4 3h1v3H4zM11 3h1v3h-1zM6 4h1v1H6z"/>}
      {style===1&&<path fill={hair} d="M4 1h8v4H4zM3 4h1v4H3zM12 4h1v4h-1zM5 5h1v1H5z"/>}
      {style===2&&<path fill={hair} d="M4 1h8v3H4zM3 3h1v5H3zM12 3h1v5h-1zM5 6h6v1H5z"/>}
      {style===3&&<path fill={hair} d="M4 1h8v3H4zM6 0h4v1H6zM4 3h1v2H4zM11 3h1v2h-1z"/>}
      <path fill={hair} d="M6 4h1v1H6zM9 4h1v1H9z"/>
      <path fill="#1d2a35" d="M6 5h1v1H6zM9 5h1v1H9z"/>
      {glasses&&<path fill="#9fe8ff" opacity=".85" d="M5 4h3v2H5zM8 5h1v1H8zM9 4h3v2H9z"/>}
      <path fill="#00000022" d="M7 6h2v1H7z"/>
      <path fill="#8b4a45" d="M6 8h3v1H6z"/>
      {chain&&<path fill="#f4d38a" d="M7 9h2v1H7z"/>}
      {hat&&<path fill={hat} d="M4 0h8v2H4zM3 2h10v1H3z"/>}
    </svg>}
  </span>;
}
