/**
 * AnimaImagine v2.2 — Tag Pill Input
 *
 * 多行、auto-grow、pill 可点击编辑、带删除按钮、可拖动排序。
 * 不依赖任何三方库（Tagify ~50KB，我们只需 4KB）。
 *
 * 使用场景：高级模式下每个语义槽位（appearance / outfit / artist 等）都是一个 PillInput。
 * 用户输入 “, ” 或 Enter → 提交成一个 pill。
 * 点击 pill → 进入编辑态，再提交会回到原位。
 * Backspace 且输入区为空 → 抓起最后一个 pill 进编辑态。
 */

import { escapeHtml } from './utils.js';

// 表示一个 pill input 实例的状态。
export class PillInput {
  /**
   * @param {HTMLElement} root 容器元素（一个空 div）
   * @param {Object} opts
   * @param {string} opts.placeholder
   * @param {string} [opts.category] 'general' | 'artist' | 'character' | 'series' | 'meta'
   *        会记在 dataset.category 上，供 autocomplete 过滤、供 CSS 变色。
   * @param {string} [opts.value] 初始值（逗号分隔）
   * @param {boolean} [opts.singleLine] true 则只许一行（用于 quality / count）
   * @param {(value:string)=>void} [opts.onChange]
   */
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = opts;
    this.category = opts.category || 'general';
    this.placeholder = opts.placeholder || '';
    this.singleLine = !!opts.singleLine;
    this.onChange = opts.onChange || (() => {});

    this._build();
    if (opts.value) this.setValue(opts.value);
  }

  // ----------------------------------------------------------
  // DOM
  // ----------------------------------------------------------
  _build() {
    this.root.classList.add('pill-input');
    if (this.singleLine) this.root.classList.add('pill-input-single');
    this.root.dataset.category = this.category;

    // editor: contenteditable plaintext。始终是容器内最后一个子节点。
    this.editor = document.createElement('span');
    this.editor.className = 'pill-editor';
    this.editor.contentEditable = 'plaintext-only';
    this.editor.setAttribute('spellcheck', 'false');
    // contenteditable="plaintext-only" 在 Firefox 可能被降级为 true，都能用

    this.placeholderEl = document.createElement('span');
    this.placeholderEl.className = 'pill-placeholder';
    this.placeholderEl.textContent = this.placeholder;

    this.root.appendChild(this.placeholderEl);
    this.root.appendChild(this.editor);

    // 点击容器空白处 → 聚焦 editor
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root || e.target === this.placeholderEl) {
        e.preventDefault();
        this._focusEditorAtEnd();
      }
    });

    this.editor.addEventListener('keydown', (e) => this._onKeydown(e));
    this.editor.addEventListener('input', () => this._refreshPlaceholder());
    this.editor.addEventListener('blur', () => {
      // 失焦时提交未完成的 pill，但要给 autocomplete 点击一点时间
      setTimeout(() => {
        if (document.activeElement !== this.editor) {
          this._commitEditor();
          this._refreshPlaceholder();
        }
      }, 180);
    });

    this._refreshPlaceholder();
  }

  _focusEditorAtEnd() {
    this.editor.focus();
    const range = document.createRange();
    range.selectNodeContents(this.editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  _refreshPlaceholder() {
    const hasPills = this.root.querySelector('.pill') !== null;
    const editorEmpty = !this.editor.textContent.trim();
    this.placeholderEl.style.display = (hasPills || !editorEmpty) ? 'none' : 'inline';
  }

  // ----------------------------------------------------------
  // 键盘事件
  // ----------------------------------------------------------
  _onKeydown(e) {
    // 补全导航交给 autocomplete 处理（它听同一个 editor）
    // 这里只管：逗号 / 回车 / 退格 / Tab带补全交给 ac

    if (e.key === ',' || e.key === '\uff0c') {
      e.preventDefault();
      this._commitEditor();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // \u3010v2.3 \u4fee\u590d\u3011Enter \u65f6\u5ef6\u8fdf\u63d0\u4ea4\uff0c\u8ba9 autocomplete \u7684 keydown \u5148\u6267\u884c\u3002
      // \u5982\u679c autocomplete \u9009\u4e2d\u4e86\u8865\u5168\u9879\uff0c\u5b83\u4f1a\u5148\u6e05\u7a7a editor \u5e76\u63d2\u5165 pill\uff0c
      // \u4e4b\u540e _commitEditor \u53d1\u73b0\u7f16\u8f91\u5668\u4e3a\u7a7a\u5c31\u4f1a\u8df3\u8fc7\uff0c\u907f\u514d\u91cd\u590d\u751f\u6210 pill\u3002
      setTimeout(() => this._commitEditor(), 0);
      return;
    }


    if (e.key === 'Backspace') {
      // editor 为空 → 抓起最后一个 pill 进编辑态
      const sel = window.getSelection();
      const text = this.editor.textContent;
      if (!text && sel.anchorOffset === 0) {
        const pills = this.root.querySelectorAll('.pill');
        if (pills.length) {
          e.preventDefault();
          this._editPill(pills[pills.length - 1]);
        }
      }
    }
  }

  // ----------------------------------------------------------
  // pill 提交 / 编辑 / 删除
  // ----------------------------------------------------------
  _commitEditor() {
    const raw = this.editor.textContent.trim();
    if (!raw) return;
    // 可能一次粘贴了多个 tag
    const parts = raw.split(/[,\n，]/).map(s => s.trim()).filter(Boolean);
    this.editor.textContent = '';
    parts.forEach(p => this._insertPillBefore(p, this.editor));
    this._fireChange();
    this._refreshPlaceholder();
  }

  /** 从 DOM 将指定 pill 转回编辑态（文本在 editor 中，光标居末） */
  _editPill(pillEl) {
    const text = pillEl.dataset.value;
    pillEl.remove();
    this.editor.textContent = text;
    this._focusEditorAtEnd();
    this._fireChange();
    this._refreshPlaceholder();
  }

  _removePill(pillEl) {
    pillEl.remove();
    this._fireChange();
    this._refreshPlaceholder();
  }

  /** 在指定节点前插入一个 pill。 */
  _insertPillBefore(text, beforeNode) {
    text = text.trim();
    if (!text) return;
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.dataset.value = text;
    pill.dataset.category = _detectPillCategory(text, this.category);
    pill.setAttribute('draggable', 'true');
    pill.innerHTML = `<span class="pill-text">${escapeHtml(text)}</span><button type="button" class="pill-remove" tabindex="-1">×</button>`;

    // 点击 pill 主体 → 进编辑
    pill.querySelector('.pill-text').addEventListener('mousedown', (e) => {
      e.preventDefault();
      this._editPill(pill);
    });
    // 点 × 删除
    pill.querySelector('.pill-remove').addEventListener('mousedown', (e) => {
      e.preventDefault();
      this._removePill(pill);
    });
    // 拖拽排序
    _wireDrag(pill, this);

    this.root.insertBefore(pill, beforeNode);
  }

  // ----------------------------------------------------------
  // 外部 API
  // ----------------------------------------------------------
  /** 返回逗号分隔的完整值（不含当前 editor 未提交部分 — 调用前请 commit） */
  getValue() {
    // 先提交 editor，保证用户点“生成”时未完成的输入也计入
    this._commitEditor();
    const pills = this.root.querySelectorAll('.pill');
    return Array.from(pills).map(p => p.dataset.value).join(', ');
  }

  setValue(str) {
    // 清空并重建
    this.root.querySelectorAll('.pill').forEach(p => p.remove());
    this.editor.textContent = '';
    if (str) {
      str.split(/[,\n，]/).map(s => s.trim()).filter(Boolean)
        .forEach(p => this._insertPillBefore(p, this.editor));
    }
    this._refreshPlaceholder();
    this._fireChange();
  }

  clear() { this.setValue(''); }

  focus() { this._focusEditorAtEnd(); }

  /** autocomplete 需要拿 editor DOM 节点来绑定事件 */
  getEditorEl() { return this.editor; }

  /** autocomplete 选中一项后调用：直接插入成 pill */
  insertTag(tagText) {
    this.editor.textContent = '';
    this._insertPillBefore(tagText, this.editor);
    this._fireChange();
    this._refreshPlaceholder();
    this._focusEditorAtEnd();
  }

  _fireChange() {
    try { this.onChange(this.getValueSilent()); } catch {}
  }

  /** 不 trigger commit 的取值（内部用，避免递归） */
  getValueSilent() {
    const pills = this.root.querySelectorAll('.pill');
    return Array.from(pills).map(p => p.dataset.value).join(', ');
  }
}

// ----------------------------------------------------------
// pill 拖动排序（同一个 PillInput 内部）
// ----------------------------------------------------------
function _wireDrag(pill, instance) {
  pill.addEventListener('dragstart', (e) => {
    pill.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Firefox 需要设任意数据才会开拖拽
    e.dataTransfer.setData('text/plain', pill.dataset.value);
  });
  pill.addEventListener('dragend', () => {
    pill.classList.remove('dragging');
    instance._fireChange();
  });
  pill.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = instance.root.querySelector('.pill.dragging');
    if (!dragging || dragging === pill) return;
    const rect = pill.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    instance.root.insertBefore(dragging, after ? pill.nextSibling : pill);
  });
}

// ----------------------------------------------------------
// 根据字段默认类别与 tag 本身推断显示色
// ----------------------------------------------------------
function _detectPillCategory(text, fieldCategory) {
  const t = text.toLowerCase().trim();
  if (t.startsWith('@')) return 'artist';
  if (/^score_\d+$/.test(t)) return 'score';
  if (/^(masterpiece|best quality|highres|absurdres|good quality|normal quality|low quality|worst quality)$/.test(t)) return 'quality';
  if (/^(safe|sensitive|nsfw|explicit)$/.test(t)) return 'safety';
  if (/^year \d{4}$|^(newest|recent|mid|early|old)$/.test(t)) return 'year';
  if (/^\d*(girl|boy|other)s?$|^no humans$/.test(t)) return 'count';
  return fieldCategory || 'general';
}
