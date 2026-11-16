/** 只读解析用户提供的按省份名单，输出原始行，不改 xlsx。 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const SRC = 'C:/Users/ZhangWeiGuang/Desktop/zhong-guo-shuo-chang-ge-shou-ming-dan-an-sheng-fen.xlsx';
const OUT = path.resolve(__dirname, 'xlsx-roster-raw.json');

const wb = XLSX.readFile(SRC, {cellDates: false});
const sheet = wb.Sheets['名单（按省份）'];
const rows = XLSX.utils.sheet_to_json(sheet, {header: 1, defval: ''});
const people = rows.slice(3).filter(r => r[2] && String(r[2]).trim()).map(r => ({
  no: Number(r[0]) || null,
  province: String(r[1] || '').trim(),
  stageName: String(r[2] || '').trim(),
  realName: String(r[3] || '').trim(),
  origin: String(r[4] || '').trim(),
  activeCity: String(r[5] || '').trim(),
  crew: String(r[6] || '').trim(),
  verify: String(r[7] || '').trim(),
  note: String(r[8] || '').trim(),
}));
fs.writeFileSync(OUT, JSON.stringify({source: SRC, sheets: wb.SheetNames, rows: people}, null, 2));
console.log('写出', OUT, '人数', people.length);
console.log('省份分布', people.reduce((a, p) => (a[p.province] = (a[p.province] || 0) + 1, a), {}));
