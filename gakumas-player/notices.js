const STORAGE_KEY = 'gakumas-player-read-notices-v1';

export function normalizeNotices(data) {
  if (!data || !Array.isArray(data.notices)) throw new Error('通知格式不正确');
  const ids = new Set();
  return data.notices.flatMap(item => {
    if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.body !== 'string') return [];
    const id = item.id.trim(), title = item.title.trim(), body = item.body.trim();
    if (!id || !title || !body || ids.has(id)) return [];
    ids.add(id);
    return [{ id, title, body, date: typeof item.date === 'string' ? item.date.trim() : '' }];
  });
}

export function mountNotices(doc = document) {
  const button = doc.getElementById('gpNoticesBtn');
  const badge = doc.getElementById('gpNoticesBadge');
  const dialog = doc.getElementById('gpNotices');
  const list = doc.getElementById('gpNoticesList');
  const status = doc.getElementById('gpNoticesStatus');
  const retry = doc.getElementById('gpNoticesRetry');
  if (!button || !badge || !dialog || !list || !status || !retry) return;

  let notices = [], loaded = false, loading = null;
  let read = new Set();
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(stored)) read = new Set(stored.filter(id => typeof id === 'string'));
  } catch { /* Browser storage is optional. */ }

  function updateBadge() {
    const count = notices.filter(item => !read.has(item.id)).length;
    badge.hidden = !count;
    badge.textContent = count > 99 ? '99+' : String(count);
    button.setAttribute('aria-label', count ? `通知，${count} 条未读` : '通知');
  }

  function markRead() {
    notices.forEach(item => read.add(item.id));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...read])); } catch { /* Remains read for this page. */ }
    updateBadge();
  }

  function render() {
    list.replaceChildren();
    for (const item of notices) {
      const article = doc.createElement('article');
      article.className = 'gp-notice';
      if (item.date) {
        const time = doc.createElement('time');
        time.textContent = item.date;
        article.append(time);
      }
      const title = doc.createElement('h4');
      title.textContent = item.title;
      const body = doc.createElement('p');
      body.textContent = item.body;
      article.append(title, body);
      list.append(article);
    }
    status.textContent = notices.length ? '' : '暂无通知';
  }

  async function load() {
    if (loading) return loading;
    status.textContent = '正在加载通知…';
    retry.hidden = true;
    loading = (async () => {
      try {
        const response = await fetch(new URL('../notices.json', import.meta.url), { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        notices = normalizeNotices(await response.json());
        loaded = true;
        render();
        if (dialog.open) markRead(); else updateBadge();
      } catch (error) {
        status.textContent = '通知加载失败，请稍后重试。';
        retry.hidden = false;
        console.warn('通知加载失败', error);
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  button.addEventListener('click', () => {
    if (!dialog.open) dialog.showModal();
    if (loaded) markRead(); else load();
  });
  retry.addEventListener('click', load);
  load();
}

if (typeof document !== 'undefined') mountNotices();
