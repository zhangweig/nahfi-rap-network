import {spawn} from 'node:child_process';
import {buildData} from './build-data.mjs';
await buildData();
const children=[spawn(process.execPath,['server/index.mjs','--dev'],{stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','0.0.0.0'],{stdio:'inherit'})];
let exiting=false;const stop=()=>{if(exiting)return;exiting=true;children.forEach(child=>child.kill());};
for(const child of children)child.on('exit',code=>{stop();process.exitCode=code||0;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
