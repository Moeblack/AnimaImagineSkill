import {
  clearAllCache,
  clearCustom,
  getStats,
  importCustomCSV,
  listCustom,
  loadTagData,
  refreshCoreFromRemote,
  removeCustomTag,
} from './tag-data.js';
import { escapeHtml, showToast } from './utils.js';

const CUSTOM_TAGS_KEY = 'custom_tags';

let dialogEl = null;
let syncPromise = null;

export async function syncCustomTagsFromServer() {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    const localCsv = await serializeCustomTags();

    try {
      const response = await fetch(`/api/preferences?keys=${CUSTOM_TAGS_KEY}`);
      if (response.ok) {
        const data = await response.json();
        if (typeof data[CUSTOM_TAGS_KEY] === 'string') {
          const remoteCsv = data[CUSTOM_TAGS_KEY];
          if (normalizeCsv(remoteCsv) !== normalizeCsv(localCsv)) {
            await replaceLocalCustomTags(remoteCsv);
          } else if (!getStats().ready) {
            await loadTagData();
          }
          return;
        }
      }
    } catch {
      // Ignore and fall back to local cache.
    }

    if (localCsv.trim()) {
      await persistCustomTagsToServer(localCsv);
    }
    if (!getStats().ready) {
      await loadTagData();
    }
  })();

  try {
    await syncPromise;
  } finally {
    syncPromise = null;
  }
}

export async function openTagDataManager() {
  await syncCustomTagsFromServer();
  if (!dialogEl) dialogEl = buildDialog();
  await refreshUI();
  if (typeof dialogEl.showModal === 'function') {
    dialogEl.showModal();
  } else {
    dialogEl.setAttribute('open', '');
  }
}

function buildDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'tdm-dialog';
  dialog.innerHTML = `
    <div class="tdm-header">
      <h2>标签数据管理</h2>
      <button type="button" class="tdm-close" data-act="close">×</button>
    </div>
    <div class="tdm-body">
      <section class="tdm-section">
        <h3>当前数据集</h3>
        <div class="tdm-stats" id="tdmStats"></div>
      </section>

      <section class="tdm-section">
        <h3>刷新核心标签库</h3>
        <p class="tdm-hint">重新从服务端拉取 core 标签库，并更新本地缓存。</p>
        <div class="tdm-row">
          <button type="button" class="tdm-btn primary" data-act="refresh-core">重新下载 core</button>
          <button type="button" class="tdm-btn warn" data-act="clear-cache">清除本地缓存</button>
        </div>
        <div class="tdm-progress" id="tdmProgress" style="display:none;">
          <div class="tdm-progress-bar"><div class="tdm-progress-fill" id="tdmProgressFill"></div></div>
          <span class="tdm-progress-text" id="tdmProgressText">0%</span>
        </div>
      </section>

      <section class="tdm-section">
        <h3>自定义标签 CSV</h3>
        <p class="tdm-hint">
          格式：<code>tag,category,count,"alias1,alias2"</code>。导入后会同步到服务端偏好，跨端共用。
        </p>
        <div class="tdm-drop" id="tdmDrop">
          <input type="file" id="tdmFile" accept=".csv,.txt" hidden multiple />
          <p>拖入 CSV 文件，或 <button type="button" class="tdm-link" data-act="pick-file">点击选择</button></p>
        </div>
        <details class="tdm-custom-list">
          <summary>已导入的自定义标签 <span id="tdmCustomCount"></span></summary>
          <div class="tdm-custom-table" id="tdmCustomTable"></div>
          <button type="button" class="tdm-btn warn" data-act="clear-custom">全部清除</button>
        </details>
      </section>
    </div>
  `;

  dialog.addEventListener('click', (event) => {
    const action = event.target.closest('[data-act]')?.dataset.act;
    if (!action) return;
    void handleAction(action);
  });

  dialog.querySelector('#tdmFile').addEventListener('change', (event) => {
    [...event.target.files].forEach((file) => {
      void importFile(file);
    });
    event.target.value = '';
  });

  const dropZone = dialog.querySelector('#tdmDrop');
  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('drag-over');
    [...event.dataTransfer.files].forEach((file) => {
      void importFile(file);
    });
  });

  document.body.appendChild(dialog);
  return dialog;
}

async function handleAction(action) {
  switch (action) {
    case 'close':
      dialogEl.close();
      return;
    case 'pick-file':
      dialogEl.querySelector('#tdmFile').click();
      return;
    case 'refresh-core':
      await refreshCore();
      return;
    case 'clear-cache':
      await clearCache();
      return;
    case 'clear-custom':
      await clearAllCustomTags();
      return;
    default:
      if (action.startsWith('rm:')) {
        await removeOneCustomTag(action.slice(3));
      }
  }
}

async function refreshCore() {
  const progress = dialogEl.querySelector('#tdmProgress');
  const fill = dialogEl.querySelector('#tdmProgressFill');
  const text = dialogEl.querySelector('#tdmProgressText');

  progress.style.display = 'flex';
  fill.style.width = '0%';
  text.textContent = '0%';

  try {
    await refreshCoreFromRemote(undefined, (loaded, total) => {
      const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
      fill.style.width = `${percent}%`;
      text.textContent = total ? `${percent}%` : `${Math.round(loaded / 1024)} KB`;
    });
    showToast('core 标签库已更新', 'success');
    await refreshUI();
  } catch (error) {
    showToast(`更新失败: ${error.message}`, 'error');
  } finally {
    setTimeout(() => {
      progress.style.display = 'none';
    }, 600);
  }
}

async function clearCache() {
  if (!window.confirm('确定清除本地缓存吗？下次会重新拉取标签数据。')) {
    return;
  }
  await clearAllCache();
  showToast('本地缓存已清除，刷新页面后会重新同步', 'info');
}

async function clearAllCustomTags() {
  if (!window.confirm('确定删除全部自定义标签吗？')) {
    return;
  }

  await clearCustom();
  await persistCustomTagsToServer('');
  showToast('自定义标签已清空', 'success');
  await refreshUI();
}

async function removeOneCustomTag(name) {
  await removeCustomTag(name);
  await persistCustomTagsToServer(await serializeCustomTags());
  await refreshUI();
}

async function importFile(file) {
  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const added = await importCustomCSV(event.target.result);
      await persistCustomTagsToServer(await serializeCustomTags());
      showToast(`已导入 ${added} 个自定义标签`, 'success');
      await refreshUI();
    } catch (error) {
      showToast(`导入失败: ${error.message}`, 'error');
    }
  };
  reader.readAsText(file);
}

async function refreshUI() {
  if (!dialogEl) return;

  const stats = getStats();
  const statsEl = dialogEl.querySelector('#tdmStats');
  statsEl.innerHTML = `
    <div class="tdm-stat"><span class="k">core</span><span class="v">${stats.coreCount.toLocaleString()}</span></div>
    <div class="tdm-stat"><span class="k">custom</span><span class="v">${stats.customCount.toLocaleString()}</span></div>
    <div class="tdm-stat"><span class="k">artists</span><span class="v">${stats.artistCount.toLocaleString()}</span></div>
    <div class="tdm-stat"><span class="k">来源</span><span class="v">${stats.source || '-'}</span></div>
    <div class="tdm-stat"><span class="k">更新时间</span><span class="v">${stats.updatedAt ? new Date(stats.updatedAt).toLocaleString() : '-'}</span></div>
  `;

  const customList = await listCustom();
  dialogEl.querySelector('#tdmCustomCount').textContent = `(${customList.length})`;

  const tableEl = dialogEl.querySelector('#tdmCustomTable');
  if (!customList.length) {
    tableEl.innerHTML = '<p class="tdm-hint">尚未导入任何自定义标签。</p>';
    return;
  }

  const rows = customList.slice(0, 200).map((tag) => `
    <div class="tdm-row-tag">
      <span class="tdm-tag-name cat-${tag.categoryName}">${escapeHtml(tag.tag)}</span>
      <span class="tdm-tag-cat">${tag.categoryName}</span>
      <span class="tdm-tag-count">${tag.count.toLocaleString()}</span>
      <button type="button" class="tdm-link" data-act="rm:${escapeHtml(tag.tag)}">删</button>
    </div>
  `).join('');

  const summary = customList.length > 200
    ? `<p class="tdm-hint">仅显示前 200 项，当前共 ${customList.length} 项。</p>`
    : '';

  tableEl.innerHTML = rows + summary;
}

async function replaceLocalCustomTags(csvText) {
  await clearCustom();
  if (csvText.trim()) {
    await importCustomCSV(csvText);
  } else if (!getStats().ready) {
    await loadTagData();
  }
}

async function persistCustomTagsToServer(csvText) {
  try {
    await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: CUSTOM_TAGS_KEY, value: csvText }),
    });
  } catch {
    // Keep local cache even if server sync fails.
  }
}

async function serializeCustomTags() {
  const customList = await listCustom();
  return customList.map((tag) => {
    const aliases = Array.isArray(tag.aliases) ? tag.aliases.filter(Boolean) : [];
    const escapedAliases = aliases.length
      ? `"${aliases.join(',').replace(/"/g, '""')}"`
      : '';
    return `${tag.tag},${tag.category},${tag.count},${escapedAliases}`;
  }).join('\n');
}

function normalizeCsv(value) {
  return (value || '').trim().replace(/\r\n/g, '\n');
}
