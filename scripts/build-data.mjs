import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
export async function buildData(destination='server/generated'){
  const result=await build({stdin:{contents:"export {nodes,relations,works,baseDataset} from './src/data/rap-data';export {PROVINCE_NAMES,cityProvince,UNKNOWN_PROVINCE} from './src/lib/province';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
  const {nodes,relations,works,baseDataset,PROVINCE_NAMES,cityProvince,UNKNOWN_PROVINCE}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  mkdirSync(destination,{recursive:true});writeFileSync(`${destination}/base-data.json`,JSON.stringify({nodes,relations,works}));
  // 未叠加任何人工编辑的基线，sheet:import 用它判断哪些行真的被改过。
  // 只是导入时的比对材料，放缓存目录，不进仓库也不进构建产物。
  const cache=resolve('.data');mkdirSync(cache,{recursive:true});
  writeFileSync(`${cache}/baseline-data.json`,JSON.stringify(baseDataset));
  // 34 个省级行政区与城市映射，导出/导入共用来校验「省份」列。
  writeFileSync(`${cache}/provinces.json`,JSON.stringify({names:PROVINCE_NAMES,cities:cityProvince,unknown:UNKNOWN_PROVINCE}));
}
if(process.argv[1]?.endsWith('build-data.mjs'))await buildData(process.argv[2]);
