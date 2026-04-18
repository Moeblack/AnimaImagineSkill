/**
 * AnimaImagine 生图面板模块。
 * Phase 1.1: 从 gallery.html 抽出的生图逻辑。
 * Phase 2.1: 滑块控件、Ratio 按钮组、MP 输入、分辨率自动计算。
 * Phase 2.3: Ctrl+Enter 快捷生成、Prompt 历史。
 */

import { calcResolution, showToast } from './utils.js';
import { enableAutocomplete } from './autocomplete.js';
import { loadData } from './gallery-view.js';

// ============================================================
// 状态
// ============================================================

let currentMode = 'basic'; // 'basic' | 'advanced'
let currentRatio = '3:4';
let currentMP = 1.0;
let manualResolution = false; // 用户是否手动覆盖了宽高

// ============================================================
// 初始化
// ============================================================

export function init() {
  // --- 生图面板切换 ---
  document.getElementById('toggleGenerator')?.addEventListener('click', toggleGenerator);

  // --- 模式切换 ---
  document.getElementById('tabBasic')?.addEventListener('click', () => switchTab('basic'));
  document.getElementById('tabAdvanced')?.addEventListener('click', () => switchTab('advanced'));

  // --- JSON 导入 ---
  document.getElementById('jsonUpload')?.addEventListener('change', handleJsonUpload);

  // --- 生成按钮 ---
  document.getElementById('generateBtn')?.addEventListener('click', doGenerate);

  // --- Ratio 按钮组 ---
  document.querySelectorAll('.ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentRatio = btn.dataset.ratio;
      document.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      manualResolution = false;
      _updateResolution();
    });
  });

  // --- MP 按钮组 + 输入框 ---
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
    // 取消预设按钮高亮
    document.querySelectorAll('.mp-btn').forEach(b => {
      b.classList.toggle('active', parseFloat(b.dataset.mp) === val);
    });
    manualResolution = false;
    _updateResolution();
  });

  // --- 滑块控件 ---
  _initSlider('stepsSlider', 'stepsValue', 'paramSteps');
  _initSlider('cfgSlider', 'cfgValue', 'paramCfg');

  // --- Seed 随机按钮 ---
  document.getElementById('seedRandom')?.addEventListener('click', () => {
    document.getElementById('paramSeed').value = -1;
  });

  // --- Ctrl+Enter 快捷生成 ---
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const panel = document.getElementById('generatorPanel');
      if (panel && panel.style.display !== 'none') {
        e.preventDefault();
        doGenerate();
      }
    }
  });

  // --- 标签补全：在所有 prompt 输入框上启用 ---
  enableAutocomplete(document.getElementById('basicPrompt'));
  enableAutocomplete(document.getElementById('negPrompt'));
  // 高级模式的各个字段也启用补全
  ['advQuality', 'advCount', 'advCharacter', 'advSeries',
   'advAppearance', 'advArtist', 'advStyle', 'advTags',
   'advNltags', 'advEnvironment'].forEach(id => {
    enableAutocomplete(document.getElementById(id));
  });

  // --- Prompt 历史 ---
  _initPromptHistory();

  // 初始分辨率计算
  _updateResolution();
}

// ============================================================
// 生图面板显示/隐藏
// ============================================================

function toggleGenerator() {
  const panel = document.getElementById('generatorPanel');
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
}

// ============================================================
// 模式切换
// ============================================================

function switchTab(mode) {
  currentMode = mode;
  document.getElementById('tabBasic').classList.toggle('active', mode === 'basic');
  document.getElementById('tabAdvanced').classList.toggle('active', mode === 'advanced');
  document.getElementById('modeBasic').style.display = mode === 'basic' ? 'flex' : 'none';
  document.getElementById('modeAdvanced').style.display = mode === 'advanced' ? 'flex' : 'none';
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
      if (data.negative_prompt) document.getElementById('negPrompt').value = data.negative_prompt;
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
}

// ============================================================
// 生成图片
// ============================================================

async function doGenerate() {
  const btn = document.getElementById('generateBtn');
  const statusEl = document.getElementById('genStatus');

  // 计算分辨率
  const { width, height } = manualResolution
    ? { width: parseInt(document.getElementById('paramWidth').value) || 0,
        height: parseInt(document.getElementById('paramHeight').value) || 0 }
    : calcResolution(currentRatio, currentMP);

  const payload = {
    mode: currentMode,
    negative_prompt: document.getElementById('negPrompt').value,
    seed: parseInt(document.getElementById('paramSeed').value),
    steps: parseInt(document.getElementById('paramSteps').value),
    cfg_scale: parseFloat(document.getElementById('paramCfg').value),
    aspect_ratio: currentRatio,
    width,
    height,
  };

  if (currentMode === 'basic') {
    payload.prompt = document.getElementById('basicPrompt').value;
  } else {
    payload.quality_meta_year_safe = document.getElementById('advQuality').value;
    payload.count = document.getElementById('advCount').value;
    payload.character = document.getElementById('advCharacter').value;
    payload.series = document.getElementById('advSeries').value;
    payload.appearance = document.getElementById('advAppearance').value;
    payload.artist = document.getElementById('advArtist').value;
    payload.style = document.getElementById('advStyle').value;
    payload.tags = document.getElementById('advTags').value;
    payload.nltags = document.getElementById('advNltags').value;
    payload.environment = document.getElementById('advEnvironment').value;
  }

  btn.disabled = true;
  statusEl.innerHTML = '<span class="spinner"></span> 正在生成...';

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    const data = await res.json();

    if (res.ok && data.status === 'ok') {
      const time = data.meta?.generation_time || '?';
      showToast(`✅ 生成完成！耗时 ${time}s`, 'success');
      statusEl.textContent = '';
      _savePromptHistory(payload);
      loadData(); // 立即获取新图
    } else {
      showToast('❌ 生成失败: ' + JSON.stringify(data), 'error');
      statusEl.textContent = '';
    }
  } catch (err) {
    showToast('❌ 请求错误: ' + err.message, 'error');
    statusEl.textContent = '';
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// 分辨率计算与显示
// ============================================================

function _updateResolution() {
  const { width, height, actualMP } = calcResolution(currentRatio, currentMP);
  const display = document.getElementById('resolutionDisplay');
  if (display) {
    display.innerHTML = `→ 分辨率: <strong>${width} × ${height}</strong>  (${actualMP} MP)`;
  }
  // 同步到隐藏的 width/height 输入框
  const wEl = document.getElementById('paramWidth');
  const hEl = document.getElementById('paramHeight');
  if (wEl) wEl.value = width;
  if (hEl) hEl.value = height;
}

// ============================================================
// 滑块工具
// ============================================================

function _initSlider(sliderId, displayId, inputId) {
  const slider = document.getElementById(sliderId);
  const display = document.getElementById(displayId);
  const input = document.getElementById(inputId);
  if (!slider || !display || !input) return;

  // 初始同步
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
// Prompt 历史（localStorage）
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
    if (entry.negative_prompt) document.getElementById('negPrompt').value = entry.negative_prompt;
    showToast('历史记录已回填', 'info');
  });
}

function _getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

function _savePromptHistory(payload) {
  const history = _getHistory();
  history.unshift({
    prompt: payload.prompt || '',
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
  select.innerHTML = '<option value="">📜 历史记录</option>' +
    history.map((h, i) => {
      const preview = (h.prompt || '').substring(0, 40) + ((h.prompt?.length > 40) ? '...' : '');
      return `<option value="${i}">${preview}</option>`;
    }).join('');
}

// ============================================================
// 外部调用：用图片元数据填充生图面板
// ============================================================

export function fillFromMeta(img) {
  if (!img) return;
  // 打开面板
  const panel = document.getElementById('generatorPanel');
  if (panel) panel.style.display = 'flex';

  switchTab('basic');
  if (img.prompt) document.getElementById('basicPrompt').value = img.prompt;
  if (img.negative_prompt) document.getElementById('negPrompt').value = img.negative_prompt;
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
  showToast('✅ 参数已回填到生图面板', 'success');
}
