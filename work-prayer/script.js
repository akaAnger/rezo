// Constants
const BURN_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const LONGPRESS_MS = 800;
const TURBO_MS = 10_000;
const STORAGE_KEYS = {
	role: 'wp_role',
	mode: 'wp_mode',
	sound: 'wp_sound',
	lastDate: 'wp_lastDate',
	streak: 'wp_streak',
	candlesToday: 'wp_candlesToday',
	burnEndAt: 'wp_burnEndAt'
};

// State
const state = {
	role: localStorage.getItem(STORAGE_KEYS.role) || 'mediabuyer',
	mode: localStorage.getItem(STORAGE_KEYS.mode) || 'secular', // 'sacred' | 'secular'
	sound: localStorage.getItem(STORAGE_KEYS.sound) || 'off', // 'on' | 'off'
	streak: parseInt(localStorage.getItem(STORAGE_KEYS.streak) || '0', 10),
	candlesToday: parseInt(localStorage.getItem(STORAGE_KEYS.candlesToday) || '0', 10),
	burnEndAt: parseInt(localStorage.getItem(STORAGE_KEYS.burnEndAt) || '0', 10),
	isLit: false,
	igniteHoldTimer: null,
	igniteProgressTimer: null,
	remainingMs: BURN_DURATION_MS,
	incense: false
};

function saveState() {
	localStorage.setItem(STORAGE_KEYS.role, state.role);
	localStorage.setItem(STORAGE_KEYS.mode, state.mode);
	localStorage.setItem(STORAGE_KEYS.sound, state.sound);
	localStorage.setItem(STORAGE_KEYS.streak, String(state.streak));
	localStorage.setItem(STORAGE_KEYS.candlesToday, String(state.candlesToday));
	localStorage.setItem(STORAGE_KEYS.burnEndAt, String(state.burnEndAt || 0));
}

function getTodayStr(date = new Date()) {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

function updateDailyCounters() {
	const today = getTodayStr();
	const lastDate = localStorage.getItem(STORAGE_KEYS.lastDate);
	if (lastDate !== today) {
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		const wasYesterday = lastDate === getTodayStr(yesterday);
		state.streak = wasYesterday ? (state.streak || 0) + 1 : 1;
		state.candlesToday = 0;
		localStorage.setItem(STORAGE_KEYS.lastDate, today);
		saveState();
	}
}

// Hash: FNV-1a 32-bit
function fnv1a(str) {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
	}
	return h >>> 0;
}

function pickDeterministic(array, seedStr) {
	if (!array || array.length === 0) return null;
	const h = fnv1a(seedStr);
	const idx = h % array.length;
	return array[idx];
}

// Data loader
const dataLoader = (() => {
	let prayers = [];
	let predictions = [];
	let loadError = false;

	const fallbackPrayers = [
		{ id: 'fallback_1', mood: 'focus', roles: ['any'], tone: 'light', text_sacred: 'Даруй мне Wi‑Fi стабильный и кофе бодрящий.', text_secular: 'Пусть Wi‑Fi будет стабильным, а кофе — бодрым.' }
	];
	const fallbackPredictions = [
		{ id: 'fallback_1', mood: 'neutral', roles: ['any'], emoji: '🔮', text: 'Небольшой шаг вперёд сейчас лучше, чем идеальный план завтра.' }
	];

	async function loadJson(path) {
		try {
			const res = await fetch(path, { cache: 'no-store' });
			if (!res.ok) throw new Error('HTTP ' + res.status);
			return await res.json();
		} catch (e) {
			console.warn('Failed to load', path, e);
			loadError = true;
			return null;
		}
	}

	async function loadAll() {
		const [p1, p2] = await Promise.all([
			loadJson('data/prayers.json'),
			loadJson('data/predictions.json')
		]);
		prayers = Array.isArray(p1) && p1.length ? p1 : fallbackPrayers;
		predictions = Array.isArray(p2) && p2.length ? p2 : fallbackPredictions;
		return { loadError, prayers, predictions };
	}

	function getPrayerFor(role, mode, dateStr) {
		const pool = prayers.filter(p => p.roles.includes(role) || p.roles.includes('any'));
		const usePool = pool.length ? pool : prayers.filter(p => p.roles.includes('any'));
		const seed = `${dateStr}::${role}`;
		const item = pickDeterministic(usePool, seed) || fallbackPrayers[0];
		return {
			title: mode === 'sacred' ? 'Молитва дня' : 'Мантра дня',
			text: mode === 'sacred' ? (item.text_sacred || item.text_secular) : (item.text_secular || item.text_sacred)
		};
	}

	function getPredictionFor(role, dateStr) {
		const pool = predictions.filter(p => p.roles.includes(role) || p.roles.includes('any'));
		const usePool = pool.length ? pool : predictions.filter(p => p.roles.includes('any'));
		const seed = `${dateStr}::${role}`;
		const item = pickDeterministic(usePool, seed) || fallbackPredictions[0];
		return { emoji: item.emoji || '🔮', text: item.text || '' };
	}

	return { loadAll, getPrayerFor, getPredictionFor, get loadError() { return loadError; } };
})();

// Audio via WebAudio (no external files)
const audio = (() => {
	let ctx = null;
	function getCtx() { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); return ctx; }

	function playMatch() {
		if (state.sound !== 'on') return;
		const ac = getCtx();
		const t = ac.currentTime;
		const o = ac.createOscillator();
		const g = ac.createGain();
		o.type = 'triangle';
		o.frequency.setValueAtTime(1800, t);
		o.frequency.exponentialRampToValueAtTime(220, t + 0.05);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
		o.connect(g).connect(ac.destination);
		o.start(t);
		o.stop(t + 0.22);
	}

	function meow() {
		if (state.sound !== 'on') return;
		const ac = getCtx();
		const t = ac.currentTime;
		const o = ac.createOscillator();
		const g = ac.createGain();
		o.type = 'sawtooth';
		o.frequency.setValueAtTime(600, t);
		o.frequency.exponentialRampToValueAtTime(300, t + 0.2);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
		o.connect(g).connect(ac.destination);
		o.start(t);
		o.stop(t + 0.27);
	}

	let ambient = null;
	function incenseAmbientOn() {
		if (state.sound !== 'on') return;
		const ac = getCtx();
		const o = ac.createOscillator();
		const g = ac.createGain();
		o.type = 'sine';
		o.frequency.value = 110;
		g.gain.value = 0.02;
		o.connect(g).connect(ac.destination);
		o.start();
		ambient = { o, g };
	}
	function incenseAmbientOff() {
		if (!ambient) return;
		const ac = getCtx();
		ambient.g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.4);
		ambient.o.stop(ac.currentTime + 0.45);
		ambient = null;
	}

	return { playMatch, meow, incenseAmbientOn, incenseAmbientOff };
})();

// UI
const ui = (() => {
	const els = {
		roleSelect: document.getElementById('roleSelect'),
		modeToggle: document.getElementById('modeToggle'),
		soundToggle: document.getElementById('soundToggle'),
		resetBtn: document.getElementById('resetBtn'),
		buffWord: document.getElementById('buffWord'),
		igniteBtn: document.getElementById('igniteBtn'),
		candle: document.getElementById('candle'),
		wax: document.getElementById('wax'),
		flame: document.getElementById('flame'),
		sparkProgress: document.getElementById('sparkProgress'),
		timeLeft: document.getElementById('timeLeft'),
		stopBtn: document.getElementById('stopBtn'),
		relightBtn: document.getElementById('relightBtn'),
		prayerTitle: document.getElementById('prayerTitle'),
		prayerText: document.getElementById('prayerText'),
		predictionText: document.getElementById('predictionText'),
		predEmoji: document.getElementById('predEmoji'),
		candlesToday: document.getElementById('candlesToday'),
		streak: document.getElementById('streak'),
		shareBtn: document.getElementById('shareBtn'),
		downloadLink: document.getElementById('downloadLink'),
		errorBanner: document.getElementById('errorBanner')
	};

	let tickInterval = null;
	let turboTimeout = null;
	let holdStart = 0;
	let lastFlameClicks = [];

	function setModeUI() {
		const sacred = state.mode === 'sacred';
		els.buffWord.textContent = sacred ? 'благословение' : 'бафф';
		els.prayerTitle.textContent = sacred ? 'Молитва дня' : 'Мантра дня';
		els.modeToggle.checked = sacred;
	}

	function setSoundUI() {
		els.soundToggle.checked = state.sound === 'on';
	}

	function setRoleUI() {
		els.roleSelect.value = state.role;
	}

	function mmss(ms) {
		const s = Math.max(0, Math.floor(ms / 1000));
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
	}

	function ignite() {
		if (state.isLit) return;
		state.isLit = true;
		state.burnEndAt = Date.now() + state.remainingMs;
		state.candlesToday += 1;
		saveState();
		updateStats();
		els.candle.classList.add('lit');
		startTicking();
		animateWax();
		audio.playMatch();
	}

	function extinguish() {
		if (!state.isLit) return;
		state.isLit = false;
		state.remainingMs = Math.max(0, state.burnEndAt - Date.now());
		state.burnEndAt = 0;
		saveState();
		els.candle.classList.remove('lit');
		stopTicking();
	}

	function resetBurn() {
		state.remainingMs = BURN_DURATION_MS;
		state.burnEndAt = 0;
		state.isLit = false;
		saveState();
		els.candle.classList.remove('lit');
		els.wax.style.height = '100%';
		stopTicking();
		els.timeLeft.textContent = mmss(BURN_DURATION_MS);
	}

	function startTicking() {
		stopTicking();
		tickInterval = setInterval(() => {
			const now = Date.now();
			const remaining = Math.max(0, (state.burnEndAt || 0) - now);
			state.remainingMs = remaining;
			els.timeLeft.textContent = mmss(remaining);
			updateWaxByRemaining();
			if (remaining <= 0) {
				state.isLit = false;
				state.burnEndAt = 0;
				saveState();
				els.candle.classList.remove('lit');
				stopTicking();
			}
		}, 250);
	}
	function stopTicking() { if (tickInterval) clearInterval(tickInterval); tickInterval = null; }

	function animateWax() {
		const startH = parseFloat(getComputedStyle(els.wax).height);
		const totalH = parseFloat(getComputedStyle(els.candle.querySelector('.candle-body')).height);
		const already = totalH - startH;
		const remainingFrac = state.remainingMs / BURN_DURATION_MS;
		const targetH = `${Math.max(0, remainingFrac * 100)}%`;
		const duration = Math.max(0, state.remainingMs);
		els.wax.style.transitionDuration = `${duration}ms`;
		els.wax.style.height = targetH;
	}

	function updateWaxByRemaining() {
		const frac = Math.max(0, state.remainingMs / BURN_DURATION_MS);
		els.wax.style.height = `${Math.max(0, frac * 100)}%`;
	}

	function updateTexts() {
		const today = getTodayStr();
		const prayer = dataLoader.getPrayerFor(state.role, state.mode, today);
		els.prayerTitle.textContent = prayer.title;
		els.prayerText.textContent = prayer.text;
		const pred = dataLoader.getPredictionFor(state.role, today);
		els.predEmoji.textContent = pred.emoji;
		els.predictionText.textContent = pred.text;
	}

	function updateStats() {
		els.candlesToday.textContent = String(state.candlesToday);
		els.streak.textContent = String(state.streak);
	}

	function startHold(target) {
		if (state.isLit) return;
		if (state.igniteHoldTimer) clearTimeout(state.igniteHoldTimer);
		holdStart = performance.now();
		setIgniteProgress(0);
		state.igniteHoldTimer = setTimeout(() => {
			ignite();
			stopHold();
		}, LONGPRESS_MS);
		state.igniteProgressTimer = setInterval(() => {
			const elapsed = performance.now() - holdStart;
			const frac = Math.min(1, elapsed / LONGPRESS_MS);
			setIgniteProgress(frac);
		}, 16);
		showHolding(true, target);
	}
	function stopHold() {
		if (state.igniteHoldTimer) clearTimeout(state.igniteHoldTimer);
		if (state.igniteProgressTimer) clearInterval(state.igniteProgressTimer);
		state.igniteHoldTimer = null; state.igniteProgressTimer = null; setIgniteProgress(0); showHolding(false);
	}
	function setIgniteProgress(frac) {
		const deg = Math.floor(frac * 360);
		document.documentElement.style.setProperty('--ignite-progress', deg + 'deg');
	}
	function showHolding(isHolding, source) {
		if (source === els.igniteBtn) {
			els.igniteBtn.classList.toggle('holding', isHolding);
		} else {
			els.candle.classList.toggle('holding', isHolding);
		}
	}

	function turboFlame(ms = TURBO_MS) {
		document.documentElement.style.setProperty('--flame-brightness', '1.8');
		if (turboTimeout) clearTimeout(turboTimeout);
		turboTimeout = setTimeout(() => {
			document.documentElement.style.setProperty('--flame-brightness', state.incense ? '1.4' : '1');
		}, ms);
	}

	function incenseMode(on) {
		state.incense = on;
		document.body.classList.toggle('incense', on);
		if (on) audio.incenseAmbientOn(); else audio.incenseAmbientOff();
	}

	function bindEvents() {
		// Role
		els.roleSelect.addEventListener('change', () => {
			state.role = els.roleSelect.value;
			saveState();
			updateTexts();
		});

		// Mode
		els.modeToggle.addEventListener('change', () => {
			state.mode = els.modeToggle.checked ? 'sacred' : 'secular';
			saveState();
			setModeUI();
			updateTexts();
		});

		// Sound
		els.soundToggle.addEventListener('change', () => {
			state.sound = els.soundToggle.checked ? 'on' : 'off';
			saveState();
		});

		// Reset
		els.resetBtn.addEventListener('click', () => {
			if (!confirm('Сбросить локальные данные?')) return;
			localStorage.removeItem(STORAGE_KEYS.lastDate);
			localStorage.removeItem(STORAGE_KEYS.streak);
			localStorage.removeItem(STORAGE_KEYS.candlesToday);
			localStorage.removeItem(STORAGE_KEYS.burnEndAt);
			state.streak = 0; state.candlesToday = 0; state.burnEndAt = 0; state.remainingMs = BURN_DURATION_MS; state.isLit = false;
			saveState();
			updateStats();
			resetBurn();
		});

		// Buttons
		['mousedown','touchstart','keydown'].forEach(ev => {
			els.igniteBtn.addEventListener(ev, (e) => {
				if (ev === 'keydown' && ![' ','Enter'].includes(e.key)) return;
				startHold(els.igniteBtn);
			});
		});
		['mouseup','mouseleave','touchend','touchcancel','keyup','blur'].forEach(ev => {
			els.igniteBtn.addEventListener(ev, (e) => { stopHold(); });
		});

		['mousedown','touchstart','keydown'].forEach(ev => {
			els.candle.addEventListener(ev, (e) => {
				if (ev === 'keydown' && ![' ','Enter'].includes(e.key)) return;
				startHold(els.candle);
			});
		});
		['mouseup','mouseleave','touchend','touchcancel','keyup','blur'].forEach(ev => {
			els.candle.addEventListener(ev, stopHold);
		});

		els.stopBtn.addEventListener('click', extinguish);
		els.relightBtn.addEventListener('click', resetBurn);

		// Triple click on flame
		els.flame.addEventListener('click', () => {
			const now = Date.now();
			lastFlameClicks = lastFlameClicks.filter(t => now - t < 700);
			lastFlameClicks.push(now);
			if (lastFlameClicks.length >= 3) {
				lastFlameClicks = [];
				turboFlame();
			}
		});

		// Meow on wax click
		els.wax.addEventListener('click', () => audio.meow());

		// Share
		els.shareBtn.addEventListener('click', handleShare);
	}

	async function init() {
		updateDailyCounters();
		setRoleUI();
		setModeUI();
		setSoundUI();
		bindEvents();

		// Resume burn if active
		if (state.burnEndAt && state.burnEndAt > Date.now()) {
			state.isLit = true;
			state.remainingMs = state.burnEndAt - Date.now();
			els.candle.classList.add('lit');
			startTicking();
			animateWax();
		} else {
			resetBurn();
		}

		const { loadError } = await dataLoader.loadAll();
		updateTexts();
		updateStats();
		if (loadError) showError('Не удалось загрузить данные. Показан резервный контент.');

		setupKonami();
		setupHotkeys();
	}

	function showError(msg) {
		els.errorBanner.textContent = msg;
		els.errorBanner.hidden = false;
	}

	function setupKonami() {
		const seq = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
		let pos = 0;
		document.addEventListener('keydown', (e) => {
			const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
			if (key === seq[pos]) {
				pos++;
				if (pos === seq.length) { pos = 0; incenseMode(true); setTimeout(() => incenseMode(false), 40_000); }
			} else { pos = 0; }
		});
	}

	function setupHotkeys() {
		document.addEventListener('keydown', (e) => {
			if (e.key === 's') { els.soundToggle.click(); }
			if (e.key === 'm') { els.modeToggle.click(); }
			if (e.key === 'r') { els.roleSelect.focus(); }
		});
	}

	async function handleShare() {
		const canvas = document.getElementById('shareCanvas');
		const ctx = canvas.getContext('2d');
		const W = canvas.width, H = canvas.height;
		ctx.clearRect(0,0,W,H);
		// Background
		const grad = ctx.createRadialGradient(W/2, H*0.4, 60, W/2, H/2, H*0.9);
		grad.addColorStop(0, '#141417');
		grad.addColorStop(1, '#090a0c');
		ctx.fillStyle = grad;
		ctx.fillRect(0,0,W,H);
		// Title
		ctx.fillStyle = '#e7e9ee';
		ctx.font = 'bold 56px system-ui, -apple-system, Segoe UI, Roboto';
		ctx.textAlign = 'center';
		ctx.fillText('Предсказание дня', W/2, 120);
		// Date and role
		ctx.font = '24px system-ui, -apple-system, Segoe UI, Roboto';
		ctx.fillStyle = '#aab2bf';
		ctx.fillText(`${getTodayStr()} • ${state.role}`, W/2, 170);
		// Emoji
		ctx.font = '96px system-ui, Apple Color Emoji, Segoe UI Emoji';
		const pred = dataLoader.getPredictionFor(state.role, getTodayStr());
		ctx.fillText(pred.emoji || '🔮', W/2, 260);
		// Candle mini
		ctx.save();
		ctx.translate(W/2, 360);
		ctx.fillStyle = '#efe1ce';
		ctx.fillRect(-22, 0, 44, 80);
		const flameGrad = ctx.createRadialGradient(0, -26, 2, 0, -26, 20);
		flameGrad.addColorStop(0, '#ffd27a');
		flameGrad.addColorStop(0.6, '#ff9b42');
		flameGrad.addColorStop(1, 'rgba(255,155,66,0)');
		ctx.fillStyle = flameGrad;
		ctx.beginPath();
		ctx.ellipse(0, -26, 12, 20, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
		// Text block
		ctx.textAlign = 'left';
		ctx.fillStyle = '#e7e9ee';
		ctx.font = '32px system-ui, -apple-system, Segoe UI, Roboto';
		const margin = 120;
		wrapText(ctx, pred.text || '', margin, 460, W - margin*2, 44);
		// Footer
		ctx.textAlign = 'center';
		ctx.font = '20px system-ui, -apple-system, Segoe UI, Roboto';
		ctx.fillStyle = '#9aa3af';
		ctx.fillText('neprocrastinatory • github pages', W/2, H - 40);
		// Download
		const dataURL = canvas.toDataURL('image/png');
		const link = document.getElementById('downloadLink');
		link.href = dataURL;
		link.hidden = false;
		link.click();
	}

	function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
		const words = text.split(' ');
		let line = '';
		for (let n = 0; n < words.length; n++) {
			const testLine = line + words[n] + ' ';
			const metrics = ctx.measureText(testLine);
			if (metrics.width > maxWidth && n > 0) {
				ctx.fillText(line, x, y);
				line = words[n] + ' ';
				y += lineHeight;
			} else {
				line = testLine;
			}
		}
		ctx.fillText(line, x, y);
	}

	return { init };
})();

// Init
window.addEventListener('DOMContentLoaded', ui.init);