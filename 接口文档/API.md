# 酷狗概念版 API 开发文档

> 目标应用：`com.kugou.android.lite`（酷狗概念版）v11.6.2.1 / appid `3116` / plat `1070`
> 逆向方式：APK 静态分析（15 dex + 107 so）+ 桌面 Reqable 落盘解析 + 离线签名爆破
> 文档状态：所有标注 ✅ 的接口均已在本机实测通过，可直接调用
> 配套代码：`kugou/kg_sdk.py`（单文件 SDK，零依赖除 requests）

---

## 目录

1. [架构总览：三条通道](#1-架构总览三条通道)
2. [通用约定](#2-通用约定)
3. [签名算法（核心）](#3-签名算法核心)
4. [通道 A — Web 免签接口](#4-通道-a--web-免签接口)
5. [通道 B — 播放地址](#5-通道-b--播放地址)
6. [通道 C — Gateway 签名接口](#6-通道-c--gateway-签名接口)
7. [业务场景组合](#7-业务场景组合)
8. [错误码速查](#8-错误码速查)
9. [限制、时效与风险](#9-限制时效与风险)
10. [附录：全量接口清单](#10-附录全量接口清单)

---

## 1. 架构总览：三条通道

酷狗概念版的接口分散在三个完全不同的鉴权层级上。**选错通道会浪费大量时间**，这是本项目的首要结论。

```
┌──────────────────────────────────────────────────────────────────┐
│  A. Web 免签通道                                                   │
│     mobilecdn.kugou.com / krcs.kugou.com / imge.kugou.com        │
│     零鉴权 · 纯 GET · 无需任何密钥                                  │
│     能力：搜索 / 歌单 / 榜单 / 歌词 / 封面图                        │
│     稳定性：★★★★★  （浏览器能开就能用）                            │
├──────────────────────────────────────────────────────────────────┤
│  B. 播放地址通道                                                    │
│     trackercdn.kugou.com/v5/url                                  │
│     鉴权：gateway md5 签名 + key=md5(hash)                         │
│     能力：128 / 320 / flac / high 音频直链 + 时长 + 音量归一化      │
│     稳定性：★★★★★  （10/10 实测命中）                              │
├──────────────────────────────────────────────────────────────────┤
│  C. Gateway 签名通道                                                │
│     gateway.kugou.com/**                                         │
│     鉴权：md5(secret + 排序参数 + body + secret)                   │
│     能力：账号 / 会员 / 签到 / 任务 / 打卡 / 推荐 / 榜单 / 搜索      │
│     稳定性：★★★★☆  （418 个端点同源，个别需特定参数组合）           │
└──────────────────────────────────────────────────────────────────┘
```

**开发建议**：内容类（搜索、歌单、榜单、歌词、封面）走 A；拿播放地址走 B；账号与权益类走 C。三者共用同一套设备身份参数。

---

## 2. 通用约定

### 2.1 设备身份参数（通道 B / C 必带）

这些参数来自真实设备抓包，**与账号绑定**。换账号需重新获取 `token`，换设备需重新获取 `mid` / `dfid`。

| 参数 | 值 | 说明 |
|---|---|---|
| `appid` | `3116` | 概念版应用 ID。**不能换成 1005/1014**，否则签名通过但业务拒绝 |
| `clientver` | `11621` | 客户端版本号（对应 11.6.2.1） |
| `plat` | `1070` | 平台标识，1070 = 概念版 Android |
| `channel` | `14` | 分发渠道 |
| `userid` | `1125949070` | 账号 UID |
| `mid` | `328258476213896267330734203660213193848` | 设备指纹（33 位数字串） |
| `dfid` | `0Qe6pO2SzNUo0rHEax0EtGNY` | 设备指纹（另一套，24 位混合大小写） |
| `token` | `2180ef54d13a21ff0f0ff0c21d421dcc0e969132117e6b55a4089845984f8397` | 登录态令牌（128 hex） |
| `uuid` | `-` | 匿名占位，概念版固定传 `-` |
| `gitver` | `06a1fc0` | Git 构建号。**部分接口传它会报错**，建议默认剔除 |
| `clienttime` | 当前 Unix 秒 | 每次请求动态生成，时效窗口约 ±5 分钟 |

> `gitver` 与 `sha` 两个参数对 `/concepts/*` 系列有副作用，SDK 中默认 `_DROP` 掉。

### 2.2 HTTP 头

```http
User-Agent: Android13-1070-11621-14-0-User-wifi
Accept: */*
Connection: keep-alive
```

UA 格式解析：`Android{系统版本}-{plat}-{clientver}-{channel}-{?}-User-{网络类型}`。
网络类型可换 `wifi` / `4g` / `5g`，不影响功能。

POST 时追加：

```http
Content-Type: application/json
```

### 2.3 响应信封

**Gateway 通道**统一信封：

```json
{
  "status": 1,          // 1=成功，0=失败（注意与 errcode 双重判断）
  "error_code": 0,      // 0=成功
  "error_msg": "",
  "data": { }           // 业务数据
}
```

少数接口用 `errcode` / `errmsg` 命名，两者都可能出现，判断时应该都读：

```python
code = j.get("errcode", j.get("error_code"))
ok = (code in (0, None)) and j.get("status") != 0
```

**Web 通道**统一信封：

```json
{ "status": 1, "errcode": 0, "errmsg": "", "data": { "info": [...], "total": 56 } }
```

### 2.4 Python 会话基线

```python
import requests

S = requests.Session()
S.trust_env = False        # ★ 关键：绕开系统代理，否则 MITM 证书会报 CERTIFICATE_VERIFY_FAILED
S.verify = False           # web 侧部分域名证书链不完整
S.headers.update({"User-Agent": "Android13-1070-11621-14-0-User-wifi"})
```

`trust_env = False` 是踩过的坑：本机若装了 Reqable / Fiddler 之类全局代理，requests 会自动走它，导致所有请求 SSL 失败。**这一行必须加。**

---

## 3. 签名算法（核心）

### 3.1 密钥

```
secret = LnT6xpN3khm36zse0QzvmgTZ3waWdRSA
```

**硬编码在 Java 层**，位于 `classes6.dex` / `classes8.dex` / `classes9.dex` / `classes13.dex`，不在 native so 里。这也是它能被离线爆破出来的原因。

（附带：Web 旧通道 `wwwapi.kugou.com` 用的是另一个密钥 `NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt`，现已基本废用，因为该接口要求登录态且返回 `30020`。）

### 3.2 算法

```python
import hashlib

SECRET = "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA"

def sign(params, body=""):
    # 1) 剔除 signature 自身
    # 2) 按 key 的字典序排序
    # 3) 拼成 k1=v1k2=v2...（无分隔符、无 URL 编码）
    raw = "".join("%s=%s" % (k, params[k]) for k in sorted(params) if k != "signature")
    return hashlib.md5((SECRET + raw + body + SECRET).encode("utf8")).hexdigest()
```

**三个必须遵守的细节**：

| 细节 | 说明 |
|---|---|
| GET 的 `body` | 传空字符串 `""` |
| POST 的 `body` | 传**实际发送的 JSON 字节原文**，不能重新序列化。`json.dumps` 的 `separators=(',',':')` 必须与发送时完全一致 |
| URL 编码 | 参与签名的值是**原始值**，不是 URL encode 后的值。`requests` 的 `params=` 会自动编码发送，但签名用原值 —— 这两件事是分开的 |

### 3.3 验证证据

| 接口 | 不带签名 | 错签名 | 正确签名 |
|---|---|---|---|
| `GET /gtools/v1/crash/whitelist` | `20010 error signature` | `20006 invalid signature` | `{"errcode":0,"data":{"is_valid":true}}` |
| `POST /concepts/v1/free_mode/receive_vip_morning` | `20010` | `20006` | 进入业务逻辑 |
| `GET /concepts/v1/free_mode/secondfloor_info` | `20010` | `20006` | 返回完整签到数据 |
| `GET https://trackercdn.kugou.com/v5/url` | `err signature` | `err signature` | 返回音频直链 |

5 组真实抓包样本（同接口、仅 `clienttime` 不同）全部 5/5 命中，无碰撞。

### 3.4 复现爆破的方法（换版本后可用）

如果酷狗升级更换了密钥，`scripts/brute_sign3.py` 可直接复用：

1. 抓 3~5 个同接口真实请求（含 signature，仅 clienttime 不同）
2. 从新 APK 的 `dex` + `so` + `assets` 中正则抽取所有 32 位 hex 串（约 37k 个候选）
3. 对每个候选套用公式回代校验，全样本命中即密钥

单次全量耗时约 4 秒（Python），无需 GPU。

---

## 4. 通道 A — Web 免签接口

> 全部为纯 GET，无需任何签名或 Cookie。浏览器可直接访问验证。

### 4.1 歌曲搜索 ✅

```
GET https://mobilecdn.kugou.com/api/v3/search/song
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `keyword` | 是 | 关键词，支持中文/歌手/歌名 |
| `page` | 是 | 页码，从 1 开始 |
| `pagesize` | 是 | 每页数量，实测最大 100 |
| `showtype` | 是 | 固定 `1`（固定值，缺失会返回空列表） |
| `version` | 是 | 固定 `8000` |

**响应**（`data` 节点）：

```json
{
  "total": 1024,
  "info": [
    {
      "hash": "b3a52a7a958bf0aed0ebfba2e9a818b7",
      "320hash": "1b56126a8a03924f1dd066259c095cbc",
      "sqhash": "0a69169202de95aaf24a9944ccf0730d",
      "songname": "晴天",
      "singername": "周杰伦",
      "album_name": "叶惠美",
      "album_id": "1010167",
      "album_audio_id": 30618161,
      "audio_id": 1007378739,
      "duration": 269,
      "filesize": 4318796,
      "bitrate": 128,
      "extname": "mp3",
      "privilege": 8,
      "pay_type": 3,
      "trans_param": {
        "union_cover": "http://imge.kugou.com/stdmusic/{size}/20250822/20250822164712115635.jpg",
        "language": "国语",
        "cpy_grade": 5
      }
    }
  ]
}
```

**字段要点**：

- `hash` — 128k 音频标识，通道 B 的核心入参
- `320hash` / `sqhash` — 320k / 无损版本各自的 hash；**部分歌曲的 320k 与原版 hash 不同**
- `duration` — 秒，歌词精确匹配需要
- `trans_param.union_cover` — 封面图模板，把 `{size}` 换成 `240` / `480` / `1080` / 空 均可直接访问
- `pay_type` — `3` 表示付费/需会员；但**实测即使 `pay_type=3`，通道 B 仍能拿到 128/320 直链**
- `privilege` — 版权位图，`8` 常见于正常可播

### 4.2 歌单搜索 ✅

```
GET https://mobilecdn.kugou.com/api/v3/search/special
参数：keyword / page / pagesize / version=8000
```

```json
{
  "specialid": 6409645,
  "specialname": "周杰伦精选",
  "nickname": "创建者昵称",
  "songcount": 50,
  "playcount": 120000,
  "collectcount": 3000,
  "imgurl": "http://imge.kugou.com/.../{size}/xxx.jpg",
  "intro": "歌单简介",
  "publishtime": "2024-01-01 00:00:00"
}
```

### 4.3 歌单详情 ✅

```
GET https://mobilecdn.kugou.com/api/v3/special/info
参数：specialid / version=8000
```

### 4.4 歌单歌曲 ✅

```
GET https://mobilecdn.kugou.com/api/v3/special/song
参数：specialid / page / pagesize / version=8000 / plat=0
```

```json
{
  "filename": "晴天 - 周杰伦",
  "hash": "b3a52a7a958bf0aed0ebfba2e9a818b7",
  "album_id": "1010167",
  "duration": 269,
  "singername": "周杰伦",
  "filesize": 4318796,
  "privilege": 8
}
```

### 4.5 榜单列表 ✅

```
GET https://mobilecdn.kugou.com/api/v3/rank/list
参数：version=8000 / plat=0
```

实测返回 **56 个榜单**。常用 `rankid`：

| rankid | 榜单 |
|---|---|
| `8888` | TOP500 |
| `6666` | 酷狗飙升榜 |
| `2` | 酷狗TOP500（旧） |
| `1` | 酷狗热歌榜 |

```json
{ "rankid": 8888, "rankname": "TOP500", "intro": "...",
  "imgurl": "http://imge.kugou.com/mcommon/{size}/xxx.jpg", "songcount": 500 }
```

### 4.6 榜单歌曲 ✅

```
GET https://mobilecdn.kugou.com/api/v3/rank/song
参数：rankid / page / pagesize / version=8000
```

```json
{
  "last_sort": 1,
  "songname": "慌啥子嘛",
  "filename": "慌啥子嘛 - 赵本山",
  "hash": "...",
  "320hash": "...",
  "sqhash": "54F67DC7084DE3525E02D5B7986F6D59",
  "album_id": "...",
  "duration": 210,
  "authors": [ { "author_id": 85511, "author_name": "赵本山" } ]
}
```

> 注意：榜单接口的 `singername` 不在顶层，需要从 `authors[0].author_name` 取。

### 4.7 歌词检索 ✅

```
GET https://krcs.kugou.com/search
```

| 参数 | 说明 |
|---|---|
| `ver` | 固定 `1` |
| `man` | 固定 `no` |
| `client` | 固定 `pc` |
| `keyword` | 歌名+歌手，可空 |
| `hash` | 歌曲 hash（**用 hash 匹配最准**） |
| `duration` | 歌曲毫秒时长（从搜索的 `duration` × 1000，或用歌词候选自带的） |

用 `hash` + `duration` 组合可以精确命中同一首歌的歌词，避免同名歌曲串行。

**响应**：

```json
{
  "candidates": [
    {
      "id": "652770770",
      "accesskey": "0CD89982FF9B77A84AF9D88367D930F7",
      "song": "晴天",
      "singer": "周杰伦",
      "duration": 269792,
      "language": "",
      "krctype": 2,
      "score": 100,
      "contenttype": 1
    }
  ]
}
```

### 4.8 歌词下载 ✅

```
GET https://krcs.kugou.com/download
```

| 参数 | 说明 |
|---|---|
| `ver` | `1` |
| `client` | `pc` |
| `id` | 上一步的 `candidates[].id` |
| `accesskey` | 上一步的 `candidates[].accesskey` |
| `fmt` | `lrc` / `krc` / `txt` |
| `charset` | `utf8` |

**`content` 字段是 base64**，必须解码：

```python
import base64
text = base64.b64decode(j["content"]).decode("utf-8", "ignore")
```

实测 `晴天` 返回 3172 字节完整 LRC（含 `[00:00.00]` 时间轴）。
`krc` 格式是酷狗的逐字歌词格式，需要专用解码器；普通场景用 `lrc` 即可。

### 4.9 封面图 ✅

搜索结果的 `trans_param.union_cover` 是模板：

```
http://imge.kugou.com/stdmusic/{size}/20250822/20250822164712115635.jpg
```

`{size}` 替换实测结果：

| size | 文件大小 |
|---|---|
| `240` | 88 KB |
| `480` | 316 KB |
| `1080` | 1.4 MB |
| 空（`//`） | 12.4 MB 原图 |

---

## 5. 通道 B — 播放地址

这是本项目最有价值的产出。**一条 GET 拿到可直接播放/下载的音频直链。**

### 5.1 接口

```
GET https://trackercdn.kugou.com/v5/url
```

### 5.2 参数

| 参数 | 值 | 说明 |
|---|---|---|
| `hash` | 歌曲 hash | 来自搜索/歌单/榜单 |
| `quality` | `128` / `320` / `flac` / `high` | 见下方音质表 |
| `pid` | `2` | 平台 ID。**非 2 会报 `illegal pid or pidversion`** |
| `pidversion` | `2` | 必须非 0，否则报 `illegal pid` |
| `cmd` | `25` | 固定 |
| `behavior` | `play` | `play` 或 `download` |
| `key` | `md5(hash)` | ★ 注意：**就是 hash 的 md5，不加盐** |
| 通用身份参数 | 全部必带 | appid/clientver/plat/channel/mid/dfid/userid/token/clienttime |
| `signature` | gateway 签名 | 见第 3 节 |

### 5.3 音质档位实测

| `quality` | 结果 | 说明 |
|---|---|---|
| `128` | ✅ mp3 / `qu128` | 标准音质 |
| `320` | ✅ mp3 / `qu320` | 高音质，10.8 MB/首（《晴天》） |
| `flac` | ✅ flac / `quflac` | 无损 |
| `high` | ✅ flac / `quhigh` | 高解析（VIP 档，返回 flac） |
| `sq` | ❌ `status:0` 空 | 已废弃，改用 `flac` |
| `viper` / `ape` / `hires` | ❌ 空 | 蝰蛇/APE 档需付费，未打通 |

### 5.4 完整请求示例

```python
import hashlib, time, requests

SECRET = "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA"
HASH = "b3a52a7a958bf0aed0ebfba2e9a818b7"

p = {
    "appid": "3116", "clientver": "11621", "plat": "1070", "channel": "14",
    "userid": "1125949070",
    "mid": "328258476213896267330734203660213193848",
    "dfid": "0Qe6pO2SzNUo0rHEax0EtGNY",
    "token": "2180ef54d13a21ff0f0ff0c21d421dcc0e969132117e6b55a4089845984f8397",
    "uuid": "-",
    "clienttime": str(int(time.time())),
    "hash": HASH,
    "quality": "320",
    "pid": "2",
    "pidversion": "2",
    "cmd": "25",
    "behavior": "play",
    "key": hashlib.md5(HASH.encode()).hexdigest(),
}
raw = "".join("%s=%s" % (k, p[k]) for k in sorted(p))
p["signature"] = hashlib.md5((SECRET + raw + SECRET).encode()).hexdigest()

r = requests.get("https://trackercdn.kugou.com/v5/url", params=p, timeout=15).json()
print(r["url"])
```

### 5.5 响应

```json
{
  "status": 1,
  "hash": "B3A52A7A958BF0AED0EBFBA2E9A818B7",
  "std_hash": "b3a52a7a958bf0aed0ebfba2e9a818b7",
  "url": [
    "http://fsandroid.tx.kugou.com/202611162200/d242fd78.../v3/1b56126a.../yp/full/ap3116_us1125949070_df0qe6po2sznuo0rheax0etgny_pi2_qu320_ct440100_s2846639307.mp3",
    "http://fsmobile.kugou.com/202611162200/3eccd49a.../v3/1b56126a.../yp/full/...s2846639307.mp3"
  ],
  "volume": -10.8,
  "volume_peak": 0.2,
  "std_hash_time": 269000,
  "classmap": { "attr0": 234885128 },
  "trans_param": { "language": "国语", "pay_block_tpl": 1 },
  "tracker_through": { "identity_block": 0, "cpy_grade": 5, "cpy_level": 1, "all_quality_free": 0 }
}
```

**关键字段**：

- `url[]` — **多条 CDN 备用链**，第一条失败可轮换后面的
- `std_hash_time` — 音频真实毫秒时长（用于歌词匹配）
- `volume` — 音量归一化 dB（做播放器响度均衡时有用）
- `tracker_through.cpy_grade` — 版权等级，`5` 表示无水印可播

### 5.6 直链 URL 结构解析

```
http://fsandroid.tx.kugou.com/{yyyymmddHH}/{32hex}/{v3}/{32hex}/yp/full/
en{32hex}_ap3116_us{userid}_df{dfid小写}_pi{pid}_qu{码率}_ct{版权id}_s{10位}.{ext}
```

| 片段 | 含义 |
|---|---|
| `{yyyymmddHH}` | 签发时间精确到小时，**时效约 2~4 小时** |
| `ap3116` | appid |
| `us{userid}` | 绑定账号 UID |
| `df{dfid小写}` | 绑定设备指纹 |
| `pi2` | pid |
| `qu320` | 音质档 |
| `ct440100` | 版权区域码（440100 = 广州，即 `area_code=1` 对应值） |
| `s{10位}` | 签名片段，动态生成 |

**推论**：直链与账号+设备绑定，**不能跨账号复用**；且过期后必须重新调接口。

### 5.7 可用性验证

```python
import requests
u = r["url"][0]
h = requests.head(u, timeout=15)
# h.status_code == 200
# h.headers["Content-Type"] == "audio/mpeg"
# h.headers["Content-Length"] == "10792943"

# 支持 Range 分段（做流式播放/拖动进度必需）
g = requests.get(u, headers={"Range": "bytes=0-1023"}, stream=True)
# g.status_code == 206, 返回 1024 字节, magic = 49 44 33 ("ID3")
```

**支持 HTTP Range** → 可以直接喂给 ExoPlayer / AVPlayer / `<audio>`，实现边下边播。

### 5.8 成功率

批量实测（`陈奕迅` 前 10 首，quality=320）：

```
成功率 10/10
```

包括 `pay_type=3` 的付费曲目。这是通道 B 相比官方开放平台的最大优势。

---

## 6. 通道 C — Gateway 签名接口

### 6.1 通用调用模板

```python
def api(path, extra=None, method="GET", body_obj=None):
    p = dict(IDENT)                       # 2.1 的设备身份
    p.pop("gitver", None); p.pop("sha", None)
    p["clienttime"] = str(int(time.time()))
    p["uuid"] = "-"
    if extra:
        p.update({k: str(v) for k, v in extra.items()})

    body = ""
    if body_obj is not None:
        body = json.dumps(body_obj, ensure_ascii=False, separators=(",", ":"))
    p["signature"] = sign(p, body)        # 第 3 节

    if method == "GET":
        r = S.get("https://gateway.kugou.com" + path, params=p, timeout=15)
    else:
        r = S.post("https://gateway.kugou.com" + path, params=p,
                   data=body.encode("utf8"),
                   headers={"Content-Type": "application/json"}, timeout=15)
    return r.json()
```

**调用顺序的坑**：必须先算好 body 字符串 → 再签名 → 再用**同一个字符串**发送。如果先把 body 序列化一次算签名、再序列化一次发送，浮点数/中文转义差异会导致签名不符。

---

### 6.2 签到状态 ✅

```
GET /concepts/v1/free_mode/secondfloor_info
参数：通用参数 + req_id=""（必填，可为空串）+ uuid="-"
```

**缺 `uuid` 会返回 `20002`**，这是最容易踩的坑。

**响应**：

```json
{
  "status": 1, "error_code": 0,
  "data": {
    "daily_vip": {
      "title": "天天签到领VIP",
      "sub_title": "...",
      "received_today": 1,
      "can_receive": 1,
      "token_vip_morning": "…………………………",
      "headimg": "https://...",
      "daily_vip_records": [
        { "date": "11.14", "status": "3" },
        { "date": "11.15", "status": "3" },
        { "date": "今天",  "status": "1" },
        { "date": "明天",  "status": "2" }
      ]
    }
  }
}
```

`daily_vip_records[].status` 语义：

| 值 | 含义 |
|---|---|
| `3` | 已领取 |
| `1` | 今日（可领） |
| `2` | 未来（未开始） |

`token_vip_morning` 是**服务端按天按账号签发的一次性签到凭证**。服务端判定「今日已领」或「不可领」时**不会下发该字段**（是缺字段，不是空串）。

### 6.3 提交签到 ✅

```
POST /concepts/v1/free_mode/receive_vip_morning
query: 通用参数 + token_vip_morning + req_id="" + signature（含 body）
body : {"date":"YYYY-MM-DD"}      Content-Type: application/json
```

```python
def claim(token):
    body_obj = {"date": datetime.date.today().strftime("%Y-%m-%d")}
    body = json.dumps(body_obj, separators=(",", ":"))     # {"date":"2026-11-16"}
    p = _params({"token_vip_morning": token, "req_id": ""})
    p["signature"] = sign(p, body)                         # ★ body 参与签名
    r = S.post("https://gateway.kugou.com/concepts/v1/free_mode/receive_vip_morning",
               params=p, data=body.encode("utf8"),
               headers={"Content-Type": "application/json"}, timeout=15)
    return r.json()
```

**三个必须**：

1. `token_vip_morning` 必须取自**同一次** `secondfloor_info` 的响应，跨请求复用会失效
2. `date` 必须是 `yyyy-MM-dd`，用本地当天日期
3. 签名必须包含 body 原文 —— 漏掉会一直报 `20006 error signature`，这是本项目卡最久的地方

**返回**：

```json
{ "status": 1, "error_code": 0, "data": { ... } }        // 成功
{ "status": 0, "errcode": 39706, "errmsg": "领取失败，请稍后重试" }   // 已领/令牌失效
```

### 6.4 会员入口 ✅

```
GET /youth/v1/user/get_vip_entrance
```

```json
{
  "user_type": 1,
  "vip_end_date_with_unclaimed": "2028-07-16",
  "tvip_end_date_with_unclaimed": "2028-07-16",
  "unclaimed_vip_days": 0,
  "busi_vip": [
    {
      "busi_type": "concept",
      "product_type": "tvip",
      "is_vip": 1,
      "vip_begin_time": "2026-10-15 14:58:08",
      "vip_end_time": "2026-11-25 17:58:08",
      "vip_clearday": "2026-11-15 14:58:08",
      "is_paid_vip": 0,
      "latest_product_id": ""
    }
  ]
}
```

`busi_vip[].product_type` 取值：`tvip`（体验 VIP）/ `wvip`（周 VIP）/ `mvip`（月卡）等。

### 6.5 账号统计 / 365 福利 ✅

```
GET /youth/v5/user/get_account_stat
```

```json
{
  "account_stat": 0,
  "user_type": 0,
  "is_freecard": 0,
  "welfare_type": 1,
  "365_welfare": {
    "claim_status": 2,
    "vip_days": 200,
    "next_claimable": 1,
    "has_coupon_365": 1,
    "last_claim_timestamp": 0
  },
  "period_welfare": {
    "current_period_id": 0,
    "banner": "https://youthimgbssdl.kugou.com/xxx.png",
    "signin_list": []
  },
  "common_popup": { "can_popup": 0, "jump_type": 1, "popup_img": "", "jump_url": "" }
}
```

`365_welfare.vip_days = 200` —— 这是 365 天福利包剩余天数，与签到领的日 VIP 是两套体系。

### 6.6 打卡信息 ✅

```
GET /youth/v1/clock_in/info
```

约 3.9 KB，主要返回打卡页的视觉素材与活动配置：

```json
{
  "bg_img": [
    "https://youthimgbssdl.kugou.com/16d10725....png",
    "https://youthimgbssdl.kugou.com/7b2700da....jpg"
  ],
  "...": "打卡规则、连续天数、奖励档位等配置项"
}
```

`bg_img` 是一组背景图（按天/按状态切换），可直接用于 UI。

同类端点（同 `clock_in` 前缀）：

| 端点 | 状态 | 说明 |
|---|---|---|
| `/youth/v1/clock_in/info` | ✅ | 打卡主数据 |
| `/youth/v1/clock_in/recommend_flag` | ✅ | 推荐标记 |
| `/youth/v1/clock_in/user_info` | ⚠️ `20002` | 已知需 `view_uid/req_id/with_base_user`，但当前版本仍报参数不足，疑似需额外签名头 |
| `/youth/v1/clock_in/share_info` | ⚠️ `20002` | 同上 |
| `/youth/v1/clock_in/set_flag` | 📋 | 写接口，未验证 |
| `/youth/v1/clock_in/user_list` | 📋 | 未验证 |

### 6.7 任务中心 ✅

```
GET /youth/v2/activity/task_list
```

返回 7.3 KB。结构为「任务分组 → 任务项」两级：

```json
{
  "list": [
    {
      "task_type_id": 1,
      "task_type_name": "福利活动",
      "task_list": [
        {
          "task_id": 694,
          "task_stat": 0,                       // 0=未完成 1=已完成 2=已领奖
          "banner": "https://youthimgbssdl.kugou.com/xxx.jpg",
          "banner_type": 1,
          "jump_url": "https://activity.kugou.com/getvips/v-4163b2d0/index.html?...",
          "topic_id": 0,
          "focus_id": 0
        }
      ]
    }
  ]
}
```

`jump_url` 里的 `activity.kugou.com/getvips/v-4163b2d0/` 就是「签到领会员」H5 活动页，
这也是从接口侧反推出签到入口的原始线索。

### 6.8 免流模式 ✅

```
GET /youth/v1/ad/free_mode_info
```

```json
{ "free_mode_award": 1, "vip_time": 0, "award_vip_hour": 24, "mode_status": 0 }
```

- `mode_status` — `0` 未开启免流模式，`1` 已开启
- `award_vip_hour` — 开启后每日奖励 VIP 小时数

```
GET /concepts/v1/free_mode/info?fields=auto_send,listen_song_task,upgrade_ad&uuid=-
```

`fields` 参数必填，否则返回空结构。可用值：`auto_send` / `listen_song_task` / `upgrade_ad`。

### 6.9 播放列表 ✅

```
GET /youth/v1/player/get_player_list?show_type=1
```

`show_type` 枚举（实测）：

| 值 | 含义 |
|---|---|
| `1` | ✅ 最近播放 |
| `2` | ✅ 我的收藏 |
| `0` / `3` | ❌ `param show_type err` |

### 6.10 推荐类 ✅

| 端点 | 状态 | 说明 |
|---|---|---|
| `/youth/v1/focus/recommend_list` | ✅ | 猜你喜欢，返回 `data.list` |
| `/youth/v1/account/popup_song_list` | ✅ | 首页弹窗歌单，含 `songlist_name` / `song_type` / `song_list` |
| `/concepts/v1/ai/copywriting_list` | ✅ | AI 写词素材列表 |
| `/concepts/v1/yuanbao/user_status` | ✅ | 元宝（每日领奖）状态，含 `vip_days` / `available` / `reward_date` |
| `/youth/v1/activity/get_listen_song_task` | ✅ | 听歌任务 |
| `/youth/v1/free_package/get_vip_task` | ✅ | 免费会员任务 |
| `/youth/v1/account/get_vip_tips` | ✅ | 会员提示文案 |

### 6.11 榜单（gateway 版）✅

```
GET /youth/api/rank/v1/info?rank_id=8888
GET /youth/api/rank/v1/song?rank_id=8888&page=1&pagesize=30
```

> 注意参数名是 **`rank_id`**（下划线），用 `rankid` 会返回 `20002`。
> web 通道（4.6）用的才是 `rankid`。两套命名不一致，容易混。

### 6.12 搜索（gateway 版）⚠️

```
POST /youth/v2/search/song
body: {"keyword":"周杰伦","page":1,"pagesize":5}
```

- 用 GET → `20001`（方法不支持）
- 用 POST 但参数放 query → `20003`
- 用 POST 且参数放 body → `error_code:0` 但 `youth_lists` 恒为空

该端点当前版本已实质废弃或被服务端按用户灰度关闭。**搜索请走通道 A 的 `mobilecdn` 接口**，功能完全等价且更稳。

---

## 7. 业务场景组合

### 7.1 每日自动签到（已落地）

```
① GET  /concepts/v1/free_mode/secondfloor_info
       → 读 data.daily_vip.{received_today, can_receive, token_vip_morning}
② 若 received_today == 1        → 结束（今日已签）
③ 若 token_vip_morning 缺失     → 结束（账号当日不参与活动）
④ POST /concepts/v1/free_mode/receive_vip_morning
       query: token_vip_morning + req_id
       body : {"date":"今天"}
⑤ 复核：再查一次 ①，确认 received_today == 1
```

已实现于 `kugou/sign_daily.py`，退出码语义：

| 码 | 含义 |
|---|---|
| `0` | 成功 / 今日已签 |
| `2` | 服务端未下发令牌（当日不可领） |
| `3` | 拉状态失败（token 过期或网络） |
| `4` | 签到请求异常 |
| `5` | 签到业务失败 |

### 7.2 搜索 → 播放（最小可用播放器）

```python
kg = KuGou()

# 1. 搜索
songs = kg.search("晴天 周杰伦", pagesize=1)
s = songs[0]
# {'songname': '晴天', 'hash': 'b3a52a...', 'duration': 269, 'cover': 'http://imge...'}

# 2. 拿直链（自动降级 320→128）
info = kg.play_url_safe(s["hash"], qualities=("320", "128"))
audio_url = info["url"][0]      # 直接喂 <audio src>

# 3. 拿歌词
lyric_text = kg.lyric(file_hash=s["hash"], duration=s["duration"] * 1000)["lyric"]

# 4. 封面
cover = s["cover"]              # 已是 480 尺寸
```

### 7.3 歌单批量导出

```python
kg = KuGou()
sp = kg.search_special("周杰伦", pagesize=1)[0]
songs = kg.special_song(sp["specialid"], pagesize=50)
for s in songs:
    u = kg.play_url_safe(s["hash"])
    print(s["filename"], u["url"][0] if u else "无版权")
```

### 7.4 榜单抓取

```python
kg = KuGou()
for r in kg.rank_list():
    print(r["rankid"], r["rankname"])
top = kg.rank_song(8888, pagesize=100)
```

### 7.5 本地下载

```python
kg.download("b3a52a7a958bf0aed0ebfba2e9a818b7", "D:/music/晴天.mp3", quality="320")
```

---

## 8. 错误码速查

### 8.1 Gateway 通用

| 码 | 含义 | 处理 |
|---|---|---|
| `0` | 成功 | — |
| `20001` | 方法不支持 | GET/POST 用错了 |
| `20002` | 参数错误 / 缺失 | 检查必填参数，特别是 `uuid` / `req_id` / `show_type` |
| `20003` | 参数不足 | POST body 缺字段 |
| `20006` | 签名错误 | 公式错，多半是漏拼 body 或参数未排序 |
| `20008` | no post data | POST 没带 body |
| `20010` | 参数错误 | 空值/非法值，或完全没带 signature |
| `39706` | 领取失败 | 签到令牌无效 / 今日已领 |
| `30020` | 需要登录态 | `wwwapi` 老接口，已废 |
| `60002` | 资源不存在 | 榜单 ID 错误 |
| `502` | 网关层拒绝 | 路径前缀不被该 host 接受（换 host） |

### 8.2 播放通道

| 返回 | 含义 |
|---|---|
| `status: 1` + `url[]` | 成功 |
| `status: 0, error: "illegal quality"` | `quality` 值非法（用了 `sq`/`ape` 等） |
| `status: 0, error: "illegal pid or pidversion"` | `pid` 不是 2，或 `pidversion` 为 0/缺失 |
| `status: 0, error: "illegal key"` | `key` 不是 `md5(hash)` |
| `errmsg: "err signature"` | gateway 签名缺失/错误 |
| `errmsg: "err clientver or mid or dfid or clienttime"` | 身份参数不全 |
| `status: 2` + `trans_param` | 该档位无版权（老旧 `/i/v2` 接口的返回） |

---

## 9. 限制、时效与风险

### 9.1 时效性

| 项目 | 时效 |
|---|---|
| 音频直链 | 约 2~4 小时（URL 内含小时级时间戳） |
| `token_vip_morning` | 单次有效，跨请求复用会失效 |
| `clienttime` | ±5 分钟窗口 |
| 登录 `token` | 长期（无主动过期），但改密/异地登录会失效 |

**结论**：不要缓存直链。每次播放前实时取，或缓存 1 小时内复用。

### 9.2 绑定关系

```
账号 userid  ←→  token
设备 mid / dfid  ←→  直链 URL 里的 df{dfid} 段
```

直链**与账号+设备双重绑定**，跨账号复用会 403。换设备需重新抓 `mid` / `dfid`。

### 9.3 反爬与风控

| 风险点 | 表现 | 缓解 |
|---|---|---|
| 高频请求 | 短时大量请求后返回空 `data` | 请求间隔 ≥200ms |
| 异常 UA | 非标准 UA 可能被降级 | 严格用 `Android13-1070-11621-14-0-User-wifi` |
| 签名重放 | 同 `clienttime` 重复提交 | 每次重新生成 `clienttime` |
| 账号风控 | 签到接口连续失败 | 每日只签一次，不重试刷接口 |

### 9.4 已知未打通

| 能力 | 状态 | 原因 |
|---|---|---|
| 蝰蛇音质（viper） | ❌ | 需付费音效包 + 独立鉴权 |
| APE / HiRes | ❌ | 同上传奇 |
| `get_auth_list`（音质授权列表） | ⚠️ `20003` | 参数结构未完全逆向出，但通道 B 已可替代 |
| `clock_in/user_info` | ⚠️ `20002` | 疑似需要额外的 native 签名头 |
| 歌单收藏 / 歌曲收藏（写操作） | 📋 | 已定位端点，未验证（有副作用，谨慎测试） |
| 评论 / 私信 | 📋 | 端点已定位，未验证 |

### 9.5 合规提示

本项目为**本地研究性质的技术验证**：所有接口均来自公开客户端，凭据来自自有账号。用于个人学习与自用工具。

若你要发布自己的应用，需注意：
- 音频直链是酷狗 CDN 的临时签名地址，**二次分发涉及版权**
- 商业用途应走官方开放平台（`openapi.kugou.com`）
- 账号凭据（`token`）属于个人敏感信息，不要硬编码进公开仓库

---

## 10. 附录：全量接口清单

### 10.1 已实测可用（推荐直接使用）

| # | 方法 | 端点 | 能力 |
|---|---|---|---|
| 1 | GET | `mobilecdn.kugou.com/api/v3/search/song` | 歌曲搜索 |
| 2 | GET | `mobilecdn.kugou.com/api/v3/search/special` | 歌单搜索 |
| 3 | GET | `mobilecdn.kugou.com/api/v3/special/info` | 歌单详情 |
| 4 | GET | `mobilecdn.kugou.com/api/v3/special/song` | 歌单歌曲 |
| 5 | GET | `mobilecdn.kugou.com/api/v3/rank/list` | 榜单列表（56 个） |
| 6 | GET | `mobilecdn.kugou.com/api/v3/rank/song` | 榜单歌曲 |
| 7 | GET | `krcs.kugou.com/search` | 歌词检索 |
| 8 | GET | `krcs.kugou.com/download` | 歌词下载（base64） |
| 9 | GET | `imge.kugou.com/stdmusic/{size}/...` | 封面图 |
| 10 | GET | `trackercdn.kugou.com/v5/url` | **音频直链** |
| 11 | GET | `/concepts/v1/free_mode/secondfloor_info` | 签到状态 |
| 12 | POST | `/concepts/v1/free_mode/receive_vip_morning` | 提交签到 |
| 13 | GET | `/concepts/v1/free_mode/info` | 免流任务详情 |
| 14 | GET | `/concepts/v1/ai/copywriting_list` | AI 写词素材 |
| 15 | GET | `/concepts/v1/yuanbao/user_status` | 元宝状态 |
| 16 | GET | `/youth/v1/user/get_vip_entrance` | 会员入口 |
| 17 | GET | `/youth/v5/user/get_account_stat` | 账号 / 365 福利 |
| 18 | GET | `/youth/v1/clock_in/info` | 打卡信息 |
| 19 | GET | `/youth/v1/clock_in/recommend_flag` | 打卡推荐标记 |
| 20 | GET | `/youth/v1/ad/free_mode_info` | 免流模式状态 |
| 21 | GET | `/youth/v2/activity/task_list` | 任务中心 |
| 22 | GET | `/youth/v1/activity/get_listen_song_task` | 听歌任务 |
| 23 | GET | `/youth/v1/free_package/get_vip_task` | 免费会员任务 |
| 24 | GET | `/youth/v1/account/get_vip_tips` | 会员提示 |
| 25 | GET | `/youth/v1/player/get_player_list` | 播放列表 |
| 26 | GET | `/youth/v1/focus/recommend_list` | 猜你喜欢 |
| 27 | GET | `/youth/v1/account/popup_song_list` | 弹窗歌单 |
| 28 | GET | `/youth/api/rank/v1/info` | 榜单详情 |
| 29 | GET | `/youth/api/rank/v1/song` | 榜单歌曲 |
| 30 | GET | `/gtools/v1/crash/whitelist` | 签名验证用探针 |

### 10.2 已定位未验证（按业务域分组）

完整 418 条路径见同目录 `ENDPOINTS.md`。以下为按业务域归类的重点候选：

**会员 / 权益**（`concepts` / `kugouvip`）
```
/concepts/v1/recharge/receive_365_welfare      365 福利领取
/concepts/v1/invite/invite_list                邀请列表
/concepts/v1/yuanbao/award_status              抽奖状态
/kugouvip/v1/act/concept_youth/products        会员商品列表
/kugouvipgo/**                                 会员下单
```

**打卡 / 任务**
```
/youth/v1/clock_in/{info,user_info,share_info,set_flag,user_list}
/youth/v2/activity/task_list                   任务中心
/youth/v1/activity/{get_listen_song_task,receive_new_user_vip}
/youth/v1/free_package/get_vip_task
```

**播放 / 音质**
```
/youth/v1/player/get_player_list
/youth/api/song/v1/get_auth_list               音质授权（待攻）
/youth/api/rank/v1/{info,song}
/media.store/v1/get_res_privilege              资源权限（另一套）
/youth/v1/ai/ai_song_tracker_url
```

**搜索 / 推荐**
```
/complexsearch/v4/search/mixed
/complexsearch/v3/search/mixed
/searchtip/v3/getSearchTip
/youth/v2/search/song
/youth/v1/focus/{search,recommend_list}
/youth/api/channel/v10/recommend_list
/youth/v1/recommend/{ai_radio_recommend,channel_wander}
```

**用户 / 社交**
```
/youth/v1/user/{get_user_conf,rt_status,batch_rt_status,set_user_conf}
/youth/v1/check/user
/youth/v1/kugroup/{check_group,report}
/youth/v3/user/{recent_dynamic,dynamic_rpt}
/youth/v4/user/get_dynamic
```

**AI 功能**（概念版特色）
```
/concepts/v1/ai/{copywriting_list,free_tab_config,recommend_song}
/youth/v1/ai/{ai_song_list,ai_song_info,ai_song_lyric,synthesis_song,user_ai_produce}
/youth/v1/ai/{materiel_songs,materiel_tab_songs,materiel_song_recommend}
```

**播放历史 / 收藏**
```
/playhistory/youth/v1/{get_device_tabs,get_songs,upload_songs}
/recentcollect/**
/youth/v1/channel/{add_song,batch_del_collect_song}
```

**其它**
```
/ip/api/v1/overseas/check_v2                   海外区域检测
/openapi/copyright/v1/audio/get_goods          版权商品
/fingerprint.service/**                        音频指纹识别
/rmservice/**                                  资源管理（22 个端点）
```

---

## 变更记录

| 日期 | 内容 |
|---|---|
| 2026-11-16 | 首版。完成签名爆破、签到链路、播放直链打通，输出 SDK 与本文档 |

---

**配套文件**

| 文件 | 说明 |
|---|---|
| `kugou/kg_sdk.py` | **统一 SDK，单文件可直接 import** |
| `kugou/demo.py` | 命令行示例：搜索 / 取直链 / 歌词 / 歌单 / 榜单 / 下载 |
| `kugou/sign_daily.py` | 每日签到执行器 |
| `kugou/kg_gateway.py` | gateway 轻量封装（签到专用） |
| `kugou/kg_api.py` | web 通道封装（早期版本） |
| `kugou/config.json` | 凭据 / 密钥 / 端点配置 |
| `docs/ENDPOINTS.md` | 418 条 gateway 路径全量清单 |
| `docs/urls_all.txt` | 1693 条 dex 内提取的原始 URL |
| `scripts/brute_sign3.py` | 签名爆破器（换版本后可复用） |
| `scripts/smoke_test.py` | SDK 全功能冒烟测试（25 项） |
| `scripts/probe_*.py` | 各轮接口探测脚本 |
