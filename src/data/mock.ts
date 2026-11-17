import type {
  Track,
  Playlist,
  QueueItem,
  User,
  ThirdPartyAccount,
} from '../types';

/** 生成封面渐变（纯 CSS，无外链依赖） */
export const coverGradients = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
  'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
  'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)',
];

/** 当前用户 */
export const currentUser: User = {
  id: 'u-me',
  nickname: '我',
  avatar: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
};

/** 歌曲库 */
export const mockTracks: Track[] = [
  { id: 't1', title: '夜空中最亮的星', artist: '逃跑计划', album: '世界', cover: coverGradients[8], duration: 252, source: 'netease' },
  { id: 't2', title: '晴天', artist: '周杰伦', album: '叶惠美', cover: coverGradients[0], duration: 269, source: 'netease' },
  { id: 't3', title: '起风了', artist: '买辣椒也用券', album: '起风了', cover: coverGradients[1], duration: 325, source: 'qq' },
  { id: 't4', title: '平凡之路', artist: '朴树', album: '猎户星座', cover: coverGradients[5], duration: 305, source: 'netease' },
  { id: 't5', title: '稻香', artist: '周杰伦', album: '魔杰座', cover: coverGradients[9], duration: 223, source: 'qq' },
  { id: 't6', title: '光年之外', artist: '邓紫棋', album: '光年之外', cover: coverGradients[2], duration: 235, source: 'kugou' },
  { id: 't7', title: '突然的自我', artist: '伍佰', album: '泪桥', cover: coverGradients[3], duration: 276, source: 'netease' },
  { id: 't8', title: '蓝莲花', artist: '许巍', album: '时光·漫步', cover: coverGradients[6], duration: 286, source: 'migu' },
  { id: 't9', title: '小幸运', artist: '田馥甄', album: '我的少女时代', cover: coverGradients[4], duration: 275, source: 'qq' },
  { id: 't10', title: '山海', artist: '草东没有派对', album: '大风吹', cover: coverGradients[7], duration: 271, source: 'netease' },
  { id: 't11', title: '孤勇者', artist: '陈奕迅', album: '孤勇者', cover: coverGradients[0], duration: 229, source: 'kugou' },
  { id: 't12', title: '海阔天空', artist: 'Beyond', album: '乐与怒', cover: coverGradients[8], duration: 326, source: 'netease' },
];

/** 歌单 */
export const mockPlaylists: Playlist[] = [
  {
    id: 'p1',
    name: '深夜单曲循环',
    cover: coverGradients[0],
    description: '一个人的夜晚，循环的旋律',
    trackCount: 5,
    source: 'netease',
    tracks: [mockTracks[0], mockTracks[3], mockTracks[7], mockTracks[9], mockTracks[11]],
  },
  {
    id: 'p2',
    name: '华语经典 · 青春回响',
    cover: coverGradients[1],
    description: '那些年，我们一起听过的歌',
    trackCount: 5,
    source: 'qq',
    tracks: [mockTracks[1], mockTracks[4], mockTracks[8], mockTracks[10], mockTracks[6]],
  },
  {
    id: 'p3',
    name: '治愈系 · 温柔时刻',
    cover: coverGradients[2],
    description: '给疲惫的心一点温柔',
    trackCount: 4,
    source: 'kugou',
    tracks: [mockTracks[2], mockTracks[5], mockTracks[8], mockTracks[0]],
  },
  {
    id: 'p4',
    name: '摇滚不死',
    cover: coverGradients[5],
    description: '燃烧吧，躁动的灵魂',
    trackCount: 4,
    source: 'netease',
    tracks: [mockTracks[9], mockTracks[11], mockTracks[3], mockTracks[6]],
  },
];

/** 每日推荐 */
export const mockDaily: Track[] = [
  mockTracks[0], mockTracks[2], mockTracks[5], mockTracks[9], mockTracks[1],
  mockTracks[11], mockTracks[4], mockTracks[7],
];

/**
 * 内置兜底队列（未接入在线数据源时占位）。
 * addedBy 统一为「我」——不虚构其他听众，真实成员只来自在线房间。
 */
export const mockQueue: QueueItem[] = [
  { id: 'q1', track: mockTracks[0], addedBy: '我', pinned: false, addedAt: Date.now() - 5000 },
  { id: 'q2', track: mockTracks[2], addedBy: '我', pinned: false, addedAt: Date.now() - 4000 },
  { id: 'q3', track: mockTracks[5], addedBy: '我', pinned: false, addedAt: Date.now() - 3000 },
  { id: 'q4', track: mockTracks[9], addedBy: '我', pinned: false, addedAt: Date.now() - 2000 },
  { id: 'q5', track: mockTracks[1], addedBy: '我', pinned: false, addedAt: Date.now() - 1000 },
];

/** 第三方账号 */
export const mockAccounts: ThirdPartyAccount[] = [
  { provider: 'netease', label: '网易云音乐', accountId: '', bound: false, token: '' },
  { provider: 'qq', label: 'QQ 音乐', accountId: '', bound: false, token: '' },
  { provider: 'kugou', label: '酷狗音乐', accountId: '', bound: false, token: '' },
  { provider: 'migu', label: '咪咕音乐', accountId: '', bound: false, token: '' },
];

/** 音质选项 */
export const qualityOptions = [
  { value: 'standard', label: '标准', desc: '省流量' },
  { value: 'high', label: '高品', desc: '更清晰' },
  { value: 'lossless', label: '无损', desc: 'Hi-Fi' },
  { value: 'hires', label: 'Hi-Res', desc: '极致' },
] as const;

/**
 * 歌词原文（逐行）。框架阶段为示例歌词，按歌曲时长均匀分布时间轴；
 * 接入真实 API 后由 getLyrics 适配器返回真实带时间戳歌词替换。
 */
const lyricTexts: Record<string, string[]> = {
  t1: [
    '夜空中最亮的星', '能否听清', '那仰望的人', '心底的孤独和叹息',
    '夜空中最亮的星', '能否记起', '曾与我同行', '消失在风里的身影',
    '我祈祷拥有一颗透明的心灵', '和会流泪的眼睛',
    '给我再去相信的勇气', '越过谎言去拥抱你',
    '每当我找不到存在的意义', '每当我迷失在黑夜里',
    '夜空中最亮的星', '请指引我靠近你',
  ],
  t2: [
    '故事的小黄花', '从出生那年就飘着', '童年的荡秋千', '随记忆一直晃到现在',
    '吹着前奏望着天空', '我想起花瓣试着掉落',
    '为你翘课的那一天', '花落的那一天', '教室的那一间', '我怎么看不见',
    '消失的下雨天', '我好想再淋一遍',
    '刮风这天我试过握着你的手', '但是偏偏雨天', '你却说再见',
  ],
  t3: [
    '我来不及道声不安', '慌乱转身说句晚安', '却没回头看你一眼',
    '风吹过秋天的画面', '落叶铺满长街', '一个人的夜晚',
    '起风了', '我仍在这里等待', '等风也等你回来',
    '年少时不懂的珍惜', '都成了现在的遗憾',
    '当风吹散了承诺', '我还记得你的轮廓',
  ],
  t4: [
    '我曾经跨过山和大海', '也穿过人山人海',
    '我曾经拥有着的一切', '转眼都飘散如烟',
    '我曾经失落失望失掉所有方向', '直到看见平凡才是唯一的答案',
    '当你仍然还在幻想', '你的明天', '她会好吗',
    '时间无言', '如此这般', '明天已在眼前',
    '风吹过的路依然远', '你的故事讲到了哪',
  ],
  t5: [
    '还记得你说家是唯一的城堡', '随着稻香河流继续奔跑',
    '微微笑 小时候的梦我知道',
    '不要哭让萤火虫带着你逃跑', '乡间的歌谣永远的依靠',
    '回家吧 回到最初的美好',
    '阳光 空气 水和草地', '还有儿时伙伴的笑语',
  ],
  t6: [
    '辽阔的疆域 一望无际', '漫天的星辰 为我闪烁',
    '光年之外', '爱是不可思议的相遇',
    '我愿意 为你 守候', '穿越时空的距离',
    '就算世界 到尽头', '我也会 牵着你的手',
    '在光年之外', '等你',
  ],
  t7: [
    '我就像那一只林中的小鸟', '努力挣脱冲向蓝天怀抱',
    '朗朗明月 那是我心', '悠悠白云 那是我梦',
    '从来没有一种呼唤', '像你的名字这样美丽',
    '突然的自我', '在这一刻', '放声歌唱',
    '把所有的烦恼', '都抛到九霄云外',
  ],
  t8: [
    '一朵莲花 盛开在尘世之外', '清净的笑容 那样的从容',
    '蓝莲花', '没有什么能够阻挡',
    '你对自由的向往', '天马行空的生涯',
    '你的心了无牵挂', '穿过幽暗的岁月',
    '也曾感到彷徨', '当你低头的瞬间', '才发觉脚下的路',
  ],
  t9: [
    '幸运的是我 曾陪他们开放', 'invoice 那年的夏天',
    '小幸运', '原来你是我最想留住的幸运',
    '原来我们和爱情曾经靠得那么近',
    '那为我对抗世界的决定', '那陪我淋的雨',
    '一幕幕都是你', '一尘不染的真心',
    '与你相遇 好幸运',
  ],
  t10: [
    '我听见我的身体里刮起一阵狂风', '它冷的有些过分',
    '但我不愿再逃避', '我不想再装睡',
    '山海', '是遥远的呼唤',
    '你站在山的那一边', '我望着海的这一面',
    '大风吹', '吹走了谁的少年',
    '留下我一个人', '在原地徘徊',
  ],
  t11: [
    '暗火燃烧 我绝不后退', '独行的夜 不需要安慰',
    '谁说站在光里的才算英雄',
    '他们说 要扶正这倾斜的秤',
    '要挺直 那弯曲的脊梁',
    '孤勇者', '爱你不跪的模样',
    '爱你对峙过绝望 不肯哭一场',
    '爱你破烂的衣裳 却敢堵命运的枪',
    '战吗 战啊 以最卑微的梦',
  ],
  t12: [
    '今天我 寒夜里看雪飘过', '怀着冷却了的心窝漂远方',
    '风雨里追赶', '雾里分不清影踪',
    '天空海阔你与我', '可会变',
    '原谅我这一生不羁放纵爱自由', '也会怕有一天会跌倒',
    '背弃了理想 谁人都可以', '哪会怕有一天只你共我',
    '海阔天空', '在风雨中', '仍然相信自由',
  ],
};

/** 按歌曲时长为歌词生成均匀时间戳 */
function buildLyrics(texts: string[], duration: number): { time: number; text: string }[] {
  if (!texts.length) return [];
  const intro = 6; // 前奏留白秒数
  const usable = Math.max(duration - intro - 8, texts.length * 2);
  const step = usable / texts.length;
  return texts.map((text, i) => ({
    time: Math.round((intro + i * step) * 10) / 10,
    text,
  }));
}

/** 歌词库：trackId → 带时间戳歌词 */
export const mockLyrics: Record<string, { time: number; text: string }[]> = Object.fromEntries(
  mockTracks.map((t) => [t.id, buildLyrics(lyricTexts[t.id] ?? ['♪', '这首歌暂无歌词', '敬请期待'], t.duration)])
);
