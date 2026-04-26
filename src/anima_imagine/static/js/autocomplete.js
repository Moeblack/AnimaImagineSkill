/**
 * AnimaImagine v2.2 标签自动补全。
 *
 * v2.2 变更：
 *   - 同时支持 textarea/input 和 PillInput 作为宿主
 *   - 支持 categoryFilter（画师字段只推画师，角色字段只推角色等）
 *   - 选中后：PillInput 调 insertTag；textarea 则原位插入
 */

import { sortedTags, dataReady } from './tag-data.js';
import { syncCustomTagsFromServer } from './tag-data-manager.js';
import { escapeHtml, formatCount } from './utils.js';

const MAX_SUGGESTIONS = 12;
let tagDataLoadPromise = null;

// 前端性能优化：自动补全按需加载标签库，目的在于不让图库首屏承担大型 CSV 下载和解析成本。
// 生成面板打开时会预热；如果用户直接输入，这里会触发同一条同步链路。

// ============================================================
// 匹配
// ============================================================
function matchWord(target, q) {
  if (target === q) return { matched: true, exact: true };
  if (target.includes(q)) return { matched: true, exact: false };
  if (target.replace(/[-_\s']/g, '').includes(q.replace(/[-_\s']/g, ''))) return { matched: true, exact: false };
  return { matched: false, exact: false };
}

function sequentialSearch(query, categoryFilter) {
  const exact = [], partial = [], added = new Set();
  const q = query.toLowerCase();
  for (const td of sortedTags) {
    if (categoryFilter != null && td.category !== categoryFilter) continue;
    let m = matchWord(td.tag.toLowerCase(), q);
    if (!m.matched && td.aliases.length) {
      for (const a of td.aliases) {
        const am = matchWord(a.toLowerCase(), q);
        if (am.matched) { m = am; break; }
      }
    }
    if (m.matched && !added.has(td.tag)) {
      (m.exact ? exact : partial).push(td);
      added.add(td.tag);
      if (exact.length + partial.length >= MAX_SUGGESTIONS) break;
    }
  }
  return [...exact, ...partial];
}

// ============================================================
// 从宿主中提取当前 partial
// ============================================================

function getPartialFromTextarea(el) {
  const text = el.value;
  const cursor = el.selectionStart;
  const lastComma = text.lastIndexOf(',', cursor - 1);
  const lastNewline = text.lastIndexOf('\n', cursor - 1);
  const start = Math.max(lastComma, lastNewline) + 1;
  return text.substring(start, cursor).trim().replace(/ /g, '_');
}

function getPartialFromEditor(editorEl) {
  // PillInput 的 editor 只包含未提交文本
  return editorEl.textContent.trim().replace(/ /g, '_');
}

function insertIntoTextarea(el, tagText) {
  const text = el.value;
  const cursor = el.selectionStart;
  const lastComma = text.lastIndexOf(',', cursor - 1);
  const lastNewline = text.lastIndexOf('\n', cursor - 1);
  const start = Math.max(lastComma, lastNewline) + 1;
  const needSpace = text[start - 1] === ',';
  const prefix = needSpace ? ' ' : '';
  const normalized = tagText.replace(/_/g, ' ');
  const suffix = ', ';
  el.focus();
  el.setSelectionRange(start, cursor);
  if (!document.execCommand('insertText', false, prefix + normalized + suffix)) {
    const before = text.substring(0, start);
    const after = text.substring(cursor);
    el.value = before + prefix + normalized + suffix + after;
    const pos = start + prefix.length + normalized.length + suffix.length;
    el.selectionStart = el.selectionEnd = pos;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// ============================================================
// AutocompleteUI
// ============================================================
class AutocompleteUI {
  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'autocomplete-root';
    this.list = document.createElement('div');
    this.list.className = 'autocomplete-list';
    this.root.appendChild(this.list);
    document.body.appendChild(this.root);
    this.target = null;          // 宿主：{ kind:'textarea'|'pill', el, pill?, categoryFilter? }
    this.candidates = [];
    this.selectedIndex = -1;

    this.list.addEventListener('mousedown', (e) => {
      const row = e.target.closest('.ac-item');
      if (row && row.dataset.index !== undefined) {
        const td = this.candidates[parseInt(row.dataset.index, 10)];
        if (td) this._commit(td);
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  isVisible() {
    return this.root.style.display === 'block';
  }

  update(target) {
    if (!dataReady) { this.target = target; ensureTagDataForAutocomplete(target); this.hide(); return; }
    this.target = target;
    const partial = target.kind === 'pill'
      ? getPartialFromEditor(target.el)
      : getPartialFromTextarea(target.el);
    if (!partial) { this.hide(); return; }

    const cands = sequentialSearch(partial, target.categoryFilter);
    if (!cands.length) { this.hide(); return; }
    this.candidates = cands;
    this.selectedIndex = 0;

    this.list.innerHTML = '';
    cands.forEach((td, idx) => {
      const row = document.createElement('div');
      row.className = 'ac-item';
      row.dataset.index = idx;
      row.dataset.cat = td.categoryName;
      row.innerHTML = `
        <span class="ac-tag-name">${escapeHtml(td.tag.replace(/_/g, ' '))}</span>
        <span class="ac-alias">${escapeHtml((td.aliases || []).slice(0, 3).join(', '))}</span>
        <span class="ac-count">${formatCount(td.count)}</span>
      `;
      this.list.appendChild(row);
    });
    this._position(target);
    this.root.style.display = 'block';
    this._highlight();
  }

  hide() {
    this.root.style.display = 'none';
    this.selectedIndex = -1;
    this.candidates = [];
  }

  navigate(dir) {
    if (!this.candidates.length) return;
    this.selectedIndex = (this.selectedIndex + dir + this.candidates.length) % this.candidates.length;
    this._highlight();
  }

  getSelected() {
    return this.selectedIndex >= 0 ? this.candidates[this.selectedIndex] : null;
  }

  /** 外部调用（按 Enter / Tab）提交选中。 */
  commitSelected() {
    const td = this.getSelected();
    if (td) this._commit(td);
  }

  _commit(td) {
    if (!this.target) return;
    if (this.target.kind === 'pill') {
      // PillInput: 交给实例插入。画师字段 → 自动加 @ 前缀
      let text = td.tag.replace(/_/g, ' ');
      if (this.target.categoryFilter === 1 && !text.startsWith('@')) text = '@' + text;
      this.target.pill.insertTag(text);
    } else {
      insertIntoTextarea(this.target.el, td.tag);
    }
    this.hide();
  }

  _position(target) {
    const rect = target.el.getBoundingClientRect();
    this.root.style.left = (rect.left + window.scrollX) + 'px';
    this.root.style.top = (rect.bottom + 4 + window.scrollY) + 'px';
    this.root.style.maxWidth = Math.min(rect.width, 500) + 'px';
    requestAnimationFrame(() => {
      const r = this.root.getBoundingClientRect();
      if (r.bottom > window.innerHeight) {
        this.root.style.top = (rect.top + window.scrollY - r.height - 4) + 'px';
      }
    });
  }

  _highlight() {
    const items = this.list.children;
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle('selected', i === this.selectedIndex);
      if (i === this.selectedIndex) items[i].scrollIntoView({ block: 'nearest' });
    }
  }
}

const acUI = new AutocompleteUI();

function ensureTagDataForAutocomplete(target) {
  // 前端性能优化：多个输入框共享同一个加载 Promise，目的在于避免重复拉取和重复解析标签数据。
  if (tagDataLoadPromise) return;
  tagDataLoadPromise = syncCustomTagsFromServer().then(() => {
    tagDataLoadPromise = null;
    if (acUI.target === target) acUI.update(target);
  }).catch((err) => {
    tagDataLoadPromise = null;
    console.warn('[Autocomplete] 标签库加载失败:', err.message);
  });
}

// ============================================================
// 公开接口
// ============================================================

/**
 * 为 textarea/input 启用补全。
 * @param {HTMLTextAreaElement|HTMLInputElement} el
 * @param {{ categoryFilter?: number }} [opts]
 */
export function enableAutocomplete(el, opts = {}) {
  if (!el) return;
  const target = { kind: 'textarea', el, categoryFilter: opts.categoryFilter };
  _wireKeyEvents(el, target);
}

/**
 * 为 PillInput 启用补全。
 * @param {{getEditorEl:()=>HTMLElement, insertTag:(s:string)=>void}} pill
 * @param {{ categoryFilter?: number }} [opts]
 */
export function enableAutocompleteForPill(pill, opts = {}) {
  if (!pill) return;
  const editor = pill.getEditorEl();
  const target = { kind: 'pill', el: editor, pill, categoryFilter: opts.categoryFilter };
  _wireKeyEvents(editor, target);
}

function _wireKeyEvents(el, target) {
  el.addEventListener('keydown', (e) => {
    if (!acUI.isVisible()) return;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); acUI.navigate(1); break;
      case 'ArrowUp':   e.preventDefault(); acUI.navigate(-1); break;
      case 'Tab':
      case 'Enter': {
        if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) break;
        if (acUI.getSelected()) {
          e.preventDefault();
          e.stopPropagation();
          acUI.commitSelected();
        } else {
          acUI.hide();
        }
        break;
      }
      case 'Escape': e.preventDefault(); acUI.hide(); break;
    }
  });
  el.addEventListener('keyup', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) return;
    // 【v2.3 性能优化】keyup 和 input 都会触发 update，导致同一次按键搜索两次。
    // 改为 keyup 中去抖：只有在 input 没触发时才搜。用 RAF 合并到下一帧。
    if (target._acRafId) cancelAnimationFrame(target._acRafId);
    target._acRafId = requestAnimationFrame(() => {
      target._acRafId = 0;
      acUI.update(target);
    });
  });
  // 【v2.3】去掉 input 事件上的重复 update 调用，只保留 keyup（已去抖）
  el.addEventListener('blur', () => {
    setTimeout(() => {
      if (!acUI.root.contains(document.activeElement)) acUI.hide();
    }, 180);
  });
}
