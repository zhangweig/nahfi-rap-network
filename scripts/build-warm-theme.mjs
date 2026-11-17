import fs from 'node:fs';
const src = fs.readFileSync('src/neon.css','utf8');

// 语义映射：原色 → 新色。优先保证「暗底上的文字」可读。
const SEM = {
  // 主强调（青 → 焦橙）
  '8ff0ff':'e4572e','4fd8ff':'ff7a4d','a9f0ff':'ff8f63','d8f8ff':'ffb08a',
  'bfe9ff':'ff9a6a','9fe8ff':'ff8a5c','bdf0ff':'ffb08a','d5f7ff':'ffc2a0',
  'e6fbff':'ffd0b4','c9f6ff':'ffb08a','9fe4f7':'ff9a6a','cbeeff':'ffb08a',
  '7ad9ff':'e4572e','4fd8ff':'ff7a4d',
  // 浅青文字 → 米白
  'c9f2ff':'f2ede4','dff3ff':'f2ede4','e8f7ff':'f2ede4','eaf9ff':'f2ede4',
  'e6f6ff':'f2ede4','e6fbff':'ffd0b4','d5eaf7':'e0d7c8','d8eefc':'e8dcc8',
  'c3dcec':'ded6c8','cfe6f4':'d9d2c7','cfe2ef':'d9d2c7','b8d4e4':'cdbfae',
  'a8c6d8':'bdae9b','bdd8e6':'cdbfae','eaf9ff':'f2ede4',
  // 中灰蓝文字（暗底次要文字）→ 暖灰，保证可读
  '4e7f99':'9a8b7a','5e859b':'a39584','7fa3b8':'b3a593','6b90a5':'a39584',
  '5f93ad':'a39584','6d97ad':'9a8b7a','7fb2c9':'b3a593','4e6a7d':'8a7d6f',
  '54718a':'8a7d6f','7c9db3':'a39584','8fb2c7':'b3a593','9fd7ee':'c9baa6',
  '6d90a8':'9a8b7a','4f7c93':'8a7d6f','5c7d94':'9a8b7a','7a4a2b':'8a7d6f',
  '6fa9c2':'b3a593','5f92ab':'a39584','9dbfd2':'c0b2a0','5f8ba3':'a39584',
  '7a3b56':'8a7d6f','6d93a8':'9a8b7a','7bb0c7':'b3a593','4f7288':'9a8b7a',
  '6b6358':'8a7d6f','4e6a7d':'8a7d6f','54718a':'8a7d6f','3c566d':'8a7d6f',
  '33506b':'8a7d6f','5d6b4a':'a39584','4b4a3c':'9a8b7a',
  // 原本暖色
  'ffb27a':'ffb27a','c9a873':'c9a873','c5b994':'c5b994','c3b793':'c3b793',
  'ad743e':'ad743e','8e382a':'8e382a','ff9d5c':'ff9d5c','ffd7b0':'ffd7b0',
};
// 暖色阶（仅用于真正的背景/边框暗色）
const RAMP = ['080706','0d0b0a','131010','1a1412','221a16','2e221c','3c2c22','4d382a',
              '63503c','7d6b52','9a8567','bda788','d9c9ae','f2ede4'];
function rgb(h){const s=h.slice(0,6).padEnd(6,'0');return [parseInt(s.slice(0,2),16)||0,parseInt(s.slice(2,4),16)||0,parseInt(s.slice(4,6),16)||0]}
function lum([r,g,b]){const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4};return .2126*f(r)+.7152*f(g)+.0722*f(b)}
function hsl([r,g,b]){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let h=0;if(d){if(mx===r)h=60*(((g-b)/d)%6);else if(mx===g)h=60*((b-r)/d+2);else h=60*((r-g)/d+4)}if(h<0)h+=360;const l=(mx+mn)/2,s=d?d/(1-Math.abs(2*l-1)):0;return [h,s,l]}
function map(hex){
  if(['000','fff','0000','0008'].includes(hex))return hex;
  const alpha=hex.length>6?hex.slice(6):'';
  if(SEM[hex])return SEM[hex]+alpha;
  const [h,s,l]=hsl(rgb(hex)), L=lum(rgb(hex));
  if(h<45||h>=330){if(L>.70&&s>.35)return 'ffb08a'+alpha;return hex}
  if(L>.66&&s>.42)return 'e4572e'+alpha;
  const idx=Math.min(RAMP.length-1,Math.max(0,Math.round(L*(RAMP.length-1))));
  return RAMP[idx]+alpha;
}
let out=src.replace(/#([0-9a-fA-F]{3,8})\b/g,(m,hex)=>{
  const low=hex.toLowerCase();
  if(low.length===3&&!'000fff'.includes(low))return '#'+map(low.split('').map(c=>c+c).join(''));
  return '#'+map(low);
});
out='/* FLOWLINE · warm retro-digital palette (semantic remap). Revert by switching import in main.tsx. */\n'+out;
fs.writeFileSync('src/theme.css',out);
console.log('rewritten',out.length);
