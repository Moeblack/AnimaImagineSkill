/**
 * AnimaImagine v2.3 标签数据加载与管理。
 *
 * 多数据源：
 *   - core: 默认 danbooru_tags.csv（同源于仓库，首次加载后缓存到 IndexedDB）
 *   - custom: 用户导入的 CSV（存于 IndexedDB，遇重复 tag 覆盖 core）
 *   - artist: 从 core+custom 中筛选 category=1 得到，供画师字段专用补全
 *
 * 缓存策略：
 *   - v2.3: 从 localStorage 迁移到 IndexedDB，解决 localStorage 5-10MB 配额限制
 *     导致大型 CSV 无法存储的问题（"exceeded the quota" 错误）。
 *   - core CSV 首次访问后写入 IndexedDB（store: cache, key: core/custom/meta）
 *   - 下次启动直接从本地读，避免重新下载 5-8MB
 *   - "数据管理"面板可手动刷新 / 上传 / 清除
 */

// 类别名称
const CATEGORY_NAMES = ['general', 'artist', 'unused', 'copyright', 'character', 'meta'];

export class TagData {
  constructor(tag, category, count, aliases) {
    this.tag = tag;
    this.category = category;
    this.count = count;
    this.aliases = aliases;
  }
  get categoryName() { return CATEGORY_NAMES[this.category] || 'unknown'; }
}

// ============================================================
// CSV 解析
// ============================================================
function parseCSVLine(line) {
  const result = [];
  let current = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else current += ch;
  }
  result.push(current);
  return result;
}

function parseCSV(csvText) {
  const lines = csvText.split('\n').filter(l => l.trim().length > 0);
  const startIndex = lines[0].toLowerCase().startsWith('tag,category') ? 1 : 0;
  const tags = [];
  for (let i = startIndex; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 3) continue;
    const tag = cols[0].trim();
    const category = parseInt(cols[1].trim(), 10);
    const count = parseInt(cols[2].trim(), 10) || 0;
    const aliasStr = (cols[3] || '').trim();
    if (!tag || isNaN(category)) continue;
    const aliases = aliasStr ? aliasStr.split(',').map(a => a.trim()).filter(Boolean) : [];
    tags.push(new TagData(tag, category, count, aliases));
  }
  return tags;
}

// ============================================================
// IndexedDB 存储层
// 【v2.3 新增】替代 localStorage，解决大文件配额溢出问题。
// 使用单个 object store "cache"，key 为 core / custom / meta。
// ============================================================
const IDB_NAME = 'anima_tagdata';
const IDB_VERSION = 1;
const IDB_STORE = 'cache';

/** 打开（或创建）IndexedDB，返回 db 实例。 */
function _openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 从 IndexedDB 读取指定 key 的值。 */
async function _idbGet(key) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 向 IndexedDB 写入指定 key 的值。 */
async function _idbSet(key, value) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 从 IndexedDB 删除指定 key。 */
async function _idbDelete(key) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================
// 存储 key 常量 & 状态
// ============================================================
const KEY_CORE = 'core';
const KEY_CUSTOM = 'custom';
const KEY_META = 'meta';
const CORE_URL = '/static/data/danbooru_tags.csv';

// 全局状态
export let sortedTags = [];        // 全量按 count 降序
export const tagMap = new Map();   // tag 名 -> TagData
export let dataReady = false;
export let artistTags = [];        // 画师子集（category=1）
let meta = { coreCount: 0, customCount: 0, artistCount: 0, source: '', updatedAt: '' };

// ============================================================
// 一次性迁移：localStorage -> IndexedDB
// 【v2.3】旧版数据可能残留在 localStorage 中，首次加载时迁移过来
// 并清理旧 key，避免浪费 localStorage 配额。
// ============================================================
const LS_KEY_CORE_LEGACY = 'anima_tagdata_core_v1';
const LS_KEY_CUSTOM_LEGACY = 'anima_tagdata_custom_v1';
const LS_KEY_META_LEGACY = 'anima_tagdata_meta_v1';

async function _migrateFromLocalStorage() {
  // 【v2.3 性能优化】只在首次 loadTagData 调用时执行，之后跳过
  if (_migrateFromLocalStorage._done) return;
  _migrateFromLocalStorage._done = true;
  try {
    const coreLS = localStorage.getItem(LS_KEY_CORE_LEGACY);
    if (coreLS) {
      await _idbSet(KEY_CORE, coreLS);
      localStorage.removeItem(LS_KEY_CORE_LEGACY);
      console.log('[TagData] 已将 core 从 localStorage 迁移到 IndexedDB');
    }
    const customLS = localStorage.getItem(LS_KEY_CUSTOM_LEGACY);
    if (customLS) {
      await _idbSet(KEY_CUSTOM, customLS);
      localStorage.removeItem(LS_KEY_CUSTOM_LEGACY);
      console.log('[TagData] 已将 custom 从 localStorage 迁移到 IndexedDB');
    }
    const metaLS = localStorage.getItem(LS_KEY_META_LEGACY);
    if (metaLS) {
      await _idbSet(KEY_META, metaLS);
      localStorage.removeItem(LS_KEY_META_LEGACY);
    }
  } catch (e) {
    console.warn('[TagData] localStorage 迁移出错（可忽略）:', e.message);
  }
}

// ============================================================
// 加载入口（优先读缓存）
// ============================================================
export async function loadTagData() {
  const t0 = performance.now();

  // 首次加载时尝试迁移旧 localStorage 数据
  await _migrateFromLocalStorage();

  let coreText = null;
  let source = '';

  // 1. 先试 IndexedDB 缓存
  try {
    coreText = await _idbGet(KEY_CORE);
    if (coreText) source = 'cache';
  } catch {}

  // 2. 未命中 -> 从服务端拉
  if (!coreText) {
    try {
      const resp = await fetch(CORE_URL);
      if (resp.ok) {
        coreText = await resp.text();
        source = 'remote';
        // 写入 IndexedDB 缓存（无 localStorage 配额限制）
        try { await _idbSet(KEY_CORE, coreText); }
        catch (e) { console.warn('[TagData] 缓存 core CSV 到 IndexedDB 失败:', e.message); }
      }
    } catch (e) {
      console.error('[TagData] 下载 core CSV 失败:', e);
    }
  }

  if (!coreText) { console.warn('[TagData] 无可用数据'); return; }

  const coreList = parseCSV(coreText);
  let customList = [];
  try {
    const customText = await _idbGet(KEY_CUSTOM);
    if (customText) customList = parseCSV(customText);
  } catch {}

  // 合并：custom 覆盖 core
  tagMap.clear();
  coreList.forEach(t => tagMap.set(t.tag, t));
  customList.forEach(t => tagMap.set(t.tag, t));

  sortedTags = Array.from(tagMap.values()).sort((a, b) => b.count - a.count);
  artistTags = sortedTags.filter(t => t.category === 1);
  dataReady = true;

  meta = {
    coreCount: coreList.length,
    customCount: customList.length,
    artistCount: artistTags.length,
    source,
    updatedAt: new Date().toISOString(),
  };
  try { await _idbSet(KEY_META, JSON.stringify(meta)); } catch {}

  const elapsed = (performance.now() - t0).toFixed(0);
  console.log(`[TagData] 就绪: ${sortedTags.length} 总条（core ${coreList.length} + custom ${customList.length}）、画师 ${artistTags.length}、来源 ${source}、耗时 ${elapsed}ms`);
  // 广播事件，供 autocomplete 重新准备。
  document.dispatchEvent(new CustomEvent('tagdata:ready', { detail: meta }));
}

// ============================================================
// 查询 API
// ============================================================

/** 返回当前数据集统计，供数据管理面板显示。 */
export function getStats() { return { ...meta, ready: dataReady }; }

/** 画师补全专用：只返回 category=1 的按 count 降序列表。 */
export function getArtistTags() { return artistTags; }

// ============================================================
// v2.2: 远程刷新
// ============================================================

/**
 * 从指定 URL（或默认服务端）重新下载 core 数据。
 * @param {string} [url]
 * @param {(loaded:number,total:number)=>void} [onProgress]
 */
export async function refreshCoreFromRemote(url = CORE_URL, onProgress = null) {
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  // 可选：进度回调
  const total = parseInt(resp.headers.get('content-length') || '0', 10);
  let text;
  if (onProgress && resp.body) {
    const reader = resp.body.getReader();
    const chunks = []; let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.length;
      onProgress(received, total);
    }
    text = new TextDecoder().decode(_concatChunks(chunks, received));
  } else {
    text = await resp.text();
  }

  // 【v2.3】写入 IndexedDB 而非 localStorage，避免配额溢出
  try { await _idbSet(KEY_CORE, text); }
  catch (e) { throw new Error('保存到本地失败：' + e.message); }
  // 重新加载进内存
  await loadTagData();
  return getStats();
}

function _concatChunks(chunks, total) {
  const out = new Uint8Array(total); let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

// ============================================================
// v2.2: 用户自定义数据
// ============================================================

/** 以 CSV 文本在现有 custom 集上追加或覆盖。返回新增数量。 */
export async function importCustomCSV(csvText) {
  const list = parseCSV(csvText);
  if (!list.length) throw new Error('CSV 中未解析到任何条目');
  // 与现有 custom 合并，同名覆盖
  const existing = await _readCustomList();
  const merged = new Map();
  existing.forEach(t => merged.set(t.tag, t));
  list.forEach(t => merged.set(t.tag, t));
  await _writeCustomList(Array.from(merged.values()));
  await loadTagData();
  return list.length;
}

/** 删除指定名称的自定义标签。 */
export async function removeCustomTag(name) {
  const existing = (await _readCustomList()).filter(t => t.tag !== name);
  await _writeCustomList(existing);
  await loadTagData();
}

/** 清除所有自定义标签。 */
export async function clearCustom() {
  // 【v2.3】改用 IndexedDB 删除
  try { await _idbDelete(KEY_CUSTOM); } catch {}
  await loadTagData();
}

/** 列出所有自定义标签（供管理面板显示）。 */
export async function listCustom() { return await _readCustomList(); }

/** 【v2.3】从 IndexedDB 读取 custom CSV 文本并解析为 TagData 列表。 */
async function _readCustomList() {
  try {
    const t = await _idbGet(KEY_CUSTOM);
    return t ? parseCSV(t) : [];
  } catch { return []; }
}

/** 【v2.3】将 custom TagData 列表序列化为 CSV 并写入 IndexedDB。 */
async function _writeCustomList(list) {
  const lines = list.map(t => {
    const aliasField = t.aliases && t.aliases.length
      ? `"${t.aliases.join(',').replace(/"/g, '""')}"`
      : '';
    return `${t.tag},${t.category},${t.count},${aliasField}`;
  });
  try { await _idbSet(KEY_CUSTOM, lines.join('\n')); }
  catch (e) { throw new Error('保存到本地失败：' + e.message); }
}

/** 手动清除所有缓存（含 core），下次启动会重新下载。 */
export async function clearAllCache() {
  // 【v2.3】清除 IndexedDB 中所有缓存 key
  try {
    await _idbDelete(KEY_CORE);
    await _idbDelete(KEY_CUSTOM);
    await _idbDelete(KEY_META);
  } catch {}
  // 同时清理可能残留的旧 localStorage key
  try {
    localStorage.removeItem(LS_KEY_CORE_LEGACY);
    localStorage.removeItem(LS_KEY_CUSTOM_LEGACY);
    localStorage.removeItem(LS_KEY_META_LEGACY);
  } catch {}
}
