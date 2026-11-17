/**
 * 轻量 LRU + TTL 缓存（Map 实现，无依赖）。
 * 用于搜索/榜单/歌词/直链结果缓存，减轻上游 API 压力与并发重复请求。
 */
export class LruCache {
  constructor(max = 500) {
    this.max = max;
    this.map = new Map();
  }

  get(key) {
    const item = this.map.get(key);
    if (!item) return undefined;
    if (item.expire && Date.now() > item.expire) {
      this.map.delete(key);
      return undefined;
    }
    // 命中提升为最近使用
    this.map.delete(key);
    this.map.set(key, item);
    return item.value;
  }

  set(key, value, ttl = 0) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expire: ttl ? Date.now() + ttl : 0 });
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }

  delete(key) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

export default LruCache;
