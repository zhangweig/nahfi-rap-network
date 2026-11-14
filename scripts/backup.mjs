import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
if(existsSync('.env'))process.loadEnvFile('.env');
const dataDir=resolve(process.env.DATA_DIR||'.data');
const source=resolve(dataDir,'community.sqlite');
if(!existsSync(source))throw new Error('数据库尚未创建，请先运行 npm run dev');
const dir=resolve(dataDir,'backups');mkdirSync(dir,{recursive:true});
const target=resolve(dir,`community-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
const db=new DatabaseSync(source,{readOnly:true});
try{await backup(db,target);console.log(`数据库备份已保存：${target}`);}finally{db.close();}
