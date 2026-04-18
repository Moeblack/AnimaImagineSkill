/**
 * AnimaImagine v2.2 生图面板。
 *
 * v2.2 变更：
 *   - 高级模式全部字段改为 multiline tag-pill 输入
 *   - 画师、角色、作品字段有专用补全过滤
 *   - 新增 outfit / pose_expression / composition 子槽
 *   - “标签库”入口（header 按钮）打开数据管理对话框
 *   - 实时预览从 pill 实例采集
 *   - fillFromMeta 会智能拆分 prompt 取画师段回填到画师字段
 */

import { getResolution, showToast } from './utils.js';
import { enableAutocomplete, enableAutocompleteForPill } from './autocomplete.js';
import { PillInput } from './pill-input.js';
import { openTagDataManager } from './tag-data-manager.js';
import { createPresetButton } from './field-presets.js';

// ============================================================
// 状态
// ============================================================
let currentMode = 'basic';
let currentRatio = '3:4';
let currentMP = 1.0;
let manualResolution = false;

const _bus = new EventTarget();
export function onGenerated(fn) { _bus.addEventListener('generated', fn); }

// v2.2: 高级字段表。id ↔ payload 键 ↔ categoryFilter。
//   categoryFilter 与 danbooru：0=general 1=artist 3=copyright 4=character 5=meta
const ADV_FIELDS = [
  { id: 'advQuality',     key: 'quality_meta_year_safe', cat: null, defaultVal: 'masterpiece, best quality, newest, year 2025, safe' },
  { id: 'advCount',       key: 'count',                  cat: null, defaultVal: '1girl' },
  { id: 'advCharacter',   key: 'character',              cat: 4 },
  { id: 'advSeries',      key: 'series',                 cat: 3 },
  { id: 'advArtist',      key: 'artist',                 cat: 1 },
  { id: 'advAppearance',  key: 'appearance',             cat: 0 },
  { id: 'advOutfit',      key: 'outfit',                 cat: 0 },
  { id: 'advPose',        key: 'pose_expression',        cat: 0 },
  { id: 'advComposition', key: 'composition',            cat: 0 },
  { id: 'advEnvironment', key: 'environment',            cat: 0 },
  { id: 'advStyle',       key: 'style',                  cat: 0 },
  { id: 'advNlCaption',   key: 'nl_caption',             cat: 0 },
];

// id → PillInput 实例
const pillInputs = new Map();

// ============================================================
// 初始化
// ============================================================
export function init() {
  document.getElementById('toggleGenerator')?.addEventListener('click', toggleGenerator);
  document.getElementById('closeGenerator')?.addEventListener('click', () => {
    document.getElementById('generatorPanel').style.display = 'none';
  });
  document.getElementById('tabBasic')?.addEventListener('click', () => switchTab('basic'));
  document.getElementById('tabAdvanced')?.addEventListener('click', () => switchTab('advanced'));
  document.getElementById('jsonUpload')?.addEventListener('change', handleJsonUpload);
  document.getElementById('clearPromptBtn')?.addEventListener('click', _clearAll);
  document.getElementById('generateBtn')?.addEventListener('click', doGenerate);
  document.getElementById('openTagManager')?.addEventListener('click', openTagDataManager);

  // 【v2.3】从 localStorage 恢复上次使用的字段值，key 前缀 anima_lastval_
  const _savedVals = _loadLastValues();

  // 初始化 PillInput
  ADV_FIELDS.forEach(f => {
    const host = document.getElementById(f.id);
    if (!host) return;
    const pill = new PillInput(host, {
      placeholder: host.dataset.placeholder || '',
      category: f.cat === 1 ? 'artist' : f.cat === 4 ? 'character' : f.cat === 3 ? 'copyright' : 'general',
      singleLine: host.dataset.single === '1',
      // 【v2.3】onChange 同时触发预览更新和自动保存上次值
      onChange: () => { _updatePromptPreview(); _saveLastValues(); },
    });
    // 【v2.3】优先恢复上次保存的值；首次使用（无保存记录）时才用硬编码默认值
    const initialVal = _savedVals[f.id] !== undefined ? _savedVals[f.id] : (f.defaultVal || '');
    if (initialVal) pill.setValue(initialVal);
    pillInputs.set(f.id, pill);
    enableAutocompleteForPill(pill, { categoryFilter: f.cat == null ? undefined : f.cat });
    // 【v2.3 新增】为每个字段创建预设保存按钮，插入到 label 旁边
    const label = host.closest('.adv-field')?.querySelector('.adv-label');
    if (label) {
      const presetBtn = createPresetButton(f.id, pill);
      label.appendChild(presetBtn);
    }
  });

  // 比例按钮组
  document.querySelectorAll('.ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentRatio = btn.dataset.ratio;
      document.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      manualResolution = false;
      _updateResolution();
    });
  });

  document.querySelectorAll('.mp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentMP = parseFloat(btn.dataset.mp);
      document.getElementById('mpInput').value = currentMP;
      document.querySelectorAll('.mp-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      manualResolution = false;
      _updateResolution();
    });
  });

  const mpInput = document.getElementById('mpInput');
  mpInput?.addEventListener('input', () => {
    let val = parseFloat(mpInput.value);
    if (isNaN(val)) return;
    val = Math.max(0.5, Math.min(4.0, val));
    currentMP = val;
    document.querySelectorAll('.mp-btn').forEach(b => {
      b.classList.toggle('active', parseFloat(b.dataset.mp) === val);
    });
    manualResolution = false;
    _updateResolution();
  });

  _initSlider('stepsSlider', 'stepsValue', 'paramSteps');
  _initSlider('cfgSlider', 'cfgValue', 'paramCfg');

  document.getElementById('seedRandom')?.addEventListener('click', () => {
    document.getElementById('paramSeed').value = -1;
  });

  // Ctrl+Enter 快捷生成
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const panel = document.getElementById('generatorPanel');
      if (panel && panel.style.display !== 'none') {
        e.preventDefault();
        doGenerate();
      }
    }
  });

  // 基础模式 / 负面 仍为 textarea
  enableAutocomplete(document.getElementById('basicPrompt'));
  enableAutocomplete(document.getElementById('negPrompt'));

  // 预览复制
  document.getElementById('previewCopy')?.addEventListener('click', () => {
    const text = document.getElementById('previewText')?.textContent || '';
    if (text) navigator.clipboard.writeText(text).then(() => showToast('✅ 已复制拼接结果', 'success'));
  });

  // Negative badge
  const neg = document.getElementById('negPrompt');
  neg?.addEventListener('input', _updateNegBadge);
  _updateNegBadge();

  _initPromptHistory();
  _updateResolution();
  _updatePromptPreview();
}

// ============================================================
// 面板 / 模式
// ============================================================
function toggleGenerator() {
  const panel = document.getElementById('generatorPanel');
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
}

function switchTab(mode) {
  currentMode = mode;
  document.getElementById('tabBasic').classList.toggle('active', mode === 'basic');
  document.getElementById('tabAdvanced').classList.toggle('active', mode === 'advanced');
  document.getElementById('modeBasic').style.display = mode === 'basic' ? 'block' : 'none';
  document.getElementById('modeAdvanced').style.display = mode === 'advanced' ? 'block' : 'none';
  if (mode === 'advanced') _updatePromptPreview();
}

// ============================================================
// 清空 / 预览 / Negative badge
// ============================================================
function _clearAll() {
  document.getElementById('basicPrompt').value = '';
  ADV_FIELDS.forEach(f => {
    const pill = pillInputs.get(f.id);
    if (pill) pill.setValue(f.defaultVal || '');
  });
  _updatePromptPreview();
  _saveLastValues();
  showToast('已清空', 'info');
}

// 【v2.3 性能优化】用 RAF 去抖，避免多次 pill 变更（如 setValue 循环）
// 每次都触发 DOM 更新。只在下一帧渲染一次即可。
let _previewRafId = 0;
function _updatePromptPreview() {
  if (_previewRafId) return;
  _previewRafId = requestAnimationFrame(_doUpdatePreview);
}
function _doUpdatePreview() {
  _previewRafId = 0;
  const previewEl = document.getElementById('previewText');
  if (!previewEl) return;
  // 按 ADV_FIELDS 顺序拼接。注意画师需加 @。
  const parts = [];
  ADV_FIELDS.forEach(f => {
    const pill = pillInputs.get(f.id);
    if (!pill) return;
    let v = pill.getValueSilent().trim();
    if (!v) return;
    if (f.key === 'artist') {
      v = v.split(',').map(s => s.trim()).filter(Boolean)
           .map(s => s.startsWith('@') ? s : '@' + s).join(', ');
    }
    parts.push(v);
  });
  const result = parts.join(', ');
  previewEl.textContent = result || '(输入字段后自动显示拼接结果)';
  previewEl.style.color = result ? '#c0c0d8' : '#555';
}

function _updateNegBadge() {
  const negPrompt = document.getElementById('negPrompt');
  const badge = document.getElementById('negBadge');
  if (!negPrompt || !badge) return;
  const count = negPrompt.value.split(',').filter(t => t.trim()).length;
  badge.textContent = `${count} tags`;
}

// ============================================================
// JSON 导入
// ============================================================
function handleJsonUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const data = JSON.parse(evt.target.result);
      if (data.prompt) document.getElementById('basicPrompt').value = data.prompt;
      if (data.negative_prompt) {
        document.getElementById('negPrompt').value = data.negative_prompt;
        _updateNegBadge();
      }
      if (data.seed !== undefined) document.getElementById('paramSeed').value = data.seed;
      if (data.steps !== undefined) {
        document.getElementById('paramSteps').value = data.steps;
        _syncSliderFromInput('stepsSlider', 'stepsValue', data.steps);
      }
      if (data.cfg_scale !== undefined) {
        document.getElementById('paramCfg').value = data.cfg_scale;
        _syncSliderFromInput('cfgSlider', 'cfgValue', data.cfg_scale);
      }
      if (data.aspect_ratio) {
        currentRatio = data.aspect_ratio;
        _activateRatioBtn(data.aspect_ratio);
      }
      switchTab('basic');
      showToast('JSON 导入成功', 'success');
    } catch (err) {
      showToast('JSON 解析失败: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ============================================================
// 生成
// ============================================================
async function doGenerate() {
  const btn = document.getElementById('generateBtn');
  const statusEl = document.getElementById('genStatus');

  const { width, height } = manualResolution
    ? { width: parseInt(document.getElementById('paramWidth').value) || 0,
        height: parseInt(document.getElementById('paramHeight').value) || 0 }
    : getResolution(currentRatio, currentMP);

  const payload = {
    mode: currentMode,
    negative_prompt: document.getElementById('negPrompt').value,
    seed: parseInt(document.getElementById('paramSeed').value),
    steps: parseInt(document.getElementById('paramSteps').value),
    cfg_scale: parseFloat(document.getElementById('paramCfg').value),
    aspect_ratio: currentRatio,
    width, height,
  };

  if (currentMode === 'basic') {
    payload.prompt = document.getElementById('basicPrompt').value;
  } else {
    // 从所有 PillInput 采集
    ADV_FIELDS.forEach(f => {
      const pill = pillInputs.get(f.id);
      if (pill) payload[f.key] = pill.getValue();
    });
  }

  btn.disabled = true;
  statusEl.innerHTML = '<span class="spinner"></span> 提交中...';

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    if (res.status === 429) {
      showToast('⚠️ 生图请求过于频繁', 'error');
      statusEl.textContent = ''; btn.disabled = false; return;
    }
    const data = await res.json();
    if (data.status === 'queued' && data.job_id) {
      statusEl.innerHTML = `<span class="spinner"></span> 排队中（第 ${data.queue_position} 位）...`;
      _pollJob(data.job_id, btn, statusEl, payload);
    } else if (data.error) {
      showToast('❌ ' + data.error, 'error');
      statusEl.textContent = ''; btn.disabled = false;
    }
  } catch (err) {
    showToast('❌ 请求错误: ' + err.message, 'error');
    statusEl.textContent = ''; btn.disabled = false;
  }
}

async function _pollJob(jobId, btn, statusEl, payload) {
  const maxPolls = 300;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const resp = await fetch(`/api/jobs/${jobId}`);
      if (!resp.ok) continue;
      const job = await resp.json();
      if (job.status === 'queued') {
        statusEl.innerHTML = `<span class="spinner"></span> 排队中（第 ${job.queue_position} 位）...`;
      } else if (job.status === 'running') {
        statusEl.innerHTML = '<span class="spinner"></span> 正在生成...';
      } else if (job.status === 'succeeded') {
        showToast(`✅ 生成完成！耗时 ${job.generation_time || '?'}s`, 'success');
        statusEl.textContent = '';
        _savePromptHistory(payload);
        _bus.dispatchEvent(new Event('generated'));
        btn.disabled = false;
        return;
      } else if (job.status === 'failed') {
        showToast('❌ 生成失败: ' + (job.error || '未知错误'), 'error');
        statusEl.textContent = ''; btn.disabled = false; return;
      } else if (job.status === 'cancelled') {
        showToast('任务已取消', 'info');
        statusEl.textContent = ''; btn.disabled = false; return;
      }
    } catch (e) { /* continue */ }
  }
  showToast('⚠️ 任务超时', 'error');
  statusEl.textContent = ''; btn.disabled = false;
}

// ============================================================
// 分辨率 / 滑块
// ============================================================
function _updateResolution() {
  const { width, height, actualMP } = getResolution(currentRatio, currentMP);
  const display = document.getElementById('resolutionDisplay');
  if (display) display.innerHTML = `→ <strong>${width}×${height}</strong> (${actualMP} MP)`;
  document.getElementById('paramWidth').value = width;
  document.getElementById('paramHeight').value = height;
}

function _initSlider(sliderId, displayId, inputId) {
  const slider = document.getElementById(sliderId);
  const display = document.getElementById(displayId);
  const input = document.getElementById(inputId);
  if (!slider || !display || !input) return;
  slider.value = input.value;
  display.textContent = input.value;
  slider.addEventListener('input', () => {
    display.textContent = slider.value;
    input.value = slider.value;
  });
}

function _syncSliderFromInput(sliderId, displayId, value) {
  const slider = document.getElementById(sliderId);
  const display = document.getElementById(displayId);
  if (slider) slider.value = value;
  if (display) display.textContent = value;
}

function _activateRatioBtn(ratio) {
  document.querySelectorAll('.ratio-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.ratio === ratio);
  });
}

// ============================================================
// Prompt 历史
// ============================================================
const HISTORY_KEY = 'anima_prompt_history';
const MAX_HISTORY = 50;

function _initPromptHistory() {
  const select = document.getElementById('promptHistory');
  if (!select) return;
  _renderHistory(select);
  select.addEventListener('change', () => {
    const idx = parseInt(select.value);
    if (isNaN(idx)) return;
    const history = _getHistory();
    const entry = history[idx];
    if (!entry) return;
    if (entry.prompt) document.getElementById('basicPrompt').value = entry.prompt;
    if (entry.negative_prompt) {
      document.getElementById('negPrompt').value = entry.negative_prompt;
      _updateNegBadge();
    }
    showToast('历史记录已回填', 'info');
  });
}
function _getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function _savePromptHistory(payload) {
  const history = _getHistory();
  // 实际交上去的可能是高级字段，此时拼个 basic prompt 作为预览
  const promptText = payload.prompt ||
    ADV_FIELDS.map(f => payload[f.key] || '').filter(Boolean).join(', ');
  history.unshift({
    prompt: promptText,
    negative_prompt: payload.negative_prompt || '',
    timestamp: new Date().toISOString(),
  });
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  const select = document.getElementById('promptHistory');
  if (select) _renderHistory(select);
}
function _renderHistory(select) {
  const history = _getHistory();
  select.innerHTML = '<option value="">📜 历史</option>' +
    history.map((h, i) => {
      const preview = (h.prompt || '').substring(0, 40) + ((h.prompt?.length > 40) ? '...' : '');
      return `<option value="${i}">${preview}</option>`;
    }).join('');
}

// ============================================================
// 外部调用：用图片元数据填充
// ============================================================
export function fillFromMeta(img) {
  if (!img) return;
  const panel = document.getElementById('generatorPanel');
  if (panel) panel.style.display = 'flex';

  // 【v2.3】如果有 adv_fields，回填到高级模式；否则回填基础模式
  const adv = img.adv_fields;
  if (adv && Object.keys(adv).length > 0) {
    switchTab('advanced');
    // 按 ADV_FIELDS 的 key 与 adv_fields 的 key 对应关系回填
    ADV_FIELDS.forEach(f => {
      const pill = pillInputs.get(f.id);
      if (!pill) return;
      const val = adv[f.key];
      if (val !== undefined) pill.setValue(val);
    });
    if (img.negative_prompt) {
      document.getElementById('negPrompt').value = img.negative_prompt;
      _updateNegBadge();
    }
    _updatePromptPreview();
    _saveLastValues();
  } else {
    switchTab('basic');
    if (img.prompt) document.getElementById('basicPrompt').value = img.prompt;
    if (img.negative_prompt) {
      document.getElementById('negPrompt').value = img.negative_prompt;
      _updateNegBadge();
    }
  }

  if (img.seed !== undefined) document.getElementById('paramSeed').value = img.seed;
  if (img.steps !== undefined) {
    document.getElementById('paramSteps').value = img.steps;
    _syncSliderFromInput('stepsSlider', 'stepsValue', img.steps);
  }
  if (img.cfg_scale !== undefined) {
    document.getElementById('paramCfg').value = img.cfg_scale;
    _syncSliderFromInput('cfgSlider', 'cfgValue', img.cfg_scale);
  }
  if (img.aspect_ratio) {
    currentRatio = img.aspect_ratio;
    _activateRatioBtn(img.aspect_ratio);
  }
  _updateResolution();
  const modeLabel = (adv && Object.keys(adv).length > 0) ? '高级模式' : '基础模式';
  showToast(`✅ 参数已回填（${modeLabel}）`, 'success');
}


// ============================================================
// v2.3: 自动保存/恢复上次使用的字段值
// 将所有字段的当前值存入 localStorage，下次打开页面时自动恢复。
// 数据量很小（几个字段的逻号分隔字符串），用 localStorage 即可。
// ============================================================
const LS_LASTVAL_KEY = 'anima_adv_lastvalues';

function _saveLastValues() {
  const data = {};
  ADV_FIELDS.forEach(f => {
    const pill = pillInputs.get(f.id);
    if (pill) data[f.id] = pill.getValueSilent();
  });
  try { localStorage.setItem(LS_LASTVAL_KEY, JSON.stringify(data)); } catch {}
}

function _loadLastValues() {
  try {
    const raw = localStorage.getItem(LS_LASTVAL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
