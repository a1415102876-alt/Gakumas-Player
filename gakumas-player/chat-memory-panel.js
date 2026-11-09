import { createChatMemoryStore, readProducerProfile, writeProducerProfile } from '../sandbox/chat-memory.js?v=20261107-chat-memory-v1';

export function createChatMemoryPanel({ root = document, selectedIdol, isBusy = () => false, onClear, onError } = {}) {
    const field = id => root.getElementById(id);
    const store = createChatMemoryStore();
    const dialog = field('gpChatMemory');
    const list = field('gpMemoryList');
    let page = 'profile', rows = [], total = 0, generation = 0, loading = false, clearing = false;
    let returnFocus;
    const selected = () => field('gpMemoryIdol').value;
    const status = (text, error = false) => {
        field('gpMemoryStatus').textContent = text;
        field('gpMemoryStatus').dataset.tone = error ? 'error' : '';
    };
    const reportError = (error, action = 'read') => {
        const message = action === 'write'
            ? '本轮对话未能保存到聊天记忆，请检查浏览器存储空间。当前回复仍可继续播放。'
            : '历史聊天记忆暂时无法读取，本次将使用当前页面中的近期对话。';
        onError?.(message);
        if (dialog.open) status(message, true);
    };
    function syncActions() {
        field('gpMemoryMoreBtn').hidden = rows.length >= total;
        field('gpMemoryMoreBtn').disabled = loading || clearing;
        field('gpMemoryClearBtn').disabled = loading || clearing || !total;
        field('gpMemoryExportBtn').disabled = loading || clearing || !total;
        field('gpMemoryIdol').disabled = clearing;
        field('gpMemoryClearConfirm').hidden = true;
    }
    function render() {
        field('gpMemoryCount').textContent = `与${selected()}共 ${total} 轮对话`;
        const fragment = root.createDocumentFragment();
        if (!rows.length) {
            const empty = root.createElement('p');
            empty.className = 'gp-settings-note gp-memory-empty';
            empty.textContent = `还没有与${selected()}的聊天记忆。成功回复后会自动保存，刷新页面也可以接着聊。`;
            fragment.append(empty);
        }
        for (const exchange of rows) {
            const article = root.createElement('article');
            article.className = 'gp-memory-exchange';
            const time = root.createElement('time');
            time.dateTime = new Date(exchange.createdAt).toISOString();
            time.textContent = new Date(exchange.createdAt).toLocaleString('zh-CN');
            article.append(time);
            for (const turn of [exchange.user, exchange.assistant]) {
                const line = root.createElement('div');
                line.className = 'gp-memory-line';
                line.dataset.role = turn.role;
                const label = root.createElement('strong');
                label.textContent = turn.role === 'user' ? '你' : exchange.idolId;
                const text = root.createElement('p');
                text.textContent = turn.text;
                line.append(label, text);
                article.append(line);
            }
            fragment.append(article);
        }
        list.replaceChildren(fragment);
        syncActions();
    }
    async function load({ more = false } = {}) {
        const current = ++generation;
        const idol = selected();
        loading = true;
        status('正在读取聊天记忆……');
        syncActions();
        try {
            const result = await store.list(idol, { offset: more ? rows.length : 0 });
            if (current !== generation) return;
            rows = more ? [...rows, ...result.rows] : result.rows;
            total = result.total;
            status(total ? `已保存 ${total} 轮；每次闲聊会参考近期对话，并按话题查找更早的记录。` : '聊天记忆会在每轮成功回复后自动保存。');
            render();
            if (!more) list.scrollTop = 0;
        } catch (error) {
            if (current !== generation) return;
            rows = []; total = 0;
            render();
            status('无法读取聊天记忆，请检查浏览器是否允许本地存储，然后重新打开重试。', true);
        } finally {
            if (current === generation) { loading = false; syncActions(); }
        }
    }
    function setPage(next) {
        page = next === 'history' ? 'history' : 'profile';
        for (const tab of root.querySelectorAll('[data-memory-tab]')) {
            const active = tab.dataset.memoryTab === page;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
        }
        field('gpProfilePanel').hidden = page !== 'profile';
        field('gpHistoryPanel').hidden = page !== 'history';
        status('');
        if (page === 'history') void load();
    }
    function open(next = 'profile') {
        if (!dialog.open) {
            returnFocus = root.activeElement;
            field('gpProducerProfile').value = readProducerProfile();
            const idol = selectedIdol?.();
            if ([...field('gpMemoryIdol').options].some(option => option.value === idol)) field('gpMemoryIdol').value = idol;
            dialog.showModal();
        }
        setPage(next);
        field(page === 'profile' ? 'gpProducerProfile' : 'gpMemoryIdol').focus();
    }
    field('gpProfileSaveBtn').addEventListener('click', () => {
        try {
            writeProducerProfile(field('gpProducerProfile').value);
            status('制作人档案已保存在本机，下次闲聊起生效。');
        } catch { status('制作人档案未保存，请检查浏览器存储空间后重试。', true); }
    });
    field('gpMemoryCloseBtn').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
        ++generation;
        loading = false;
        returnFocus?.focus?.({ preventScroll: true });
    });
    for (const tab of root.querySelectorAll('[data-memory-tab]')) {
        tab.addEventListener('click', () => setPage(tab.dataset.memoryTab));
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 'profile' : event.key === 'End' ? 'history' : page === 'profile' ? 'history' : 'profile';
            setPage(next);
            root.querySelector(`[data-memory-tab="${next}"]`).focus();
        });
    }
    field('gpMemoryIdol').addEventListener('change', () => { rows = []; total = 0; void load(); });
    field('gpMemoryMoreBtn').addEventListener('click', () => { void load({ more: true }); });
    field('gpMemoryClearBtn').addEventListener('click', () => {
        if (isBusy()) { status('请等当前回复完成后再清空聊天记忆。'); return; }
        field('gpMemoryClearText').textContent = `确定清空与${selected()}的全部聊天记忆？此操作无法撤销，其他偶像的记录和制作人档案会保留。`;
        field('gpMemoryClearConfirm').hidden = false;
    });
    field('gpMemoryKeepBtn').addEventListener('click', () => { field('gpMemoryClearConfirm').hidden = true; });
    field('gpMemoryDeleteBtn').addEventListener('click', async () => {
        if (isBusy() || clearing) return;
        const idol = selected();
        clearing = true;
        syncActions();
        try {
            await store.clear(idol);
            onClear?.(idol);
            rows = []; total = 0;
            render();
            status(`与${idol}的聊天记忆已清空。`);
        } catch { status('聊天记忆未能清空，请重试。', true); }
        finally { clearing = false; syncActions(); }
    });
    field('gpMemoryExportBtn').addEventListener('click', async () => {
        const idol = selected();
        try {
            const exchanges = await store.all(idol);
            const blob = new Blob([JSON.stringify({ version: 1, idol, exchanges }, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = root.createElement('a');
            link.href = url;
            link.download = `聊天记忆-${idol}-${new Date().toISOString().slice(0, 10)}.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            status('已导出这位偶像的完整聊天记忆。');
        } catch { status('聊天记忆导出失败，请重试。', true); }
    });
    return {
        open,
        profile: () => readProducerProfile(),
        context: (idol, query) => store.context(idol, query),
        reportError,
        async remember(idol, exchange) {
            await store.remember(idol, exchange);
            if (dialog.open && page === 'history' && selected() === idol) await load();
        },
    };
}
