const elements = {
  form: document.querySelector('#configForm'),
  targetDate: document.querySelector('#targetDate'),
  ticketCount: document.querySelector('#ticketCount'),
  seatingMode: document.querySelector('#seatingMode'),
  pollMode: document.querySelector('#pollMode'),
  preferredPrices: document.querySelector('#preferredPrices'),
  autoAdvance: document.querySelector('#autoAdvance'),
  openLogin: document.querySelector('#openLogin'),
  start: document.querySelector('#start'),
  stop: document.querySelector('#stop'),
  runningBadge: document.querySelector('#runningBadge'),
  loginStatus: document.querySelector('#loginStatus'),
  ticketStatus: document.querySelector('#ticketStatus'),
  phaseStatus: document.querySelector('#phaseStatus'),
  updatedAt: document.querySelector('#updatedAt'),
  logs: document.querySelector('#logs'),
  toast: document.querySelector('#toast'),
  alertOverlay: document.querySelector('#alertOverlay'),
  alertMessage: document.querySelector('#alertMessage'),
  focusTicket: document.querySelector('#focusTicket'),
  dismissAlert: document.querySelector('#dismissAlert'),
};

let initialized = false;
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

function statusLabel(code, kind) {
  const labels = {
    'logged-in': '已登入',
    'logged-out': '未登入',
    unknown: kind === 'login' ? '尚未確認' : '尚未讀取',
    unavailable: '暫無票券',
    soldout: '銷售一空',
    onsale: '可購買',
    available: '可購買',
  };
  return labels[code] || code;
}

function phaseLabel(phase) {
  return {
    idle: '尚未啟動',
    starting: '正在啟動',
    'waiting-login': '等待登入',
    watching: '正在監看票況',
    buying: '正在搶票',
    'manual-action': '等待你接手',
    blocked: '網站限制，已停止',
    error: '發生錯誤',
  }[phase] || phase;
}

function render(state) {
  if (!initialized) {
    elements.targetDate.value = state.config.targetDate;
    elements.ticketCount.value = String(state.config.ticketCount);
    elements.seatingMode.value = state.config.seatingMode;
    elements.preferredPrices.value = state.config.preferredPrices;
    elements.autoAdvance.checked = state.config.autoAdvance;
    elements.pollMode.value = state.config.pollMode === 'custom' ? 'fast' : state.config.pollMode;
    initialized = true;
  }

  elements.runningBadge.textContent = state.running ? '監看中' : '未啟動';
  elements.runningBadge.className = `badge ${state.running ? 'good' : 'neutral'}`;
  elements.loginStatus.textContent = statusLabel(state.loginStatus, 'login');
  elements.ticketStatus.textContent = statusLabel(state.ticketStatus, 'ticket');
  elements.phaseStatus.textContent = phaseLabel(state.phase);
  elements.updatedAt.textContent = state.ticketUpdatedAt ? `票況更新：${state.ticketUpdatedAt}` : '';
  elements.start.disabled = state.running;
  elements.stop.disabled = !state.running;
  elements.form.querySelectorAll('input, select, button').forEach((element) => {
    element.disabled = state.running;
  });

  elements.logs.innerHTML = state.logs.length
    ? state.logs
        .map((entry) => {
          const time = new Date(entry.at).toLocaleTimeString('zh-TW', { hour12: false });
          return `<li><time>${time}</time><span>${escapeHtml(entry.message)}</span></li>`;
        })
        .join('')
    : '<li>等待啟動</li>';

  if (state.alertId > lastAlertId) {
    lastAlertId = state.alertId;
    elements.alertMessage.textContent = state.alertMessage || state.message;
    elements.alertOverlay.hidden = false;
    document.title = '🚨 需要接手｜Ticket Plus 搶票助手';
    playAlertSound();
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Ticket Plus 搶票助手', { body: state.alertMessage || state.message });
    }
  }
}

function armNotifications() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (AudioContextClass) audioContext ||= new AudioContextClass();
  if (audioContext.state === 'suspended') audioContext.resume();
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
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

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

async function refresh() {
  try {
    render(await request('/api/state'));
  } catch (error) {
    elements.toast.textContent = error.message;
  }
}

async function runAction(path, body) {
  elements.toast.textContent = '';
  try {
    const state = await request(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : '{}',
    });
    render(state);
  } catch (error) {
    elements.toast.textContent = error.message;
  }
}

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  runAction('/api/config', {
    targetDate: elements.targetDate.value,
    ticketCount: Number(elements.ticketCount.value),
    seatingMode: elements.seatingMode.value,
    pollMode: elements.pollMode.value,
    preferredPrices: elements.preferredPrices.value,
    autoAdvance: elements.autoAdvance.checked,
  });
});
elements.openLogin.addEventListener('click', () => runAction('/api/open-login'));
elements.start.addEventListener('click', () => {
  armNotifications();
  runAction('/api/start');
});
elements.stop.addEventListener('click', () => runAction('/api/stop'));
elements.focusTicket.addEventListener('click', async () => {
  await runAction('/api/open-login');
  elements.alertOverlay.hidden = true;
  document.title = 'Ticket Plus 搶票助手';
});
elements.dismissAlert.addEventListener('click', () => {
  elements.alertOverlay.hidden = true;
  document.title = 'Ticket Plus 搶票助手';
});

await refresh();
setInterval(refresh, 1_000);
