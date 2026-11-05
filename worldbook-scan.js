/**
 * SillyTavern worldbook import and scan for the standalone chat page.
 *
 * Field names follow the TavernLike importer (key, keysecondary, selectiveLogic,
 * scanDepth, position, recursion flags). Activation follows the tavern rules
 * this 初星学园 book actually depends on: primary keys are always OR, and
 * selectiveLogic applies only to secondary keys. NOT_ANY must stay off when a
 * secondary key such as "<beat" is present.
 */

export const HATSU_WORLDINFO_SETTINGS = {
    depth: 2,
    recursive: true,
    caseSensitive: false,
    matchWholeWords: false,
    budgetPercent: 100,
    budgetCap: 0,
    maxContext: 32768,
    maxRecursionSteps: 0,
    userName: '制作人',
};

const LOGIC = { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 };

function entryList(source) {
    if (Array.isArray(source)) return source;
    if (Array.isArray(source?.entries)) return source.entries;
    if (source?.entries && typeof source.entries === 'object') return Object.values(source.entries);
    return [];
}

function stringList(value) {
    const list = Array.isArray(value) ? value : String(value || '').split(/[、,，]/);
    return list.map(item => String(item || '').trim()).filter(Boolean);
}

export function importTavernWorldbook(source) {
    return entryList(source).map(raw => {
        if (!raw || typeof raw !== 'object') return null;
        const scanDepth = raw.scanDepth == null || raw.scanDepth === '' ? null : Number(raw.scanDepth);
        return {
            uid: raw.uid,
            key: stringList(raw.key ?? raw.keys),
            keysecondary: stringList(raw.keysecondary ?? raw.secondaryKeys),
            content: String(raw.content || ''),
            constant: Boolean(raw.constant),
            selective: raw.selective !== false,
            selectiveLogic: Number(raw.selectiveLogic ?? 0),
            order: Number(raw.order ?? 100),
            position: Number(raw.position ?? 1),
            scanDepth: Number.isFinite(scanDepth) ? scanDepth : null,
            caseSensitive: raw.caseSensitive ?? null,
            matchWholeWords: raw.matchWholeWords ?? null,
            excludeRecursion: Boolean(raw.excludeRecursion),
            preventRecursion: Boolean(raw.preventRecursion),
            disable: Boolean(raw.disable || raw.enabled === false),
            probability: Number(raw.probability ?? 100),
            useProbability: Boolean(raw.useProbability),
            ignoreBudget: Boolean(raw.ignoreBudget),
            comment: String(raw.comment || ''),
        };
    }).filter(entry => entry && !entry.disable && entry.content.trim());
}

function keyHits(haystack, needle, { caseSensitive, matchWholeWords }) {
    const key = String(needle || '');
    if (!key) return false;
    const text = caseSensitive ? haystack : haystack.toLowerCase();
    const sample = caseSensitive ? key : key.toLowerCase();
    if (!matchWholeWords) return text.includes(sample);
    const escaped = sample.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`).test(text);
}

function secondaryPasses(entry, text, options) {
    const secondary = entry.keysecondary || [];
    if (!entry.selective || !secondary.length) return true;
    const hits = secondary.map(key => keyHits(text, key, options));
    const logic = Number(entry.selectiveLogic ?? LOGIC.AND_ANY);
    if (logic === LOGIC.AND_ALL) return hits.every(Boolean);
    if (logic === LOGIC.NOT_ALL) return hits.some(hit => !hit);
    if (logic === LOGIC.NOT_ANY) return hits.every(hit => !hit);
    return hits.some(Boolean);
}

function entryMatches(entry, text, options) {
    if (!entry.key.length) return false;
    if (!entry.key.some(key => keyHits(text, key, options))) return false;
    return secondaryPasses(entry, text, options);
}

function scanText(entry, messages, recurseText, state, settings) {
    const depth = entry.scanDepth == null ? settings.depth : entry.scanDepth;
    const limited = depth > 0 ? messages.slice(0, depth).join('\n') : '';
    if (state !== 'recursion' || !recurseText) return limited;
    return [limited, recurseText].filter(Boolean).join('\n');
}

function matchOptions(entry, settings) {
    return {
        caseSensitive: entry.caseSensitive ?? settings.caseSensitive,
        matchWholeWords: entry.matchWholeWords ?? settings.matchWholeWords,
    };
}

function substituteMacros(content, { userName, characterName }) {
    return String(content || '')
        .replace(/\{\{\s*user\s*\}\}/gi, userName || '制作人')
        .replace(/\{\{\s*char\s*\}\}/gi, characterName || '');
}

/**
 * The affinity entries are EJS if/else chains that test includes('AFF_*').
 * TavernLike does not run EJS. Keep the first branch whose tag is in the
 * scanned text, and omit the entry when none match, so raw <% tags are not sent.
 */
export function renderWorldbookContent(content, scanTextValue) {
    const source = String(content || '');
    if (!source.includes('<%')) return source.trim();
    const tokens = source.split(/(<%[\s\S]*?%>)/);
    let include = false;
    let matched = false;
    let output = '';
    for (const token of tokens) {
        if (!token.startsWith('<%')) {
            if (include) output += token;
            continue;
        }
        const raw = token.replace(/^<%_?/, '').replace(/_?%>$/, '').trim();
        if (!raw || raw === '}') {
            include = false;
            continue;
        }
        const code = raw.replace(/^\}\s*/, '');
        const tag = code.match(/includes\(\s*['"]([^'"]+)['"]\s*\)/);
        if (/^(?:if|else if)\b/.test(code)) {
            const hit = Boolean(tag) && String(scanTextValue || '').includes(tag[1]);
            include = hit && !matched;
            if (hit) matched = true;
        } else if (/^else\b/.test(code)) {
            include = !matched;
        }
    }
    return output.trim();
}

function budgetLimit(settings) {
    const percent = Number(settings.budgetPercent);
    const context = Number(settings.maxContext) > 0 ? Number(settings.maxContext) : 32768;
    let budget = Math.round((Number.isFinite(percent) ? percent : 100) / 100 * context);
    const cap = Number(settings.budgetCap) || 0;
    if (cap > 0) budget = Math.min(budget, cap);
    return Math.max(0, budget);
}

/**
 * @param {object[]|object} source imported entries, or a tavern worldbook object
 * @param {string[]|string} messages newest message first, matching SillyTavern's scan buffer
 */
export function activateTavernWorldbook(source, messages, options = {}) {
    const settings = { ...HATSU_WORLDINFO_SETTINGS, ...options };
    const entries = importTavernWorldbook(source);
    const buffer = Array.isArray(messages) ? messages.map(item => String(item || '')) : [String(messages || '')];
    const byOrder = [...entries].sort((a, b) => b.order - a.order || Number(a.uid || 0) - Number(b.uid || 0));
    const activated = [];
    const seen = new Set();
    let state = 'initial';
    let recurseText = '';
    let spent = 0;
    const budget = budgetLimit(settings);
    const random = typeof settings.random === 'function' ? settings.random : Math.random;
    let steps = 0;

    while (state) {
        const found = [];
        for (const entry of byOrder) {
            if (seen.has(entry)) continue;
            if (state === 'recursion' && entry.excludeRecursion) continue;
            const text = scanText(entry, buffer, recurseText, state, settings);
            const optionsForEntry = matchOptions(entry, settings);
            const matched = entry.constant || entryMatches(entry, text, optionsForEntry);
            if (!matched) continue;
            if (entry.useProbability && entry.probability < 100 && random() * 100 > entry.probability) {
                seen.add(entry);
                continue;
            }
            const rendered = renderWorldbookContent(
                substituteMacros(entry.content, settings),
                text,
            );
            seen.add(entry);
            if (!rendered) continue;
            found.push({ ...entry, rendered });
        }
        if (!found.length) break;
        const recurseParts = [];
        for (const entry of found) {
            if (!entry.ignoreBudget && spent + entry.rendered.length > budget) continue;
            spent += entry.rendered.length;
            activated.push(entry);
            if (!entry.preventRecursion) recurseParts.push(entry.rendered);
        }
        steps += 1;
        const stepLimit = Number(settings.maxRecursionSteps) || 0;
        if (!settings.recursive || !recurseParts.length || (stepLimit && steps >= stepLimit)) break;
        state = 'recursion';
        recurseText = [recurseText, ...recurseParts].filter(Boolean).join('\n');
    }

    const positionRank = position => (position === 0 ? 0 : position === 1 ? 1 : 2);
    return activated
        .sort((a, b) => positionRank(a.position) - positionRank(b.position) || a.order - b.order)
        .map(entry => ({
            content: entry.rendered,
            comment: entry.comment,
            order: entry.order,
            position: entry.position,
        }));
}

export async function loadTavernWorldbook(name = '初星学园', fetchImpl = globalThis.fetch) {
    const url = new URL(`./worldbook/${encodeURIComponent(name)}.json`, import.meta.url);
    const response = await fetchImpl(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error('无法读取世界书');
    return importTavernWorldbook(await response.json());
}
