// Cover, idol picker, falling petals and the opening sequence for the Gakuen theme.
// It only reads and writes the DOM. gakumas-player.js keeps owning all behaviour; the one
// thing shared is #chatIdolSelect, whose value this file sets and announces with a change event.

const IDOLS = [
  { id: 'kotone', name: '藤田琴音', color: '#fad356', line: '制作人，今天也一起加油吧。' },
  { id: 'hski', name: '花海咲季', color: '#ea4a5b', line: '目标当然是第一名，跟上来。' },
  { id: 'ttmr', name: '月村手毬', color: '#4fa0ce', line: '……别一直盯着我看。' },
  { id: 'hume', name: '花海佑芽', color: '#ff5f4f', line: '制作人！我今天也精神满满！' },
  { id: 'mao', name: '有村麻央', color: '#a453a6', line: '呵呵，今天要聊点什么呢？' },
  { id: 'kcna', name: '仓本千奈', color: '#f8ac5e', line: '我准备了很多话题哦。' },
  { id: 'kllj', name: '葛城莉莉娅', color: '#9fd8e6', line: '一起来想想接下来的计划吧。' },
  { id: 'ssmk', name: '紫云清夏', color: '#8fd63a', line: '来吧，今天也要全力以赴！' },
  { id: 'shro', name: '筱泽广', color: '#48c6da', line: '嗯……我在听，你说吧。' },
  { id: 'hrnm', name: '姬崎莉波', color: '#f4a4be', line: '辛苦了，要不要休息一下？' },
  { id: 'jsna', name: '十王星南', color: '#f4b66a', line: '给我听好了，制作人。' },
  { id: 'hmsz', name: '秦谷美铃', color: '#a0b6dc', line: '今天的天气，很适合发呆呢。' },
  { id: 'atbm', name: '雨夜燕', color: '#a396f3', line: '……有什么事吗？' },
];
const byId = new Map(IDOLS.map(idol => [idol.id, idol]));
const $ = id => document.getElementById(id);
const art = id => `./assets/ui/key/${id}.webp`;
const avatar = id => `./assets/ui/avatar/${id}.webp`;
const sprite = id => `./assets/ui/sd/${id}.webp`;
const OPENING_TRIO = ['kotone', 'hski', 'ttmr'];
const BAND_COLORS = ['#f28a00', '#ffb94d', '#ffe5ad', '#f28a00', '#ffcf78', '#ffd99a'];
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function petals(host, count, { size = [8, 16], fall = [9, 18] } = {}) {
  for (let i = 0; i < count; i += 1) {
    const petal = document.createElement('i');
    if (host.id === 'gpBackdrop') petal.className = 'gp-petal';
    const s = size[0] + Math.random() * (size[1] - size[0]);
    petal.style.cssText = `--x:${(Math.random() * 100).toFixed(1)}%;--s:${s.toFixed(1)}px;--t:${(fall[0] + Math.random() * (fall[1] - fall[0])).toFixed(1)}s;--d:${(-Math.random() * fall[1]).toFixed(1)}s;--r:${Math.round(Math.random() * 360)}deg`;
    host.append(petal);
  }
}

/* ---------- cover + picker ---------- */
const select = $('chatIdolSelect');
const cover = { current: '', timer: 0 };
function showIdol(id, { announce = true } = {}) {
  const idol = byId.get(id) || IDOLS[0];
  if (idol.id === cover.current) return;
  cover.current = idol.id;
  const card = $('gpCover');
  card?.style.setProperty('--gk-idol', idol.color);
  card?.style.setProperty('--chip-img', `url('${avatar(idol.id)}')`);
  document.documentElement.style.setProperty('--gk-idol', idol.color);
  document.documentElement.style.setProperty('--gk-sd', `url('${sprite(idol.id)}')`);
  const host = $('gpCoverArt');
  if (host) {
    let image = host.querySelector(`img[data-id="${idol.id}"]`);
    if (!image) {
      image = new Image();
      image.dataset.id = idol.id; image.alt = ''; image.className = 'gp-cover-img'; image.decoding = 'async'; image.src = art(idol.id);
      host.append(image);
    }
    const reveal = () => requestAnimationFrame(() => {
      host.querySelectorAll('.gp-cover-img.is-current').forEach(node => { if (node !== image) node.classList.remove('is-current'); });
      image.classList.add('is-current');
      [...host.querySelectorAll('.gp-cover-img:not(.is-current)')].slice(0, -2).forEach(node => node.remove());
    });
    if (image.complete) reveal(); else image.addEventListener('load', reveal, { once: true });
  }
  $('gpCoverName').textContent = idol.name;
  $('gpCoverLine').textContent = idol.line;
  const nowName = $('gpChatNowName'); if (nowName) nowName.textContent = idol.name;
  const nowImg = $('gpChatNowImg'); if (nowImg) nowImg.src = avatar(idol.id);
  document.querySelectorAll('.gp-idol').forEach(button => {
    const active = button.dataset.id === idol.id;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-checked', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
  });
  // The line bubble pops each time the idol changes.
  const bubble = $('gpCoverLine');
  bubble?.animate?.([{ transform: 'scale(.86)', opacity: 0 }, { transform: 'scale(1.04)', opacity: 1, offset: .6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  if (announce && select && select.value !== idol.id) {
    select.value = idol.id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function buildPicker() {
  const host = $('gpIdolPicker');
  if (!host) return;
  IDOLS.forEach((idol, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'gp-idol'; button.dataset.id = idol.id; button.setAttribute('role', 'radio');
    button.style.cssText = `--c:${idol.color};--n:${index}`;
    button.innerHTML = `<img src="${avatar(idol.id)}" alt="" width="52" height="52" loading="lazy" decoding="async"><span>${idol.name.length > 4 ? idol.name.slice(0, 2) + idol.name.slice(-2) : idol.name}</span>`;
    button.setAttribute('aria-label', idol.name);
    button.addEventListener('click', () => showIdol(idol.id));
    button.addEventListener('keydown', event => {
      const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = IDOLS[(index + step + IDOLS.length) % IDOLS.length];
      showIdol(next.id);
      host.querySelector(`[data-id="${next.id}"]`)?.focus();
    });
    host.append(button);
  });
}

// The player's own selector can change too (inside the chat bar). Follow it.
select?.addEventListener('change', () => showIdol(select.value, { announce: false }));

/* ---------- opening ---------- */
function runOpening() {
  const root = $('gpOpening');
  const html = document.documentElement;
  if (!root || html.getAttribute('data-opening') !== 'on') { root?.remove(); return Promise.resolve(); }

  const bands = $('gpOpBands');
  BAND_COLORS.forEach((color, i) => { const band = document.createElement('i'); band.style.cssText = `--c:${color};--i:${i}`; bands.append(band); });
  petals($('gpOpPetals'), 26, { size: [9, 20], fall: [6, 12] });
  const trio = $('gpOpTrio');
  OPENING_TRIO.forEach((id, k) => {
    const chibi = document.createElement('div');
    chibi.className = 'gp-op-chibi'; chibi.style.setProperty('--k', String(k === 1 ? 0 : k === 0 ? 1 : 2));
    chibi.innerHTML = `<i style="--sprite:url('${sprite(id)}')"></i>`;
    trio.append(chibi);
  });
  // Show the middle one first and the sides after, as a fan.
  const order = [1, 0, 2];
  [...trio.children].forEach((node, index) => node.style.setProperty('--k', String(order.indexOf(index))));

  // Real progress: the three sprites, the logo and the first cover must be decoded before the reveal.
  const wanted = [...OPENING_TRIO.map(sprite), './assets/logo.png', art('kotone'), './assets/ui/crest-coral.webp', './assets/petals.png'];
  let done = 0;
  const fill = $('gpOpFill');
  const preload = Promise.all(wanted.map(src => new Promise(resolve => {
    const image = new Image();
    const finish = () => { done += 1; if (fill) fill.style.width = `${Math.round(done / wanted.length * 100)}%`; resolve(); };
    image.onload = finish; image.onerror = finish; image.src = src;
  })));

  return new Promise(resolve => {
    const timers = [];
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      try { sessionStorage.setItem('gpOpeningSeen', '1'); } catch { /* storage blocked */ }
      root.classList.add('is-out');
      document.body.classList.add('gp-entering');
      html.setAttribute('data-opening', 'off');
      html.style.overflow = '';
      setTimeout(() => { root.remove(); resolve(); }, 1150);
      setTimeout(() => document.body.classList.remove('gp-entering'), 2200);
    };
    const skip = () => { skipped = true; finish(); };
    let skipped = false;
    $('gpOpSkip')?.addEventListener('click', skip);
    root.addEventListener('pointerdown', event => { if (event.target.closest('.gp-op-skip') || !root.classList.contains('is-trio')) return; skip(); });
    window.addEventListener('keydown', event => { if (!finished && (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ')) skip(); }, { once: false });

    requestAnimationFrame(() => root.classList.add('is-in'));
    at(520, () => root.classList.add('is-trio'));
    at(1500, () => { root.classList.add('is-logo'); trio.querySelectorAll('.gp-op-chibi').forEach(node => node.classList.add('is-bob')); });
    // Leave at 3.4 s, or as soon as everything is decoded after that. Never wait longer than 5 s.
    at(3400, () => preload.then(finish));
    at(5000, finish);
  });
}

/* ---------- boot ---------- */
buildPicker();
petals($('gpBackdrop'), reduceMotion() ? 0 : 12, { size: [8, 15], fall: [14, 28] });
const stored = (() => { try { return JSON.parse(localStorage.getItem('gpLastIdol') || 'null'); } catch { return null; } })();
showIdol(byId.has(stored) ? stored : (select?.value || 'kotone'));
document.querySelectorAll('.gp-idol').forEach(button => button.addEventListener('click', () => { try { localStorage.setItem('gpLastIdol', JSON.stringify(button.dataset.id)); } catch { /* ignore */ } }));
runOpening();
