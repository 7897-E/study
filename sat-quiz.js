// ── SAT Quiz App ───────────────────────────────────────────
const SAT_APP = {
  questions: [],
  answers: [],
  revealed: [],
  explanationViewed: [],
  bookmarked: [],
  currentIndex: 0,
  pdfLoaded: false,
  pdfName: '',
  reviewFilter: 'all',
  settings: {
    antiClickThrough: false,
    antiClickSensitivity: 'standard',
    autoContinueOnCorrect: false,
    autoContinueDelayMs: 500,
    theme: 'dark',
    dyslexiaFont: false,
    shortcuts: {
      answer1: '1',
      answer2: '2',
      answer3: '3',
      answer4: '4',
      prev: 'arrowleft',
      next: 'arrowright'
    }
  },
  questionStartTimes: [],
  rapidClickStreak: 0,
  rapidClickAnchorIndex: null,
  capturingShortcutField: null,
  momentum: {
    correctStreak: 0,
    accuracyStreak: 0,
    noRushStreak: 0,
    badges: []
  },
  trendHistory: [],
  twoPass: {
    enabled: false,
    phase: 1,
    queue: [],
    pointer: 0
  },
  undoState: {
    timer: null,
    questionIndex: -1,
    previousAnswer: -1,
    expiresAt: 0
  },

  init() {
    this.loadState();
    this.applyAppearanceSettings();
    this.setupDragDrop();
    this.setupSidebarToggle();
    this.setupKeyboardShortcuts();
    if (this.questions.length > 0) {
      this.renderQuestionList();
      this.showQuestion(0);
      this.importScreen(false);
      this.questionScreen(true);
    }
    this.updateUI();
  },

  toast(message, type) {
    type = type || 'info';
    document.querySelectorAll('.sat-toast').forEach(t => t.remove());
    const toast = document.createElement('div');
    toast.className = 'sat-toast sat-toast-' + type;
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:12px;font-size:0.9em;z-index:500;background:var(--bg-secondary);border:1px solid var(--border);color:var(--text-primary);max-width:90vw;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.5);animation:fadeSlideIn 0.25s ease;font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif;line-height:1.4';
    if (type === 'error') { toast.style.borderColor = 'var(--error)'; toast.style.background = 'rgba(233,91,118,0.15)'; }
    else if (type === 'success') { toast.style.borderColor = 'var(--success)'; toast.style.background = 'rgba(76,175,80,0.15)'; }
    else if (type === 'warning') { toast.style.borderColor = 'var(--warning)'; toast.style.background = 'rgba(255,152,0,0.15)'; }
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s ease'; setTimeout(() => toast.remove(), 300); }, 4000);
  },

  showConfirm(title, message, onConfirm) {
    document.querySelector('.sat-confirm-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'sat-confirm-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:400;display:flex;align-items:center;justify-content:center;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--bg-secondary);border:1px solid var(--border);border-radius:12px;padding:30px;width:400px;max-width:90vw;box-shadow:0 16px 40px rgba(0,0,0,0.4);';
    const h2 = document.createElement('h2'); h2.textContent = title; h2.style.cssText = 'margin-bottom:12px;color:var(--accent);font-size:1.1em;';
    modal.appendChild(h2);
    const p = document.createElement('p'); p.textContent = message; p.style.cssText = 'font-size:0.9em;color:var(--text-secondary);line-height:1.5;margin-bottom:20px;';
    modal.appendChild(p);
    const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
    const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn'; cancelBtn.textContent = 'Cancel'; cancelBtn.onclick = () => overlay.remove();
    actions.appendChild(cancelBtn);
    const okBtn = document.createElement('button'); okBtn.className = 'btn'; okBtn.style.cssText += 'background:linear-gradient(180deg,var(--accent),#6b49ff);border-color:var(--accent);'; okBtn.textContent = 'Confirm'; okBtn.onclick = () => { overlay.remove(); onConfirm(); };
    actions.appendChild(okBtn);
    modal.appendChild(actions); overlay.appendChild(modal); document.body.appendChild(overlay);
  },

  saveState() {
    try { localStorage.setItem('sat_quiz_state', JSON.stringify({ questions: this.questions, answers: this.answers, revealed: this.revealed, explanationViewed: this.explanationViewed, bookmarked: this.bookmarked, currentIndex: this.currentIndex, pdfLoaded: this.pdfLoaded, pdfName: this.pdfName, settings: this.settings, momentum: this.momentum, trendHistory: this.trendHistory })); } catch(e) {}
  },
  loadState() {
    try { const raw = localStorage.getItem('sat_quiz_state'); if (raw) { const d = JSON.parse(raw); this.questions = d.questions || []; this.answers = d.answers || []; this.revealed = d.revealed || []; this.explanationViewed = d.explanationViewed || []; this.bookmarked = d.bookmarked || []; this.currentIndex = d.currentIndex || 0; this.pdfLoaded = d.pdfLoaded || false; this.pdfName = d.pdfName || ''; this.settings = Object.assign({ antiClickThrough: false, antiClickSensitivity: 'standard', autoContinueOnCorrect: false, autoContinueDelayMs: 500, theme: 'dark', dyslexiaFont: false, shortcuts: { answer1: '1', answer2: '2', answer3: '3', answer4: '4', prev: 'arrowleft', next: 'arrowright' } }, d.settings || {}); this.settings.shortcuts = Object.assign({ answer1: '1', answer2: '2', answer3: '3', answer4: '4', prev: 'arrowleft', next: 'arrowright' }, (d.settings && d.settings.shortcuts) || {}); this.momentum = Object.assign({ correctStreak: 0, accuracyStreak: 0, noRushStreak: 0, badges: [] }, d.momentum || {}); this.trendHistory = Array.isArray(d.trendHistory) ? d.trendHistory : []; } } catch(e) {}
  },
  clearState() { localStorage.removeItem('sat_quiz_state'); this.questions = []; this.answers = []; this.revealed = []; this.explanationViewed = []; this.bookmarked = []; this.currentIndex = 0; this.pdfLoaded = false; this.pdfName = ''; this.resetMomentum(); },
  resetMomentum() {
    this.momentum = { correctStreak: 0, accuracyStreak: 0, noRushStreak: 0, badges: [] };
    this.updateMomentumUI();
  },
  updateMomentum(answerWasCorrect, answeredWithoutRush) {
    if (answerWasCorrect) {
      this.momentum.correctStreak += 1;
      this.momentum.accuracyStreak += 1;
    } else {
      this.momentum.correctStreak = 0;
      this.momentum.accuracyStreak = 0;
    }

    if (answeredWithoutRush) this.momentum.noRushStreak += 1;
    else this.momentum.noRushStreak = 0;

    const badges = [];
    if (this.momentum.correctStreak >= 3) badges.push('🔥 On Fire');
    this.momentum.badges = badges;

    this.updateMomentumUI();
  },
  updateMomentumUI() {
    const cs = document.getElementById('correctStreakValue');
    const as = document.getElementById('accuracyStreakValue');
    const ns = document.getElementById('noRushStreakValue');
    const badgesEl = document.getElementById('momentumBadges');
    if (cs) cs.textContent = String(this.momentum.correctStreak || 0);
    if (as) as.textContent = String(this.momentum.accuracyStreak || 0);
    if (ns) ns.textContent = String(this.momentum.noRushStreak || 0);
    if (badgesEl) {
      badgesEl.innerHTML = '';
      (this.momentum.badges || []).forEach(b => {
        const pill = document.createElement('span');
        pill.className = 'badge-pill';
        pill.textContent = b;
        badgesEl.appendChild(pill);
      });
    }
  },

  importScreen(show) { document.getElementById('importScreen').style.display = show ? 'flex' : 'none'; },
  questionScreen(show) { document.getElementById('questionScreen').classList.toggle('active', show); },
  reviewScreen(show) { document.getElementById('reviewScreen').classList.toggle('active', show); },
  showLoading(text) { document.getElementById('loadingText').textContent = text || 'Processing...'; document.getElementById('loadingOverlay').classList.add('show'); },
  hideLoading() { document.getElementById('loadingOverlay').classList.remove('show'); },
  openSettings() {
    const overlay = document.getElementById('settingsOverlay');
    if (!overlay) return;
    const toggle = document.getElementById('antiClickToggle');
    if (toggle) toggle.checked = !!this.settings.antiClickThrough;
    const sensitivity = document.getElementById('antiClickSensitivity');
    if (sensitivity) sensitivity.value = this.settings.antiClickSensitivity || 'standard';
    const autoContinue = document.getElementById('autoContinueToggle');
    if (autoContinue) autoContinue.checked = !!this.settings.autoContinueOnCorrect;
    const autoContinueDelay = document.getElementById('autoContinueDelay');
    if (autoContinueDelay) autoContinueDelay.value = String(this.settings.autoContinueDelayMs || 500);
    const autoContinueDelayValue = document.getElementById('autoContinueDelayValue');
    if (autoContinueDelayValue) autoContinueDelayValue.textContent = (this.settings.autoContinueDelayMs || 500) + ' ms';
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) themeSelect.value = this.settings.theme || 'dark';
    const dyslexiaFontToggle = document.getElementById('dyslexiaFontToggle');
    if (dyslexiaFontToggle) dyslexiaFontToggle.checked = !!this.settings.dyslexiaFont;
    overlay.style.display = 'flex';
  },
  closeSettings() {
    const overlay = document.getElementById('settingsOverlay');
    if (overlay) overlay.style.display = 'none';
  },
  openShortcutsModal() {
    const overlay = document.getElementById('shortcutsOverlay');
    if (!overlay) return;
    const s = this.settings.shortcuts || {};
    const map = {
      scAnswer1: s.answer1,
      scAnswer2: s.answer2,
      scAnswer3: s.answer3,
      scAnswer4: s.answer4,
      scPrev: s.prev,
      scNext: s.next
    };
    Object.entries(map).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.value = this.comboToDisplay(val || '');
    });
    overlay.style.display = 'flex';
  },
  closeShortcutsModal() {
    const overlay = document.getElementById('shortcutsOverlay');
    if (overlay) overlay.style.display = 'none';
  },
  clearShortcutField(fieldId) {
    const input = document.getElementById(fieldId);
    if (input) input.value = '';
  },
  resetShortcutsToDefaults() {
    const defaults = {
      scAnswer1: '1',
      scAnswer2: '2',
      scAnswer3: '3',
      scAnswer4: '4',
      scPrev: 'ARROWLEFT',
      scNext: 'ARROWRIGHT'
    };
    Object.entries(defaults).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    });
    this.toast('Shortcut fields reset to defaults. Click Save to apply.', 'info');
  },
  saveShortcutsFromModal() {
    const readKey = (id, fallback) => {
      const raw = (document.getElementById(id)?.value || '').trim();
      if (!raw) return fallback;
      return this.normalizeComboString(raw) || fallback;
    };
    const nextShortcuts = {
      answer1: readKey('scAnswer1', '1'),
      answer2: readKey('scAnswer2', '2'),
      answer3: readKey('scAnswer3', '3'),
      answer4: readKey('scAnswer4', '4'),
      prev: readKey('scPrev', 'arrowleft'),
      next: readKey('scNext', 'arrowright')
    };

    const entries = Object.entries(nextShortcuts);
    const seen = new Map();
    for (const [action, combo] of entries) {
      const key = this.normalizeComboString(combo);
      if (!key) continue;
      if (seen.has(key)) {
        const first = seen.get(key);
        this.toast('Duplicate shortcut detected between "' + first + '" and "' + action + '". Please make each shortcut unique.', 'error');
        return;
      }
      seen.set(key, action);
    }

    this.settings.shortcuts = nextShortcuts;
    this.saveState();
    this.closeShortcutsModal();
    this.toast('Keyboard shortcuts updated.', 'success');
  },
  startShortcutCapture(fieldId) {
    const input = document.getElementById(fieldId);
    if (!input) return;
    this.capturingShortcutField = fieldId;
    input.value = 'Press keys now...';
    input.focus();
  },
  captureShortcutKeydown(event, fieldId) {
    if (this.capturingShortcutField !== fieldId) return;
    event.preventDefault();
    event.stopPropagation();

    const combo = this.keyEventToCombo(event);
    if (!combo) return;

    if (this.isDuplicateShortcutForField(combo, fieldId)) {
      this.toast('That shortcut is already used by another action. Pick a different one.', 'error');
      const input = document.getElementById(fieldId);
      if (input) {
        input.value = 'Press keys now...';
        setTimeout(() => {
          input.focus();
        }, 0);
      }
      return;
    }

    const input = document.getElementById(fieldId);
    if (input) input.value = this.comboToDisplay(combo);
    this.capturingShortcutField = null;
  },
  isDuplicateShortcutForField(combo, targetFieldId) {
    const normalizedCombo = this.normalizeComboString(combo);
    if (!normalizedCombo) return false;

    const fieldIds = ['scAnswer1', 'scAnswer2', 'scAnswer3', 'scAnswer4', 'scPrev', 'scNext'];
    for (const fieldId of fieldIds) {
      if (fieldId === targetFieldId) continue;
      const val = document.getElementById(fieldId)?.value || '';
      const normalizedVal = this.normalizeComboString(val);
      if (normalizedVal && normalizedVal === normalizedCombo) {
        return true;
      }
    }
    return false;
  },
  normalizeComboString(raw) {
    if (!raw) return '';
    let s = String(raw).toLowerCase().trim();
    s = s.replace(/\s*\+\s*/g, '+');
    s = s.replace(/^left$/, 'arrowleft').replace(/^right$/, 'arrowright').replace(/^up$/, 'arrowup').replace(/^down$/, 'arrowdown');
    return s;
  },
  comboToDisplay(combo) {
    return (combo || '').replace(/\+/g, ' + ').toUpperCase();
  },
  keyEventToCombo(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    if (e.metaKey) parts.push('meta');

    const k = (e.key || '').toLowerCase();
    if (k && !['control', 'shift', 'alt', 'meta'].includes(k)) {
      parts.push(k);
    }

    if (parts.length === 0) return '';
    return this.normalizeComboString(parts.join('+'));
  },
  toggleAntiClick(enabled) {
    this.settings.antiClickThrough = !!enabled;
    this.saveState();
    this.toast(enabled ? 'Anti Click-Through enabled.' : 'Anti Click-Through disabled.', 'info');
  },
  setAntiClickSensitivity(value) {
    const allowed = ['relaxed', 'standard', 'strict'];
    this.settings.antiClickSensitivity = allowed.includes(value) ? value : 'standard';
    this.saveState();
    this.toast('Sensitivity set to ' + this.settings.antiClickSensitivity + '.', 'info');
  },
  toggleAutoContinue(enabled) {
    this.settings.autoContinueOnCorrect = !!enabled;
    this.saveState();
    this.toast(enabled ? 'Auto-continue on correct answer enabled.' : 'Auto-continue on correct answer disabled.', 'info');
  },
  setAutoContinueDelay(value) {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? Math.max(0, Math.min(3000, Math.round(parsed))) : 500;
    this.settings.autoContinueDelayMs = safe;
    const autoContinueDelayValue = document.getElementById('autoContinueDelayValue');
    if (autoContinueDelayValue) autoContinueDelayValue.textContent = safe + ' ms';
    this.saveState();
  },
  setTheme(theme) {
    const allowed = ['dark', 'light'];
    this.settings.theme = allowed.includes(theme) ? theme : 'dark';
    this.applyAppearanceSettings();
    this.saveState();
  },
  toggleDyslexiaFont(enabled) {
    this.settings.dyslexiaFont = !!enabled;
    this.applyAppearanceSettings();
    this.saveState();
  },
  applyAppearanceSettings() {
    const theme = this.settings.theme || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    document.body.classList.toggle('dyslexia-friendly', !!this.settings.dyslexiaFont);
  },
  getAntiClickConfig() {
    const mode = this.settings.antiClickSensitivity || 'standard';
    if (mode === 'relaxed') return { rapidThresholdMs: 1800, streakThreshold: 5 };
    if (mode === 'strict') return { rapidThresholdMs: 3500, streakThreshold: 3 };
    return { rapidThresholdMs: 2500, streakThreshold: 4 };
  },

  importNew() { document.getElementById('fileInput').click(); },
  handleFile(event) { const file = event.target.files[0]; if (!file) return; this.processPDF(file); event.target.value = ''; },

  setupDragDrop() {
    const zone = document.getElementById('importZone');
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => { zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drag-over'); const files = e.dataTransfer.files; if (files.length > 0 && files[0].type === 'application/pdf') { this.processPDF(files[0]); } else { this.toast('Please drop a PDF file.', 'error'); } });
  },

  setupSidebarToggle() { document.getElementById('toggleSidebarBtn').addEventListener('click', () => { document.getElementById('sidebar').classList.toggle('collapsed'); }); },

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      const isTypingTarget = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable);
      if (isTypingTarget) return;

      const isQuestionMode = document.getElementById('questionScreen')?.classList.contains('active');
      const settingsOpen = document.getElementById('settingsOverlay')?.style.display !== 'none';
      const shortcutsOpen = document.getElementById('shortcutsOverlay')?.style.display !== 'none';
      if (!isQuestionMode || settingsOpen || shortcutsOpen) return;

      const key = (e.key || '').toLowerCase();
      const combo = this.keyEventToCombo(e);
      const s = this.settings.shortcuts || {};
      const keyToOption = {
        [this.normalizeComboString(s.answer1 || '1')]: 0,
        [this.normalizeComboString(s.answer2 || '2')]: 1,
        [this.normalizeComboString(s.answer3 || '3')]: 2,
        [this.normalizeComboString(s.answer4 || '4')]: 3,
        'a': 0, 'b': 1, 'c': 2, 'd': 3
      };

      const prevKey = this.normalizeComboString(s.prev || 'arrowleft');
      const nextKey = this.normalizeComboString(s.next || 'arrowright');
      if (combo === prevKey || key === prevKey) { e.preventDefault(); this.prevQuestion(); return; }
      if (combo === nextKey || key === nextKey) { e.preventDefault(); this.nextQuestion(); return; }

      const answerIndex = (combo in keyToOption) ? keyToOption[combo] : keyToOption[key];
      if (answerIndex === undefined) return;

      const q = this.questions[this.currentIndex];
      if (!q) return;
      if (this.answers[this.currentIndex] !== -1) return;

      const optIndex = answerIndex;
      if (optIndex < 0 || optIndex >= q.options.length) return;

      e.preventDefault();
      this.selectAnswer(this.currentIndex, optIndex);
    });
  },

  pasteFromClipboard() {
    const textarea = document.createElement('textarea'); textarea.style.cssText = 'position:fixed;top:-100px;left:-100px;width:1px;height:1px;opacity:0;';
    document.body.appendChild(textarea); textarea.focus(); document.execCommand('paste');
    setTimeout(() => { const text = textarea.value; document.body.removeChild(textarea); if (!text || text.length < 50) { this.toast('Clipboard is empty. Copy text first, then click Paste.', 'warning'); return; } this.processText(text, 'Pasted Text'); }, 100);
  },

  processText(text, name) {
    this.showLoading('Processing text...');
    setTimeout(() => {
      const questions = this.parseQuestions(text);
      if (questions.length === 0) { this.hideLoading(); console.warn('Parse failed:', text.substring(0, 2000)); this.toast('Could not parse. Check console (F12).', 'error'); return; }
      this.questions = questions; this.answers = new Array(questions.length).fill(-1); this.revealed = new Array(questions.length).fill(false); this.explanationViewed = new Array(questions.length).fill(false); this.bookmarked = new Array(questions.length).fill(false); this.currentIndex = 0; this.pdfLoaded = true; this.pdfName = name || 'Text Paste';
      this.saveState(); this.renderQuestionList(); this.showQuestion(0); this.importScreen(false); this.questionScreen(true); this.reviewScreen(false); this.updateUI(); this.hideLoading(); this.toast('Loaded ' + questions.length + ' questions!', 'success');
      this.resetMomentum();
    }, 50);
  },

  // Build line text using actual PDF item widths for accurate gap detection
  buildLineText(items) {
    if (items.length === 0) return '';
    items.sort((a, b) => a.x - b.x);
    let result = '';
    let prevEnd = null;
    for (const item of items) {
      const str = item.str;
      const x = item.x || 0;
      // Use the item's built-in width from pdf.js for accurate character sizing
      const w = item.width || (str.length * 7);
      if (prevEnd !== null && x > 0) {
        const gap = x - prevEnd;
        // Keep tiny PDF glyph gaps inside words, but preserve real word boundaries.
        // A slightly higher threshold reduces random splits like "par ticular".
        if (gap > 6) {
          result += ' ';
        }
      }
      result += str;
      prevEnd = x + w;
    }
    return result;
  },

  async processPDF(file) {
    this.showLoading('Parsing PDF...');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();

        // Group items by Y position, keeping all item data (including width)
        const Y_TOL = 4;
        const lineMap = {};
        for (const item of content.items) {
          const y = Math.round(item.transform[5] / Y_TOL) * Y_TOL;
          if (!lineMap[y]) lineMap[y] = [];
          // Store the full item with its x, width, and str from pdf.js
          lineMap[y].push({
            x: item.transform[4],
            width: item.width || 0,
            str: item.str || ''
          });
        }

        // PDF.js Y=0 is bottom, Y increases upward. Sort descending for top-to-bottom reading order.
        const yKeys = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
        for (const y of yKeys) {
          const lineStr = this.buildLineText(lineMap[y]);
          if (lineStr.trim()) fullText += lineStr + '\n';
        }
        fullText += '\n';
      }

      console.log('[SAT Quiz] Extracted text (first 2000):');
      console.log(fullText.substring(0, 2000));

      const questions = this.parseQuestions(fullText);
      if (questions.length === 0) {
        this.hideLoading();
        console.warn('[SAT Quiz] No questions found. Full text:', fullText.substring(0, 5000));
        this.toast('Could not extract questions. See console (F12) for details.', 'error');
        return;
      }
      this.questions = questions; this.answers = new Array(questions.length).fill(-1); this.revealed = new Array(questions.length).fill(false); this.explanationViewed = new Array(questions.length).fill(false); this.bookmarked = new Array(questions.length).fill(false);
      this.currentIndex = 0; this.pdfLoaded = true; this.pdfName = file.name;
      this.saveState(); this.renderQuestionList(); this.showQuestion(0);
      this.importScreen(false); this.questionScreen(true); this.reviewScreen(false); this.updateUI();
      this.hideLoading(); this.toast('Loaded ' + questions.length + ' questions!', 'success');
      this.resetMomentum();
    } catch (e) {
      this.hideLoading();
      console.error('[SAT Quiz] Error:', e);
      this.toast('Error: ' + e.message + '. Try "Paste Text".', 'error');
    }
  },

  parseQuestions(text) {
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let q = this.parseQuestionIDFormat(text);
    q = this.normalizeQuestionSetText(q);
    if (q.length > 0) return q;
    q = this.parseNumberedFormat(text);
    q = this.normalizeQuestionSetText(q);
    return q;
  },

  normalizeQuestionSetText(questions) {
    if (!Array.isArray(questions) || questions.length === 0) return questions || [];
    return questions.map(q => ({
      ...q,
      text: this.normalizeBrokenWordSpacing(q.text || ''),
      options: Array.isArray(q.options)
        ? q.options.map(opt => this.normalizeBrokenWordSpacing(opt || ''))
        : q.options,
      explanation: this.normalizeBrokenWordSpacing(q.explanation || '')
    }));
  },

  normalizeBrokenWordSpacing(text) {
    if (!text) return '';

    // Normalize repeated spaces/tabs while keeping line breaks.
    // We intentionally avoid aggressive word-joining here because it can
    // accidentally merge valid words (e.g., "the market" -> "themarket").
    const out = text
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .trim();

    return out;
  },

  parseQuestionIDFormat(text) {
    const questions = [];
    let norm = text;
    norm = norm.replace(/Question\s*\n\s*ID\s*\n\s*:/g, 'Question ID:');
    norm = norm.replace(/Question\s*\n\s*ID:/g, 'Question ID:');
    norm = norm.replace(/Q\s+u\s+e\s+s\s+t\s+i\s+o\s+n\s+I\s+D\s*:/gi, 'Question ID:');
    const rawBlocks = norm.split(/(?=Question ID:)/g);
    for (let bi = 0; bi < rawBlocks.length; bi++) {
      const block = rawBlocks[bi].trim();
      if (!block || block.length < 30 || !/\bQuestion\b/i.test(block) || !/\bAnswer\b/i.test(block)) continue;
      const idMatch = block.match(/Question\s*ID:\s*([a-f0-9]+)/i);
      const qid = idMatch ? idMatch[1] : '';
      let domain = '', skill = '', difficulty = '';
      const metaSection = block.match(/AssessmentTestDomainSkillDifficulty\s*\n([\s\S]*?)(?=\nQuestion\b)/);
      if (metaSection) {
        const metaText = metaSection[1].replace(/\s+/g, ' ').trim();
        const parsed = this.parseMetaData(metaText);
        domain = parsed.domain; skill = parsed.skill; difficulty = parsed.difficulty;
      }
      const qMatch = block.match(/(?:^|\n)Question\s*\n([\s\S]*?)(?=\n\s*Answer\s*\n)/m);
      if (!qMatch) continue;
      let questionText = qMatch[1].trim();
      const optionsSection = block.match(/(?:^|\n)Answer\s*\n([\s\S]*?)(?=\n\s*Correct\s+Answer\s*:|\n\s*Rationale\s*\n|$)/);
      if (!optionsSection) continue;
      const optionsText = optionsSection[1].trim();
      const optionLetters = [], options = [];
      const optLines = optionsText.split('\n');
      for (const line of optLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const optMatch = trimmed.match(/^([A-D])\s*[.)\s]\s*(.*)/);
        if (optMatch) { optionLetters.push(optMatch[1]); options.push(optMatch[2].trim()); }
      }
      if (options.length === 0) continue;
      const correctMatch = block.match(/Correct\s+Answer\s*:\s*([A-D])/i);
      let correctAnswer = '', correctIdx = -1;
      if (correctMatch) { correctAnswer = correctMatch[1].toUpperCase(); correctIdx = optionLetters.indexOf(correctAnswer); }
      const expMatch = block.match(/(?:^|\n)Rationale\s*\n([\s\S]*?)$/);
      let explanation = '';
      if (expMatch) { explanation = expMatch[1].trim().replace(/\nQuestion\s*ID:.*$/g, '').trim(); }
      questions.push({ num: questions.length + 1, id: qid, text: questionText, options, optionLetters, correctIdx, correctAnswer, explanation, domain, skill, difficulty });
    }
    return questions;
  },

  parseMetaData(meta) {
    const result = { domain: '', skill: '', difficulty: '' };
    if (!meta) return result;
    for (const d of ['Easy', 'Medium', 'Hard']) { if (meta.indexOf(d) >= 0) { result.difficulty = d; meta = meta.replace(d, ''); break; } }
    meta = meta.replace(/^SAT/, '').trim();
    if (meta.indexOf('Reading') >= 0) { result.domain = 'Reading and Writing'; meta = meta.replace(/Reading and Writing/, '').trim(); }
    else if (meta.indexOf('Math') >= 0) { result.domain = 'Math'; meta = meta.replace(/Math/, '').trim(); }
    if (meta) result.skill = meta.trim();
    return result;
  },

  parseNumberedFormat(text) {
    const questions = [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    let blocks = [], currentBlock = [];
    for (const line of lines) {
      if (/^Answer\s*Key/i.test(line) || /^Explanations/i.test(line) || /^Rationale/i.test(line)) { if (currentBlock.length > 0) { blocks.push(currentBlock.join('\n')); currentBlock = []; } continue; }
      if (/^\d+\s*[.)]\s/.test(line)) { if (currentBlock.length > 0) blocks.push(currentBlock.join('\n')); currentBlock = [line]; }
      else if (currentBlock.length > 0 && line.length > 0) { currentBlock.push(line); }
    }
    if (currentBlock.length > 0) blocks.push(currentBlock.join('\n'));
    for (const block of blocks) { const p = this.parseNumberedQuestion(block); if (p) { p.num = questions.length + 1; questions.push(p); } }
    return questions;
  },

  parseNumberedQuestion(block) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 3) return null;
    const firstLine = lines[0];
    const numMatch = firstLine.match(/^(\d+)\s*[.)]\s*/);
    if (!numMatch) return null;
    const optionLetters = [], options = [], questionLines = [];
    let inOptions = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const optMatch = line.match(/^([A-D])\s*[.)]\s*/);
      if (optMatch) { inOptions = true; optionLetters.push(optMatch[1]); options.push(line.replace(/^[A-D]\s*[.)]\s*/, '').trim()); }
      else if (!inOptions) { questionLines.push(line); }
    }
    if (options.length < 2) return null;
    const questionText = questionLines.join(' ').replace(/^\d+\s*[.)]\s*/, '').trim();
    let correctAnswer = '', correctIdx = -1;
    for (const line of lines) { const m = line.match(/Correct\s+Answer\s*:\s*([A-D])/i); if (m) { correctAnswer = m[1].toUpperCase(); correctIdx = optionLetters.indexOf(correctAnswer); break; } const m2 = line.match(/^Answer\s*:\s*([A-D])/i); if (m2 && line.length < 25) { correctAnswer = m2[1].toUpperCase(); correctIdx = optionLetters.indexOf(correctAnswer); break; } }
    let explanation = ''; const expMatch = block.match(/(?:Explanation|Rationale)\s*:?\s*\n?([\s\S]*?)$/i); if (expMatch) explanation = expMatch[1].trim();
    return { text: questionText, options, optionLetters, correctIdx, correctAnswer, explanation, domain: '', skill: '', difficulty: '' };
  },

  loadSample() {
    this.questions = SAT_SAMPLE_QUESTIONS; this.answers = new Array(this.questions.length).fill(-1); this.revealed = new Array(this.questions.length).fill(false); this.explanationViewed = new Array(this.questions.length).fill(false); this.bookmarked = new Array(this.questions.length).fill(false); this.currentIndex = 0; this.pdfLoaded = true; this.pdfName = 'Sample Questions';
    this.resetMomentum(); this.saveState(); this.renderQuestionList(); this.showQuestion(0); this.importScreen(false); this.questionScreen(true); this.reviewScreen(false); this.updateUI(); this.toast('Loaded ' + this.questions.length + ' sample questions!', 'success');
  },

  goToQuestion(index) {
    if (index < 0 || index >= this.questions.length) return;
    this.currentIndex = index;
    // If user clicks from question bank while on review screen,
    // switch back into question mode automatically.
    this.reviewScreen(false);
    this.importScreen(false);
    this.questionScreen(true);
    this.showQuestion(index);
    this.updateUI();
  },
  nextQuestion() {
    if (this.twoPass.enabled) {
      this.nextTwoPassQuestion();
      return;
    }
    if (this.currentIndex < this.questions.length - 1) { this.goToQuestion(this.currentIndex + 1); } else { this.showReview(); }
  },
  prevQuestion() { if (this.currentIndex > 0) { this.goToQuestion(this.currentIndex - 1); } },

  showQuestion(index) {
    const q = this.questions[index]; if (!q) return;
    this.questionStartTimes[index] = Date.now();
    document.getElementById('qBadge').textContent = 'Question ' + (q.num || (index + 1));
    document.getElementById('currentQNum').textContent = index + 1;
    document.getElementById('totalQNum').textContent = this.questions.length;
    const domainSpan = document.getElementById('qDomain');
    const parts = [];
    if (q.domain) parts.push(q.domain); if (q.skill) parts.push(q.skill); if (q.difficulty) parts.push(q.difficulty);
    if (parts.length > 0) { domainSpan.textContent = parts.join(' \u00B7 '); domainSpan.className = 'q-domain-badge'; if (q.difficulty) domainSpan.classList.add('difficulty-' + q.difficulty.toLowerCase()); domainSpan.style.display = 'inline-block'; } else { domainSpan.style.display = 'none'; }
    document.getElementById('qText').innerHTML = this.formatText(q.text);
    const bookmarkBtn = document.getElementById('bookmarkBtn');
    if (bookmarkBtn) {
      const isBookmarked = !!this.bookmarked[index];
      bookmarkBtn.textContent = isBookmarked ? '★ Bookmarked' : '☆ Bookmark';
      bookmarkBtn.classList.toggle('active', isBookmarked);
    }
    const optionsContainer = document.getElementById('optionsList'); optionsContainer.innerHTML = '';
    const userAnswer = this.answers[index], isRevealed = this.revealed[index], isAnswered = userAnswer !== -1, wasCorrect = isAnswered && userAnswer === q.correctIdx;
    const banner = document.getElementById('feedbackBanner'); banner.classList.remove('show', 'correct', 'wrong');
    if (isAnswered) { banner.classList.add('show', wasCorrect ? 'correct' : 'wrong'); banner.innerHTML = wasCorrect ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> <span>Correct!</span>' : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> <span>Incorrect</span>'; }
    const correctLabel = document.getElementById('correctAnswerLabel');
    if (q.correctAnswer) correctLabel.textContent = 'Correct answer: ' + q.correctAnswer;
    else if (q.correctIdx >= 0) correctLabel.textContent = 'Correct answer: ' + q.optionLetters[q.correctIdx];
    else correctLabel.textContent = 'Correct answer: (not specified)';
    const expBox = document.getElementById('explanationBox'); const expText = document.getElementById('explanationText');
    const breakdown = document.getElementById('choiceBreakdown');
    if (isRevealed || (isAnswered && !wasCorrect)) { expBox.classList.add('show'); if (isAnswered && !wasCorrect && !isRevealed) { this.revealed[index] = true; this.explanationViewed[index] = true; this.saveState(); } }
    else if (isAnswered && wasCorrect && isRevealed) { expBox.classList.add('show'); } else { expBox.classList.remove('show'); }
    expText.textContent = q.explanation || 'No explanation provided.';
    let hasChoiceBlocks = false;
    if (breakdown) {
      hasChoiceBlocks = this.renderChoiceBreakdown(q, userAnswer, wasCorrect, breakdown);
    }
    expText.style.display = hasChoiceBlocks ? 'none' : 'block';
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    for (let i = 0; i < q.options.length; i++) {
      const opt = q.options[i]; const letter = q.optionLetters[i] || letters[i];
      const optDiv = document.createElement('div'); optDiv.className = 'option-item'; if (isAnswered) optDiv.classList.add('disabled');
      if (isAnswered && i === q.correctIdx) optDiv.classList.add('correct-reveal');
      if (isAnswered && i === userAnswer && !wasCorrect) optDiv.classList.add('wrong-reveal');
      if (isAnswered && i === userAnswer) optDiv.classList.add('selected');
      const letterSpan = document.createElement('span'); letterSpan.className = 'option-letter'; letterSpan.textContent = letter; optDiv.appendChild(letterSpan);
      const textSpan = document.createElement('span'); textSpan.className = 'option-text'; textSpan.innerHTML = this.formatText(opt); optDiv.appendChild(textSpan);
      if (isAnswered) { const iconSpan = document.createElement('span'); iconSpan.className = 'option-icon'; if (i === q.correctIdx) iconSpan.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'; else if (i === userAnswer && !wasCorrect) iconSpan.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'; optDiv.appendChild(iconSpan); }
      if (!isAnswered) optDiv.addEventListener('click', () => this.selectAnswer(index, i));
      optionsContainer.appendChild(optDiv);
    }
    document.getElementById('prevBtn').disabled = index === 0;
    const nextBtn = document.getElementById('nextBtn');
    const finishBtn = document.getElementById('finishReviewBtn');
    const isLastQuestion = index === this.questions.length - 1;
    nextBtn.textContent = 'Next \u25B6';
    nextBtn.style.display = isLastQuestion ? 'none' : 'inline-flex';
    finishBtn.style.display = isLastQuestion ? 'inline-block' : 'none';
    const showExpBtn = document.getElementById('showExplanationBtn');
    if (isAnswered && wasCorrect && q.explanation) {
      showExpBtn.style.display = 'inline-block';
      showExpBtn.textContent = isRevealed ? 'Hide Explanation' : 'Show Explanation';
      showExpBtn.onclick = () => this.toggleExplanation(index);
    } else {
      showExpBtn.style.display = 'none';
    }
    this.renderUndoButton();
    document.querySelectorAll('.q-item').forEach((el, i) => { el.classList.toggle('active', i === index); if (i === index) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
    this.updateProgress(); this.saveState();
  },

  renderUndoButton() {
    const navCenter = document.getElementById('navCenter');
    if (!navCenter) return;
    const now = Date.now();
    const active = this.undoState.questionIndex >= 0 && this.undoState.expiresAt > now;
    if (!active) return;
    const secs = Math.max(1, Math.ceil((this.undoState.expiresAt - now) / 1000));
    navCenter.innerHTML = `<button class="btn btn-sm" onclick="SAT_APP.undoLastAnswer()">Undo answer (${secs}s)</button>`;
  },

  startUndoWindow(qIndex, previousAnswer) {
    if (this.undoState.timer) clearInterval(this.undoState.timer);
    this.undoState.questionIndex = qIndex;
    this.undoState.previousAnswer = previousAnswer;
    this.undoState.expiresAt = Date.now() + 3000;
    this.renderUndoButton();
    this.undoState.timer = setInterval(() => {
      if (Date.now() >= this.undoState.expiresAt) {
        clearInterval(this.undoState.timer);
        this.undoState.timer = null;
        this.undoState.questionIndex = -1;
        this.undoState.previousAnswer = -1;
        this.updateUI();
        return;
      }
      this.renderUndoButton();
    }, 250);
  },

  undoLastAnswer() {
    const now = Date.now();
    const idx = this.undoState.questionIndex;
    if (idx < 0 || this.undoState.expiresAt <= now) return;
    this.answers[idx] = this.undoState.previousAnswer;
    this.revealed[idx] = false;
    this.explanationViewed[idx] = false;
    if (this.undoState.timer) clearInterval(this.undoState.timer);
    this.undoState = { timer: null, questionIndex: -1, previousAnswer: -1, expiresAt: 0 };
    this.saveState();
    this.showQuestion(idx);
    this.updateUI();
    this.toast('Answer undone.', 'info');
  },

  renderChoiceBreakdown(q, userAnswer, wasCorrect, breakdownEl) {
    breakdownEl.innerHTML = '';
    const isAnswered = userAnswer !== -1;
    if (!isAnswered || !q.options || q.options.length === 0) return false;

    const order = [];
    const added = new Set();

    if (!wasCorrect && userAnswer >= 0) {
      order.push({ idx: userAnswer, kind: 'user-wrong' });
      added.add(userAnswer);
    }
    if (q.correctIdx >= 0 && !added.has(q.correctIdx)) {
      order.push({ idx: q.correctIdx, kind: 'correct' });
      added.add(q.correctIdx);
    }
    for (let i = 0; i < q.options.length; i++) {
      if (!added.has(i)) order.push({ idx: i, kind: 'other' });
    }

    const parsedByLetter = this.extractChoiceExplanations(q.explanation || '');
    const hasChoiceBlocks = Object.keys(parsedByLetter).length > 0;

    order.forEach(entry => {
      const i = entry.idx;
      const letter = (q.optionLetters && q.optionLetters[i]) || String.fromCharCode(65 + i);
      const optionText = q.options[i] || '';
      const card = document.createElement('div');
      card.className = 'choice-breakdown-item ' + entry.kind;

      const head = document.createElement('div');
      head.className = 'cb-head';
      if (entry.kind === 'user-wrong') {
        head.textContent = letter + ': Your choice (incorrect) — Why this is wrong';
      } else if (entry.kind === 'correct') {
        head.textContent = letter + ': Correct choice — Why this is right';
      } else {
        head.textContent = letter + ': Other option';
      }

      const body = document.createElement('div');
      body.className = 'cb-body';
      body.textContent = this.buildChoiceExplanationText(q, i, entry.kind, optionText, parsedByLetter);

      card.appendChild(head);
      card.appendChild(body);
      breakdownEl.appendChild(card);
    });

    return hasChoiceBlocks;
  },

  extractChoiceExplanations(explanationText) {
    const result = {};
    const text = (explanationText || '').replace(/\r/g, '');
    const regex = /Choice\s+([A-H])\s+(?:is\s+the\s+best\s+answer\.?|is\s+incorrect\.?)([\s\S]*?)(?=\s*Choice\s+[A-H]\s+(?:is\s+the\s+best\s+answer\.?|is\s+incorrect\.?)|$)/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const letter = (match[1] || '').toUpperCase();
      const block = ('Choice ' + letter + (match[0].includes('best answer') ? ' is the best answer.' : ' is incorrect.') + (match[2] || ''))
        .replace(/\s+/g, ' ')
        .trim();
      if (letter) result[letter] = block;
    }
    return result;
  },

  buildChoiceExplanationText(q, optionIndex, kind, optionText, parsedByLetter) {
    const letter = (q.optionLetters && q.optionLetters[optionIndex]) || String.fromCharCode(65 + optionIndex);
    if (parsedByLetter && parsedByLetter[letter]) {
      return parsedByLetter[letter];
    }

    const base = (q.explanation || '').replace(/\s+/g, ' ').trim();
    const compact = base ? base : 'No detailed rationale was provided for this question.';
    const shortBase = compact.length > 220 ? compact.slice(0, 220) + '…' : compact;

    if (kind === 'user-wrong') {
      return 'This selected answer does not match the evidence/logic of the question. Use the rationale focus: ' + shortBase;
    }
    if (kind === 'correct') {
      return 'This answer matches the question requirements and the intended reasoning path. Key rationale: ' + shortBase;
    }
    const isActuallyCorrect = optionIndex === q.correctIdx;
    if (!isActuallyCorrect) {
      return 'This option is not the best-supported choice when compared to the correct answer and rationale.';
    }
    return 'This option is the correct answer based on the provided rationale.';
  },

  toggleExplanation(index) {
    const next = !this.revealed[index];
    this.revealed[index] = next;
    if (next) this.explanationViewed[index] = true;
    this.saveState();
    this.showQuestion(index);
  },

  formatText(text) {
    if (!text) return '';
    let t = text.replace(/&/g, '&' + 'amp;').replace(/</g, '&' + 'lt;').replace(/>/g, '&' + 'gt;').replace(/"/g, '&' + 'quot;');
    t = t.replace(/\\n/g, '<br>').replace(/`([^`]+)`/g, '<code>$1</code>');
    return t.replace(/\n/g, '<br>');
  },

  selectAnswer(qIndex, optIndex) {
    if (this.answers[qIndex] !== -1) return; const q = this.questions[qIndex]; if (!q) return;
    const previousAnswer = this.answers[qIndex];

    // Anti click-through detection
    if (this.settings.antiClickThrough) {
      const started = this.questionStartTimes[qIndex] || Date.now();
      const dwellMs = Date.now() - started;
      const cfg = this.getAntiClickConfig();
      const rapidThresholdMs = cfg.rapidThresholdMs;
      if (dwellMs < rapidThresholdMs) {
        if (this.rapidClickAnchorIndex === null) this.rapidClickAnchorIndex = qIndex;
        this.rapidClickStreak += 1;
      } else {
        this.rapidClickStreak = 0;
        this.rapidClickAnchorIndex = null;
      }

      if (this.rapidClickStreak >= cfg.streakThreshold) {
        const rewindTo = this.rapidClickAnchorIndex ?? qIndex;
        for (let i = rewindTo; i < this.answers.length; i++) {
          this.answers[i] = -1;
          this.revealed[i] = false;
          this.explanationViewed[i] = false;
        }
        this.currentIndex = rewindTo;
        this.rapidClickStreak = 0;
        this.rapidClickAnchorIndex = null;
        this.saveState();
        this.showQuestion(rewindTo);
        this.updateUI();
        this.toast('⚠️ Slow down — clicking through isn\'t how you learn. I rewound you so you can take your time.', 'warning');
        return;
      }
    }

    this.answers[qIndex] = optIndex; if (optIndex !== q.correctIdx) { this.revealed[qIndex] = true; this.explanationViewed[qIndex] = true; }
    const dwellMs = Date.now() - (this.questionStartTimes[qIndex] || Date.now());
    const noRush = dwellMs >= this.getAntiClickConfig().rapidThresholdMs;
    this.updateMomentum(optIndex === q.correctIdx, noRush);
    this.startUndoWindow(qIndex, previousAnswer);
    this.saveState(); this.showQuestion(qIndex); this.updateUI();
    if (optIndex === q.correctIdx && this.settings.autoContinueOnCorrect) {
      const delay = Math.max(0, Number(this.settings.autoContinueDelayMs) || 0);
      setTimeout(() => {
        if (qIndex < this.questions.length - 1) this.goToQuestion(qIndex + 1);
        else this.showReview();
      }, delay);
    }
  },

  updateUI() {
    const h = this.questions.length > 0;
    const importBtnTop = document.getElementById('importNewBtn');
    if (importBtnTop) importBtnTop.style.display = h ? 'inline-block' : 'none';
    const legacyResetBtn = document.getElementById('resetBtn');
    if (legacyResetBtn) legacyResetBtn.style.display = h ? 'inline-block' : 'none';
    if (h) { const a = this.answers.filter(x => x !== -1).length; document.getElementById('navCenter').textContent = a + '/' + this.questions.length + ' answered'; }
    this.updateMomentumUI();
  },

  updateProgress() {
    const total = this.questions.length; if (total === 0) return;
    const answered = this.answers.filter(a => a !== -1).length; const correct = this.answers.reduce((c, a, i) => c + (a === this.questions[i].correctIdx ? 1 : 0), 0);
    document.getElementById('correctCount').textContent = correct; document.getElementById('wrongCount').textContent = answered - correct;
    const pct = Math.round((answered / total) * 100); document.getElementById('progressPctText').textContent = pct + '%'; document.getElementById('progressFill').style.width = pct + '%';
    this.renderQuestionList();
  },

  renderQuestionList() {
    const container = document.getElementById('questionList');
    if (this.questions.length === 0) { container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary);font-size:0.85em;">Import a PDF to get started</div>'; document.getElementById('pdfInfo').textContent = 'No PDF loaded'; return; }
    document.getElementById('pdfInfo').innerHTML = '<strong>' + this.pdfName + '</strong> \u00B7 ' + this.questions.length + ' questions';
    container.innerHTML = '';
    this.questions.forEach((q, i) => {
      const div = document.createElement('div'); div.className = 'q-item';
      const isAnswered = this.answers[i] !== -1; const isCorrect = isAnswered && this.answers[i] === q.correctIdx;
      if (isAnswered) div.classList.add(isCorrect ? 'correct' : 'wrong'); else { div.classList.add('unanswered'); if (i === this.currentIndex) div.classList.add('current-unanswered'); }
      const numSpan = document.createElement('span'); numSpan.className = 'q-num'; numSpan.textContent = q.num || (i + 1); div.appendChild(numSpan);
      const titleSpan = document.createElement('span'); titleSpan.className = 'q-item-title'; titleSpan.textContent = (this.bookmarked[i] ? '★ ' : '') + (q.text.length > 40 ? q.text.substring(0, 40) + '…' : q.text); div.appendChild(titleSpan);
      if (isAnswered) { const dot = document.createElement('span'); dot.className = 'q-status-dot ' + (isCorrect ? 'correct' : 'wrong'); div.appendChild(dot); }
      div.addEventListener('click', () => this.goToQuestion(i)); container.appendChild(div);
    });
  },

  showReview() {
    const total = this.questions.length; if (total === 0) return;
    const answered = this.answers.filter(a => a !== -1).length; const correct = this.answers.reduce((c, a, i) => c + (a === this.questions[i].correctIdx ? 1 : 0), 0); const wrong = answered - correct; const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;
    document.getElementById('reviewTotal').textContent = total; document.getElementById('reviewCorrect').textContent = correct; document.getElementById('reviewWrong').textContent = wrong; document.getElementById('reviewAccuracy').innerHTML = accuracy + '%';
    if (answered === total) {
      document.getElementById('reviewTitle').textContent = '\uD83C\uDF89 Review Complete!';
      const pct = Math.round((correct / total) * 100); let msg = 'You got ' + correct + '/' + total + ' correct (' + pct + '%).';
      if (pct >= 90) msg += ' Outstanding! \uD83C\uDF1F'; else if (pct >= 70) msg += ' Good job! Keep practicing. \uD83D\uDCAA'; else if (pct >= 50) msg += ' Room for improvement! \uD83D\uDCDA'; else msg += ' Keep studying! \uD83D\uDD25';
      document.getElementById('reviewSubtitle').textContent = msg;
    } else { document.getElementById('reviewTitle').textContent = '\uD83D\uDCCA Progress Review'; document.getElementById('reviewSubtitle').textContent = 'You\'ve answered ' + answered + '/' + total + ' questions. Keep going!'; }
    this.recordTrendSnapshot();
    this.renderTrendCharts();
    const filterWrap = document.getElementById('reviewFilters');
    if (filterWrap) {
      filterWrap.innerHTML = '';
      const twoPassBtn = document.createElement('button');
      twoPassBtn.className = 'review-filter-btn';
      twoPassBtn.textContent = this.twoPass.enabled ? 'Two-Pass Active' : 'Start Two-Pass Review';
      twoPassBtn.onclick = () => this.startTwoPassReview();
      filterWrap.appendChild(twoPassBtn);

      const filters = [
        { key: 'all', label: 'All' },
        { key: 'wrong', label: 'Wrong only' },
        { key: 'unanswered', label: 'Unanswered only' },
        { key: 'bookmarked', label: 'Bookmarked only' }
      ];
      filters.forEach(f => {
        const btn = document.createElement('button');
        btn.className = 'review-filter-btn' + (this.reviewFilter === f.key ? ' active' : '');
        btn.textContent = f.label;
        btn.onclick = () => { this.reviewFilter = f.key; this.showReview(); };
        filterWrap.appendChild(btn);
      });
    }

    const list = document.getElementById('reviewQuestionList'); list.innerHTML = '';
    this.questions.forEach((q, i) => {
      const div = document.createElement('div'); div.className = 'review-q-item';
      const isAnswered = this.answers[i] !== -1; const isCorrect = isAnswered && this.answers[i] === q.correctIdx;
      if (this.reviewFilter === 'wrong' && (!isAnswered || isCorrect)) return;
      if (this.reviewFilter === 'unanswered' && isAnswered) return;
      if (this.reviewFilter === 'bookmarked' && !this.bookmarked[i]) return;

      const statusPill = document.createElement('span');
      statusPill.className = 'review-status-pill ' + (isAnswered ? (isCorrect ? 'ok' : 'bad') : 'pending');
      statusPill.textContent = isAnswered ? (isCorrect ? 'Correct' : 'Incorrect') : 'Unanswered';
      div.appendChild(statusPill);

      const icon = document.createElement('span'); icon.className = 'rq-icon'; icon.textContent = isAnswered ? (isCorrect ? '\u2705' : '\u274C') : '';
      const text = document.createElement('span');
      text.className = 'rq-text';
      const label = 'Question ' + (q.num || (i + 1));
      text.textContent = label;
      div.appendChild(text);
      if (isAnswered && q.correctAnswer) { const ans = document.createElement('span'); ans.className = 'rq-answer'; ans.innerHTML = 'Your: <strong style="color:' + (isCorrect ? 'var(--success)' : 'var(--error)') + '">' + (q.optionLetters[this.answers[i]] || '?') + '</strong> \u00B7 Correct: <strong>' + q.correctAnswer + '</strong>'; div.appendChild(ans); }
      else if (isAnswered) { const ans = document.createElement('span'); ans.className = 'rq-answer'; ans.innerHTML = isCorrect ? '\u2705 Correct' : '\u274C Incorrect'; div.appendChild(ans); }
      div.addEventListener('click', () => { this.currentIndex = i; this.questionScreen(true); this.reviewScreen(false); this.showQuestion(i); this.updateUI(); }); list.appendChild(div);
    });
    this.questionScreen(false); this.importScreen(false); this.reviewScreen(true);
  },

  startTwoPassReview() {
    const unanswered = [];
    const retry = [];
    for (let i = 0; i < this.questions.length; i++) {
      const ans = this.answers[i];
      if (ans === -1) unanswered.push(i);
      else if (ans !== this.questions[i].correctIdx || this.bookmarked[i]) retry.push(i);
    }

    const queue = unanswered.concat(retry.filter(i => !unanswered.includes(i)));
    if (queue.length === 0) {
      this.toast('Two-pass queue is empty. You are all caught up!', 'success');
      return;
    }

    this.twoPass.enabled = true;
    this.twoPass.phase = unanswered.length > 0 ? 1 : 2;
    this.twoPass.queue = queue;
    this.twoPass.pointer = 0;

    this.reviewScreen(false);
    this.questionScreen(true);
    this.goToQuestion(queue[0]);
    this.toast(`Two-pass started: ${queue.length} questions queued.`, 'info');
  },

  nextTwoPassQuestion() {
    if (!this.twoPass.enabled) return;
    this.twoPass.pointer += 1;
    if (this.twoPass.pointer >= this.twoPass.queue.length) {
      this.twoPass.enabled = false;
      this.twoPass.queue = [];
      this.twoPass.pointer = 0;
      this.showReview();
      this.toast('Two-pass review complete.', 'success');
      return;
    }
    const nextIndex = this.twoPass.queue[this.twoPass.pointer];
    this.goToQuestion(nextIndex);
  },

  recordTrendSnapshot() {
    const total = this.questions.length;
    if (!total) return;
    const answered = this.answers.filter(a => a !== -1).length;
    const correct = this.answers.reduce((c, a, i) => c + (a === this.questions[i].correctIdx ? 1 : 0), 0);
    const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;
    const completion = Math.round((answered / total) * 100);
    const snapshot = { t: Date.now(), accuracy, completion };
    const last = this.trendHistory[this.trendHistory.length - 1];
    if (!last || last.accuracy !== snapshot.accuracy || last.completion !== snapshot.completion) {
      this.trendHistory.push(snapshot);
      if (this.trendHistory.length > 10) this.trendHistory = this.trendHistory.slice(-10);
      this.saveState();
    }
  },

  renderTrendCharts() {
    const accEl = document.getElementById('accuracyTrendBars');
    if (!accEl) return;
    accEl.innerHTML = '';

    // Prefer in-session progression so charts always show multiple points
    // across the question set (not just one session summary point).
    const session = this.buildSessionTrendSeries();
    if (session.accuracy.length >= 2) {
      this.renderTrendLineChart(accEl, session.accuracy, 'Accuracy');
      return;
    }

    // Fallback to saved history if session does not have enough points yet.
    const rows = this.trendHistory.slice(-10);
    this.renderTrendLineChart(accEl, rows.map(r => r.accuracy), 'Accuracy');
  },

  buildSessionTrendSeries() {
    const total = this.questions.length;
    const accuracy = [];
    const completion = [];
    if (!total) return { accuracy, completion };

    let answeredSoFar = 0;
    let correctSoFar = 0;

    for (let i = 0; i < total; i++) {
      const ans = this.answers[i];
      if (ans !== -1) {
        answeredSoFar += 1;
        if (ans === this.questions[i].correctIdx) correctSoFar += 1;

        // Only plot answered questions (skip unanswered)
        const accPct = Math.round((correctSoFar / answeredSoFar) * 100);
        const compPct = Math.round((answeredSoFar / total) * 100);
        accuracy.push(accPct);
        completion.push(compPct);
      }
    }

    return { accuracy, completion };
  },

  renderTrendLineChart(container, values, label) {
    if (!container) return;
    container.innerHTML = '';
    if (!values || values.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'trend-label-minmax';
      empty.textContent = 'No data yet';
      container.appendChild(empty);
      return;
    }

    const width = 320;
    const height = 110;
    const padL = 16, padR = 8, padT = 8, padB = 16;
    const minV = 0, maxV = 100;
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;

    const toX = (i) => padL + (values.length === 1 ? innerW / 2 : (i * innerW) / (values.length - 1));
    const toY = (v) => padT + (1 - (Math.max(minV, Math.min(maxV, v)) - minV) / (maxV - minV)) * innerH;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'trend-svg');

    [25, 50, 75, 100].forEach(p => {
      const y = toY(p);
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', String(padL));
      line.setAttribute('x2', String(width - padR));
      line.setAttribute('y1', String(y));
      line.setAttribute('y2', String(y));
      line.setAttribute('class', 'trend-grid');
      svg.appendChild(line);
    });

    const axis = document.createElementNS(svgNS, 'line');
    axis.setAttribute('x1', String(padL));
    axis.setAttribute('x2', String(width - padR));
    axis.setAttribute('y1', String(height - padB));
    axis.setAttribute('y2', String(height - padB));
    axis.setAttribute('class', 'trend-axis');
    svg.appendChild(axis);

    const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(v)}`).join(' ');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'trend-line');
    path.setAttribute('aria-label', `${label} trend line`);
    svg.appendChild(path);

    values.forEach((v, i) => {
      const dot = document.createElementNS(svgNS, 'circle');
      dot.setAttribute('cx', String(toX(i)));
      dot.setAttribute('cy', String(toY(v)));
      dot.setAttribute('r', '3');
      dot.setAttribute('class', 'trend-point');
      dot.setAttribute('title', `Run ${i + 1}: ${v}%`);
      svg.appendChild(dot);
    });

    const meta = document.createElement('div');
    meta.className = 'trend-label-minmax';
    meta.textContent = `${Math.min(...values)}% - ${Math.max(...values)}%`;

    container.appendChild(svg);
    container.appendChild(meta);
  },

  startOver() { this.answers = new Array(this.questions.length).fill(-1); this.revealed = new Array(this.questions.length).fill(false); this.explanationViewed = new Array(this.questions.length).fill(false); this.currentIndex = 0; this.resetMomentum(); this.saveState(); this.renderQuestionList(); this.showQuestion(0); this.questionScreen(true); this.reviewScreen(false); this.updateUI(); this.toast('Progress reset!', 'info'); },
  toggleBookmarkCurrent() {
    if (!this.questions[this.currentIndex]) return;
    if (!Array.isArray(this.bookmarked) || this.bookmarked.length !== this.questions.length) {
      this.bookmarked = new Array(this.questions.length).fill(false);
    }
    this.bookmarked[this.currentIndex] = !this.bookmarked[this.currentIndex];
    this.saveState();
    this.renderQuestionList();
    this.showQuestion(this.currentIndex);
  },

  async copyProgressReport() {
    if (!this.questions || this.questions.length === 0) {
      this.toast('No questions available for report.', 'warning');
      return;
    }

    const total = this.questions.length;
    const answered = this.answers.filter(a => a !== -1).length;
    const correct = this.answers.reduce((sum, a, i) => sum + (a !== -1 && a === this.questions[i].correctIdx ? 1 : 0), 0);
    const wrong = answered - correct;
    const unanswered = total - answered;
    const accuracyAnswered = answered > 0 ? ((correct / answered) * 100).toFixed(1) : '0.0';
    const completionPct = ((answered / total) * 100).toFixed(1);

    const byDifficulty = {};
    const byDomain = {};
    const bySkill = {};

    const wrongDetails = [];
    const perQuestion = [];

    const pushBucket = (obj, key, field, isCorrect, isAnswered) => {
      const k = key && key.trim() ? key.trim() : `Unknown ${field}`;
      if (!obj[k]) obj[k] = { total: 0, answered: 0, correct: 0, wrong: 0, unanswered: 0 };
      obj[k].total += 1;
      if (isAnswered) {
        obj[k].answered += 1;
        if (isCorrect) obj[k].correct += 1;
        else obj[k].wrong += 1;
      } else {
        obj[k].unanswered += 1;
      }
    };

    for (let i = 0; i < this.questions.length; i++) {
      const q = this.questions[i];
      const ans = this.answers[i];
      const isAnswered = ans !== -1;
      const isCorrect = isAnswered && ans === q.correctIdx;

      const difficulty = q.difficulty || 'Unknown Difficulty';
      const domain = q.domain || 'Unknown Domain';
      const skill = q.skill || 'Unknown Skill';

      pushBucket(byDifficulty, difficulty, 'Difficulty', isCorrect, isAnswered);
      pushBucket(byDomain, domain, 'Domain', isCorrect, isAnswered);
      pushBucket(bySkill, skill, 'Skill', isCorrect, isAnswered);

      const questionLabel = `Question ${q.num || (i + 1)}`;
      const viewedExplanation = !!this.explanationViewed[i] || (isAnswered && !isCorrect);
      const userLetter = isAnswered ? (q.optionLetters?.[ans] || '?') : '—';
      const correctLetter = q.correctAnswer || (q.correctIdx >= 0 ? q.optionLetters?.[q.correctIdx] || '?' : '?');
      const shortText = (q.text || '').replace(/\s+/g, ' ').trim().slice(0, 140);

      perQuestion.push(
        `${questionLabel} | ${isAnswered ? (isCorrect ? 'CORRECT' : 'WRONG') : 'UNANSWERED'} | Difficulty: ${difficulty} | Domain: ${domain} | Skill: ${skill} | Explanation Viewed: ${viewedExplanation ? 'Yes' : 'No'} | Your: ${userLetter} | Correct: ${correctLetter} | Prompt: ${shortText}${shortText.length >= 140 ? '…' : ''}`
      );

      if (isAnswered && !isCorrect) {
        wrongDetails.push(
          `${questionLabel}\n` +
          `- Difficulty: ${difficulty}\n` +
          `- Domain: ${domain}\n` +
          `- Skill: ${skill}\n` +
          `- Your Answer: ${userLetter}\n` +
          `- Correct Answer: ${correctLetter}\n` +
          `- Prompt: ${shortText}${shortText.length >= 140 ? '…' : ''}\n` +
          `- Explanation Viewed: Yes`
        );
      }
    }

    const bucketToLines = (title, bucket) => {
      const lines = [`${title}:`];
      const keys = Object.keys(bucket).sort((a, b) => a.localeCompare(b));
      for (const k of keys) {
        const b = bucket[k];
        const acc = b.answered > 0 ? ((b.correct / b.answered) * 100).toFixed(1) : '0.0';
        lines.push(`- ${k}: total ${b.total}, answered ${b.answered}, correct ${b.correct}, wrong ${b.wrong}, unanswered ${b.unanswered}, accuracy ${acc}%`);
      }
      return lines.join('\n');
    };

    const report = [
      '================ SAT QUIZ PROGRESS REPORT ================',
      `Generated: ${new Date().toLocaleString()}`,
      `Source: ${this.pdfName || 'Unknown Source'}`,
      '',
      '--- OVERALL SUMMARY ---',
      `Total Questions: ${total}`,
      `Answered: ${answered} (${completionPct}%)`,
      `Correct: ${correct}`,
      `Wrong: ${wrong}`,
      `Unanswered: ${unanswered}`,
      `Accuracy (answered only): ${accuracyAnswered}%`,
      '',
      '--- BREAKDOWNS ---',
      bucketToLines('By Difficulty', byDifficulty),
      '',
      bucketToLines('By Domain', byDomain),
      '',
      bucketToLines('By Skill', bySkill),
      '',
      '--- QUESTIONS YOU GOT WRONG ---',
      wrongDetails.length > 0 ? wrongDetails.join('\n\n') : 'None 🎉',
      '',
      '--- ALL QUESTION RESULTS ---',
      perQuestion.join('\n'),
      '==========================================================='
    ].join('\n');

    console.log(report);

    try {
      await navigator.clipboard.writeText(report);
      this.toast('Progress report copied to clipboard and printed to console.', 'success');
    } catch (e) {
      // Fallback copy method
      try {
        const ta = document.createElement('textarea');
        ta.value = report;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        this.toast('Progress report copied (fallback) and printed to console.', 'success');
      } catch (_e) {
        this.toast('Could not copy report automatically. Report is in console.', 'warning');
      }
    }
  },

  confirmReset() {
    if (this.questions.length === 0) return;
    this.closeSettings();
    this.showConfirm('Reset All', 'This will clear all questions and progress.', () => { this.clearState(); this.questionScreen(false); this.reviewScreen(false); this.importScreen(true); this.renderQuestionList(); document.getElementById('pdfInfo').textContent = 'No PDF loaded'; });
  }
};

const SAT_SAMPLE_QUESTIONS = [
  { num: 1, text: 'If 3x + 7 = 22, what is the value of x?', options: ['3', '5', '7', '15'], optionLetters: ['A', 'B', 'C', 'D'], correctIdx: 1, correctAnswer: 'B', explanation: 'Solve: 3x + 7 = 22\n3x = 15\nx = 5', domain: 'Math', skill: 'Algebra', difficulty: 'Easy' },
  { num: 2, text: 'In the xy-plane, the line with equation y = 2x + 3 is reflected across the x-axis. Which is the equation of the reflected line?', options: ['y = -2x - 3', 'y = -2x + 3', 'y = 2x - 3', 'y = -2x + 3'], optionLetters: ['A', 'B', 'C', 'D'], correctIdx: 0, correctAnswer: 'A', explanation: 'Reflecting across the x-axis changes the sign of y.', domain: 'Math', skill: 'Algebra', difficulty: 'Medium' },
  { num: 3, text: 'Emperor Ashoka ruled the Maurya Empire in South Asia from roughly 270 to 232 BCE. He is known for enforcing a moral code called the Law of Piety, which established the sanctity of animal ______ the just treatment of the elderly, and the abolition of the slave trade.', options: ['life', 'life;', 'life:', 'life,'], optionLetters: ['A', 'B', 'C', 'D'], correctIdx: 3, correctAnswer: 'D', explanation: 'A comma is needed to separate items in a list of three things.', domain: 'Reading and Writing', skill: 'Boundaries', difficulty: 'Easy' },
  { num: 4, text: 'A bag contains 3 red marbles, 4 blue marbles, and 5 green marbles. If one marble is randomly selected, what is the probability it is blue?', options: ['1/4', '1/3', '4/12', '4/5'], optionLetters: ['A', 'B', 'C', 'D'], correctIdx: 1, correctAnswer: 'B', explanation: 'Total = 12, Blue = 4. 4/12 = 1/3.', domain: 'Math', skill: 'Problem Solving', difficulty: 'Easy' },
  { num: 5, text: 'The function f is defined by f(x) = x\u00B2 - 4x + 5. What is the minimum value of f(x)?', options: ['0', '1', '2', '5'], optionLetters: ['A', 'B', 'C', 'D'], correctIdx: 1, correctAnswer: 'B', explanation: 'Complete the square: f(x) = (x-2)\u00B2 + 1. Min = 1.', domain: 'Math', skill: 'Advanced Math', difficulty: 'Hard' }
];

document.addEventListener('DOMContentLoaded', () => SAT_APP.init());