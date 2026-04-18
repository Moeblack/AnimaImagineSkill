/**
 * AnimaImagine 标签自动补全。
 * Phase 1.4: 从 ComfyUI-Autocomplete-Plus 的 autocomplete.js 移植并简化。
 * 去掉了 ComfyUI 画布缩放、LoRA/Embedding、Settings 依赖，
 * 只保留纯前端 textarea 补全逻辑。
 */

import { sortedTags, dataReady, tagMap } from './tag-data.js';
import { escapeHtml, formatCount } from './utils.js';

// ============================================================
// 配置常量
// ============================================================

const MAX_SUGGESTIONS = 10;

// ============================================================
// 匹配函数（复用 ComfyUI-Autocomplete-Plus 的 matchWord 逻辑）
// ============================================================

/**
 * 检查 target 是否匹配 queries 中的任一变体。
 * @param {string} target - 小写后的目标字符串
 * @param {Set<string>} queries - 查询变体集合
 * @returns {{matched: boolean, isExactMatch: boolean}}
 */
function matchWord(target, queries) {
  for (const q of queries) {
    if (target === q) return { matched: true, isExactMatch: true };
  }
  for (const q of queries) {
    if (target.includes(q)) return { matched: true, isExactMatch: false };
    // 去除常见分隔符后再试（处理 "black hair" vs "black_hair"）
    if (target.replace(/[-_\s']/g, '').includes(q.replace(/[-_\s']/g, ''))) {
      return { matched: true, isExactMatch: false };
    }
  }
  return { matched: false, isExactMatch: false };
}

// ============================================================
// 搜索算法（顺序搜索，高频优先）
// ============================================================

/**
 * 在已排序的标签数组中搜索候选项。
 * 精确匹配优先于部分匹配，达到 MAX_SUGGESTIONS 后停止。
 *
 * @param {Set<string>} queryVariations - 查询变体集合
 * @returns {TagData[]}
 */
function sequentialSearch(queryVariations) {
  const exactMatches = [];
  const partialMatches = [];
  const added = new Set();

  for (const tagData of sortedTags) {
    let matched = false;
    let isExact = false;

    // 检查主标签
    const m = matchWord(tagData.tag.toLowerCase(), queryVariations);
    matched = m.matched;
    isExact = m.isExactMatch;

    // 主标签未命中则检查别名
    if (!matched && tagData.aliases.length > 0) {
      for (const alias of tagData.aliases) {
        const am = matchWord(alias.toLowerCase(), queryVariations);
        if (am.matched) {
          matched = true;
          isExact = am.isExactMatch;
          break;
        }
      }
    }

    if (matched && !added.has(tagData.tag)) {
      (isExact ? exactMatches : partialMatches).push(tagData);
      added.add(tagData.tag);

      if (exactMatches.length + partialMatches.length >= MAX_SUGGESTIONS) {
        return [...exactMatches, ...partialMatches].slice(0, MAX_SUGGESTIONS);
      }
    }
  }

  return [...exactMatches, ...partialMatches];
}

// ============================================================
// 提取当前输入的 partial tag
// ============================================================

/**
 * 从 textarea 的光标位置向前查找当前正在输入的标签片段。
 * 以逗号或换行为分隔符。
 */
function getCurrentPartialTag(el) {
  if (!el) return '';
  const text = el.value;
  const cursor = el.selectionStart;

  // 找到光标前最近的分隔符（逗号或换行）
  const lastComma = text.lastIndexOf(',', cursor - 1);
  const lastNewline = text.lastIndexOf('\n', cursor - 1);
  const start = Math.max(lastComma, lastNewline) + 1;

  const partial = text.substring(start, cursor).trim();

  // 如果看起来像权重修饰符（如 :1.2），跳过
  const colonIdx = partial.lastIndexOf(':');
  if (colonIdx !== -1) {
    const afterColon = partial.substring(colonIdx + 1);
    const w = parseFloat(afterColon);
    if (!isNaN(w) && w <= 9.9) return '';
  }

  // 标准化：空格替换为下划线（danbooru 格式）
  return partial.replace(/ /g, '_');
}

/**
 * 提取 textarea 中已有的所有标签（用于判断“已存在”状态）。
 */
function getExistingTags(el) {
  if (!el || !el.value) return new Set();
  return new Set(
    el.value.split(/[,\n]/)
      .map(s => s.trim().replace(/ /g, '_').toLowerCase())
      .filter(s => s.length > 0)
  );
}

// ============================================================
// 插入标签到 textarea
// ============================================================

/**
 * 将选中的标签插入 textarea，替换 partial tag。
 * 使用 execCommand('insertText') 以支持浏览器原生 Undo。
 */
function insertTag(el, tagData) {
  if (!el || !tagData) return;

  const text = el.value;
  const cursor = el.selectionStart;

  // 找到要替换的范围
  const lastComma = text.lastIndexOf(',', cursor - 1);
  const lastNewline = text.lastIndexOf('\n', cursor - 1);
  const start = Math.max(lastComma, lastNewline) + 1;

  // 替换文本：保留分隔符后的空格，追加 ", "
  const needSpace = text[start - 1] === ',';
  const prefix = needSpace ? ' ' : '';
  // 下划线替换为空格（适合 Anima 的 prompt 格式）
  const normalizedTag = tagData.tag.replace(/_/g, ' ');
  const suffix = ', ';

  el.focus();
  el.setSelectionRange(start, cursor);
  const ok = document.execCommand('insertText', false, prefix + normalizedTag + suffix);
  if (!ok) {
    // 回退方案：直接修改 value
    const before = text.substring(0, start);
    const after = text.substring(cursor);
    el.value = before + prefix + normalizedTag + suffix + after;
    const newPos = start + prefix.length + normalizedTag.length + suffix.length;
    el.selectionStart = el.selectionEnd = newPos;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// ============================================================
// AutocompleteUI 组件
// ============================================================

class AutocompleteUI {
  constructor() {
    // 创建 DOM
    this.root = document.createElement('div');
    this.root.className = 'autocomplete-root';
    this.list = document.createElement('div');
    this.list.className = 'autocomplete-list';
    this.root.appendChild(this.list);
    document.body.appendChild(this.root);

    this.target = null;       // 当前绑定的 textarea/input
    this.selectedIndex = -1;
    this.candidates = [];

    // 鼠标点击选择
    this.list.addEventListener('mousedown', (e) => {
      const row = e.target.closest('.ac-item');
      if (row && row.dataset.index !== undefined) {
        const td = this.candidates[parseInt(row.dataset.index, 10)];
        if (td) {
          insertTag(this.target, td);
          this.hide();
        }
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  isVisible() {
    return this.root.style.display !== 'none' && this.root.style.display !== '';
  }

  /**
   * 根据当前 textarea 输入更新补全列表。
   */
  update(textareaEl) {
    if (!dataReady) { this.hide(); return; }

    const partial = getCurrentPartialTag(textareaEl);
    if (!partial || partial.length === 0) { this.hide(); return; }

    // 生成查询变体
    const queryVariations = new Set([partial.toLowerCase()]);

    this.candidates = sequentialSearch(queryVariations);
    if (this.candidates.length === 0) { this.hide(); return; }

    this.target = textareaEl;
    this.selectedIndex = 0;

    // 渲染候选列表
    const existingTags = getExistingTags(textareaEl);
    this.list.innerHTML = '';
    this.candidates.forEach((td, idx) => {
      const isExisting = existingTags.has(td.tag.toLowerCase());
      const row = document.createElement('div');
      row.className = 'ac-item' + (isExisting ? ' existing' : '');
      row.dataset.index = idx;
      row.dataset.cat = td.categoryName;

      row.innerHTML = `
        <span class="ac-tag-name">${escapeHtml(td.tag.replace(/_/g, ' '))}</span>
        <span class="ac-alias">${escapeHtml(td.aliases.slice(0, 3).join(', '))}</span>
        <span class="ac-count">${formatCount(td.count)}</span>
      `;
      this.list.appendChild(row);
    });

    this._position(textareaEl);
    this.root.style.display = 'block';
    this._highlight();
  }

  hide() {
    this.root.style.display = 'none';
    this.selectedIndex = -1;
    this.candidates = [];
  }

  navigate(dir) {
    if (this.candidates.length === 0) return;
    this.selectedIndex += dir;
    if (this.selectedIndex < 0) this.selectedIndex = this.candidates.length - 1;
    if (this.selectedIndex >= this.candidates.length) this.selectedIndex = 0;
    this._highlight();
  }

  getSelected() {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.candidates.length) {
      return this.candidates[this.selectedIndex];
    }
    return null;
  }

  /** 定位到 textarea 下方 */
  _position(el) {
    const rect = el.getBoundingClientRect();
    let top = rect.bottom + 4 + window.scrollY;
    let left = rect.left + window.scrollX;

    // 确保不超出视口底部，否则翻转到上方
    this.root.style.left = left + 'px';
    this.root.style.top = top + 'px';
    this.root.style.maxWidth = Math.min(rect.width, 500) + 'px';

    // 测量实际高度后判断是否需要翻转
    requestAnimationFrame(() => {
      const rootRect = this.root.getBoundingClientRect();
      if (rootRect.bottom > window.innerHeight) {
        // 翻转到上方
        this.root.style.top = (rect.top + window.scrollY - rootRect.height - 4) + 'px';
      }
    });
  }

  _highlight() {
    const items = this.list.children;
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle('selected', i === this.selectedIndex);
      if (i === this.selectedIndex) {
        items[i].scrollIntoView({ block: 'nearest' });
      }
    }
  }
}

// ============================================================
// 全局单例 + 事件绑定
// ============================================================

const acUI = new AutocompleteUI();

/**
 * 在指定的 textarea/input 元素上启用自动补全。
 * 调用后，用户在该元素中输入时会自动弹出补全建议。
 *
 * @param {HTMLTextAreaElement|HTMLInputElement} el
 */
export function enableAutocomplete(el) {
  if (!el) return;

  // keydown: 处理导航和选择
  el.addEventListener('keydown', (e) => {
    if (!acUI.isVisible()) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        acUI.navigate(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        acUI.navigate(-1);
        break;
      case 'Tab':
      case 'Enter': {
        // 有修饰键时不拦截（允许 Ctrl+Enter 等快捷键）
        if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) break;
        const sel = acUI.getSelected();
        if (sel) {
          e.preventDefault();
          insertTag(el, sel);
        }
        acUI.hide();
        break;
      }
      case 'Escape':
        e.preventDefault();
        acUI.hide();
        break;
    }
  });

  // keyup: 更新补全列表
  el.addEventListener('keyup', (e) => {
    // 修饰键组合不触发补全
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    // 导航键不触发重新搜索
    if (['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) return;

    acUI.update(el);
  });

  // 失去焦点时延迟关闭（允许点击下拉列表）
  el.addEventListener('blur', () => {
    setTimeout(() => {
      if (!acUI.root.contains(document.activeElement)) {
        acUI.hide();
      }
    }, 150);
  });
}
