const elements = {
  runningBadge: document.querySelector('#runningBadge'),
  loginStatus: document.querySelector('#loginStatus'),
  ticketStatus: document.querySelector('#ticketStatus'),
  phaseStatus: document.querySelector('#phaseStatus'),
  salePlan: document.querySelector('#salePlan'),
  settings: document.querySelector('#settings'),
  logs: document.querySelector('#logs'),
  toast: document.querySelector('#toast'),
  preferenceForm: document.querySelector('#preferenceForm'),
  ticketMode: document.querySelector('#ticketMode'),
  cardPrefixForm: document.querySelector('#cardPrefixForm'),
  cardPrefix: document.querySelector('#cardPrefix'),
  cardPrefixStatus: document.querySelector('#cardPrefixStatus'),
  openLogin: document.querySelector('#openLogin'),
  start: document.querySelector('#start'),
  stop: document.querySelector('#stop'),
  alertOverlay: document.querySelector('#alertOverlay'),
  alertMessage: document.querySelector('#alertMessage'),
  focusTicket: document.querySelector('#focusTicket'),
  dismissAlert: document.querySelector('#dismissAlert'),
};

let lastAlertId = 0;
let audioContext = null;

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function phaseLabel(phase) {
  return {
    idle: '尚未啟動',
    starting: '正在啟動',
    'waiting-sale': '等待 9/22 10:00 開賣',
    'entering-sale': '進入官方購票流程',
    'waiting-card': '正在自動送出卡友驗證',
    'refresh-wait': '等待下一次更新票數',
    refreshing: '正在更新票數',
    selecting: '正在選擇票種',
    'manual-action': '等待你接手',
    blocked: '已暫停，等待你檢查',
    error: '發生錯誤',
  }[phase] || phase;
}

function loginLabel(status) {
  return { 'logged-in': '已登入', 'logged-out': '未登入', unknown: '請確認' }[status] || status;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function armAlerts() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (AudioContextClass) audioContext ||= new AudioContextClass();
  if (audioContext?.state === 'suspended') audioContext.resume();
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

function playAlertSound() {
  if (!audioContext) return;
  const start = audioContext.currentTime;
  for (const offset of [0, 0.28, 0.56]) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.24, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.2);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.22);
  }
}

function render(state) {
  elements.runningBadge.textContent = state.running ? '進行中' : '未啟動';
  elements.runningBadge.className = `badge ${state.running ? 'good' : 'neutral'}`;
  elements.loginStatus.textContent = loginLabel(state.loginStatus);
  elements.ticketStatus.textContent = state.ticketStatus || '尚未啟動';
  elements.phaseStatus.textContent = phaseLabel(state.phase);
  elements.salePlan.textContent = `開賣：${new Date(state.config.saleStart).toLocaleString('zh-TW', { hour12: false })}`;
  elements.start.disabled = state.running;
  elements.stop.disabled = !state.running;
  elements.ticketMode.value = state.config.ticketMode;
  elements.ticketMode.disabled = state.running;
  elements.cardPrefixForm.hidden = state.config.saleMode === 'general-sale';
  elements.start.textContent = state.config.saleMode === 'general-sale'
    ? '開始等待 9/22 10:00'
    : '開始中信卡友演練';
  elements.cardPrefixStatus.textContent = state.cardPrefixReady
    ? '已暫存在記憶體；關閉程式後會自動清除。'
    : '尚未暫存；不會寫入設定檔或操作紀錄。';

  const ticketPriority = state.config.ticketMode === 'adjacent-two-then-one'
    ? '票數順位：2/28 兩張連號 → 2/27 兩張連號 → 2/28 單張 → 2/27 單張'
    : '票數順位：2/28 單張 → 2/27 單張';
  const settings = [
    `首選：${state.config.primary}`,
    `備案：${state.config.fallback}`,
    ticketPriority,
    '不選輪椅／身障席；非遮蔽區優先，再依票價高至低',
    '無票時每 3–5 秒使用官方「更新票數」，持續到選到票或你按停止',
    `VIP 粉絲福利：${state.config.wantVipBenefit ? '要' : '不要'}；自動下一步：${state.config.autoAdvance ? '開啟' : '關閉'}`,
  ];
  if (state.config.saleMode === 'ctbc-rehearsal') {
    settings.push(`卡號前 6 碼：${state.cardPrefixReady ? '已準備' : '尚未設定'}；演練抵達票況頁即停止。`);
  } else {
    settings.push('一般販售不需卡號前 6 碼；選票後仍須由你完成實名資料與付款。');
  }
  elements.settings.innerHTML = settings.map((item) => `<li><span>${escapeHtml(item)}</span></li>`).join('');
  elements.logs.innerHTML = state.logs.length
    ? state.logs.map((entry) => {
      const time = new Date(entry.at).toLocaleTimeString('zh-TW', { hour12: false });
      return `<li><time>${time}</time><span>${escapeHtml(entry.message)}</span></li>`;
    }).join('')
    : '<li>等待啟動</li>';

  if (state.alertId > lastAlertId) {
    lastAlertId = state.alertId;
    elements.alertMessage.textContent = state.alertMessage || state.message;
    elements.alertOverlay.hidden = false;
    document.title = '🚨 需要接手｜寬宏搶票助手';
    playAlertSound();
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('寬宏搶票助手', { body: state.alertMessage || state.message });
    }
  }
}

async function refresh() {
  try {
    render(await request('/api/state'));
  } catch (error) {
    elements.toast.textContent = error.message;
  }
}

async function runAction(path) {
  elements.toast.textContent = '';
  try {
    render(await request(path, { method: 'POST', body: '{}' }));
  } catch (error) {
    elements.toast.textContent = error.message;
  }
}

elements.openLogin.addEventListener('click', () => runAction('/api/open-login'));
elements.ticketMode.addEventListener('change', async () => {
  elements.toast.textContent = '';
  try {
    render(await request('/api/preferences', {
      method: 'POST',
      body: JSON.stringify({ ticketMode: elements.ticketMode.value }),
    }));
  } catch (error) {
    elements.toast.textContent = error.message;
    await refresh();
  }
});
elements.cardPrefixForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  elements.toast.textContent = '';
  if (!elements.cardPrefix.reportValidity()) return;
  try {
    const state = await request('/api/card-prefix', {
      method: 'POST',
      body: JSON.stringify({ cardPrefix: elements.cardPrefix.value }),
    });
    elements.cardPrefix.value = '';
    render(state);
    elements.toast.textContent = '前 6 碼已安全暫存；偵測到驗證欄位時會自動填入並送出。';
  } catch (error) {
    elements.toast.textContent = error.message;
  }
});
elements.start.addEventListener('click', () => {
  armAlerts();
  runAction('/api/start');
});
elements.stop.addEventListener('click', () => runAction('/api/stop'));
elements.focusTicket.addEventListener('click', async () => {
  await runAction('/api/open-login');
  elements.alertOverlay.hidden = true;
  document.title = '寬宏搶票助手';
});
elements.dismissAlert.addEventListener('click', () => {
  elements.alertOverlay.hidden = true;
  document.title = '寬宏搶票助手';
});

await refresh();
setInterval(refresh, 1_000);
