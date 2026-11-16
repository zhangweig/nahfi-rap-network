import {readFileSync,existsSync,mkdirSync,writeFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createApplication} from './app.mjs';

if(existsSync('.env'))process.loadEnvFile('.env');
const dataDir=resolve(process.env.DATA_DIR||'.data');mkdirSync(dataDir,{recursive:true});
let password=process.env.ADMIN_PASSWORD;
if(!password){
  if(process.env.NODE_ENV==='production')throw new Error('生产环境必须设置 ADMIN_PASSWORD（至少 16 字符）');
  const path=resolve(dataDir,'owner-key.txt');if(!existsSync(path))writeFileSync(path,randomBytes(24).toString('hex'),{mode:0o600});
  password=readFileSync(path,'utf8').trim();console.log(`本地审核密钥保存在 ${path}（请勿分享或提交到 Git）`);
}
const production=process.env.NODE_ENV==='production';
if(production&&!process.env.PUBLIC_ORIGIN?.startsWith('https://'))throw new Error('生产环境必须配置 HTTPS 的 PUBLIC_ORIGIN');
/**
 * Snapshot is re-read whenever its mtime changes, so `npm run sheet:import` takes effect on the
 * next request instead of requiring a server restart. Keeps /api/data from serving stale people.
 */
const basePath=resolve(process.argv.includes('--dev')?'server/generated/base-data.json':'dist/base-data.json');
let cachedBase=null,cachedMtime=0;
const base=()=>{
  try{
    const {mtimeMs}=statSync(basePath);
    if(!cachedBase||mtimeMs!==cachedMtime){
      cachedBase=JSON.parse(readFileSync(basePath,'utf8'));cachedMtime=mtimeMs;
      console.log(`[base] 载入数据快照 ${basePath}（${cachedBase.nodes.length} 人 / ${cachedBase.relations.length} 关系）`);
    }
  }catch(error){
    if(!cachedBase)throw error;
  }
  return cachedBase;
};
base();
const app=createApplication({base,dbPath:resolve(dataDir,'community.sqlite'),adminPassword:password,publicOrigin:process.env.PUBLIC_ORIGIN,staticDir:resolve('dist'),secureCookies:production});
const port=Number(process.env.PORT||8787);app.server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`嘻哈版图 Flowline 数据与审核服务 http://localhost:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
