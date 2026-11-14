import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {validateSubmission,compose,fingerprint,InputError} from './domain.mjs';

/**
 * `base` may be a plain snapshot or a getter. The getter form lets the dev server pick up
 * `sheet:import` / `build-data` output without a restart, so the API never serves a stale copy.
 */
export function createApplication({base,dbPath,adminPassword,publicOrigin='',staticDir,secureCookies=false,rateLimit=true}) {
  const baseData=typeof base==='function'?base:()=>base;
  if(!adminPassword||adminPassword.length<16)throw new Error('审核密钥至少需要 16 个字符');
  const db=new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,kind TEXT NOT NULL,target_id TEXT,base_revision TEXT,payload TEXT NOT NULL,contributor TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,reviewed_at TEXT,review_note TEXT);
    CREATE TABLE IF NOT EXISTS approved(entity_id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,submission_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,submission_id TEXT NOT NULL,action TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);`);
  // Restart / password rotation revokes old owner sessions.
  db.exec('DELETE FROM sessions');
  const salt=randomBytes(32), passwordHash=scryptSync(adminPassword,salt,64);
  const buckets=new Map();
  const snapshot=()=>compose(baseData(),db.prepare('SELECT * FROM approved ORDER BY rowid').all());
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const authorized=req=>{const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('nahfi_owner='))?.slice(12);return !!token&&!!db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?').get(hash(token),Date.now());};
  const requireOwner=req=>{if(!authorized(req))throw new InputError('请先登录审核台',401);};
  function limit(req,scope,max){
    if(!rateLimit)return;
    const now=Date.now();for(const [key,v] of buckets)if(v.until<now)buckets.delete(key);
    const key=`${scope}:${req.socket.remoteAddress}`,entry=buckets.get(key)||{count:0,until:now+600_000};
    if(++entry.count>max)throw new InputError('操作太频繁，请 10 分钟后重试',429);
    buckets.set(key,entry);
  }
  async function body(req){
    if(!req.headers['content-type']?.startsWith('application/json'))throw new InputError('仅接受 JSON 请求',415);
    let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>24_000)throw new InputError('投稿内容过大',413);chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw new InputError('JSON 格式错误');}
  }
  function send(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));}
  const server=http.createServer(async(req,res)=>{
    try{
      const pathname=new URL(req.url,'http://localhost').pathname;
      const method=req.method;
      if(!['GET','HEAD','POST'].includes(method))throw new InputError('请求方法不支持',405);
      if(method==='POST'){
        const origin=req.headers.origin;
        if(!origin)throw new InputError('请求来源不匹配',403);
        let originHost='';
        try{originHost=new URL(origin).host;}catch{throw new InputError('请求来源不匹配',403);}
        const lower=value=>String(value||'').toLowerCase();
        const loopback=host=>/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(lower(host));
        // 生产按 PUBLIC_ORIGIN 严格比对；本地开发时 vite 代理会把端口换掉，回环地址一律放行。
        const allowed=publicOrigin
          ? lower(originHost)===lower(new URL(publicOrigin).host)
          : lower(originHost)===lower(req.headers.host)||(loopback(originHost)&&loopback(req.headers.host));
        if(!allowed)throw new InputError('请求来源不匹配',403);
      }
      if(pathname==='/api/data'&&method==='GET'){const data=snapshot();return send(res,200,{...data,revisions:Object.fromEntries([...data.nodes,...data.relations].map(x=>[x.id,fingerprint(x)]))});}
      if(pathname==='/api/session'&&method==='GET')return send(res,200,{owner:authorized(req)});
      if(pathname==='/api/login'&&method==='POST'){
        limit(req,'login',10);const input=await body(req);
        if(typeof input.password!=='string'||input.password.length>500||!timingSafeEqual(scryptSync(input.password,salt,64),passwordHash))throw new InputError('审核密钥错误',401);
        const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(token),Date.now()+8*3600_000);
        return send(res,200,{owner:true},{'Set-Cookie':`nahfi_owner=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookies?'; Secure':''}`});
      }
      if(pathname==='/api/logout'&&method==='POST'){
        const token=(req.headers.cookie||'').match(/(?:^|;\s*)nahfi_owner=([^;]+)/)?.[1];if(token)db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(token));
        return send(res,200,{ok:true},{'Set-Cookie':`nahfi_owner=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookies?'; Secure':''}`});
      }
      if(pathname==='/api/submissions'&&method==='POST'){
        limit(req,'submit',20);const value=validateSubmission(await body(req),snapshot()),id=randomUUID();
        db.prepare('INSERT INTO submissions(id,kind,target_id,base_revision,payload,contributor,message,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,value.kind,value.targetId,value.baseRevision,JSON.stringify(value.payload),value.contributor,value.message,new Date().toISOString());
        return send(res,201,{id,status:'pending'});
      }
      if(pathname==='/api/review'&&method==='GET'){
        requireOwner(req);const rows=db.prepare('SELECT * FROM submissions ORDER BY created_at DESC LIMIT 500').all();
        const data=snapshot();return send(res,200,{items:rows.map(row=>({...row,payload:JSON.parse(row.payload),original:row.target_id?(row.kind==='artist'?data.nodes:data.relations).find(x=>x.id===row.target_id):null})),audit:db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all()});
      }
      const decision=pathname.match(/^\/api\/review\/([a-zA-Z0-9-]+)$/);
      if(decision&&method==='POST'){
        requireOwner(req);const {action,note=''}=await body(req);
        if(!['approve','reject'].includes(action)||typeof note!=='string'||note.length>1500)throw new InputError('审核操作无效');
        if(action==='reject'&&!note.trim())throw new InputError('请填写退回原因');
        db.exec('BEGIN IMMEDIATE');
        try{
          const row=db.prepare('SELECT * FROM submissions WHERE id=?').get(decision[1]);
          if(!row)throw new InputError('投稿不存在',404);
          if(row.status!=='pending')throw new InputError('该投稿已经审核，请刷新列表',409);
          if(action==='approve'){
            const data=snapshot(),entity=JSON.parse(row.payload),collection=row.kind==='artist'?data.nodes:data.relations;
            if(row.target_id&&fingerprint(collection.find(x=>x.id===row.target_id))!==row.base_revision)throw new InputError('原记录已被其他投稿更新，请退回并重新提交',409);
            if(row.kind==='artist'&&collection.some(x=>x.id!==entity.id&&x.name.toLocaleLowerCase()===entity.name.toLocaleLowerCase()))throw new InputError('已存在同名人物，请退回并重新提交',409);
            if(row.kind==='relationship'&&(!data.nodes.some(x=>x.id===entity.source)||!data.nodes.some(x=>x.id===entity.target)))throw new InputError('关系人物不存在',409);
            if(row.kind==='relationship'&&data.relations.some(x=>x.id!==entity.id&&x.type===entity.type&&x.label===entity.label&&[x.source,x.target].sort().join('|')===[entity.source,entity.target].sort().join('|')))throw new InputError('已有相同关系通过审核，请退回重复投稿',409);
            db.prepare('INSERT INTO approved VALUES(?,?,?,?) ON CONFLICT(entity_id) DO UPDATE SET kind=excluded.kind,payload=excluded.payload,submission_id=excluded.submission_id').run(entity.id,row.kind,row.payload,row.id);
          }
          const now=new Date().toISOString();db.prepare('UPDATE submissions SET status=?,reviewed_at=?,review_note=? WHERE id=?').run(action==='approve'?'approved':'rejected',now,note.trim(),row.id);
          db.prepare('INSERT INTO audit(submission_id,action,note,created_at) VALUES(?,?,?,?)').run(row.id,action,note.trim(),now);db.exec('COMMIT');
        }catch(error){db.exec('ROLLBACK');throw error;}
        return send(res,200,{ok:true});
      }
      if(pathname.startsWith('/api/'))throw new InputError('接口不存在',404);
      if(!staticDir)throw new InputError('开发页面请访问 Vite 地址',404);
      let path=resolve(staticDir,'.'+decodeURIComponent(pathname));
      if(!path.startsWith(resolve(staticDir)+sep)&&path!==resolve(staticDir))throw new InputError('路径无效',403);
      if(pathname==='/'||(!extname(pathname)&&pathname!=='/api'))path=resolve(staticDir,'index.html');
      try{if(!(await stat(path)).isFile())throw 0;}catch{throw new InputError('文件不存在',404);}
      const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.jpg':'image/jpeg','.ico':'image/x-icon'}[extname(path)]||'application/octet-stream';
      res.writeHead(200,{'Content-Type':mime,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY','Cache-Control':pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'});res.end(await readFile(path));
    }catch(error){if(!res.headersSent)send(res,error.status||500,{error:error.status?error.message:'服务器暂时无法完成操作，请稍后重试'});else res.end();}
  });
  return {server,db,close:()=>new Promise(resolve=>server.close(()=>{db.close();resolve();}))};
}
