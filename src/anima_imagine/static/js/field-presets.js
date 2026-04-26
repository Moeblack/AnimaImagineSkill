import { escapeHtml, showToast } from './utils.js';

const LS_PREFIX = 'anima_presets_';
const API_PREFIX = 'presets_';

let presetsCache = {};
let presetsLoaded = false;
let activePopover = null;

document.addEventListener('mousedown', (event) => {
  if (activePopover && !activePopover.contains(event.target)) {
    closePopover();
  }
});

export async function loadAllPresetsFromServer() {
  if (presetsLoaded) {
    return presetsCache;
  }

  try {
    const response = await fetch(`/api/preferences?prefix=${API_PREFIX}`);
    if (response.ok) {
      const data = await response.json();
      for (const [key, rawValue] of Object.entries(data)) {
        const fieldId = key.slice(API_PREFIX.length);
        presetsCache[fieldId] = parsePresetList(rawValue);
      }
      presetsLoaded = true;
      return presetsCache;
    }
  } catch {
    // Ignore and fall back to localStorage.
  }

  presetsLoaded = true;
  return presetsCache;
}

export function createPresetButton(fieldId, pillInstance) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'preset-btn';
  button.title = '预设';
  button.textContent = '🔖';
  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    await togglePopover(button, fieldId, pillInstance);
  });
  return button;
}

function closePopover() {
  if (!activePopover) return;
  activePopover.remove();
  activePopover = null;
}

async function togglePopover(anchorButton, fieldId, pillInstance) {
  if (activePopover?.dataset.fieldId === fieldId) {
    closePopover();
    return;
  }

  closePopover();
  await loadAllPresetsFromServer();

  const popover = document.createElement('div');
  popover.className = 'preset-popover';
  popover.dataset.fieldId = fieldId;
  document.body.appendChild(popover);

  renderPopoverContent(popover, fieldId, pillInstance);
  positionPopover(popover, anchorButton);
  activePopover = popover;
}

function positionPopover(popover, anchorButton) {
  const rect = anchorButton.getBoundingClientRect();
  popover.style.position = 'fixed';
  popover.style.left = `${rect.left}px`;
  popover.style.top = `${rect.bottom + 6}px`;
  popover.style.zIndex = '9999';

  requestAnimationFrame(() => {
    const popRect = popover.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 6;

    if (popRect.right > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - popRect.width - 8);
    }
    if (popRect.bottom > window.innerHeight - 8) {
      top = Math.max(8, rect.top - popRect.height - 6);
    }

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  });
}

function renderPopoverContent(popover, fieldId, pillInstance) {
  const presets = loadPresets(fieldId);
  const currentValue = pillInstance.getValueSilent().trim();

  let html = `
    <div class="preset-pop-header">字段预设</div>
    <div class="preset-save-row">
      <input type="text" class="preset-name-input" placeholder="预设名称" />
      <button type="button" class="preset-save-btn">保存</button>
    </div>
  `;

  if (!presets.length) {
    html += '<div class="preset-empty">暂无预设</div>';
  } else {
    html += '<div class="preset-list">';
    presets.forEach((preset, index) => {
      html += `
        <div class="preset-item" data-idx="${index}">
          <span class="preset-item-name" title="${escapeHtml(preset.value)}">${escapeHtml(preset.name)}</span>
          <button type="button" class="preset-item-del" data-idx="${index}" title="删除">×</button>
        </div>
      `;
    });
    html += '</div>';
  }

  popover.innerHTML = html;

  const nameInput = popover.querySelector('.preset-name-input');
  const saveButton = popover.querySelector('.preset-save-btn');

  saveButton.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      showToast('请输入预设名称', 'error');
      return;
    }
    if (!currentValue) {
      showToast('当前字段为空，无法保存预设', 'error');
      return;
    }

    await savePreset(fieldId, name, currentValue);
    showToast(`已保存预设“${name}”`, 'success');
    renderPopoverContent(popover, fieldId, pillInstance);
  });

  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveButton.click();
    }
  });

  popover.querySelectorAll('.preset-item-name').forEach((element) => {
    element.addEventListener('click', () => {
      const index = Number.parseInt(element.parentElement.dataset.idx, 10);
      const preset = presets[index];
      if (!preset) return;
      pillInstance.setValue(preset.value);
      showToast(`已加载预设“${preset.name}”`, 'success');
      closePopover();
    });
  });

  popover.querySelectorAll('.preset-item-del').forEach((element) => {
    element.addEventListener('click', async (event) => {
      event.stopPropagation();
      const index = Number.parseInt(element.dataset.idx, 10);
      const preset = presets[index];
      if (!preset) return;
      await deletePreset(fieldId, index);
      showToast(`已删除预设“${preset.name}”`, 'info');
      renderPopoverContent(popover, fieldId, pillInstance);
    });
  });
}

function loadPresets(fieldId) {
  if (fieldId in presetsCache) {
    return presetsCache[fieldId];
  }

  try {
    const raw = localStorage.getItem(LS_PREFIX + fieldId);
    const list = parsePresetList(raw);
    presetsCache[fieldId] = list;
    return list;
  } catch {
    presetsCache[fieldId] = [];
    return presetsCache[fieldId];
  }
}

async function savePreset(fieldId, name, value) {
  const list = [...loadPresets(fieldId)];
  const existingIndex = list.findIndex((item) => item.name === name);
  const nextItem = { name, value };

  if (existingIndex >= 0) {
    list[existingIndex] = nextItem;
  } else {
    list.push(nextItem);
  }

  presetsCache[fieldId] = list;
  await persistPresets(fieldId, list);
}

async function deletePreset(fieldId, index) {
  const list = [...loadPresets(fieldId)];
  list.splice(index, 1);
  presetsCache[fieldId] = list;
  await persistPresets(fieldId, list);
}

async function persistPresets(fieldId, list) {
  const json = JSON.stringify(list);

  try {
    localStorage.setItem(LS_PREFIX + fieldId, json);
  } catch {
    // Ignore local cache failure.
  }

  try {
    await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: API_PREFIX + fieldId, value: json }),
    });
  } catch {
    // Ignore server failure and keep local cache.
  }
}

function parsePresetList(rawValue) {
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.name === 'string' && typeof item.value === 'string')
      .map((item) => ({ name: item.name, value: item.value }));
  } catch {
    return [];
  }
}
