"""Cache public Apple catalog metadata for manual review, never import blindly.

Run with Python 3. Uses the documented Search API and stays below 20 calls/minute.
No artwork, audio, lyrics or credentials are downloaded.
"""
import json
from pathlib import Path
import sys
import time
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'research' / 'catalog'
CACHE.mkdir(parents=True, exist_ok=True)
ARTISTS = {
    'ma': '马思唯', 'knowknow': 'KnowKnow', 'psyp': 'Psy.P', 'melo': 'Melo',
    'shengyu': '盛宇', 'keyl': '刘聪', 'kungfu': '功夫胖', 'bridge': '布瑞吉',
    'yitai': '王以太', 'air': '艾热', 'asen': '艾志恒', 'gai': 'GAI周延',
    'pharaoh': '法老', 'elfin': '小精灵', 'keyng': '杨和苏', 'vinida': '万妮达',
    'vava': 'VaVa', 'capper': 'Capper', 'jonyj': 'Jony J', 'tizzyt': 'Tizzy T',
    'hotdog': 'MC HotDog', 'mcjin': '欧阳靖', 'gem': '宝石Gem', 'xiedi': '谢帝',
    'ty': 'Ty.', 'ddg': '邓典果', 'mengzi': '孟子', 'wudu': '雾都L4WUDU',
    'wangqiming': '王齐铭', 'lianma': '连麻', 'yee': '于意Yee', 'guangguang': 'MC光光',
    'gaotianzuo': '高天佐', 'zaoan': '早安', 'icepaper': 'Ice Paper', 'pact': '派克特',
    'creamd': 'CREAM D', 'danko': '弹壳', 'gali': 'GALI', 'narchy': '那奇沃夫',
    'athree': 'AThree', 'nawukere': '那吾克热', 'fox': '福克斯', 'huangxu': '黄旭',
    'ice': 'ICE杨长青', 'jiang': '姜云升', 'shayiting': '沙一汀', 'nineone': 'NINEONE',
    'eso': '瘦子E.SO', 'kenzy': '顽童 小春', 'muta': '顽童 大渊',
    'softlipa': '蛋堡', 'kumachan': '熊仔', 'lexie': '刘柏辛',
}
for key, term in ARTISTS.items():
    target = CACHE / f'{key}.json'
    if target.exists():
        continue
    query = {'term': term, 'entity': 'song', 'attribute': 'artistTerm', 'country': 'TW', 'limit': 60}
    url = 'https://itunes.apple.com/search?' + urllib.parse.urlencode(query)
    try:
        data = json.load(urllib.request.urlopen(url, timeout=25))
        fields = ['artistName', 'artistId', 'artistViewUrl', 'trackId', 'trackName',
                  'trackViewUrl', 'collectionName', 'releaseDate', 'primaryGenreName']
        records = [{k: row.get(k) for k in fields} for row in data.get('results', []) if row.get('kind') == 'song']
        target.write_text(json.dumps({'query': term, 'url': url, 'checkedAt': '2026-11-13', 'results': records}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(key, len(records), flush=True)
    except Exception as error:
        print(key, 'ERROR', str(error), flush=True)
    time.sleep(3.2)
