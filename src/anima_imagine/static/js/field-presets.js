/**
 * AnimaImagine v2.3 — 字段预设保存/加载模块。
 *
 * 【v2.3 新增】每个高级模式字段可以保存当前值为命名预设，
 * 之后从列表中快速选择恢复。预设按字段分开存储在 localStorage 中。
 *
 * 存储格式：localStorage key = `anima_presets_${fieldId}`
 *   值为 JSON: [{name: string, value: string}]
 */

import { escapeHtml, showToast } from './utils.js';

const LS_PREFIX = 'anima_presets_';

/**
 * 为一个 PillInput 字段创建预设按钮并绑定逻辑。
 * @param {string} fieldId   字段 DOM id（如 'advAppearance'）
 * @param {import('./pill-input.js').PillInput} pillInstance  对应 PillInput 实例
 * @returns {HTMLElement} 按钮元素，调用方自行插入 DOM
 */
export function createPresetButton(fieldId, pillInstance) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'preset-btn';
  btn.title = '预设';
  btn.textContent = '💾';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    _togglePopover(btn, fieldId, pillInstance);
  });
  return btn;
}

// ============================================================
// 预设弹窗
// ============================================================
let _activePopover = null;

// 点击弹窗外部关闭
document.addEventListener('mousedown', (e) => {
  if (_activePopover && !_activePopover.contains(e.target)) {
    _closePopover();
  }
});

function _closePopover() {
  if (_activePopover) {
    _activePopover.remove();
    _activePopover = null;
  }
}

function _togglePopover(anchorBtn, fieldId, pillInstance) {
  // 如果已经打开同一个，关闭
  if (_activePopover && _activePopover.dataset.fieldId === fieldId) {
    _closePopover();
    return;
  }
  _closePopover();

  const pop = document.createElement('div');
  pop.className = 'preset-popover';
  pop.dataset.fieldId = fieldId;

  _renderPopoverContent(pop, fieldId, pillInstance);

  // 定位到按钮下方
  document.body.appendChild(pop);
  const rect = anchorBtn.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.left = (rect.left + window.scrollX) + 'px';
  pop.style.top = (rect.bottom + 4) + 'px';
  pop.style.zIndex = '9999';

  // 如果超出屏幕右边界，往左移
  requestAnimationFrame(() => {
    const popRect = pop.getBoundingClientRect();
    if (popRect.right > window.innerWidth - 8) {
      pop.style.left = (window.innerWidth - popRect.width - 8) + 'px';
    }
    // 如果超出底部，弹到上方
    if (popRect.bottom > window.innerHeight - 8) {
      pop.style.top = (rect.top - popRect.height - 4) + 'px';
    }
  });

  _activePopover = pop;
}

function _renderPopoverContent(pop, fieldId, pillInstance) {
  const presets = _loadPresets(fieldId);
  const currentValue = pillInstance.getValueSilent().trim();

  let html = '<div class="preset-pop-header">预设列表</div>';

  // 保存当前值
  html += `
    <div class="preset-save-row">
      <input type="text" class="preset-name-input" placeholder="预设名称" />
      <button class="preset-save-btn" title="保存当前值">保存</button>
    </div>
  `;

  // 预设列表
  if (presets.length === 0) {
    html += '<div class="preset-empty">暂无预设</div>';
  } else {
    html += '<div class="preset-list">';
    presets.forEach((p, idx) => {
      html += `
        <div class="preset-item" data-idx="${idx}">
          <span class="preset-item-name" title="${escapeHtml(p.value)}">${escapeHtml(p.name)}</span>
          <button class="preset-item-del" data-idx="${idx}" title="删除">×</button>
        </div>
      `;
    });
    html += '</div>';
  }

  pop.innerHTML = html;

  // 绑定事件：保存
  const saveBtn = pop.querySelector('.preset-save-btn');
  const nameInput = pop.querySelector('.preset-name-input');
  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { showToast('请输入预设名称', 'error'); return; }
    if (!currentValue) { showToast('当前字段为空', 'error'); return; }
    _savePreset(fieldId, name, currentValue);
    showToast(`已保存预设「${name}」`, 'success');
    _renderPopoverContent(pop, fieldId, pillInstance);
  });
  // Enter 保存
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
  });

  // 绑定事件：选择加载
  pop.querySelectorAll('.preset-item-name').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.parentElement.dataset.idx, 10);
      const preset = presets[idx];
      if (preset) {
        pillInstance.setValue(preset.value);
        showToast(`已加载预设「${preset.name}」`, 'success');
        _closePopover();
      }
    });
  });

  // 绑定事件：删除
  pop.querySelectorAll('.preset-item-del').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(el.dataset.idx, 10);
      const preset = presets[idx];
      _deletePreset(fieldId, idx);
      showToast(`已删除预设「${preset.name}」`, 'info');
      _renderPopoverContent(pop, fieldId, pillInstance);
    });
  });
}

// ============================================================
// localStorage 存取（预设数据很小，不需要 IndexedDB）
// ============================================================
function _loadPresets(fieldId) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + fieldId);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function _savePreset(fieldId, name, value) {
  const list = _loadPresets(fieldId);
  // 同名覆盖
  const existing = list.findIndex(p => p.name === name);
  if (existing >= 0) {
    list[existing].value = value;
  } else {
    list.push({ name, value });
  }
  localStorage.setItem(LS_PREFIX + fieldId, JSON.stringify(list));
}

function _deletePreset(fieldId, idx) {
  const list = _loadPresets(fieldId);
  list.splice(idx, 1);
  localStorage.setItem(LS_PREFIX + fieldId, JSON.stringify(list));
}
