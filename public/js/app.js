'use strict';

/* ═══════════════════════════════════════════════════════════════
   NutriSnap — Frontend Application
   ═══════════════════════════════════════════════════════════════ */

const App = (() => {

  // ─── State ─────────────────────────────────────────────────────
  let token         = localStorage.getItem('ns_token') || null;
  let user          = JSON.parse(localStorage.getItem('ns_user') || 'null');
  let capturedImage = null;   // base64 data URI
  let analysisData  = null;   // last AI analysis result
  let videoStream   = null;   // MediaStream
  let calorieChart  = null;
  let macrosChart   = null;
  let pieChart      = null;
  let ringChart     = null;
  let deferredInstall = null;

  // Fasting state
  let fastSession      = null;   // active fast object from server
  let fastInterval     = null;   // setInterval handle
  let selFastHours     = 16;
  let selFastProtocol  = '16:8';

  // Weight goal
  let weightGoalData   = null;

  // Insight cache
  let insightCached    = null;

  const today = () => new Date().toISOString().slice(0, 10);

  // ─── API helpers ───────────────────────────────────────────────
  async function api(method, path, body = null, isForm = false) {
    const opts = {
      method,
      headers: {}
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body && !isForm) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (body && isForm) {
      opts.body = body; // FormData
    }
    const res  = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // ─── Toast ─────────────────────────────────────────────────────
  function toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.className = 'toast hidden'; }, 3000);
  }

  // ─── Auth ──────────────────────────────────────────────────────
  function showLogin() {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
  }

  function showRegister() {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
  }

  async function login() {
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl    = document.getElementById('login-error');
    const btn      = document.getElementById('login-btn');

    clearError(errEl);
    if (!email || !password) return showError(errEl, 'Please fill in all fields.');

    btn.disabled = true; btn.querySelector('span').textContent = 'Signing in…';
    try {
      const data = await api('POST', '/api/auth/login', { email, password });
      setSession(data.token, data.user);
      initApp();
    } catch (e) {
      showError(errEl, e.message);
    } finally {
      btn.disabled = false; btn.querySelector('span').textContent = 'Sign In';
    }
  }

  async function register() {
    const errEl = document.getElementById('reg-error');
    const btn   = document.getElementById('register-btn');
    clearError(errEl);

    const body = {
      name:     document.getElementById('reg-name').value.trim(),
      email:    document.getElementById('reg-email').value.trim(),
      password: document.getElementById('reg-password').value,
      age:      parseInt(document.getElementById('reg-age').value)    || null,
      weight:   parseFloat(document.getElementById('reg-weight').value) || null,
      height:   parseFloat(document.getElementById('reg-height').value) || null,
      gender:   document.getElementById('reg-gender').value,
      activity: document.getElementById('reg-activity').value,
      goal:     document.getElementById('reg-goal').value,
    };

    if (!body.name || !body.email || !body.password)
      return showError(errEl, 'Name, email and password are required.');
    if (body.password.length < 6)
      return showError(errEl, 'Password must be at least 6 characters.');

    btn.disabled = true; btn.querySelector('span').textContent = 'Creating account…';
    try {
      const data = await api('POST', '/api/auth/register', body);
      setSession(data.token, data.user);
      initApp();
    } catch (e) {
      showError(errEl, e.message);
    } finally {
      btn.disabled = false; btn.querySelector('span').textContent = 'Create Account';
    }
  }

  function setSession(t, u) {
    token = t; user = u;
    localStorage.setItem('ns_token', t);
    localStorage.setItem('ns_user', JSON.stringify(u));
  }

  function logout() {
    token = null; user = null;
    localStorage.removeItem('ns_token');
    localStorage.removeItem('ns_user');
    stopCamera();
    document.getElementById('auth-screen').classList.add('active');
    document.getElementById('app-screen').classList.remove('active');
    showLogin();
  }

  function showError(el, msg) {
    el.textContent = msg; el.classList.remove('hidden');
  }
  function clearError(el) {
    el.textContent = ''; el.classList.add('hidden');
  }

  // ─── App Init ──────────────────────────────────────────────────
  function initApp() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('app-screen').classList.add('active');
    updateGreeting();
    updateDate();
    loadDashboard();
    loadProfile();
    checkActiveFast();
    loadInsight();
    switchTab('dashboard');
    scheduleReminders();
    requestNotificationsIfGranted();
  }

  function updateGreeting() {
    const h = new Date().getHours();
    const g = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    document.getElementById('greeting-text').textContent =
      `${g}, ${(user?.name || 'friend').split(' ')[0]}! 👋`;
    document.getElementById('greeting-sub').textContent = 'Here\'s your nutrition today';
  }

  function updateDate() {
    const d = new Date();
    document.getElementById('topbar-date').textContent =
      d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // ─── Tab Switching ─────────────────────────────────────────────
  function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));

    document.getElementById('tab-' + tab).classList.add('active');
    document.querySelector(`.nav-btn[data-tab="${tab}"]`)?.classList.add('active');

    if (tab === 'dashboard') loadDashboard();
    if (tab === 'fasting')   loadFastingTab();
    if (tab === 'charts')    loadCharts();
    if (tab === 'profile')   loadProfile();
    if (tab !== 'camera')    stopCamera();

    history.replaceState(null, '', tab === 'dashboard' ? '/' : '/?tab=' + tab);
  }

  // ─── Dashboard ─────────────────────────────────────────────────
  async function loadDashboard() {
    try {
      const data = await api('GET', `/api/food/logs?date=${today()}`);
      renderDashboard(data);
      updateFastWidget();
    } catch (e) {
      console.error(e);
    }
  }

  function renderDashboard({ logs, totals }) {
    const target = user?.calorie_target || 2000;

    // Ring chart
    const consumed = Math.round(totals.calories || 0);
    const pct      = Math.min(consumed / target, 1);
    drawRing(consumed, target, pct);

    document.getElementById('ring-consumed').textContent = consumed;
    document.getElementById('ring-remaining').textContent =
      consumed < target ? `of ${target} kcal` : '🎯 Goal reached!';

    // Macro bars (rough daily targets)
    const pTarget  = (target * 0.25) / 4;   // ~25% from protein
    const cTarget  = (target * 0.50) / 4;   // ~50% from carbs
    const fTarget  = (target * 0.25) / 9;   // ~25% from fat
    setMacro('protein', totals.protein, pTarget, '#val-protein', '#bar-protein');
    setMacro('carbs',   totals.carbs,   cTarget, '#val-carbs',   '#bar-carbs');
    setMacro('fat',     totals.fat,     fTarget, '#val-fat',     '#bar-fat');

    // Meals list
    const list = document.getElementById('meals-list');
    if (!logs.length) {
      list.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🍽️</span>
          <p>No meals logged yet today</p>
          <button class="btn-primary sm" onclick="App.switchTab('camera')">Snap your first meal</button>
        </div>`;
      return;
    }

    list.innerHTML = logs.map(log => `
      <div class="meal-item" id="meal-${log.id}">
        <div class="meal-thumb">
          ${log.image_data
            ? `<img src="${log.image_data}" alt="${escHtml(log.food_name)}" />`
            : `<span>${mealEmoji(log.meal_type)}</span>`}
        </div>
        <div class="meal-info">
          <div class="meal-name">${escHtml(log.food_name)}</div>
          <div class="meal-meta">
            <span class="meal-type-badge ${log.meal_type}">${cap(log.meal_type)}</span>
            ${log.serving_size ? `<span style="margin-left:6px;color:var(--text3);font-size:11px">${escHtml(log.serving_size)}</span>` : ''}
          </div>
        </div>
        <div class="meal-calories">
          <span class="meal-cal-num">${Math.round(log.calories)}</span>
          <span class="meal-cal-unit">kcal</span>
        </div>
        <button class="meal-delete" onclick="App.deleteLog(${log.id})" title="Remove">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>`).join('');
  }

  function setMacro(name, val, target, valSel, barSel) {
    const v = Math.round(val || 0);
    document.querySelector(valSel).textContent = v + 'g';
    document.querySelector(barSel).style.width = Math.min((v / target) * 100, 100) + '%';
  }

  function drawRing(consumed, target, pct) {
    const canvas = document.getElementById('calorie-ring');
    const ctx    = canvas.getContext('2d');
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const r  = 72, lw = 12;
    const start = -Math.PI / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Track
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = lw;
    ctx.stroke();

    // Fill
    const color = pct >= 1 ? '#f87171' : '#4ade80';
    const grad  = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    grad.addColorStop(0, color); grad.addColorStop(1, pct >= 1 ? '#ef4444' : '#22c55e');

    if (pct > 0) {
      ctx.beginPath(); ctx.arc(cx, cy, r, start, start + pct * Math.PI * 2);
      ctx.strokeStyle = grad; ctx.lineWidth = lw;
      ctx.lineCap = 'round'; ctx.stroke();
    }

    // Glow
    ctx.shadowColor = color; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(cx, cy, r, start, start + pct * Math.PI * 2);
    ctx.strokeStyle = grad; ctx.lineWidth = lw;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // ─── Delete log ────────────────────────────────────────────────
  async function deleteLog(id) {
    try {
      await api('DELETE', `/api/food/log/${id}`);
      const el = document.getElementById(`meal-${id}`);
      if (el) { el.style.opacity = '0'; el.style.transform = 'translateX(20px)';
                el.style.transition = 'all .3s'; setTimeout(() => el.remove(), 300); }
      toast('Meal removed', 'success');
      setTimeout(loadDashboard, 350);
    } catch (e) { toast(e.message, 'error'); }
  }

  // ─── Camera ────────────────────────────────────────────────────
  async function openCamera() {
    if (videoStream) { stopCamera(); return; }
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      });
      const video = document.getElementById('camera-video');
      video.srcObject = videoStream;
      video.classList.remove('hidden');
      document.getElementById('camera-idle').classList.add('hidden');
      document.getElementById('btn-capture').classList.remove('hidden');
      document.getElementById('btn-open-camera').textContent = '';
      document.getElementById('btn-open-camera').innerHTML =
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Stop`;
    } catch {
      toast('Camera access denied — try uploading a photo instead', 'error');
    }
  }

  function capturePhoto() {
    const video  = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    const MAX    = 1024;
    let w = video.videoWidth  || 640;
    let h = video.videoHeight || 480;
    if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
    if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    capturedImage = canvas.toDataURL('image/jpeg', 0.82);
    showPreview(capturedImage);
    stopCamera();
  }

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1024;
        let w = img.width, h = img.height;
        if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
        const canvas = document.getElementById('camera-canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        capturedImage = canvas.toDataURL('image/jpeg', 0.82);
        showPreview(capturedImage);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function showPreview(src) {
    const img = document.getElementById('preview-img');
    img.src = src; img.classList.remove('hidden');
    document.getElementById('camera-idle').classList.add('hidden');
    document.getElementById('camera-video').classList.add('hidden');
    document.getElementById('btn-capture').classList.add('hidden');
    document.getElementById('btn-retake').classList.remove('hidden');
    document.getElementById('btn-analyze').classList.add('hidden');
    document.getElementById('analysis-result').classList.add('hidden');
    document.getElementById('btn-open-camera').innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>Camera`;
    analyzeFood();
  }

  function retakePhoto() {
    capturedImage = null; analysisData = null;
    document.getElementById('preview-img').classList.add('hidden');
    document.getElementById('camera-idle').classList.remove('hidden');
    document.getElementById('btn-retake').classList.add('hidden');
    document.getElementById('btn-analyze').classList.add('hidden');
    document.getElementById('analysis-result').classList.add('hidden');
    document.getElementById('analyzing-loader').classList.add('hidden');
    document.getElementById('file-input').value = '';
  }

  function stopCamera() {
    if (videoStream) {
      videoStream.getTracks().forEach(t => t.stop());
      videoStream = null;
    }
    const video = document.getElementById('camera-video');
    video.srcObject = null; video.classList.add('hidden');
    document.getElementById('btn-capture').classList.add('hidden');
  }

  // ─── AI Food Analysis ──────────────────────────────────────────
  async function analyzeFood() {
    if (!capturedImage) return toast('Please take or upload a photo first.', 'error');

    document.getElementById('btn-analyze').classList.add('hidden');
    document.getElementById('analyzing-loader').classList.remove('hidden');
    document.getElementById('analysis-result').classList.add('hidden');

    try {
      // Convert base64 data URI to Blob for FormData
      const blob = dataURItoBlob(capturedImage);
      const form = new FormData();
      form.append('image', blob, 'food.jpg');

      const res = await fetch('/api/food/analyze', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: form
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Analysis failed');
      }
      analysisData = await res.json();
      showAnalysisResult(analysisData);
    } catch (e) {
      toast('Analysis failed: ' + e.message, 'error');
      document.getElementById('btn-analyze').classList.remove('hidden');
    } finally {
      document.getElementById('analyzing-loader').classList.add('hidden');
    }
  }

  function showAnalysisResult(d) {
    document.getElementById('result-name').textContent        = d.food_name || 'Unknown food';
    document.getElementById('result-description').textContent = d.description || '';
    document.getElementById('result-serving').textContent     = d.serving_size || '';
    document.getElementById('res-calories').textContent       = Math.round(d.calories)    || 0;
    document.getElementById('res-protein').textContent        = Math.round(d.protein)     || 0;
    document.getElementById('res-carbs').textContent          = Math.round(d.carbs)       || 0;
    document.getElementById('res-fat').textContent            = Math.round(d.fat)         || 0;

    const conf  = document.getElementById('result-confidence');
    const level = (d.confidence || 'medium').toLowerCase();
    conf.textContent = { high: '✓ High confidence', medium: '~ Medium confidence', low: '⚠ Low confidence' }[level];
    conf.className = `confidence-badge ${level}`;

    // Pre-fill editable fields
    document.getElementById('edit-name').value     = d.food_name || '';
    document.getElementById('edit-calories').value = Math.round(d.calories) || '';
    document.getElementById('edit-protein').value  = parseFloat(d.protein  || 0).toFixed(1);
    document.getElementById('edit-carbs').value    = parseFloat(d.carbs    || 0).toFixed(1);
    document.getElementById('edit-fat').value      = parseFloat(d.fat      || 0).toFixed(1);

    // Set meal type based on hour
    const h = new Date().getHours();
    const mt = h < 10 ? 'breakfast' : h < 14 ? 'lunch' : h < 19 ? 'dinner' : 'snack';
    document.getElementById('edit-meal-type').value = mt;

    document.getElementById('analysis-result').classList.remove('hidden');
  }

  async function logFood() {
    const name     = document.getElementById('edit-name').value.trim();
    const calories = parseFloat(document.getElementById('edit-calories').value);
    if (!name || isNaN(calories)) return toast('Food name and calories are required.', 'error');

    const btn = document.querySelector('#analysis-result .btn-primary');
    btn.disabled = true;

    try {
      await api('POST', '/api/food/log', {
        food_name:    name,
        description:  analysisData?.description || '',
        calories,
        protein:      parseFloat(document.getElementById('edit-protein').value)   || 0,
        carbs:        parseFloat(document.getElementById('edit-carbs').value)     || 0,
        fat:          parseFloat(document.getElementById('edit-fat').value)       || 0,
        fiber:        analysisData?.fiber || 0,
        serving_size: analysisData?.serving_size || '',
        meal_type:    document.getElementById('edit-meal-type').value,
        log_date:     today(),
        image_data:   capturedImage || null
      });

      toast('🎉 Meal logged successfully!', 'success');
      retakePhoto();
      setTimeout(() => switchTab('dashboard'), 600);
    } catch (e) {
      toast('Failed to log: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // ─── Charts ────────────────────────────────────────────────────
  async function loadCharts() {
    const days = parseInt(document.getElementById('chart-range')?.value || '30');
    const to   = today();
    const from = (() => { const d = new Date(to); d.setDate(d.getDate() - days + 1); return d.toISOString().slice(0, 10); })();

    try {
      const { rows } = await api('GET', `/api/food/summary?from=${from}&to=${to}`);
      renderCharts(rows, from, to, days);
    } catch (e) { console.error(e); }
  }

  function renderCharts(rows, from, to, days) {
    // Build full date range (fill gaps with 0)
    const map = {};
    rows.forEach(r => { map[r.log_date] = r; });
    const labels = [], cals = [], proteins = [], carbs = [], fats = [];
    for (let d = new Date(from); d <= new Date(to); d.setDate(d.getDate() + 1)) {
      const k = d.toISOString().slice(0, 10);
      labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      const r = map[k] || {};
      cals.push(Math.round(r.total_calories || 0));
      proteins.push(Math.round(r.total_protein || 0));
      carbs.push(Math.round(r.total_carbs    || 0));
      fats.push(Math.round(r.total_fat       || 0));
    }

    const target = user?.calorie_target || 2000;
    const chartDefaults = {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#5a5a72', font: { size: 10 }, maxTicksLimit: 7 },
             grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#5a5a72', font: { size: 10 } },
             grid: { color: 'rgba(255,255,255,0.04)' } }
      }
    };

    // ── Calories line chart
    if (calorieChart) calorieChart.destroy();
    const cCtx = document.getElementById('calories-chart').getContext('2d');
    const gradCal = cCtx.createLinearGradient(0, 0, 0, 200);
    gradCal.addColorStop(0, 'rgba(74,222,128,0.3)');
    gradCal.addColorStop(1, 'rgba(74,222,128,0)');
    calorieChart = new Chart(cCtx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Calories', data: cals,
            borderColor: '#4ade80', backgroundColor: gradCal,
            fill: true, tension: 0.4, pointRadius: 3,
            pointBackgroundColor: '#4ade80', borderWidth: 2
          },
          {
            label: 'Target', data: labels.map(() => target),
            borderColor: 'rgba(255,255,255,0.2)', borderDash: [6, 3],
            fill: false, tension: 0, pointRadius: 0, borderWidth: 1
          }
        ]
      },
      options: { ...chartDefaults, plugins: {
        legend: { display: true, labels: { color: '#9898b0', font: { size: 11 } } }
      }}
    });

    // ── Macros stacked bar
    if (macrosChart) macrosChart.destroy();
    const mCtx = document.getElementById('macros-chart').getContext('2d');
    macrosChart = new Chart(mCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Protein', data: proteins, backgroundColor: 'rgba(167,139,250,0.7)', stack: 'a' },
          { label: 'Carbs',   data: carbs,    backgroundColor: 'rgba(251,191,36,0.7)',  stack: 'a' },
          { label: 'Fat',     data: fats,     backgroundColor: 'rgba(248,113,113,0.7)', stack: 'a' }
        ]
      },
      options: { ...chartDefaults, plugins: {
        legend: { display: true, labels: { color: '#9898b0', font: { size: 11 } } }
      }}
    });

    // ── Pie: average macro split
    if (pieChart) pieChart.destroy();
    const avgP = proteins.reduce((a, b) => a + b, 0) / (proteins.length || 1);
    const avgC = carbs.reduce((a, b) => a + b, 0)    / (carbs.length    || 1);
    const avgF = fats.reduce((a, b) => a + b, 0)     / (fats.length     || 1);
    const pCtx  = document.getElementById('pie-chart').getContext('2d');
    pieChart = new Chart(pCtx, {
      type: 'doughnut',
      data: {
        labels: ['Protein', 'Carbs', 'Fat'],
        datasets: [{ data: [avgP, avgC, avgF],
          backgroundColor: ['rgba(167,139,250,0.8)', 'rgba(251,191,36,0.8)', 'rgba(248,113,113,0.8)'],
          borderColor: 'transparent', borderRadius: 4, spacing: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#9898b0', font: { size: 11 } } } },
        cutout: '65%'
      }
    });

    // ── Stats row
    const activeDays = rows.length;
    const avgCal     = activeDays ? Math.round(cals.reduce((a, b) => a + b, 0) / days) : 0;
    const maxCal     = Math.max(...cals, 0);
    document.getElementById('chart-stats').innerHTML = `
      <div class="stats-row-item"><span class="sri-val">${activeDays}</span><span class="sri-label">Active days</span></div>
      <div class="stats-row-item"><span class="sri-val">${avgCal}</span><span class="sri-label">Avg kcal/day</span></div>
      <div class="stats-row-item"><span class="sri-val">${maxCal}</span><span class="sri-label">Max kcal</span></div>`;
  }

  // ─── Profile ───────────────────────────────────────────────────
  async function loadProfile() {
    try {
      const data = await api('GET', '/api/user/profile');
      user = { ...user, ...data };
      localStorage.setItem('ns_user', JSON.stringify(user));
      renderProfile(data);
      loadWeightGoal();
      loadMcpKey();
    } catch (e) { console.error(e); }
  }

  function renderProfile(u) {
    document.getElementById('profile-name').textContent  = u.name || 'User';
    document.getElementById('profile-email').textContent = u.email || '';
    document.getElementById('profile-avatar').textContent = (u.name || 'U')[0].toUpperCase();

    // Stats
    if (u.bmi != null) {
      document.getElementById('bmi-value').textContent = u.bmi;
      const cat = (u.bmi_category || '').toLowerCase().replace(' ', '');
      const badge = document.getElementById('bmi-category');
      badge.textContent = u.bmi_category || '';
      badge.className = `bmi-badge ${cat}`;

      // Position BMI thumb (scale: 15–40)
      const pct = Math.min(Math.max((u.bmi - 15) / 25, 0), 1) * 100;
      document.getElementById('bmi-thumb').style.left = pct + '%';
    }

    document.getElementById('stat-target').innerHTML = u.calorie_target != null
      ? `${u.calorie_target} <small>kcal</small>` : '— <small>kcal</small>';
    document.getElementById('stat-bmr').innerHTML = u.bmr != null
      ? `${u.bmr} <small>kcal</small>` : '— <small>kcal</small>';
    document.getElementById('stat-tdee').innerHTML = u.tdee != null
      ? `${u.tdee} <small>kcal</small>` : '— <small>kcal</small>';

    // Fill form
    document.getElementById('p-name').value     = u.name     || '';
    document.getElementById('p-age').value      = u.age      || '';
    document.getElementById('p-weight').value   = u.weight   || '';
    document.getElementById('p-height').value   = u.height   || '';
    document.getElementById('p-gender').value   = u.gender   || 'other';
    document.getElementById('p-activity').value = u.activity || 'moderate';
    document.getElementById('p-goal').value     = u.goal     || 'maintain';
  }

  async function saveProfile() {
    const body = {
      name:     document.getElementById('p-name').value.trim(),
      age:      parseInt(document.getElementById('p-age').value)    || null,
      weight:   parseFloat(document.getElementById('p-weight').value) || null,
      height:   parseFloat(document.getElementById('p-height').value) || null,
      gender:   document.getElementById('p-gender').value,
      activity: document.getElementById('p-activity').value,
      goal:     document.getElementById('p-goal').value,
    };

    const btn = document.querySelector('#tab-profile .btn-primary');
    btn.disabled = true;
    try {
      const data = await api('PUT', '/api/user/profile', body);
      user = { ...user, ...data };
      localStorage.setItem('ns_user', JSON.stringify(user));
      renderProfile(data);
      toast('Profile saved!', 'success');
    } catch (e) {
      toast('Failed to save: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // ─── PWA Install Prompt ────────────────────────────────────────

  // ═══════════════════════════════════════════════════════════════
  // FASTING
  // ═══════════════════════════════════════════════════════════════

  async function checkActiveFast() {
    try {
      const { session } = await api('GET', '/api/fasting/current');
      fastSession = session;
      if (session) startFastTick();
      else stopFastTick();
    } catch {}
  }

  async function loadFastingTab() {
    await checkActiveFast();
    renderFastArc();
    updateFastWidget();
    try {
      const { sessions, stats } = await api('GET', '/api/fasting/history?limit=15');
      renderFastStats(stats);
      renderFastHistory(sessions);
    } catch {}
  }

  function selectProtocol(btn) {
    document.querySelectorAll('.proto-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selFastHours    = parseInt(btn.dataset.hours) || 0;
    selFastProtocol = btn.dataset.proto;
    const customWrap = document.getElementById('custom-hours-wrap');
    if (selFastProtocol === 'custom') {
      customWrap.classList.remove('hidden');
      selFastHours = parseInt(document.getElementById('custom-hours-input').value) || 20;
    } else {
      customWrap.classList.add('hidden');
    }
    renderEatingWindow(selFastHours);
    renderFastArc();
  }

  function renderEatingWindow(hours) {
    const el = document.getElementById('fast-eating-window');
    if (!el) return;
    if (!hours) { el.textContent = ''; return; }
    const eatWindow = 24 - hours;
    const now = new Date();
    // Eating window = right now until hours from now
    const eatStart = new Date(now.getTime() + hours * 3600000);
    const eatEnd   = new Date(eatStart.getTime() + eatWindow * 3600000);
    const fmt = d => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    el.textContent = `Eating window: ${fmt(eatStart)} – ${fmt(eatEnd)} (${eatWindow}h)`;
  }

  async function toggleFast() {
    if (fastSession) {
      // End fast
      const feeling = document.getElementById('fast-feeling')?.value || 'good';
      const note    = document.getElementById('fast-note')?.value    || '';
      try {
        await api('POST', '/api/fasting/end', { feeling, note });
        fastSession = null;
        stopFastTick();
        toast('Fast completed! Great job.', 'success');
        sendNotification('Fast complete!', `You completed your ${selFastProtocol} fast. Time to eat!`);
        await loadFastingTab();
        renderFastArc();
        updateFastWidget();
      } catch (e) { toast(e.message, 'error'); }
    } else {
      // Start fast
      if (selFastProtocol === 'custom') {
        selFastHours = parseInt(document.getElementById('custom-hours-input')?.value) || 20;
      }
      try {
        const { session } = await api('POST', '/api/fasting/start', {
          target_hours: selFastHours,
          protocol: selFastProtocol
        });
        fastSession = session;
        startFastTick();
        scheduleEndNotification(selFastHours);
        toast(`${selFastProtocol} fast started!`, 'success');
        renderFastArc();
        updateFastWidget();
        document.getElementById('fast-protocol-wrap')?.classList.add('hidden');
        document.getElementById('fast-end-options')?.classList.remove('hidden');
      } catch (e) { toast(e.message, 'error'); }
    }
  }

  async function cancelFast() {
    try {
      await api('POST', '/api/fasting/cancel');
      fastSession = null;
      stopFastTick();
      cancelEndNotification();
      toast('Fast cancelled.');
      renderFastArc();
      updateFastWidget();
      document.getElementById('fast-protocol-wrap')?.classList.remove('hidden');
      document.getElementById('fast-end-options')?.classList.add('hidden');
      await loadFastingTab();
    } catch (e) { toast(e.message, 'error'); }
  }

  function startFastTick() {
    stopFastTick();
    renderFastArc();
    updateFastWidget();
    fastInterval = setInterval(() => {
      renderFastArc();
      updateFastWidget();
    }, 1000);
  }

  function stopFastTick() {
    clearInterval(fastInterval);
    fastInterval = null;
  }

  function getElapsedHours() {
    if (!fastSession) return 0;
    const started = new Date(fastSession.started_at.endsWith('Z')
      ? fastSession.started_at
      : fastSession.started_at + 'Z');
    return (Date.now() - started.getTime()) / 3600000;
  }

  function formatHMS(hours) {
    const totalSecs = Math.floor(hours * 3600);
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function renderFastArc() {
    const canvas = document.getElementById('fast-arc');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const r = 90, lw = 14;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Track
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = lw;
    ctx.lineCap = 'round'; ctx.stroke();

    const elapsed = getElapsedHours();
    const target  = fastSession ? fastSession.target_hours : selFastHours || 16;
    const pct     = fastSession ? Math.min(elapsed / target, 1) : 0;

    if (pct > 0) {
      const start = -Math.PI / 2;
      const color = pct >= 1 ? '#fbbf24' : '#4ade80';
      const grad  = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
      grad.addColorStop(0, color);
      grad.addColorStop(1, pct >= 1 ? '#f59e0b' : '#22c55e');
      ctx.beginPath(); ctx.arc(cx, cy, r, start, start + pct * Math.PI * 2);
      ctx.strokeStyle = grad; ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.shadowColor = color; ctx.shadowBlur = 18;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Center text
    const timeEl   = document.getElementById('fast-time-display');
    const statusEl = document.getElementById('fast-status-label');
    const pctEl    = document.getElementById('fast-progress-pct');
    const btn      = document.getElementById('fast-action-btn');

    if (fastSession) {
      if (timeEl)   timeEl.textContent   = formatHMS(elapsed);
      if (statusEl) statusEl.textContent = pct >= 1 ? 'Goal reached!' : 'Fasting';
      if (pctEl)    pctEl.textContent    = Math.floor(pct * 100) + '% of ' + fastSession.target_hours + 'h';
      if (btn) {
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> End Fast`;
        btn.style.background = pct >= 1 ? 'linear-gradient(135deg,#fbbf24,#f59e0b)' : '';
      }
      document.getElementById('fast-protocol-wrap')?.classList.add('hidden');
      document.getElementById('fast-end-options')?.classList.remove('hidden');
    } else {
      if (timeEl)   timeEl.textContent   = '00:00:00';
      if (statusEl) statusEl.textContent = 'Not fasting';
      if (pctEl)    pctEl.textContent    = '';
      if (btn) {
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Start Fast`;
        btn.style.background = '';
      }
      document.getElementById('fast-protocol-wrap')?.classList.remove('hidden');
      document.getElementById('fast-end-options')?.classList.add('hidden');
      renderEatingWindow(selFastHours);
    }
  }

  function updateFastWidget() {
    const titleEl = document.getElementById('dash-fast-title');
    const subEl   = document.getElementById('dash-fast-sub');
    const timerEl = document.getElementById('dash-fast-timer');
    const dotEl   = document.getElementById('dash-fast-dot') || document.querySelector('.fast-dot');

    if (!titleEl) return;
    if (fastSession) {
      const elapsed  = getElapsedHours();
      const pct      = Math.min(elapsed / fastSession.target_hours, 1);
      const remaining = Math.max(fastSession.target_hours - elapsed, 0);
      titleEl.textContent  = `${fastSession.protocol} fast in progress`;
      subEl.textContent    = remaining > 0
        ? `${formatHMS(remaining)} remaining`
        : 'Goal reached — tap to end';
      timerEl.textContent  = formatHMS(elapsed);

      const widget = document.getElementById('dash-fast-widget');
      if (widget) {
        const dot = widget.querySelector('.fast-dot');
        if (dot) { dot.className = 'fast-dot ' + (pct >= 1 ? 'done' : 'active'); }
      }
    } else {
      titleEl.textContent = 'Start a fast';
      subEl.textContent   = 'Tap to open fasting timer';
      timerEl.textContent = '—';
      const widget = document.getElementById('dash-fast-widget');
      if (widget) {
        const dot = widget.querySelector('.fast-dot');
        if (dot) dot.className = 'fast-dot idle';
      }
    }
  }

  function renderFastStats(stats) {
    const el = document.getElementById('fast-stats-row');
    if (!el) return;
    el.innerHTML = `
      <div class="stats-row-item"><span class="sri-val">${stats?.total || 0}</span><span class="sri-label">Total fasts</span></div>
      <div class="stats-row-item"><span class="sri-val">${stats?.avg_hours || 0}h</span><span class="sri-label">Average</span></div>
      <div class="stats-row-item"><span class="sri-val">${stats?.best_hours || 0}h</span><span class="sri-label">Best</span></div>`;
  }

  function renderFastHistory(sessions) {
    const el = document.getElementById('fast-history-list');
    if (!el) return;
    if (!sessions.length) {
      el.innerHTML = '<div class="empty-state" style="padding:24px 0"><span class="empty-icon">⏱</span><p>No completed fasts yet</p></div>';
      return;
    }
    el.innerHTML = sessions.map(s => {
      const date  = new Date(s.started_at + (s.started_at.endsWith('Z') ? '' : 'Z'));
      const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const icon  = s.status === 'completed' ? '✓' : '✕';
      const goal  = s.actual_hours ? (s.actual_hours >= s.target_hours ? '' : ` / ${s.target_hours}h goal`) : '';
      return `
        <div class="fast-history-item">
          <div class="fhi-icon">${s.status === 'completed' ? '✓' : '✕'}</div>
          <div class="fhi-info">
            <div class="fhi-title">${escHtml(s.protocol || s.target_hours + 'h')} fast</div>
            <div class="fhi-meta">${label}${s.feeling ? ' · felt ' + s.feeling : ''}${s.note ? ' · ' + escHtml(s.note) : ''}</div>
          </div>
          <div class="fhi-result">
            <span class="fhi-hours">${s.actual_hours ? s.actual_hours.toFixed(1) + 'h' : '—'}</span>
            <span class="fhi-badge ${s.status}">${s.status}</span>
          </div>
        </div>`;
    }).join('');
  }

  // ═══════════════════════════════════════════════════════════════
  // WEIGHT GOAL
  // ═══════════════════════════════════════════════════════════════

  async function loadWeightGoal() {
    try {
      const { goal, logs } = await api('GET', '/api/goals/weight');
      weightGoalData = { goal, logs };
      renderWeightGoal(goal, logs);
    } catch {}
  }

  function renderWeightGoal(goal, logs) {
    const noGoalEl  = document.getElementById('wg-no-goal');
    const progWrap  = document.getElementById('wg-progress-wrap');
    if (!noGoalEl || !progWrap) return;

    if (!goal) {
      noGoalEl.classList.remove('hidden');
      progWrap.classList.add('hidden');
      // Pre-fill date 3 months out
      const d = new Date(); d.setMonth(d.getMonth() + 3);
      const dateEl = document.getElementById('wg-date');
      if (dateEl) dateEl.value = d.toISOString().slice(0, 10);
      return;
    }

    noGoalEl.classList.add('hidden');
    progWrap.classList.remove('hidden');

    const currentWeight = logs[0]?.weight || goal.start_weight;
    const start  = goal.start_weight;
    const target = goal.target_weight;
    const range  = Math.abs(target - start) || 1;
    const delta  = start - currentWeight;          // positive = progress toward lower weight
    const needed = target - start;                 // negative = losing, positive = gaining
    const progress = needed !== 0 ? Math.min(Math.abs(delta) / Math.abs(range), 1) : 1;

    const bar   = document.getElementById('wg-bar');
    const thumb = document.getElementById('wg-thumb');
    if (bar)   bar.style.width = (progress * 100) + '%';
    if (thumb) thumb.style.left = (progress * 100) + '%';

    const daysLeft = Math.max(0, Math.ceil((new Date(goal.target_date) - new Date()) / 86400000));
    document.getElementById('wg-start-label').textContent   = start + ' kg';
    document.getElementById('wg-current-label').textContent = currentWeight.toFixed(1) + ' kg now';
    document.getElementById('wg-target-label').textContent  = target + ' kg';
    document.getElementById('wg-days-left').textContent     = daysLeft > 0
      ? `${daysLeft} days left · ${Math.abs(currentWeight - target).toFixed(1)} kg to go`
      : 'Target date passed';
  }

  async function setWeightGoal() {
    const target = parseFloat(document.getElementById('wg-target')?.value);
    const date   = document.getElementById('wg-date')?.value;
    if (!target || !date) return toast('Enter target weight and date.', 'error');
    try {
      await api('POST', '/api/goals/weight', { target_weight: target, target_date: date });
      toast('Weight goal set!', 'success');
      loadWeightGoal();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function logWeight() {
    const w = parseFloat(document.getElementById('wg-log-weight')?.value);
    if (!w || w < 20 || w > 400) return toast('Enter a valid weight.', 'error');
    try {
      await api('POST', '/api/goals/weight/log', { weight: w });
      document.getElementById('wg-log-weight').value = '';
      toast(`Weight ${w} kg logged!`, 'success');
      loadWeightGoal();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function getWeightAnalysis() {
    const btn = document.getElementById('wg-ai-btn');
    const el  = document.getElementById('wg-analysis-text');
    if (!el) return;
    if (btn) btn.disabled = true;
    el.textContent = 'Analyzing your progress…';
    el.classList.add('loading');
    try {
      const { analysis, message } = await api('GET', '/api/goals/weight/analysis');
      el.textContent = analysis || message;
      el.classList.remove('loading');
    } catch (e) {
      el.textContent = 'Could not load analysis.';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // AI INSIGHTS
  // ═══════════════════════════════════════════════════════════════

  async function loadInsight() {
    const el = document.getElementById('insight-text');
    if (!el) return;
    // Use cached if < 2h old
    const cacheKey = 'ns_insight_' + today();
    const cached   = localStorage.getItem(cacheKey);
    if (cached) {
      el.textContent = cached;
      insightCached  = cached;
      return;
    }
    el.textContent = 'Checking your progress…';
    el.classList.add('loading');
    try {
      const { insight } = await api('GET', '/api/insights/daily');
      el.textContent = insight;
      el.classList.remove('loading');
      insightCached = insight;
      localStorage.setItem(cacheKey, insight);
    } catch {
      el.textContent = 'Could not load insight – check your API key.';
      el.classList.remove('loading');
    }
  }

  async function refreshInsight() {
    const el  = document.getElementById('insight-text');
    const btn = document.getElementById('insight-refresh');
    if (!el) return;
    if (btn) { btn.disabled = true; btn.style.transform = 'rotate(360deg)'; }
    el.classList.add('loading');
    el.textContent = 'Refreshing…';
    localStorage.removeItem('ns_insight_' + today());
    try {
      const { insight } = await api('GET', '/api/insights/daily');
      el.textContent = insight;
      insightCached  = insight;
      localStorage.setItem('ns_insight_' + today(), insight);
    } catch {
      el.textContent = insightCached || 'Could not load insight.';
    } finally {
      el.classList.remove('loading');
      if (btn) { btn.disabled = false; btn.style.transform = ''; }
    }
  }

  // ─── MCP Key ─────────────────────────────────────────────────────────────
  async function loadMcpKey() {
    try {
      const data      = await api('GET', '/api/user/mcp-key');
      const display   = document.getElementById('mcp-key-display');
      const hint      = document.getElementById('mcp-key-hint');
      const revokeBtn = document.getElementById('mcp-revoke-btn');
      const genBtn    = document.getElementById('mcp-generate-btn');
      const urlRow = document.getElementById('mcp-url-row');
      if (data.key) {
        document.getElementById('mcp-key-value').textContent = data.key;
        display.classList.remove('hidden');
        revokeBtn.classList.remove('hidden');
        genBtn.textContent = 'Regenerate';
        hint.textContent   = '';
        document.getElementById('mcp-url-value').textContent = `${location.protocol}//${location.hostname}:3001/sse`;
        urlRow.classList.remove('hidden');
      } else {
        display.classList.add('hidden');
        revokeBtn.classList.add('hidden');
        genBtn.textContent = 'Generate key';
        hint.textContent   = 'No key yet.';
        urlRow.classList.add('hidden');
      }
    } catch (e) { console.error(e); }
  }

  async function generateMcpKey() {
    if (!confirm('Generate a new key? Any existing key will stop working immediately.')) return;
    try {
      const data = await api('POST', '/api/user/mcp-key');
      document.getElementById('mcp-key-value').textContent = data.key;
      document.getElementById('mcp-key-display').classList.remove('hidden');
      document.getElementById('mcp-revoke-btn').classList.remove('hidden');
      document.getElementById('mcp-generate-btn').textContent = 'Regenerate';
      document.getElementById('mcp-key-hint').textContent = "Copy this key now — it won't be shown again in full.";
      document.getElementById('mcp-url-value').textContent = `${location.protocol}//${location.hostname}:3001/sse`;
      document.getElementById('mcp-url-row').classList.remove('hidden');
    } catch (e) { toast('Failed to generate key', 'error'); }
  }

  async function revokeMcpKey() {
    if (!confirm('Revoke your MCP key? Any connected AI clients will immediately lose access.')) return;
    try {
      await api('DELETE', '/api/user/mcp-key');
      document.getElementById('mcp-key-display').classList.add('hidden');
      document.getElementById('mcp-revoke-btn').classList.add('hidden');
      document.getElementById('mcp-url-row').classList.add('hidden');
      document.getElementById('mcp-generate-btn').textContent = 'Generate key';
      document.getElementById('mcp-key-hint').textContent = 'Key revoked.';
    } catch (e) { toast('Failed to revoke key', 'error'); }
  }

  function copyMcpKey() {
    const key = document.getElementById('mcp-key-value').textContent;
    navigator.clipboard.writeText(key).then(() => toast('Key copied!', 'success'));
  }

  function copyMcpUrl() {
    const url = document.getElementById('mcp-url-value').textContent;
    navigator.clipboard.writeText(url).then(() => toast('URL copied!', 'success'));
  }

  // ═══════════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════

  let fastEndTimeoutId = null;

  function requestNotificationsIfGranted() {
    if (Notification.permission === 'granted') {
      updateNotifIcon(true);
      scheduleReminders();
    }
  }

  async function requestNotifications() {
    if (!('Notification' in window)) return toast('Notifications not supported on this browser.');
    if (Notification.permission === 'granted') {
      updateNotifIcon(true);
      toast('Reminders already enabled!', 'success');
      scheduleReminders();
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      updateNotifIcon(true);
      toast('Reminders enabled!', 'success');
      scheduleReminders();
      sendNotification('NutriSnap reminders on', 'You\'ll get daily meal and fasting reminders.');
    } else {
      toast('Notifications blocked. Enable in browser settings.', 'error');
    }
  }

  function updateNotifIcon(granted) {
    const btn = document.getElementById('notif-btn');
    if (btn) btn.classList.toggle('notif-granted', granted);
  }

  function sendNotification(title, body) {
    if (Notification.permission !== 'granted') return;
    new Notification(title, {
      body,
      icon: '/icons/icon-192.svg',
      badge: '/icons/icon-192.svg',
      tag: 'nutrisnap'
    });
  }

  function scheduleEndNotification(hours) {
    cancelEndNotification();
    if (Notification.permission !== 'granted') return;
    const ms = hours * 3600 * 1000;
    fastEndTimeoutId = setTimeout(() => {
      sendNotification('Fasting goal reached!', `You've completed your ${hours}h fast! Time to break your fast.`);
    }, ms);
  }

  function cancelEndNotification() {
    clearTimeout(fastEndTimeoutId);
    fastEndTimeoutId = null;
  }

  function scheduleReminders() {
    if (Notification.permission !== 'granted') return;
    // Daily 12pm reminder if no meals logged today
    const now   = new Date();
    const noon  = new Date(now); noon.setHours(12, 0, 0, 0);
    const eve   = new Date(now); eve.setHours(19, 30, 0, 0);
    const reminders = [noon, eve].map(t => {
      const ms = t - now;
      if (ms > 0) {
        return setTimeout(async () => {
          try {
            const { totals } = await api('GET', `/api/food/logs?date=${today()}`);
            if ((totals.calories || 0) < 200) {
              sendNotification('Don\'t forget to log your meals!', 'Tap to open NutriSnap and track your nutrition.');
            }
          } catch {}
        }, ms);
      }
    });
  }

  // ─── PWA Install Prompt ────────────────────────────────────────

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstall = e;
    // Show banner after 3s if not already installed
    if (!window.matchMedia('(display-mode: standalone)').matches) {
      setTimeout(showInstallBanner, 3000);
    }
  });

  function showInstallBanner() {
    if (!deferredInstall || document.getElementById('install-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'install-banner';
    banner.className = 'install-banner';
    banner.innerHTML = `
      <span>📲 <strong>Install NutriSnap</strong> for the best experience</span>
      <button class="btn-primary" onclick="App.installPWA()">Install</button>
      <button class="icon-btn" onclick="document.getElementById('install-banner').remove()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>`;
    document.body.appendChild(banner);
  }

  async function installPWA() {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    if (outcome === 'accepted') {
      deferredInstall = null;
      document.getElementById('install-banner')?.remove();
    }
  }

  // ─── Service Worker ────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(console.error);
    });
  }

  // ─── Utils ─────────────────────────────────────────────────────
  function dataURItoBlob(uri) {
    const [meta, b64] = uri.split(',');
    const mime  = meta.match(/:(.*?);/)[1];
    const bytes = atob(b64);
    const ab    = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) ab[i] = bytes.charCodeAt(i);
    return new Blob([ab], { type: mime });
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

  function mealEmoji(type) {
    return { breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🍎' }[type] || '🍽️';
  }

  // ─── Entry Point ───────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', () => {
    if (token && user) {
      initApp();
    } else {
      document.getElementById('auth-screen').classList.add('active');
      // Handle PWA shortcut URL
      const tab = new URLSearchParams(location.search).get('tab');
      if (tab) history.replaceState(null, '', '/');
    }
  });

  // Public API
  return {
    login, register, logout,
    showLogin, showRegister,
    switchTab,
    openCamera, capturePhoto, retakePhoto, handleFileUpload,
    analyzeFood, logFood, deleteLog,
    loadCharts, saveProfile,
    installPWA,
    // Fasting
    toggleFast, cancelFast, selectProtocol,
    // Weight goal
    setWeightGoal, logWeight, getWeightAnalysis,
    // Insights
    refreshInsight,
    // Notifications
    requestNotifications,
    // MCP key
    loadMcpKey, generateMcpKey, revokeMcpKey, copyMcpKey, copyMcpUrl
  };

})();
