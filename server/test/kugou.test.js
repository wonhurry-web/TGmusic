import test from 'node:test';
import assert from 'node:assert/strict';
import { sign, md5 } from '../src/sign.js';
import { parseLrc } from '../src/kugou.js';
import { SignPool } from '../src/signPool.js';
import { LruCache } from '../src/cache.js';

test('签名算法：排序参数 + secret 前后包裹', () => {
  const secret = 'SECRET';
  const params = { b: '2', a: '1', signature: 'x' };
  // md5(SECRET + a=1b=2 + body + SECRET)
  const expected = sign({ a: '1', b: '2' }, secret, '');
  assert.equal(sign(params, secret, ''), expected);
  assert.equal(sign(params, secret, ''), sign({ b: '2', a: '1' }, secret, ''));
});

test('md5(hash) 不加盐', () => {
  assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
});

test('LRC 解析：多时间戳 + 排序 + 毫秒', () => {
  const lrc = '[00:05.00]第二句\n[00:01.25]第一句\n[01:02.5]第三句\n不是歌词';
  const lines = parseLrc(lrc);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].time, 1.3); // 1.25 四舍五入到 0.1
  assert.equal(lines[0].text, '第一句');
  assert.equal(lines[2].time, 62.5);
});

test('LRU 缓存：TTL 过期 + 容量淘汰', async () => {
  const c = new LruCache(2);
  c.set('a', 1, 50);
  c.set('b', 2);
  assert.equal(c.get('a'), 1);
  c.set('c', 3); // 淘汰最久未用 'b'
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('c'), 3);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(c.get('a'), undefined); // TTL 过期
});

test('签名线程池：并发签名结果与主线程一致', async () => {
  const pool = new SignPool(4);
  pool.start();
  await new Promise((r) => setTimeout(r, 100));
  const items = Array.from({ length: 20 }, (_, i) => ({
    params: { hash: `h${i}`, quality: '320', clienttime: String(1000 + i) },
  }));
  const results = await pool.signBatch(items, 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA');
  assert.equal(results.length, 20);
  for (let i = 0; i < items.length; i++) {
    assert.equal(results[i], sign(items[i].params, 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA', ''));
  }
  pool.close();
});
