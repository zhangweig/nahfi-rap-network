import type {ArtistNode,Relationship} from './types';
const teal='#36c4bd',orange='#f1a85b',violet='#ad83f5';
export const seedNodes:ArtistNode[]=[
{id:'higher',name:'Higher Brothers',kind:'group',city:'成都',category:'CDC',color:teal,initials:'HB',description:'成都说唱组合。此处只呈现组合成员关系，不等同于全部 CDC 厂牌关系。'},
{id:'ma',name:'马思唯',aliases:['MaSiWei','Masiwei'],kind:'artist',city:'成都',category:'CDC',color:teal,initials:'马',description:'Higher Brothers 成员。'},
{id:'knowknow',name:'KnowKnow',aliases:['丁震','DZ','DZknow'],kind:'artist',city:'成都',category:'CDC',color:teal,initials:'KN',description:'Higher Brothers 成员。'},
{id:'psyp',name:'Psy.P',kind:'artist',city:'成都',category:'CDC',color:teal,initials:'PP',description:'Higher Brothers 成员。'},
{id:'melo',name:'Melo',kind:'artist',city:'成都',category:'CDC',color:teal,initials:'ME',description:'Higher Brothers 成员。'},
{id:'cblock',name:'C-BLOCK',kind:'group',city:'长沙',category:'CSC',color:orange,initials:'CB',description:'长沙说唱团体。'},
{id:'shengyu',name:'盛宇',aliases:['大傻','DamnShine'],kind:'artist',city:'长沙',category:'CSC',color:orange,initials:'盛',description:'C-BLOCK 成员。'},
{id:'keyl',name:'刘聪',aliases:['KEY.L'],kind:'artist',city:'长沙',category:'CSC',color:orange,initials:'刘',description:'C-BLOCK 成员。'},
{id:'kungfu',name:'功夫胖',aliases:['KungFuPen'],kind:'artist',city:'长沙',category:'CSC',color:orange,initials:'胖',description:'C-BLOCK 成员。'},
{id:'gosh',name:'GO$H',aliases:['GOSH'],kind:'group',city:'重庆',category:'GO$H',color:violet,initials:'G$',description:'重庆说唱团体。收录 2017 年报道中的历史关联，不推断当前签约或成员身份。'},
{id:'bridge',name:'Bridge',aliases:['布瑞吉','布瑞吉Bridge'],kind:'artist',city:'重庆',category:'GO$H',color:violet,initials:'BR',description:'2017 年斗鱼专访预告记录了其 GO$H 关联；与 GAI、功夫胖合作演唱《江湖儿女》。'},
{id:'yitai',name:'王以太',aliases:['王闪火','Yitai Wang'],kind:'artist',city:'成都',category:'说唱音乐人',color:teal,initials:'王',description:'成都说唱音乐人。收录与马思唯、艾热、艾志恒的具体作品合作，不据此推定厂牌成员关系。'},
{id:'air',name:'艾热',aliases:['AIR','艾热AIR'],kind:'artist',city:'喀什',category:'说唱音乐人',color:'#e98ec4',initials:'艾',description:'来自新疆喀什的说唱音乐人。收录与王以太的录音室及现场合作，以及与 GAI 的《永不独行》。'},
{id:'asen',name:'艾志恒Asen',aliases:['Asen','艾志恒'],kind:'artist',city:'未标注',category:'说唱音乐人',color:'#87a8f5',initials:'AS',description:'收录《战壕》《Hotel Lobby》的合作署名；城市信息暂未核验，不以合作对象推定所属地域或厂牌。'},
{id:'gai',name:'GAI',aliases:['周延','GAI周延'],kind:'artist',city:'重庆',category:'GO$H',color:violet,initials:'GA',description:'与重庆 GO$H 说唱圈有公开历史关联；不代表持续成员身份。'}
];
// observedYear records the date of a source, NOT a joining or leaving date.
const evidenceHB={title:'XXL：Higher Brothers 成员访谈（2018）',url:'https://www.xxlmag.com/the-break-presents-higher-brothers/',note:'访谈列出马思唯、KnowKnow、Psy.P、Melo 四人。确认报道时的组合成员，不推断持续签约。'};
const evidenceCB={title:'故事FM：功夫胖访谈（2022）',url:'https://m.thepaper.cn/baijiahao_19666485',note:'故事FM发表于澎湃湃客的访谈列明功夫胖、盛宇、刘聪三人。确认报道时的成员组成。'};
const evidenceG={title:'斗鱼：GAI 与 Bridge 专访预告（2017）',url:'https://www.douyu.com/cms/detail/5832.shtml',note:'2017-07-21 的专访预告明确将 GAI 与 Bridge 关联到重庆 GOSH。仅确认历史关联，不代表现役成员或经纪合约。'};
const loveMeLater={title:'Amazon Music：《Love Me Later》曲目署名',url:'https://music.amazon.in/albums/B0D8JRDR4P',note:'平台列出各曲演唱者与 2024 年发行信息；仅以具体曲目的署名建立合作，不把同专辑全部艺人互相连线。'};
function collaboration(id:string,title:string,year:number,version:'录音室版'|'现场版',artists:string[],evidence:Relationship['evidence']):Relationship[]{
 return artists.flatMap((source,i)=>artists.slice(i+1).map(target=>({id:`${id}-${source}-${target}`,source,target,type:'collaboration' as const,label:`《${title}》· ${version}`,track:{id,title,year,version},evidence,status:'verified' as const})));
}
export const seedRelations:Relationship[]=[
 ...['ma','knowknow','psyp','melo'].map(id=>({id:`higher-${id}`,source:'higher',target:id,type:'member' as const,label:'组合成员（2018 年资料）',observedYear:2018,evidence:[evidenceHB],status:'verified' as const})),
 ...['shengyu','keyl','kungfu'].map(id=>({id:`cblock-${id}`,source:'cblock',target:id,type:'member' as const,label:'组合成员（2022 年资料）',observedYear:2022,evidence:[evidenceCB],status:'verified' as const})),
 ...['bridge','gai'].map(id=>({id:`gosh-${id}`,source:'gosh',target:id,type:'affiliation' as const,label:'历史厂牌关联（2017 年资料）',observedYear:2017,evidence:[evidenceG],status:'verified' as const})),
 ...collaboration('jianghu-ernv-live-2022','江湖儿女',2022,'现场版',['gai','bridge','kungfu'],[{title:'Apple Music：《江湖儿女》演唱署名',url:'https://music.apple.com/us/song/1636079002',note:'《中国说唱巅峰对决》第五期，2022-07-23。页面署名 GAI、Bridge、Kungfu-Pen；三条边来自同一首三人合作。'}]),
 ...collaboration('do-it-like-this-2024','Do It Like This',2024,'录音室版',['yitai','ma'],[loveMeLater]),
 ...collaboration('zhanhao-2024','战壕',2024,'录音室版',['yitai','asen'],[loveMeLater]),
 ...collaboration('where-to-go-2024','Where to go',2024,'录音室版',['yitai','air'],[loveMeLater]),
 ...collaboration('hotel-lobby-2025','Hotel Lobby',2025,'录音室版',['ma','asen'],[{title:'Apple Music：《Hotel Lobby》客串署名',url:'https://music.apple.com/us/song/1844766443',note:'2025-10-15 发行，曲名明确标注 feat. 艾志恒Asen，主艺人为 Masiwei。'}]),
 ...collaboration('never-alone-2019','永不独行',2019,'录音室版',['gai','air'],[{title:'JOOX：《永不独行》发行页',url:'https://www.joox.com/my-zh_cn/album/mMT6SEDMxn55jBI6ioN1Cg%3D%3D',note:'平台列明 GAI 与艾热联合演唱，发行日期 2019-01-05。'},{title:'种梦国际音乐：作品目录',url:'https://www.dmgii.com/all-releases',note:'官方作品目录将《永不独行》署名为 GAI & 艾热；此处仅用于核对作品合作。'}]),
 ...collaboration('grow-old-2021','别怕变老',2021,'录音室版',['yitai','air'],[{title:'王以太官方 Topic：发行商提供的录音',url:'https://www.youtube.com/watch?v=WVYNeUuCCrg',note:'The Orchard 提供的发行信息署名王以太、艾热AIR，原始发行日为 2021-09-09；视频上传日期不作为歌曲首发日期。'}]),
 ...collaboration('grow-old-live-2022','别怕变老',2022,'现场版',['yitai','air'],[{title:'爱奇艺：《别怕变老》舞台纯享',url:'https://www.iq.com/short/uqjktiwqv4?lang=zh_cn',note:'节目官方 2022-07-09 纯享片段明确署名艾热AIR、王以太；与 2021 年录音室版分别收录。'}])
];
