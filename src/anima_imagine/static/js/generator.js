import { getResolution, showToast } from './utils.js';
import { enableAutocomplete, enableAutocompleteForPill } from './autocomplete.js';
import { PillInput } from './pill-input.js';
import { openTagDataManager, syncCustomTagsFromServer } from './tag-data-manager.js';
import { createPresetButton, loadAllPresetsFromServer } from './field-presets.js';

let currentMode = 'advanced';
let currentRatio = '3:4';
let currentMP = 1.0;
let manualResolution = false;

const bus = new EventTarget();
export function onGenerated(fn) {
  bus.addEventListener('generated', fn);
}

const ADV_FIELDS = [
  { id: 'advQuality', key: 'quality_meta_year_safe', cat: null, defaultVal: 'masterpiece, best quality, newest, year 2025, safe' },
  { id: 'advCount', key: 'count', cat: null, defaultVal: '1girl' },
  { id: 'advCharacter', key: 'character', cat: 4 },
  { id: 'advSeries', key: 'series', cat: 3 },
  { id: 'advArtist', key: 'artist', cat: 1 },
  { id: 'advBodyF', key: 'body_type_f', cat: 0 },
  { id: 'advBodyM', key: 'body_type_m', cat: 0 },
  { id: 'advAppearance', key: 'appearance', cat: 0 },
  { id: 'advOutfit', key: 'outfit', cat: 0 },
  { id: 'advAccessories', key: 'accessories', cat: 0 },
  { id: 'advBodyDeco', key: 'body_decoration', cat: 0 },
  { id: 'advExpression', key: 'expression', cat: 0 },
  { id: 'advPoseF', key: 'pose_f', cat: 0 },
  { id: 'advPoseM', key: 'pose_m', cat: 0 },
  { id: 'advNsfwPose', key: 'nsfw_pose', cat: 0 },
  { id: 'advNsfwInteraction', key: 'nsfw_interaction', cat: 0 },
  { id: 'advComposition', key: 'composition', cat: 0 },
  { id: 'advEnvironment', key: 'environment', cat: 0 },
  { id: 'advStyle', key: 'style', cat: 0 },
  { id: 'advOthers', key: 'others', cat: 0 },
  { id: 'advNlCaption', key: 'nl_caption', cat: 0 },
];

const pillInputs = new Map();
const batchEditors = new Map();

const HISTORY_KEY = 'anima_prompt_history';
const MAX_HISTORY = 50;
const LS_LASTVAL_KEY = 'anima_adv_lastvalues';

let historyCache = [];
let previewRafId = 0;
let saveLastValuesTimer = 0;

let batchCancelled = false;
let batchRunning = false;
let fabDefaultText = '✨';

export async function init() {
  document.getElementById('toggleGenerator')?.addEventListener('click', toggleGenerator);
  document.getElementById('closeGenerator')?.addEventListener('click', () => {
    const panel = document.getElementById('generatorPanel');
    if (panel) panel.style.display = 'none';
  });
  document.getElementById('tabBasic')?.addEventListener('click', () => switchTab('basic'));
  document.getElementById('tabAdvanced')?.addEventListener('click', () => switchTab('advanced'));
  document.getElementById('jsonUpload')?.addEventListener('change', handleJsonUpload);
  document.getElementById('clearPromptBtn')?.addEventListener('click', clearAll);
  document.getElementById('generateBtn')?.addEventListener('click', doGenerate);
  document.getElementById('openTagManager')?.addEventListener('click', () => {
    void openTagDataManager();
  });
  document.getElementById('seedRandom')?.addEventListener('click', () => {
    const seed = document.getElementById('paramSeed');
    if (seed) seed.value = -1;
  });
  document.getElementById('previewCopy')?.addEventListener('click', async () => {
    const text = document.getElementById('previewText')?.textContent || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制拼接结果', 'success');
    } catch {
      showToast('复制失败', 'error');
    }
  });

  initFAB();

  const savedValues = await loadLastValues();
  await loadAllPresetsFromServer();

  ADV_FIELDS.forEach((field) => {
    const host = document.getElementById(field.id);
    if (!host) return;

    const pill = new PillInput(host, {
      placeholder: host.dataset.placeholder || '',
      category: mapFieldCategory(field.cat),
      singleLine: host.dataset.single === '1',
      onChange: () => {
        updatePromptPreview();
        saveLastValues();
        syncBatchEditorsFromPills();
      },
    });

    const initialValue = savedValues[field.id] !== undefined ? savedValues[field.id] : (field.defaultVal || '');
    if (initialValue) {
      pill.setValue(initialValue);
    }

    pillInputs.set(field.id, pill);
    enableAutocompleteForPill(pill, { categoryFilter: field.cat == null ? undefined : field.cat });

    const label = host.closest('.adv-field')?.querySelector('.adv-label');
    if (label) {
      initFieldTools(field, host, label, pill);
    }
  });

  document.querySelectorAll('.ratio-btn').forEach((button) => {
    button.addEventListener('click', () => {
      currentRatio = button.dataset.ratio;
      document.querySelectorAll('.ratio-btn').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      manualResolution = false;
      updateResolution();
    });
  });

  document.querySelectorAll('.mp-btn').forEach((button) => {
    button.addEventListener('click', () => {
      currentMP = Number.parseFloat(button.dataset.mp);
      const mpInput = document.getElementById('mpInput');
      if (mpInput) mpInput.value = currentMP;
      document.querySelectorAll('.mp-btn').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      manualResolution = false;
      updateResolution();
    });
  });

  const mpInput = document.getElementById('mpInput');
  mpInput?.addEventListener('input', () => {
    let nextValue = Number.parseFloat(mpInput.value);
    if (Number.isNaN(nextValue)) return;
    nextValue = Math.max(0.5, Math.min(4.0, nextValue));
    currentMP = nextValue;
    document.querySelectorAll('.mp-btn').forEach((button) => {
      button.classList.toggle('active', Number.parseFloat(button.dataset.mp) === nextValue);
    });
    manualResolution = false;
    updateResolution();
  });

  initSlider('stepsSlider', 'stepsValue', 'paramSteps');
  initSlider('cfgSlider', 'cfgValue', 'paramCfg');

  enableAutocomplete(document.getElementById('basicPrompt'));
  enableAutocomplete(document.getElementById('negPrompt'));

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      const panel = document.getElementById('generatorPanel');
      if (panel && panel.style.display !== 'none') {
        event.preventDefault();
        void doGenerate();
      }
    }
  });

  const negPrompt = document.getElementById('negPrompt');
  negPrompt?.addEventListener('input', updateNegBadge);
  updateNegBadge();

  await loadHistoryFromServer();
  initPromptHistory();
  syncBatchEditorsFromPills();
  updateResolution();
  updatePromptPreview();
}

function mapFieldCategory(cat) {
  if (cat === 1) return 'artist';
  if (cat === 4) return 'character';
  if (cat === 3) return 'copyright';
  return 'general';
}

function toggleGenerator() {
  const panel = document.getElementById('generatorPanel');
  if (!panel) return;
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? 'flex' : 'none';
  if (opening) {
    // 前端性能优化：标签库只在用户打开生成面板时预热，目的在于图库首屏不再解析大型 CSV。
    void syncCustomTagsFromServer();
  }
}

function switchTab(mode) {
  currentMode = mode;
  document.getElementById('tabBasic')?.classList.toggle('active', mode === 'basic');
  document.getElementById('tabAdvanced')?.classList.toggle('active', mode === 'advanced');
  const modeBasic = document.getElementById('modeBasic');
  const modeAdvanced = document.getElementById('modeAdvanced');
  if (modeBasic) modeBasic.style.display = mode === 'basic' ? 'block' : 'none';
  if (modeAdvanced) modeAdvanced.style.display = mode === 'advanced' ? 'block' : 'none';
  if (mode === 'advanced') updatePromptPreview();
}

function initFieldTools(field, host, label, pill) {
  let actionBar = label.querySelector('.adv-label-actions');
  if (!actionBar) {
    actionBar = document.createElement('span');
    actionBar.className = 'adv-label-actions';
    label.appendChild(actionBar);
  }

  actionBar.appendChild(createPresetButton(field.id, pill));
  actionBar.appendChild(createBatchEditButton(field.id));

  if (batchEditors.has(field.id)) return;

  const wrap = document.createElement('div');
  wrap.className = 'batch-edit-area';
  wrap.hidden = true;
  wrap.innerHTML = `
    <textarea class="batch-edit-textarea" rows="4" placeholder="支持逗号或换行批量编辑"></textarea>
    <div class="batch-edit-actions">
      <button type="button" class="batch-edit-confirm">确认</button>
      <button type="button" class="batch-edit-cancel">取消</button>
    </div>
  `;
  host.insertAdjacentElement('afterend', wrap);

  const textarea = wrap.querySelector('.batch-edit-textarea');
  batchEditors.set(field.id, { host, wrap, textarea });

  wrap.querySelector('.batch-edit-confirm')?.addEventListener('click', () => {
    pill.setValue(textarea.value.trim());
    closeBatchEdit(field.id, { syncFromPill: true });
  });
  wrap.querySelector('.batch-edit-cancel')?.addEventListener('click', () => {
    closeBatchEdit(field.id, { syncFromPill: true });
  });
  textarea.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      wrap.querySelector('.batch-edit-confirm')?.click();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      wrap.querySelector('.batch-edit-cancel')?.click();
    }
  });
}

function createBatchEditButton(fieldId) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'adv-edit-btn';
  button.title = '批量编辑';
  button.textContent = '✏️';
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    openBatchEdit(fieldId);
  });
  return button;
}

function openBatchEdit(fieldId) {
  const state = batchEditors.get(fieldId);
  if (!state) return;

  batchEditors.forEach((_, id) => {
    if (id !== fieldId) closeBatchEdit(id, { syncFromPill: true });
  });

  const pill = pillInputs.get(fieldId);
  state.textarea.value = pill ? pill.getValueSilent() : '';
  state.host.hidden = true;
  state.wrap.hidden = false;
  state.wrap.classList.add('active');
  state.textarea.focus();
  state.textarea.setSelectionRange(state.textarea.value.length, state.textarea.value.length);
}

function closeBatchEdit(fieldId, { syncFromPill = false } = {}) {
  const state = batchEditors.get(fieldId);
  if (!state) return;
  if (syncFromPill) {
    const pill = pillInputs.get(fieldId);
    state.textarea.value = pill ? pill.getValueSilent() : '';
  }
  state.host.hidden = false;
  state.wrap.hidden = true;
  state.wrap.classList.remove('active');
}

function syncBatchEditorsFromPills() {
  batchEditors.forEach((state, fieldId) => {
    const pill = pillInputs.get(fieldId);
    state.textarea.value = pill ? pill.getValueSilent() : '';
  });
}

function clearAll() {
  const basicPrompt = document.getElementById('basicPrompt');
  if (basicPrompt) basicPrompt.value = '';
  ADV_FIELDS.forEach((field) => {
    const pill = pillInputs.get(field.id);
    if (pill) pill.setValue(field.defaultVal || '');
  });
  syncBatchEditorsFromPills();
  updatePromptPreview();
  saveLastValues();
  showToast('已清空字段', 'info');
}

function updatePromptPreview() {
  if (previewRafId) return;
  previewRafId = requestAnimationFrame(doUpdatePreview);
}

function doUpdatePreview() {
  previewRafId = 0;
  const previewEl = document.getElementById('previewText');
  if (!previewEl) return;

  const prompt = buildAdvancedPreview();
  previewEl.textContent = prompt || '（输入字段后自动显示拼接结果）';
  previewEl.style.color = prompt ? '#c0c0d8' : '#555';
}

function buildAdvancedPreview(payload = null) {
  const parts = [];
  ADV_FIELDS.forEach((field) => {
    let value = '';
    if (payload) {
      value = String(payload[field.key] || '').trim();
    } else {
      const pill = pillInputs.get(field.id);
      value = pill ? pill.getValueSilent().trim() : '';
    }
    if (!value) return;
    if (field.key === 'artist') {
      value = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => (item.startsWith('@') ? item : `@${item}`))
        .join(', ');
    }
    parts.push(value);
  });
  return parts.join(', ');
}

function updateNegBadge() {
  const negPrompt = document.getElementById('negPrompt');
  const badge = document.getElementById('negBadge');
  if (!negPrompt || !badge) return;
  const count = negPrompt.value.split(',').filter((item) => item.trim()).length;
  badge.textContent = `${count} tags`;
}

function handleJsonUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (loadEvent) => {
    try {
      const data = JSON.parse(loadEvent.target.result);
      if (data.prompt) {
        const basicPrompt = document.getElementById('basicPrompt');
        if (basicPrompt) basicPrompt.value = data.prompt;
      }
      if (data.negative_prompt) {
        const negPrompt = document.getElementById('negPrompt');
        if (negPrompt) negPrompt.value = data.negative_prompt;
        updateNegBadge();
      }
      if (data.seed !== undefined) document.getElementById('paramSeed').value = data.seed;
      if (data.steps !== undefined) {
        document.getElementById('paramSteps').value = data.steps;
        syncSliderFromInput('stepsSlider', 'stepsValue', data.steps);
      }
      if (data.cfg_scale !== undefined) {
        document.getElementById('paramCfg').value = data.cfg_scale;
        syncSliderFromInput('cfgSlider', 'cfgValue', data.cfg_scale);
      }
      if (data.aspect_ratio) {
        currentRatio = data.aspect_ratio;
        activateRatioBtn(data.aspect_ratio);
      }
      switchTab('basic');
      updateResolution();
      showToast('JSON 导入成功', 'success');
    } catch (error) {
      showToast(`JSON 解析失败: ${error.message}`, 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

export async function doGenerate() {
  const button = document.getElementById('generateBtn');
  const statusEl = document.getElementById('genStatus');
  if (button) button.disabled = true;
  if (statusEl) statusEl.innerHTML = '<span class="spinner"></span> 提交中...';

  try {
    const payload = collectPayload();
    const result = await runGenerationFlow(payload, {
      onQueued: (data) => {
        if (statusEl) {
          statusEl.innerHTML = `<span class="spinner"></span> 排队中（第 ${data.queue_position || '?'} 位）...`;
        }
      },
      onRunning: () => {
        if (statusEl) {
          statusEl.innerHTML = '<span class="spinner"></span> 正在生成...';
        }
      },
    });

    showToast(`生成完成，用时 ${result.generation_time || '?'}s`, 'success');
    if (statusEl) statusEl.textContent = '';
  } catch (error) {
    if (error?.redirectToLogin) {
      window.location.href = '/login';
      return;
    }
    showToast(error.message || '生成失败', 'error');
    if (statusEl) statusEl.textContent = '';
  } finally {
    if (button) button.disabled = false;
  }
}

function collectPayload({ silent = false } = {}) {
  const { width, height } = manualResolution
    ? {
        width: Number.parseInt(document.getElementById('paramWidth').value, 10) || 0,
        height: Number.parseInt(document.getElementById('paramHeight').value, 10) || 0,
      }
    : getResolution(currentRatio, currentMP);

  const payload = {
    mode: currentMode,
    negative_prompt: document.getElementById('negPrompt')?.value || '',
    seed: Number.parseInt(document.getElementById('paramSeed')?.value, 10),
    steps: Number.parseInt(document.getElementById('paramSteps')?.value, 10),
    cfg_scale: Number.parseFloat(document.getElementById('paramCfg')?.value),
    aspect_ratio: currentRatio,
    width,
    height,
  };

  if (currentMode === 'basic') {
    payload.prompt = document.getElementById('basicPrompt')?.value || '';
    return payload;
  }

  ADV_FIELDS.forEach((field) => {
    const pill = pillInputs.get(field.id);
    if (!pill) return;
    payload[field.key] = silent ? pill.getValueSilent() : pill.getValue();
  });
  return payload;
}

async function runGenerationFlow(payload, hooks = {}) {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (response.status === 401) {
    const error = new Error('未登录');
    error.redirectToLogin = true;
    throw error;
  }
  if (response.status === 429) {
    throw new Error('生成请求过于频繁，请稍后再试');
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }
  if (data.status !== 'queued' || !data.job_id) {
    throw new Error('未获取到任务编号');
  }

  hooks.onQueued?.(data);
  const job = await waitForJob(data.job_id, hooks.onRunning);
  savePromptHistory(payload);
  bus.dispatchEvent(new Event('generated'));
  return job;
}

async function waitForJob(jobId, onRunning) {
  for (let i = 0; i < 300; i += 1) {
    if (batchRunning && batchCancelled) {
      throw new Error('已取消');
    }
    await delay(1500);
    if (batchRunning && batchCancelled) {
      throw new Error('已取消');
    }
    const response = await fetch(`/api/jobs/${jobId}`);
    if (!response.ok) continue;
    const job = await response.json();

    if (job.status === 'queued') continue;
    if (job.status === 'running') {
      onRunning?.(job);
      continue;
    }
    if (job.status === 'succeeded') {
      return job;
    }
    if (job.status === 'failed') {
      throw new Error(job.error || '生成失败');
    }
    if (job.status === 'cancelled') {
      throw new Error('任务已取消');
    }
  }
  throw new Error('任务轮询超时');
}

function updateResolution() {
  const { width, height, actualMP } = getResolution(currentRatio, currentMP);
  const display = document.getElementById('resolutionDisplay');
  if (display) {
    display.innerHTML = `→ <strong>${width}×${height}</strong> (${actualMP} MP)`;
  }
  const widthInput = document.getElementById('paramWidth');
  const heightInput = document.getElementById('paramHeight');
  if (widthInput) widthInput.value = width;
  if (heightInput) heightInput.value = height;
}

function initSlider(sliderId, displayId, inputId) {
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

function syncSliderFromInput(sliderId, displayId, value) {
  const slider = document.getElementById(sliderId);
  const display = document.getElementById(displayId);
  if (slider) slider.value = value;
  if (display) display.textContent = value;
}

function activateRatioBtn(ratio) {
  document.querySelectorAll('.ratio-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.ratio === ratio);
  });
}

function initPromptHistory() {
  const select = document.getElementById('promptHistory');
  if (!select) return;

  renderHistory(select);
  select.addEventListener('change', () => {
    const index = Number.parseInt(select.value, 10);
    if (Number.isNaN(index)) return;
    const entry = historyCache[index];
    if (!entry) return;

    if (entry.prompt) {
      const basicPrompt = document.getElementById('basicPrompt');
      if (basicPrompt) basicPrompt.value = entry.prompt;
    }
    if (entry.negative_prompt) {
      const negPrompt = document.getElementById('negPrompt');
      if (negPrompt) negPrompt.value = entry.negative_prompt;
      updateNegBadge();
    }
    showToast('已回填历史记录', 'info');
  });
}

async function loadHistoryFromServer() {
  try {
    const response = await fetch('/api/preferences?keys=prompt_history');
    if (response.ok) {
      const data = await response.json();
      if (data.prompt_history) {
        historyCache = JSON.parse(data.prompt_history);
        return;
      }
    }
  } catch {
    // Ignore and fall back to localStorage.
  }

  try {
    historyCache = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    historyCache = [];
  }
}

function savePromptHistory(payload) {
  const promptText = payload.prompt || buildAdvancedPreview(payload);
  historyCache.unshift({
    prompt: promptText,
    negative_prompt: payload.negative_prompt || '',
    timestamp: new Date().toISOString(),
  });
  if (historyCache.length > MAX_HISTORY) {
    historyCache.length = MAX_HISTORY;
  }

  const json = JSON.stringify(historyCache);
  try {
    localStorage.setItem(HISTORY_KEY, json);
  } catch {
    // Ignore.
  }
  fetch('/api/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'prompt_history', value: json }),
  }).catch(() => {});

  const select = document.getElementById('promptHistory');
  if (select) renderHistory(select);
}

function renderHistory(select) {
  select.innerHTML = '<option value="">📜 历史</option>' + historyCache.map((item, index) => {
    const preview = (item.prompt || '').substring(0, 40);
    const suffix = (item.prompt || '').length > 40 ? '...' : '';
    return `<option value="${index}">${preview}${suffix}</option>`;
  }).join('');
}

export function fillFromMeta(img) {
  if (!img) return;

  const panel = document.getElementById('generatorPanel');
  if (panel) panel.style.display = 'flex';

  const adv = img.adv_fields;
  if (adv && Object.keys(adv).length > 0) {
    switchTab('advanced');
    ADV_FIELDS.forEach((field) => {
      const pill = pillInputs.get(field.id);
      if (!pill) return;
      let value = adv[field.key];
      if (value === undefined && field.key === 'pose_f' && adv.pose_expression !== undefined) {
        value = adv.pose_expression;
      }
      if (value !== undefined) {
        pill.setValue(value);
      }
    });
  } else {
    switchTab('basic');
    const basicPrompt = document.getElementById('basicPrompt');
    if (basicPrompt) basicPrompt.value = img.prompt || '';
  }

  if (img.negative_prompt) {
    const negPrompt = document.getElementById('negPrompt');
    if (negPrompt) negPrompt.value = img.negative_prompt;
    updateNegBadge();
  }
  if (img.seed !== undefined) document.getElementById('paramSeed').value = img.seed;
  if (img.steps !== undefined) {
    document.getElementById('paramSteps').value = img.steps;
    syncSliderFromInput('stepsSlider', 'stepsValue', img.steps);
  }
  if (img.cfg_scale !== undefined) {
    document.getElementById('paramCfg').value = img.cfg_scale;
    syncSliderFromInput('cfgSlider', 'cfgValue', img.cfg_scale);
  }
  if (img.aspect_ratio) {
    currentRatio = img.aspect_ratio;
    activateRatioBtn(img.aspect_ratio);
  }

  syncBatchEditorsFromPills();
  updateResolution();
  updatePromptPreview();
  saveLastValues();

  const modeLabel = adv && Object.keys(adv).length > 0 ? '高级模式' : '基础模式';
  showToast(`已回填参数（${modeLabel}）`, 'success');
}

function saveLastValues() {
  const values = {};
  ADV_FIELDS.forEach((field) => {
    const pill = pillInputs.get(field.id);
    if (pill) values[field.id] = pill.getValueSilent();
  });

  const json = JSON.stringify(values);
  try {
    localStorage.setItem(LS_LASTVAL_KEY, json);
  } catch {
    // Ignore.
  }

  clearTimeout(saveLastValuesTimer);
  saveLastValuesTimer = window.setTimeout(() => {
    fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'adv_last_values', value: json }),
    }).catch(() => {});
  }, 2000);
}

async function loadLastValues() {
  try {
    const response = await fetch('/api/preferences?keys=adv_last_values');
    if (response.ok) {
      const data = await response.json();
      if (data.adv_last_values) {
        return JSON.parse(data.adv_last_values);
      }
    }
  } catch {
    // Ignore and fall back to localStorage.
  }

  try {
    const raw = localStorage.getItem(LS_LASTVAL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function initFAB() {
  const fab = document.getElementById('fabGenerate');
  if (!fab) return;

  fabDefaultText = fab.textContent || '✨';

  let longPressTimer = 0;
  let suppressClick = false;

  fab.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (batchRunning) {
      batchCancelled = true;
      showToast('已请求取消连续出图', 'info');
      return;
    }
    void doGenerate();
  });

  fab.addEventListener('pointerdown', () => {
    longPressTimer = window.setTimeout(() => {
      suppressClick = true;
      if (batchRunning) {
        batchCancelled = true;
        showToast('已取消连续出图', 'info');
        return;
      }
      showBatchPopup(fab);
    }, 500);
  });
  fab.addEventListener('pointerup', () => clearTimeout(longPressTimer));
  fab.addEventListener('pointercancel', () => clearTimeout(longPressTimer));
  fab.addEventListener('pointermove', () => clearTimeout(longPressTimer));

  let scrollTimer = 0;
  window.addEventListener('scroll', () => {
    fab.classList.add('fab-scrolling');
    clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      fab.classList.remove('fab-scrolling');
    }, 300);
  }, { passive: true });
}

function showBatchPopup(fab) {
  document.querySelector('.fab-batch-popup')?.remove();

  const popup = document.createElement('div');
  popup.className = 'fab-batch-popup';

  [1, 5, 10, 20].forEach((count) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(count);
    button.addEventListener('click', () => {
      popup.remove();
      void batchGenerate(count, fab);
    });
    popup.appendChild(button);
  });

  document.body.appendChild(popup);

  const close = (event) => {
    if (!popup.contains(event.target) && event.target !== fab) {
      popup.remove();
      document.removeEventListener('pointerdown', close);
    }
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', close);
  }, 0);
}

async function batchGenerate(count, fab) {
  batchCancelled = false;
  batchRunning = true;
  fab.classList.add('fab-busy');

  try {
    for (let index = 1; index <= count; index += 1) {
      if (batchCancelled) break;

      fab.textContent = `${index}/${count}`;
      const payload = collectPayload({ silent: false });
      try {
        await runGenerationFlow(payload);
      } catch (error) {
        if (batchCancelled || error.message === '已取消') break;
        showToast(`连续出图第 ${index} 张失败: ${error.message}`, 'error');
      }
    }

    if (!batchCancelled) {
      showToast(`连续出图完成（${count} 张）`, 'success');
    }
  } finally {
    batchRunning = false;
    batchCancelled = false;
    fab.textContent = fabDefaultText;
    fab.classList.remove('fab-busy');
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
