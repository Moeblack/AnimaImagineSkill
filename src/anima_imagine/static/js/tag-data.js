/**
 * AnimaImagine 标签数据加载与管理。
 * Phase 1.4: 从 ComfyUI-Autocomplete-Plus 的 data.js 移植并简化。
 * 去掉了 ComfyUI API 依赖、LoRA/Embedding 逻辑、设置系统，
 * 只保留纯前端 CSV 加载 + 内存索引。
 */

// ============================================================
// 类别映射（danbooru category 数字 → 名称）
// ============================================================

/**
 * Danbooru 标签类别。CSV 中的 category 字段是数字，这里映射为可读名称。
 * 0=general, 1=artist, 3=copyright, 4=character, 5=meta
 * 注意：2 是未使用的编号，所以数组中有一个空位。
 */
const CATEGORY_NAMES = [
  'general',   // 0
  'artist',    // 1
  'unused',    // 2 (danbooru 未使用)
  'copyright', // 3
  'character', // 4
  'meta',      // 5
];

// ============================================================
// TagData 类
// ============================================================

export class TagData {
  /**
   * @param {string} tag - 标签名（danbooru 格式，下划线分隔）
   * @param {number} category - 类别索引
   * @param {number} count - 使用频率
   * @param {string[]} aliases - 别名数组（日文、中文等）
   */
  constructor(tag, category, count, aliases) {
    this.tag = tag;
    this.category = category;
    this.count = count;
    this.aliases = aliases;
  }

  /** 返回类别名称，如 'general'/'artist'/'character' */
  get categoryName() {
    return CATEGORY_NAMES[this.category] || 'unknown';
  }
}

// ============================================================
// CSV 解析（复用 ComfyUI-Autocomplete-Plus 的 parseCSVLine）
// ============================================================

/**
 * 解析一行 CSV，正确处理引号内的逗号。
 * 例如：solo,0,4005860,"ソロ,solo,ひとり" → ['solo', '0', '4005860', 'ソロ,solo,ひとり']
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"'; // 双引号转义
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// ============================================================
// 全局数据存储
// ============================================================

/** 按 count 降序排列的所有标签，搜索时高频优先 */
export let sortedTags = [];

/** tag → TagData 映射，用于快速查重 */
export const tagMap = new Map();

/** 数据是否已加载完成 */
export let dataReady = false;

// ============================================================
// 加载函数
// ============================================================

/**
 * 从服务端加载 danbooru_tags.csv，解析后存入内存索引。
 * 异步执行，不阻塞页面渲染。
 *
 * CSV 格式：tag,category,count,alias
 * 第一行可能是 header，也可能直接是数据（兵容两种情况）。
 */
export async function loadTagData() {
  try {
    const t0 = performance.now();
    const response = await fetch('/static/data/danbooru_tags.csv');
    if (!response.ok) {
      console.warn('[TagData] CSV 加载失败:', response.status);
      return;
    }
    const csvText = await response.text();
    const lines = csvText.split('\n').filter(l => l.trim().length > 0);

    // 跳过 header 行（如果存在）
    const startIndex = lines[0].toLowerCase().startsWith('tag,category') ? 1 : 0;

    const tags = [];

    for (let i = startIndex; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < 4) continue;

      const tag = cols[0].trim();
      const category = parseInt(cols[1].trim(), 10);
      const count = parseInt(cols[2].trim(), 10);
      const aliasStr = cols[3].trim();

      if (!tag || isNaN(count)) continue;
      if (tagMap.has(tag)) continue; // 去重

      const aliases = aliasStr
        ? aliasStr.split(',').map(a => a.trim()).filter(a => a.length > 0)
        : [];

      const td = new TagData(tag, category, count, aliases);
      tags.push(td);
      tagMap.set(tag, td);
    }

    // 按 count 降序排列（CSV 本身可能已排序，但不保证）
    tags.sort((a, b) => b.count - a.count);
    sortedTags = tags;
    dataReady = true;

    const elapsed = (performance.now() - t0).toFixed(0);
    console.log(`[TagData] 加载完成: ${tags.length} 条标签, 耗时 ${elapsed}ms`);
  } catch (err) {
    console.error('[TagData] 加载异常:', err);
  }
}
