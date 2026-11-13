"""Build reviewable catalog candidates from an explicit artist-identity allowlist.

This only uses exact credited aliases and known primary artist IDs. Metadata search
results are not proof of identity by themselves. Review research/catalog-review.txt
and the track-ID manifest before committing a refreshed dataset.
"""
import json
import ctypes
import os
from pathlib import Path
import re
import sys
import unicodedata

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'research' / 'catalog'
# IDs and multilingual display aliases reviewed against the returned platform credits.
ARTISTS = [
 ('ma','马思唯',[1095181798],['Masiwei','馬思唯']),
 ('knowknow','KnowKnow',[1435562780],['Know Know','丁震','DZknow','DZ']),
 ('psyp','Psy.P',[1373552959],['PSY.P','楊俊逸','杨俊逸']),
 ('melo','Melo',[1794932377],['謝宇傑','谢宇杰']),
 ('shengyu','盛宇',[1699190695],['盛宇D-SHINE','盛宇DamnShine','DamnShine','大傻']),
 ('keyl','刘聪',[1586357104,1640856786],['劉聰','KEY.L劉聰','KEY.L刘聪','KEY.L']),
 ('kungfu','功夫胖',[1347778392],['Kungfu-Pen','KungFuPen','功夫胖KungFuPen']),
 ('bridge','Bridge',[1602857942,933315150],['布瑞吉Bridge','布瑞吉']),
 ('yitai','王以太',[1436812638],['Yitai Wang','王闪火']),
 ('air','艾热',[1233590583],['艾熱AIR','艾热AIR','AIR']),
 ('asen','艾志恒Asen',[1636240804],['艾志恆Asen','艾志恒','Asen']),
 ('gai','GAI',[1522410451],['GAI周延','周延']),
 ('pharaoh','法老',[1449028292],['Pharaoh']),
 ('elfin','小精灵',[1236661024],['小精靈','Elfin']),
 ('keyng','杨和苏KeyNG',[1440715265],['楊和蘇KeyNG','杨和苏','KeyNG']),
 ('vinida','万妮达',[1185461302],['万妮達','萬妮達','Vinida Weng','Vinida']),
 ('vava','VaVa',[1278518450],['VAVA','毛衍七','VaVa毛衍七']),
 ('capper','Capper',[1574279636],['张砚拙','張硯拙']),
 ('jonyj','Jony J',[1288524146],['JonyJ','豆芽']),
 ('tizzyt','Tizzy T',[1322388883],['TizzyT','TT']),
 ('hotdog','MC HotDog',[151611994],['MC HOTDOG','MC HotDog 熱狗','热狗','熱狗']),
 ('mcjin','欧阳靖',[17621870],['歐陽靖','MC Jin']),
 ('gem','宝石Gem',[1480192431],['董寶石','董宝石','宝石老舅']),
 ('xiedi','谢帝',[1062071776],['謝帝','Boss Shady']),
 ('ty','Ty.',[1282949130],['唐溢']),
 ('ddg','邓典果DDG',[1454637962],['鄧典果DDG','邓典果']),
 ('wudu','雾都L4WUDU',[1573916677],['霧都L4WUDU','雾都','L4WUDU']),
 ('wangqiming','王齐铭',[1626398907],['王齊銘','王齐铭WatchMe','王齊銘WatchMe']),
 ('lianma','连麻',[1577300746],['連麻','连麻Swimming']),
 ('guangguang','MC光光',[1108397389],['Mc光光']),
 ('gaotianzuo','高天佐',[1569785265,1530762156],['高天佐Trouble.Z','Trouble.Z']),
 ('zaoan','早安',[1494877624],[]),
 ('icepaper','Ice Paper',[1465891746],['IcePaper']),
 ('pact','派克特',[1439648179],['PACT','PACT派克特','PACT Pai ke te']),
 ('creamd','CREAM D',[1614622179],['Cream D']),
 ('danko','弹壳Danko',[1556605586],['彈殼Danko','弹壳','彈殼','Danko']),
 ('gali','GALI',[1378752191],['蒋文涵']),
 ('narchy','那奇沃夫',[1548298768],['Narchy Wolf']),
 ('athree','AThree',[1446065195],['阿热斯兰','阿熱斯蘭']),
 ('nawukere','那吾克热',[1417035178],['那吾克熱-NW','那吾克熱NW','那吾克热-NW']),
 ('huangxu','黄旭',[1233590575],['黃旭','BooM']),
 ('ice','ICE杨长青',[1449274790],['ICE楊長青','ICE','杨长青']),
 ('jiang','姜云升',[1483458980],['姜雲升']),
 ('shayiting','沙一汀EL',[1589765978],['沙一汀']),
 ('nineone','NINEONE',[1477099168],['NINEONE趙馨玥','NINEONE赵馨玥','乃万','乃萬']),
 ('eso','瘦子E.SO',[1476379003],['E.SO','瘦子']),
 ('kenzy','小春Kenzy',[1160672273],['KENZY','小春']),
 ('muta','大渊MUTA',[1561708199],['大淵MUTA','MUTA','大渊']),
 ('softlipa','蛋堡',[403689551],['Soft Lipa','SoftLipa']),
 ('kumachan','熊仔',[794891218],['Kumachan']),
 ('lexie','刘柏辛Lexie',[1331378256],['劉柏辛Lexie','刘柏辛','Lexie Liu']),
]
def normal(text):
    return re.sub(r'[\s._·-]+','',unicodedata.normalize('NFKC',text).lower())

def simplified(text):
    # Windows' built-in linguistic mapping, used only for search aliases.
    # Preserve source spelling in the visible title and evidence.
    if os.name != 'nt':return text
    convert=ctypes.WinDLL('kernel32',use_last_error=True).LCMapStringEx
    convert.argtypes=[ctypes.c_wchar_p,ctypes.c_uint,ctypes.c_wchar_p,ctypes.c_int,ctypes.c_wchar_p,ctypes.c_int,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_ssize_t]
    size=convert('zh-CN',0x02000000,text,len(text),None,0,None,None,0)
    if not size:raise ctypes.WinError(ctypes.get_last_error())
    buffer=ctypes.create_unicode_buffer(size+1)
    if not convert('zh-CN',0x02000000,text,len(text),buffer,size,None,None,0):raise ctypes.WinError(ctypes.get_last_error())
    return buffer.value

aliases = {}
primary_ids = {}
for key,name,ids,names in ARTISTS:
    for value in [name,*names]:
        alias=normal(value)
        if alias in aliases and aliases[alias] != key:
            raise ValueError('Ambiguous credited alias: '+value)
        aliases[alias]=key
    for value in ids: primary_ids[value]=key

def version(row):
    title=row['trackName']+' '+row['collectionName']
    if re.search(r'live|現場|现场|巔峰對決|巅峰对决',title,re.I): return '现场版'
    if re.search(r'remix|混音',title,re.I): return '混音版'
    return '发行版'

def credited(row):
    # The primary ID is authoritative even if the same artist has a new display name.
    primary=primary_ids.get(row['artistId'])
    if not primary: return []
    names=re.split(r',| & |、|，| / ',row['artistName'])
    for featured in re.findall(r'\bfeat\.?\s+([^\)\]]+)',row['trackName'],re.I):
        names+=re.split(r',| & |、|，| / ',featured)
    return list(dict.fromkeys([primary,*[aliases[normal(n)] for n in names if normal(n) in aliases]]))

all_rows={}
for path in sorted(DATA.glob('*.json')):
    for row in json.loads(path.read_text(encoding='utf-8'))['results']:
        all_rows.setdefault(row['trackId'],row)

def title_key(row):
    title=re.split(r'\s*[\(\[]',row['trackName'])[0]
    # Same recording often appears on singles, albums and compilations with different IDs.
    return normal(title),tuple(sorted(credited(row))),version(row)

# Original hand-checked records are retained in seed.ts with their own evidence.
legacy_titles=['江湖兒女','江湖儿女','Do It Like This','戰壕','战壕','Where to go','Hotel Lobby','永不獨行','永不独行','別怕變老','别怕变老']
legacy_keys={normal(title) for title in legacy_titles}
candidates=[]
seen=set()
for row in all_rows.values():
    if not credited(row) or row['releaseDate'][:10]>'2026-11-13':continue
    # Accompaniment, karaoke and instrumentals are not vocal collaboration evidence.
    if re.search(r'伴奏|純音樂|纯音乐|karaoke|instrumental',row['trackName'],re.I):continue
    if title_key(row)[0] in legacy_keys:continue
    # Implausible catalog date: do not promote this as a release-year fact.
    if row['trackName'].startswith('貧民百萬歌星') and row['releaseDate'][:4]=='2012':continue
    key=title_key(row)
    if key in seen:continue
    seen.add(key)
    candidates.append(row)

selected={}
for key,_,_,_ in ARTISTS:
    pool=[r for r in candidates if key in credited(r)]
    own_rows=json.loads((DATA/(key+'.json')).read_text(encoding='utf-8'))['results']
    rank={title_key(row):index for index,row in reversed(list(enumerate(own_rows)))}
    pool.sort(key=lambda row:rank.get(title_key(row),1000))
    solos=[r for r in pool if len(credited(r))==1]
    solos.sort(key=lambda row:version(row)=='现场版')
    collaborations=[r for r in pool if len(credited(r))>1]
    # Prefer variety: at least two solo/archive entries and up to five collaborations.
    choice=solos[:3]+collaborations[:5]
    for row in pool:
        if len(choice)>=8:break
        if row not in choice:choice.append(row)
    for row in choice:selected[row['trackId']]=row

colors=['#36c4bd','#f1a85b','#ad83f5','#e98ec4','#87a8f5','#c5d773']
city_sources={
 'keyng':('成都','https://music.apple.com/cn/playlist/杨和苏keyng代表作/pl.a4c935a139cc449aa2fd4718afec820f','Apple Music 代表作介绍明确其出生于成都。'),
 'gali':('上海','https://music.apple.com/hk/playlist/gali-代表作/pl.b61bebde7d8a4f2d9f40cf669741016a','Apple Music 代表作介绍明确其来自上海。'),
 'vinida':('福州','https://news.fjsen.com/2022-12/16/content_31208215.htm','东南网报道明确称其为福州歌手；仅作地域资料，不推定厂牌。'),
}
artists=[]
for index,(key,name,ids,names) in enumerate(ARTISTS):
    songs=[r for r in selected.values() if key in credited(r)]
    if not songs:raise ValueError('Artist without a reviewed work: '+key)
    profile=next((r['artistViewUrl'] for r in all_rows.values() if r['artistId'] in ids and r['artistViewUrl']),None)
    if not profile:raise ValueError('Missing artist profile: '+key)
    source={'title':'Apple Music：艺人目录','url':profile,'note':'以平台艺人 ID 校对身份；目录收录不代表其与其他艺人同属厂牌。'}
    sources=[source]
    city='未标注'
    if key in city_sources:
        city,url,note=city_sources[key]
        sources.append({'title':'地域资料来源','url':url,'note':note})
    titles=[r['trackName'] for r in songs[:2]]
    artists.append({'id':key,'name':name,'aliases':names,'kind':'artist','city':city,'category':'说唱 / 音乐人','color':colors[index%len(colors)],'initials':name[:2] if ord(name[0])>127 else name[:2].upper(),'description':'作品档案收录'+ '、'.join('《'+title+'》' for title in titles)+'等曲目。合作记录以具体版本署名为准。','catalogArtistIds':ids,'sources':sources})
works=[]
for row in selected.values():
    ids=credited(row)
    date=row['releaseDate'][:10]
    url=row['trackViewUrl'].split('&uo=')[0]
    works.append({'id':'apple-'+str(row['trackId']),'catalogTrackId':row['trackId'],'catalogArtistId':row['artistId'],'title':row['trackName'],'searchAliases':[simplified(row['trackName']),simplified(row['collectionName'])],'year':int(date[:4]),'releaseDate':date,'version':version(row),'artistIds':ids,'creditedAs':row['artistName'] + ('；客串署名见曲名' if re.search(r'\bfeat',row['trackName'],re.I) else ''),'album':row['collectionName'],'evidence':[{'title':'Apple Music：曲目与演唱署名','url':url,'note':f'公开目录核对日期：2026-11-13。平台版本日期：{date}（可能为再版日期，不保证为作品首发日）。仅连接此曲明确署名且已收录的艺人，完整客串名单保留于曲名。'}]})

(ROOT/'src/data/catalog.json').write_text(json.dumps({'artists':artists,'works':works},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(ROOT/'research/catalog-manifest.json').write_text(json.dumps({'checkedAt':'2026-11-13','trackIds':list(selected)},indent=2)+'\n',encoding='utf-8')
report=[]
for key,name,_,_ in ARTISTS:
    report.append('\n'+name+' ['+key+']')
    for work in works:
        if key in work['artistIds']:
            report.append(f"{work['catalogTrackId']} | {work['year']} | {work['title']} | {work['creditedAs']} | {' / '.join(work['artistIds'])}")
(ROOT/'research/catalog-review.txt').write_text('\n'.join(report)+'\n',encoding='utf-8')
print(f'{len(artists)} artists; {len(works)} works; {sum(len(w["artistIds"])*(len(w["artistIds"])-1)//2 for w in works)} collaboration records')
