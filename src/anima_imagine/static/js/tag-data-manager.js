/**
 * AnimaImagine v2.2 标签数据管理面板。
 *
 * 功能：
 *   - 显示当前数据集状态（core/custom/artist 计数，来源，更新时间）
 *   - “从服务器重新拉取 core”（带进度条）
 *   - “导入自定义 CSV”（点击选文件 / 拖拽）
 *   - 列出自定义标签并允许单个删除
 *   - 一键清除自定义
 *   - 一键清除本地缓存（下次重新下载）
 *
 * 对话框使用原生 <dialog>，不引入依赖。
 */

import {
  getStats, refreshCoreFromRemote, importCustomCSV,
  removeCustomTag, clearCustom, clearAllCache, listCustom,
} from './tag-data.js';
import { showToast, escapeHtml } from './utils.js';

let dialogEl = null;

export function openTagDataManager() {
  if (!dialogEl) dialogEl = _build();
  _refreshUI();
  if (typeof dialogEl.showModal === 'function') dialogEl.showModal();
  else dialogEl.setAttribute('open', '');
}

function _build() {
  const d = document.createElement('dialog');
  d.className = 'tdm-dialog';
  d.innerHTML = `
    <div class="tdm-header">
      <h2>📊 标签数据管理</h2>
      <button class="tdm-close" data-act="close">✕</button>
    </div>

    <div class="tdm-body">
      <!-- 状态区 -->
      <section class="tdm-section">
        <h3>当前数据集</h3>
        <div class="tdm-stats" id="tdmStats"></div>
      </section>

      <!-- 远程更新区 -->
      <section class="tdm-section">
        <h3>从服务端重新拉取 core 标签库</h3>
        <p class="tdm-hint">本地缓存遇到服务端更新后不会自动同步，可以手动拉一次。</p>
        <div class="tdm-row">
          <button class="tdm-btn primary" data-act="refresh-core">🔄 重新下载 core</button>
          <button class="tdm-btn warn" data-act="clear-cache">🧹 清除本地缓存</button>
        </div>
        <div class="tdm-progress" id="tdmProgress" style="display:none;">
          <div class="tdm-progress-bar"><div class="tdm-progress-fill" id="tdmProgressFill"></div></div>
          <span class="tdm-progress-text" id="tdmProgressText">0%</span>
        </div>
      </section>

      <!-- 自定义导入区 -->
      <section class="tdm-section">
        <h3>导入自定义标签 CSV</h3>
        <p class="tdm-hint">
          格式：<code>tag,category,count,"alias1,alias2"</code>（首行可选 header）。
          可用于追加未覆盖的画师、自定义角色、项目专属标签。
          category：0=general / 1=artist / 3=copyright / 4=character / 5=meta。
        </p>
        <div class="tdm-drop" id="tdmDrop">
          <input type="file" id="tdmFile" accept=".csv,.txt" hidden multiple />
          <p>拖动 CSV 文件到此处，或 <button class="tdm-link" data-act="pick-file">点击选择</button></p>
        </div>
        <details class="tdm-custom-list">
          <summary>已导入的自定义标签 <span id="tdmCustomCount"></span></summary>
          <div class="tdm-custom-table" id="tdmCustomTable"></div>
          <button class="tdm-btn warn" data-act="clear-custom">全部清除</button>
        </details>
      </section>
    </div>
  `;

  document.body.appendChild(d);

  // 事件委托
  d.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    _handleAction(act);
  });

  d.querySelector('#tdmFile').addEventListener('change', (e) => {
    [...e.target.files].forEach(_importFile);
    e.target.value = '';
  });

  // 拖拽导入
  const drop = d.querySelector('#tdmDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drag-over');
    [...e.dataTransfer.files].forEach(_importFile);
  });

  return d;
}

function _handleAction(act) {
  switch (act) {
    case 'close': dialogEl.close(); break;
    case 'pick-file': dialogEl.querySelector('#tdmFile').click(); break;
    case 'refresh-core': _doRefreshCore(); break;
    case 'clear-cache': _doClearCache(); break;
    case 'clear-custom': _doClearCustom(); break;
    default:
      if (act.startsWith('rm:')) _doRemoveCustom(act.slice(3));
  }
}

async function _doRefreshCore() {
  const progress = dialogEl.querySelector('#tdmProgress');
  const fill = dialogEl.querySelector('#tdmProgressFill');
  const text = dialogEl.querySelector('#tdmProgressText');
  progress.style.display = 'flex';
  fill.style.width = '0%';
  text.textContent = '0%';
  try {
    await refreshCoreFromRemote(undefined, (loaded, total) => {
      const pct = total ? Math.min(100, Math.round(loaded / total * 100)) : 0;
      fill.style.width = pct + '%';
      text.textContent = total ? `${pct}%` : `${(loaded / 1024).toFixed(0)} KB`;
    });
    showToast('✅ core 标签库已更新', 'success');
    _refreshUI();
  } catch (e) {
    showToast('❌ 更新失败: ' + e.message, 'error');
  } finally {
    setTimeout(() => { progress.style.display = 'none'; }, 600);
  }
}

// 【v2.3】clearAllCache 现在是 async（IndexedDB），需要 await
async function _doClearCache() {
  if (!confirm('确定清除本地缓存？下次启动会重新从服务器下载。')) return;
  await clearAllCache();
  showToast('本地缓存已清除，请刷新页面', 'info');
}

async function _doClearCustom() {
  if (!confirm('确定删除所有自定义标签？')) return;
  await clearCustom();
  showToast('自定义标签已清除', 'success');
  _refreshUI();
}

async function _doRemoveCustom(name) {
  await removeCustomTag(name);
  _refreshUI();
}

function _importFile(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const added = await importCustomCSV(e.target.result);
      showToast(`✅ 已导入 ${added} 个自定义标签`, 'success');
      _refreshUI();
    } catch (err) {
      showToast('❌ 导入失败: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

// 【v2.3】listCustom 变成 async（IndexedDB），_refreshUI 改为 async
async function _refreshUI() {
  if (!dialogEl) return;
  const stats = getStats();
  const statsEl = dialogEl.querySelector('#tdmStats');
  statsEl.innerHTML = `
    <div class="tdm-stat"><span class="k">core</span><span class="v">${stats.coreCount.toLocaleString()}</span></div>
    <div class="tdm-stat"><span class="k">custom</span><span class="v">${stats.customCount.toLocaleString()}</span></div>
    <div class="tdm-stat"><span class="k">artists</span><span class="v">${stats.artistCount.toLocaleString()}</span></div>
    <div class="tdm-stat"><span class="k">来源</span><span class="v">${stats.source || '-'}</span></div>
    <div class="tdm-stat"><span class="k">更新于</span><span class="v">${stats.updatedAt ? new Date(stats.updatedAt).toLocaleString() : '-'}</span></div>
  `;

  const customList = await listCustom();
  dialogEl.querySelector('#tdmCustomCount').textContent = `(${customList.length})`;
  const tableEl = dialogEl.querySelector('#tdmCustomTable');
  if (!customList.length) {
    tableEl.innerHTML = '<p class="tdm-hint">尚未导入任何自定义标签。</p>';
  } else {
    tableEl.innerHTML = customList.slice(0, 200).map(t => `
      <div class="tdm-row-tag">
        <span class="tdm-tag-name cat-${t.categoryName}">${escapeHtml(t.tag)}</span>
        <span class="tdm-tag-cat">${t.categoryName}</span>
        <span class="tdm-tag-count">${t.count.toLocaleString()}</span>
        <button class="tdm-link" data-act="rm:${escapeHtml(t.tag)}">删</button>
      </div>
    `).join('') + (customList.length > 200 ? `<p class="tdm-hint">仅显示前 200 项，共 ${customList.length} 项。</p>` : '');
  }
}
