import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

/**
 * Token 持久化：把每个房间共享的第三方账号 token 写入 JSON 文件。
 * 采用「内存缓存 + 防抖落盘」，避免高频写入影响性能。
 */
export class TokenStore {
  constructor(filePath = config.tokenStorePath) {
    this.filePath = filePath;
    this.cache = {}; // { [roomId]: { tokens: [], updatedAt, by } }
    this._timer = null;
    this._dirty = false;
  }

  async init() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') this.cache = parsed;
    } catch {
      // 文件不存在或损坏：从空开始
      this.cache = {};
      await fs.mkdir(path.dirname(this.filePath), { recursive: true }).catch(() => {});
    }
  }

  get(roomId) {
    const entry = this.cache[roomId];
    return entry ? entry.tokens : [];
  }

  set(roomId, tokens, by = '') {
    this.cache[roomId] = {
      tokens,
      by,
      updatedAt: Date.now(),
    };
    this._scheduleFlush();
  }

  _scheduleFlush() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => this.flush(), 500);
  }

  async flush() {
    if (!this._dirty) return;
    this._dirty = false;
    this._timer = null;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8');
    } catch (err) {
      console.error('[store] token 落盘失败:', err.message);
    }
  }

  /** 优雅退出时调用，确保数据写入 */
  async close() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    await this.flush();
  }
}
