import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'bascnMOCK';
const TABLE = 'tblMOCK';

const text = value => [{type: 'text', text: value}];

const rows = [
  {
    record_id: 'rec_artist',
    last_modified_time: 1_760_000_000_000,
    fields: {
      编号: text(''),
      状态: '已通过',
      类型: '新增人物',
      标题: text('测试新人'),
      城市: text('成都'),
      别名: text('小测、TestRookie'),
      简介: text('用于验证拉取链路的人物。'),
      来源标题: text('示例访谈'),
      来源链接: {link: 'https://example.com/interview', text: '示例访谈'},
      证据说明: text('访谈中提到其来自成都。'),
      投稿人: text('测试'),
    },
  },
  {
    record_id: 'rec_relation',
    last_modified_time: 1_760_000_100_000,
    fields: {
      编号: text(''),
      状态: '已通过',
      类型: '新增关系',
      标题: text('《示例曲》录音室合作'),
      起点: text('马思唯'),
      终点: text('测试新人'),
      关系类型: '歌曲合作',
      年份: 2024,
      来源标题: text('作品页'),
      来源链接: {link: 'https://example.com/track', text: '作品页'},
      证据说明: text('制作名单中两人同时署名。'),
    },
  },
  {
    record_id: 'rec_broken',
    last_modified_time: 1_760_000_200_000,
    fields: {
      编号: text(''),
      状态: '已通过',
      类型: '新增关系',
      标题: text('缺少来源的关系'),
      起点: text('马思唯'),
      终点: text('测试新人'),
      关系类型: '组合成员',
    },
  },
  {
    record_id: 'rec_pending',
    last_modified_time: 1_760_000_300_000,
    fields: {
      编号: text(''),
      状态: '待审核',
      类型: '新增人物',
      标题: text('不该被拉到的人'),
      来源标题: text('x'),
      来源链接: {link: 'https://example.com/x', text: 'x'},
    },
  },
];

function startMock() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://mock');
    const json = payload => {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(payload));
    };
    if (url.pathname.endsWith('/auth/v3/tenant_access_token/internal')) {
      return json({code: 0, tenant_access_token: 'mock-token', expire: 7200});
    }
    if (url.pathname.endsWith('/tables') && req.method === 'GET') {
      return json({code: 0, data: {items: [{table_id: TABLE, name: '投稿审核'}]}});
    }
    if (url.pathname.includes('/fields')) {
      return json({code: 0, data: {items: []}});
    }
    if (url.pathname.endsWith('/records')) {
      // 服务端筛选路径：filter 存在时只回已通过的行，模拟真实行为。
      const filtered = url.searchParams.has('filter');
      const items = filtered ? rows.filter(row => row.fields.状态 === '已通过') : rows;
      return json({code: 0, data: {items, has_more: false, page_token: ''}});
    }
    res.writeHead(404);
    res.end('{}');
  });
  return new Promise(ready => server.listen(0, '127.0.0.1', () => ready(server)));
}

function runPull(env) {
  return new Promise(ready => {
    const child = spawn(process.execPath, ['scripts/feishu-pull.mjs', '--no-snapshot'], {
      cwd: ROOT,
      env: {...process.env, ...env},
    });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stdout += chunk; });
    child.on('close', code => ready({code, stdout}));
  });
}

test('飞书拉取：姓名换 id、跳过坏行、只取已通过', async t => {
  const server = await startMock();
  const dir = mkdtempSync(join(tmpdir(), 'feishu-'));
  const output = join(dir, 'approved.json');
  t.after(() => {
    server.close();
    rmSync(dir, {recursive: true, force: true});
  });

  const port = server.address().port;
  const {code, stdout} = await runPull({
    FEISHU_BASE_URL: `http://127.0.0.1:${port}`,
    FEISHU_APP_ID: 'cli_mock',
    FEISHU_APP_SECRET: 'secret_mock',
    FEISHU_APP_TOKEN: APP,
    FEISHU_TABLE_SUBMISSIONS: TABLE,
    FEISHU_OUTPUT: output.replace(ROOT + '/', ''),
  });

  assert.equal(code, 0, `脚本应成功退出，实际输出：\n${stdout}`);

  const file = JSON.parse(readFileSync(output, 'utf8'));
  const artists = file.records.filter(item => item.kind === 'artist');
  const relations = file.records.filter(item => item.kind === 'relationship');

  assert.equal(artists.length, 1, '只应写入一条人物投稿（待审核那条被过滤）');
  assert.equal(artists[0].payload.name, '测试新人');
  assert.deepEqual(artists[0].payload.aliases, ['小测', 'TestRookie']);
  assert.equal(artists[0].payload.city, '成都');
  assert.equal(artists[0].payload.sources[0].url, 'https://example.com/interview');
  assert.ok(artists[0].entityId.startsWith('community-'), '未填编号时应自动生成 id');

  assert.equal(relations.length, 1, '缺来源的那条应被跳过');
  const edge = relations[0].payload;
  assert.equal(edge.type, 'collaboration', '「歌曲合作」应映射成 collaboration');
  assert.equal(edge.target, artists[0].entityId, '终点用名字填写后应换成新投稿人物的 id');
  assert.ok(edge.source && !edge.source.includes('马思唯'), '起点应换成人物 id 而不是名字');
  assert.equal(edge.observedYear, 2024);

  assert.match(stdout, /跳过 1 条/, '应报告被跳过的坏数据');
});

test('飞书拉取：缺少凭证时给出可操作的提示', async () => {
  const {code, stdout} = await runPull({
    FEISHU_APP_ID: '',
    FEISHU_APP_SECRET: '',
    FEISHU_APP_TOKEN: '',
    FEISHU_TABLE_SUBMISSIONS: '',
    FEISHU_OUTPUT: 'tmp-never-written.json',
  });
  assert.equal(code, 1);
  assert.match(stdout, /FEISHU_APP_ID/, '提示应点名缺哪个变量');
  assert.match(stdout, /开放平台/, '提示应告诉用户去哪里取值');
});
