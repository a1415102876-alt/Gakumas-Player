(function (global) {
  "use strict";

  const DEFAULT_REFERENCE_ID = "e4887b71abdc465eb96398c1cacf1c27";
  const SAKI_REFERENCE_ID = "cd818f9ccbd142b893511e2d7181e638";
  const TEMARI_REFERENCE_ID = "4b254094b9664c42a0fbf18696dcf77a";
  const HIRO_REFERENCE_ID = "f4f557d7cc154603bc5abd7549e910d0";
  const MISUZU_REFERENCE_ID = "de0abe9c782f49bc9c22363cae7eb2f1";
  const LILJA_REFERENCE_ID = "6af0b79d645d43928e6adbe8d1d0606b";
  const SENA_REFERENCE_ID = "9934972619db41f4b6364f5e0ffc9fb0";
  const UME_REFERENCE_ID = "ce90bb98872a4cf0a81c39f1fc24707e";
  const RINAMI_REFERENCE_ID = "fb23cd92823d4274a517d7d5bb3340ec";
  const CHINA_REFERENCE_ID = "f6e6061c803c4d8fa371fdf658c35e2a";
  const TSUBAME_REFERENCE_ID = "39d27c7315044ebab7997e160b2d7f74";
  const SUMIKA_REFERENCE_ID = "4199b1062c28461ca822d130138e99d1";
  const MAO_REFERENCE_ID = "4199b1062c28461ca822d130138e99d1";
  const RINHA_REFERENCE_ID = "7eee5c0eca834d529902e9bfcd810d7f";
  const ASARI_REFERENCE_ID = "d58dc7b87a554a72a03c6cfd64b53816";
  const DEFAULT_WORKER_ORIGIN = "https://hatsuboshitest.a1415102876.workers.dev";
  const DEFAULT_MODEL = "s2.1-pro-free";
  const PRONUNCIATION_VERSION = "20261103-krnh-nasr-tts-v1";
  // User-supplied kana readings; generated offline with tools/generate-fish-pronunciation.py.
  // Pitch is OpenJTalk's default inference, not extracted game voice accent.
  // Spoken lines use full names, given names, and the simplified Chinese spellings.
  // Bare 広 / 广 stay out: they also occur inside 広い and would be forced to ひろ.
  const PRONUNCIATION_RULES = Object.freeze([
    ["藤田ことね", "ふじた　ことね", "fu1ji0ta0ko0to0ne0"],
    ["藤田琴音", "ふじた　ことね", "fu1ji0ta0ko0to0ne0"],
    ["月村手毬", "つきむら　てまり", "tsu1ki0mu0ra1te1ma0ri0"],
    ["花海咲季", "はなみ　さき", "ha0na1mi1sa1ki1"],
    ["秦谷美鈴", "はたや　みすず", "ha1ta0ya0mi0su1zu1"],
    ["秦谷美铃", "はたや　みすず", "ha1ta0ya0mi0su1zu1"],
    ["花海佑芽", "はなみ　うめ", "ha0na1mi1u0me1"],
    ["有村麻央", "ありむら　まお", "a1ri0mu0ra1ma0o1"],
    ["葛城リーリヤ", "かつらぎ　りーりや", "ka0tsu1ra1gi1ri1i1ri1ya0"],
    ["葛城莉莉娅", "かつらぎ　りーりや", "ka0tsu1ra1gi1ri1i1ri1ya0"],
    ["倉本千奈", "くらもと　ちな", "ku0ra1mo0to0chi1na0"],
    ["仓本千奈", "くらもと　ちな", "ku0ra1mo0to0chi1na0"],
    ["紫雲清夏", "しうん　すみか", "shi0u1N1su1mi0ka0"],
    ["紫云清夏", "しうん　すみか", "shi0u1N1su1mi0ka0"],
    ["篠澤広", "しのさわ　ひろ", "shi1no0sa1wa0hi1ro0"],
    ["篠沢広", "しのさわ　ひろ", "shi1no0sa1wa0hi1ro0"],
    ["筱泽广", "しのさわ　ひろ", "shi1no0sa1wa0hi1ro0"],
    ["姫崎莉波", "ひめさき　りなみ", "hi1me0sa0ki0ri0na1mi0"],
    ["姬崎莉波", "ひめさき　りなみ", "hi1me0sa0ki0ri0na1mi0"],
    ["十王星南", "じゅうおう　せな", "ju0u1o1o1se1na0"],
    ["雨夜燕", "あまや　つばめ", "a1ma0ya0tsu0ba1me1"],
    ["賀陽燐羽", "かや　りんは", "ka1ya0ri1N1ha0"],
    ["贺阳燐羽", "かや　りんは", "ka1ya0ri1N1ha0"],
    ["根緒亜紗里", "ねづ　あさり", "ne1zu0a1sa0ri0"],
    ["根绪亚纱里", "ねづ　あさり", "ne1zu0a1sa0ri0"],
    ["shiun sumika", "しうん　すみか", "shi0u1N1su1mi0ka0"],
    ["shiun-sumika", "しうん　すみか", "shi0u1N1su1mi0ka0"],
    ["arimura mao", "ありむら　まお", "a1ri0mu0ra1ma0o1"],
    ["arimura-mao", "ありむら　まお", "a1ri0mu0ra1ma0o1"],
    ["amaya tsubame", "あまや　つばめ", "a1ma0ya0tsu0ba1me1"],
    ["amaya-tsubame", "あまや　つばめ", "a1ma0ya0tsu0ba1me1"],
    ["莉莉娅", "りーりや", "ri1i1ri1ya0"],
    ["リーリヤ", "りーりや", "ri1i1ri1ya0"],
    ["ことね", "ことね", "ko0to0ne0"],
    ["琴音", "ことね", "ko0to0ne0"],
    ["咲季", "さき", "sa1ki1"],
    ["手毬", "てまり", "te1ma0ri0"],
    ["美鈴", "みすず", "mi0su1zu1"],
    ["美铃", "みすず", "mi0su1zu1"],
    ["佑芽", "うめ", "u0me1"],
    ["麻央", "まお", "ma0o1"],
    ["千奈", "ちな", "chi1na0"],
    ["清夏", "すみか", "su1mi0ka0"],
    ["莉波", "りなみ", "ri0na1mi0"],
    ["星南", "せな", "se1na0"],
    ["初星", "はつぼし", "ha0tsu1bo0shi0"],
    ["燕", "つばめ", "tsu0ba1me1"],
    ["燐羽", "りんは", "ri1N1ha0"],
    ["亚纱里", "あさり", "a1sa0ri0"],
    ["亜紗里", "あさり", "a1sa0ri0"],
    ["毬", "まり", "ma0ri1"]
  ].map(([key, reading, value]) => Object.freeze({ key, reading, value })));
  const ALLOWED_TAGS = Object.freeze(["soft", "pause", "long pause", "emphasis", "excited", "sighing"]);
  const ALLOWED_TAG_SET = new Set(ALLOWED_TAGS);
  const KOTONE_NAMES = new Set([
    "kotone", "fujita kotone", "fujita-kotone", "fktn", "藤田琴音", "琴音"
  ]);
  const VOICE_REFERENCE_BY_NAME = new Map([
    ...[...KOTONE_NAMES].map((name) => [name, DEFAULT_REFERENCE_ID]),
    ["hski", SAKI_REFERENCE_ID],
    ["saki", SAKI_REFERENCE_ID],
    ["hanami saki", SAKI_REFERENCE_ID],
    ["hanami-saki", SAKI_REFERENCE_ID],
    ["花海咲季", SAKI_REFERENCE_ID],
    ["咲季", SAKI_REFERENCE_ID],
    ["ttmr", TEMARI_REFERENCE_ID],
    ["temari", TEMARI_REFERENCE_ID],
    ["tsukimura temari", TEMARI_REFERENCE_ID],
    ["tsukimura-temari", TEMARI_REFERENCE_ID],
    ["月村手毬", TEMARI_REFERENCE_ID],
    ["手毬", TEMARI_REFERENCE_ID],
    ["shro", HIRO_REFERENCE_ID],
    ["hiro", HIRO_REFERENCE_ID],
    ["shinosawa hiro", HIRO_REFERENCE_ID],
    ["筱泽广", HIRO_REFERENCE_ID],
    ["篠澤広", HIRO_REFERENCE_ID],
    ["广", HIRO_REFERENCE_ID],
    ["hmsz", MISUZU_REFERENCE_ID],
    ["misuzu", MISUZU_REFERENCE_ID],
    ["hataya misuzu", MISUZU_REFERENCE_ID],
    ["秦谷美铃", MISUZU_REFERENCE_ID],
    ["美铃", MISUZU_REFERENCE_ID],
    ["kllj", LILJA_REFERENCE_ID],
    ["lilja", LILJA_REFERENCE_ID],
    ["katsuragi lilja", LILJA_REFERENCE_ID],
    ["葛城莉莉娅", LILJA_REFERENCE_ID],
    ["莉莉娅", LILJA_REFERENCE_ID],
    ["jsna", SENA_REFERENCE_ID],
    ["sena", SENA_REFERENCE_ID],
    ["juo sena", SENA_REFERENCE_ID],
    ["十王星南", SENA_REFERENCE_ID],
    ["星南", SENA_REFERENCE_ID],
    ["hume", UME_REFERENCE_ID],
    ["ume", UME_REFERENCE_ID],
    ["hanami ume", UME_REFERENCE_ID],
    ["花海佑芽", UME_REFERENCE_ID],
    ["佑芽", UME_REFERENCE_ID],
    ["hrnm", RINAMI_REFERENCE_ID],
    ["rinami", RINAMI_REFERENCE_ID],
    ["himesaki rinami", RINAMI_REFERENCE_ID],
    ["姬崎莉波", RINAMI_REFERENCE_ID],
    ["莉波", RINAMI_REFERENCE_ID],
    ["kcna", CHINA_REFERENCE_ID],
    ["china", CHINA_REFERENCE_ID],
    ["kuramoto china", CHINA_REFERENCE_ID],
    ["仓本千奈", CHINA_REFERENCE_ID],
    ["千奈", CHINA_REFERENCE_ID],
    ["atbm", TSUBAME_REFERENCE_ID],
    ["tsubame", TSUBAME_REFERENCE_ID],
    ["amaya tsubame", TSUBAME_REFERENCE_ID],
    ["amaya-tsubame", TSUBAME_REFERENCE_ID],
    ["雨夜燕", TSUBAME_REFERENCE_ID],
    ["燕", TSUBAME_REFERENCE_ID],
    ["ssmk", SUMIKA_REFERENCE_ID],
    ["sumika", SUMIKA_REFERENCE_ID],
    ["shiun sumika", SUMIKA_REFERENCE_ID],
    ["shiun-sumika", SUMIKA_REFERENCE_ID],
    ["紫云清夏", SUMIKA_REFERENCE_ID],
    ["清夏", SUMIKA_REFERENCE_ID],
    ["amao", MAO_REFERENCE_ID],
    ["mao", MAO_REFERENCE_ID],
    ["arimura mao", MAO_REFERENCE_ID],
    ["arimura-mao", MAO_REFERENCE_ID],
    ["有村麻央", MAO_REFERENCE_ID],
    ["麻央", MAO_REFERENCE_ID],
    ["krnh", RINHA_REFERENCE_ID],
    ["rinha", RINHA_REFERENCE_ID],
    ["kaya rinha", RINHA_REFERENCE_ID],
    ["kaya-rinha", RINHA_REFERENCE_ID],
    ["贺阳燐羽", RINHA_REFERENCE_ID],
    ["賀陽燐羽", RINHA_REFERENCE_ID],
    ["燐羽", RINHA_REFERENCE_ID],
    ["小燐", RINHA_REFERENCE_ID],
    ["nasr", ASARI_REFERENCE_ID],
    ["asari", ASARI_REFERENCE_ID],
    ["nezu asari", ASARI_REFERENCE_ID],
    ["nezu-asari", ASARI_REFERENCE_ID],
    ["根绪亚纱里", ASARI_REFERENCE_ID],
    ["根緒亜紗里", ASARI_REFERENCE_ID],
    ["亚纱里", ASARI_REFERENCE_ID],
    ["亚纱里老师", ASARI_REFERENCE_ID],
    ["亜紗里", ASARI_REFERENCE_ID]
  ]);

  const state = {
    enabled: false,
    proxyUrl: "",
    referenceId: DEFAULT_REFERENCE_ID,
    model: DEFAULT_MODEL,
    apiKey: "",
    session: 0,
    queue: [],
    running: false,
    seen: new Set(),
    prepared: new Map(),
    prepareQueue: [],
    prepareActive: 0,
    fetchControllers: new Set(),
    audio: null,
    objectUrls: new Set(),
    onError: null,
    onStatus: null
  };

  function getDefaultProxyUrl() {
    const configured = String(global.HATSU_FISH_TTS_PROXY || "").trim();
    if (configured) return configured;
    try {
      const pageUrl = new URL(global.location?.href || "", global.location?.origin || undefined);
      const hostname = String(pageUrl.hostname || "").toLowerCase();
      if (/\.workers\.dev$/i.test(hostname) || /hatsuboshi\.vercel\.app$/i.test(hostname)) {
        return new URL("/api/fish-tts", pageUrl.origin).href;
      }
      if (/hatsu-produce-local/i.test(pageUrl.pathname || "")) {
        return `${DEFAULT_WORKER_ORIGIN}/api/fish-tts`;
      }
    } catch (error) { /* use the relative fallback below */ }
    // A relative /api URL is protected by SillyTavern's global CSRF
    // middleware. Keep it only as an explicit user override; the default
    // must go straight to the configured Worker proxy.
    return `${DEFAULT_WORKER_ORIGIN}/api/fish-tts`;
  }

  function normalizeProxyUrl(value) {
    const candidate = String(value || "").replace(/\s+/g, "");
    if (!candidate || /^\/api\/fish-tts\/?$/i.test(candidate)) return `${DEFAULT_WORKER_ORIGIN}/api/fish-tts`;
    return candidate;
  }

  const DEFAULT_PROXY_URL = getDefaultProxyUrl();
  state.proxyUrl = normalizeProxyUrl(DEFAULT_PROXY_URL);

  function decodeEntities(value) {
    return String(value || "")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&")
      .replace(/&#39;/gi, "'")
      .replace(/&quot;/gi, '"');
  }

  function normalizeSpeaker(value) {
    return decodeEntities(value)
      .replace(/\([^)]*\)/g, "")
      .replace(/[（（][^））]*[））]/g, "")
      .replace(/[：:，,。！？!?]/g, " ")
      .trim()
      .toLowerCase();
  }

  function isKotoneSpeaker(value) {
    const normalized = normalizeSpeaker(value);
    if (!normalized) return false;
    if (KOTONE_NAMES.has(normalized)) return true;
    return /(?:^|\s)(?:kotone|fujita\s+kotone|fujita-kotone|fktn)(?:$|\s)/i.test(normalized);
  }

  function referenceIdForSpeaker(value) {
    const normalized = normalizeSpeaker(value);
    if (!normalized) return "";
    if (VOICE_REFERENCE_BY_NAME.has(normalized)) return VOICE_REFERENCE_BY_NAME.get(normalized);
    if (isKotoneSpeaker(value)) return DEFAULT_REFERENCE_ID;
    if (/(?:^|\s)(?:hski|hanami\s+saki|hanami-saki)(?:$|\s)/i.test(normalized)) return SAKI_REFERENCE_ID;
    if (/(?:^|\s)(?:ttmr|tsukimura\s+temari|tsukimura-temari)(?:$|\s)/i.test(normalized)) return TEMARI_REFERENCE_ID;
    if (/(?:^|\s)(?:shro|hiro|shinosawa\s+hiro)(?:$|\s)/i.test(normalized)) return HIRO_REFERENCE_ID;
    if (/(?:^|\s)(?:hmsz|misuzu|hataya\s+misuzu)(?:$|\s)/i.test(normalized)) return MISUZU_REFERENCE_ID;
    if (/(?:^|\s)(?:kllj|lilja|katsuragi\s+lilja)(?:$|\s)/i.test(normalized)) return LILJA_REFERENCE_ID;
    if (/(?:^|\s)(?:jsna|sena|juo\s+sena)(?:$|\s)/i.test(normalized)) return SENA_REFERENCE_ID;
    if (/(?:^|\s)(?:hume|ume|hanami\s+ume)(?:$|\s)/i.test(normalized)) return UME_REFERENCE_ID;
    if (/(?:^|\s)(?:hrnm|rinami|himesaki\s+rinami)(?:$|\s)/i.test(normalized)) return RINAMI_REFERENCE_ID;
    if (/(?:^|\s)(?:kcna|china|kuramoto\s+china)(?:$|\s)/i.test(normalized)) return CHINA_REFERENCE_ID;
    if (/(?:^|\s)(?:krnh|rinha|kaya\s+rinha|kaya-rinha)(?:$|\s)/i.test(normalized)) return RINHA_REFERENCE_ID;
    if (/(?:^|\s)(?:nasr|asari|nezu\s+asari|nezu-asari)(?:$|\s)/i.test(normalized)) return ASARI_REFERENCE_ID;
    return "";
  }

  function sanitizeFishTags(value) {
    const source = decodeEntities(value)
      .replace(/<[^>]*>/g, "")
      .replace(/\[([^\]]*)\]/g, (match, rawTag) => {
        const tag = String(rawTag || "").trim().toLowerCase();
        return ALLOWED_TAG_SET.has(tag) ? `[${tag}]` : "";
      });
    return source.replace(/\s{2,}/g, " ").trim();
  }

  function stripTtsTags(value) {
    return decodeEntities(value)
      .replace(/<tts\b[^>]*>[\s\S]*?<\/tts>/gi, "")
      .replace(/<tts\b[^>]*>[\s\S]*$/gi, "")
      .replace(/<display\b[^>]*>([\s\S]*?)<\/display>/gi, "$1")
      .replace(/<display\b[^>]*>/gi, "")
      .replace(/<\/display>/gi, "")
      .trim();
  }

  function parseLocalizedText(value, speaker = "") {
    const source = decodeEntities(value).trim();
    const displayMatch = source.match(/<display\b[^>]*\blang=["']zh["'][^>]*>([\s\S]*?)<\/display>/i)
      || source.match(/<display\b[^>]*>([\s\S]*?)<\/display>/i);
    const ttsMatch = source.match(/<tts\b[^>]*\blang=["']ja["'][^>]*>([\s\S]*?)<\/tts>/i)
      || source.match(/<tts\b[^>]*>([\s\S]*?)<\/tts>/i);
    const display = String(displayMatch?.[1] || stripTtsTags(source)).trim();
    const ttsText = referenceIdForSpeaker(speaker) ? sanitizeFishTags(ttsMatch?.[1] || "") : "";
    return { display, ttsText };
  }

  function emitStatus(status, item = null) {
    try { state.onStatus?.(status, item); } catch (error) { console.warn("[FishTTS] status callback failed", error); }
  }

  function emitError(error, item = null) {
    const message = String(error?.message || error || "Fish Audio TTS 失败");
    try { state.onError?.(message, item); } catch (callbackError) { console.warn("[FishTTS] error callback failed", callbackError); }
  }

  function describeFishError(payload) {
    if (!payload || typeof payload !== "object") return String(payload || "").trim();
    const parts = [];
    const push = (value) => {
      const text = String(value ?? "").trim();
      if (text && !parts.includes(text)) parts.push(text);
    };
    push(payload.message);
    push(payload.reason);
    push(payload.status);
    push(payload.error);
    if (typeof payload.detail === "string") {
      try {
        const nested = JSON.parse(payload.detail);
        if (nested && typeof nested === "object") {
          push(nested.message);
          push(nested.reason);
          push(nested.status);
        } else {
          push(payload.detail);
        }
      } catch (error) {
        push(payload.detail);
      }
    } else {
      push(payload.detail);
    }
    return parts.join("; ");
  }

  function revokeUrl(url) {
    if (!url) return;
    state.objectUrls.delete(url);
    try { global.URL?.revokeObjectURL?.(url); } catch (error) { /* best effort */ }
  }

  function releaseAudio() {
    const audio = state.audio;
    if (!audio) return;
    state.audio = null;
    try { audio._fishStop?.(); } catch (error) { /* best effort */ }
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load?.();
    } catch (error) { /* best effort */ }
  }

  function stopPlayback() {
    releaseAudio();
  }

  function configure(options = {}) {
    if (Object.hasOwn(options, "enabled")) state.enabled = Boolean(options.enabled);
    if (Object.hasOwn(options, "proxyUrl")) state.proxyUrl = normalizeProxyUrl(options.proxyUrl || DEFAULT_PROXY_URL);
    if (Object.hasOwn(options, "referenceId")) state.referenceId = String(options.referenceId || DEFAULT_REFERENCE_ID).trim() || DEFAULT_REFERENCE_ID;
    if (Object.hasOwn(options, "model")) state.model = String(options.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    if (Object.hasOwn(options, "apiKey")) state.apiKey = String(options.apiKey || "").trim();
    if (Object.hasOwn(options, "onError")) state.onError = typeof options.onError === "function" ? options.onError : null;
    if (Object.hasOwn(options, "onStatus")) state.onStatus = typeof options.onStatus === "function" ? options.onStatus : null;
    if (!state.enabled) cancel("disabled");
    return getConfig();
  }

  function getConfig() {
    return {
      enabled: state.enabled,
      proxyUrl: state.proxyUrl,
      referenceId: state.referenceId,
      model: state.model,
      pronunciationVersion: PRONUNCIATION_VERSION,
      hasApiKey: Boolean(state.apiKey)
    };
  }

  function beginSession(sessionId) {
    cancel("new_session");
    state.session = String(sessionId || Date.now());
    state.seen.clear();
    return state.session;
  }

  async function fetchAudio(item, controller) {
    if (!state.apiKey) {
      throw new Error("Fish Audio API Key 未配置");
    }
    const active = controller || new AbortController();
    const ownedController = !controller;
    if (ownedController) state.fetchControllers.add(active);
    try {
      const headers = {
        "Content-Type": "application/json",
        Accept: "audio/mpeg, audio/wav, application/octet-stream, application/json"
      };
      // Keep the key in memory only and send it over HTTPS to the configured
      // proxy. The bundled Worker can use this header, so no deployment secret
      // is required while the system-console field is being used.
      if (state.apiKey) {
        headers.Authorization = `Bearer ${state.apiKey}`;
      }
      const payload = {
        text: item.text,
        reference_id: item.referenceId || state.referenceId,
        format: "mp3",
        model: state.model
      };
      const items = PRONUNCIATION_RULES
        .filter((rule) => item.text.toLocaleLowerCase().includes(rule.key.toLocaleLowerCase()))
        .sort((left, right) => right.key.length - left.key.length)
        .map(({ key, value }) => ({ key, value, case_sensitive: false }));
      if (items.length) payload.pronunciation_dictionary = [{ items }];
      const response = await global.fetch(state.proxyUrl, {
        method: "POST",
        headers,
        signal: active.signal,
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        let detail = "";
        try {
          const contentType = response.headers?.get?.("content-type") || "";
          if (contentType.includes("json")) {
            const payload = await response.json();
            detail = describeFishError(payload);
          } else {
            detail = await response.text();
          }
        } catch (error) { /* ignore */ }
        throw new Error(`Fish Audio HTTP ${response.status}${detail ? `: ${String(detail).slice(0, 180)}` : ""}`);
      }
      const contentType = response.headers?.get?.("content-type") || "";
      if (contentType.includes("json")) {
        const payload = await response.json();
        if (payload?.audio) {
          const binary = Uint8Array.from(atob(payload.audio), char => char.charCodeAt(0));
          return new Blob([binary], { type: "audio/mpeg" });
        }
        throw new Error("Fish Audio 返回了无音频数据的 JSON");
      }
      return await response.blob();
    } finally {
      if (ownedController) state.fetchControllers.delete(active);
    }
  }

  function playBlob(blob, item, hooks = {}) {
    const url = global.URL.createObjectURL(blob);
    state.objectUrls.add(url);
    const audio = new Audio();
    state.audio = audio;
    audio.preload = "auto";
    audio.src = url;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        revokeUrl(url);
        if (state.audio === audio) state.audio = null;
        try { hooks.onPlaybackEnd?.(audio, { item, error: error || null }); } catch (callbackError) { /* best effort */ }
        if (error) reject(error); else resolve(true);
      };
      audio._fishStop = () => finish(new Error("stopped"));
      audio.onended = () => finish();
      audio.onerror = () => finish(new Error("Fish Audio 音频播放失败"));
      try { hooks.onAudio?.(audio, { item, url }); } catch (callbackError) { /* best effort */ }
      audio.play().catch(finish);
    }).finally(() => {
      try { audio.pause(); } catch (error) { /* best effort */ }
    });
  }

  async function pump() {
    if (state.running || !state.enabled) return;
    state.running = true;
    const runSession = state.session;
    while (state.queue.length && state.enabled && runSession === state.session) {
      const item = state.queue.shift();
      if (!item || item.session !== state.session) { item?.resolve?.(false); continue; }
      try {
        emitStatus("generating", item);
        const blob = await fetchAudio(item);
        if (!state.enabled || item.session !== state.session) { item.resolve(false); continue; }
        emitStatus("playing", item);
        await playBlob(blob, item);
        item.resolve(true);
      } catch (error) {
        if (error?.name === "AbortError" || String(error?.message || "").toLowerCase().includes("aborted")) item.resolve(false);
        else if (item.session !== state.session) item.resolve(false);
        else { emitError(error, item); item.resolve(false); }
      } finally {
        if (runSession !== state.session) state.running = false;
      }
    }
    if (runSession === state.session) {
      state.running = false;
      emitStatus("idle");
    }
  }

  function lineKey(session, id, text, referenceId) {
    return `${PRONUNCIATION_VERSION}|${session}|${String(id || "")}|${referenceId || ""}|${text}`;
  }

  function pumpPrepare() {
    const limit = 2;
    while (state.prepareActive < limit && state.prepareQueue.length) {
      const entry = state.prepareQueue.shift();
      if (!entry || entry.session !== String(state.session)) {
        entry?.resolve?.(null);
        continue;
      }
      state.prepareActive += 1;
      const controller = new AbortController();
      entry.controller = controller;
      state.fetchControllers.add(controller);
      fetchAudio(entry, controller).then((blob) => {
        if (entry.session !== String(state.session)) {
          entry.resolve(null);
          return null;
        }
        entry.blob = blob;
        entry.resolve({ id: entry.id, text: entry.text, blob });
        return blob;
      }).catch((error) => {
        const aborted = error?.name === "AbortError" || String(error?.message || "").toLowerCase().includes("aborted");
        if (!aborted && entry.session === String(state.session)) emitError(error, entry);
        entry.resolve(null);
        return null;
      }).finally(() => {
        state.fetchControllers.delete(controller);
        state.prepareActive = Math.max(0, state.prepareActive - 1);
        if (entry.session === String(state.session)) pumpPrepare();
      });
    }
  }

  function prioritizePrepared(key) {
    const index = state.prepareQueue.findIndex((entry) => entry.key === key);
    if (index > 0) {
      const [entry] = state.prepareQueue.splice(index, 1);
      state.prepareQueue.unshift(entry);
    }
  }

  function prepare(options = {}) {
    const speaker = String(options.speaker || "");
    const text = sanitizeFishTags(options.text || options.ttsText || "");
    const referenceId = referenceIdForSpeaker(speaker);
    const session = String(options.session || state.session);
    if (!state.enabled || !state.apiKey || !referenceId || !text) return Promise.resolve(null);
    if (session !== String(state.session)) return Promise.resolve(null);
    const key = lineKey(session, options.id, text, referenceId);
    const existing = state.prepared.get(key);
    if (existing) return existing.promise;
    let resolvePromise = null;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    const entry = {
      key,
      id: String(options.id || ""),
      speaker,
      text,
      referenceId,
      session,
      priority: Number(options.priority ?? 0),
      promise,
      resolve: resolvePromise,
      blob: null
    };
    state.prepared.set(key, entry);
    state.prepareQueue.push(entry);
    state.prepareQueue.sort((left, right) => left.priority - right.priority);
    pumpPrepare();
    return promise;
  }

  async function playPrepared(options = {}) {
    const session = String(options.session || state.session);
    const text = sanitizeFishTags(options.text || options.ttsText || "");
    prioritizePrepared(lineKey(session, options.id, text, referenceIdForSpeaker(options.speaker)));
    const prepared = await prepare(options);
    if (!prepared?.blob) return false;
    if (session !== String(state.session)) return false;
    if (typeof options.isCurrent === "function" && !options.isCurrent()) return false;
    stopPlayback();
    if (session !== String(state.session)) return false;
    if (typeof options.isCurrent === "function" && !options.isCurrent()) return false;
    try {
      await playBlob(prepared.blob, prepared, {
        onAudio: options.onAudio,
        onPlaybackEnd: options.onPlaybackEnd,
      });
      return true;
    } catch (error) {
      if (String(error?.message || "") === "stopped") return false;
      emitError(error, prepared);
      return false;
    }
  }

  function enqueue(options = {}) {
    const speaker = String(options.speaker || "");
    const text = sanitizeFishTags(options.text || options.ttsText || "");
    const referenceId = referenceIdForSpeaker(speaker);
    if (!state.enabled || !referenceId || !text) return Promise.resolve(false);
    const key = lineKey(state.session, options.id, text, referenceId);
    if (state.seen.has(key)) return Promise.resolve(false);
    state.seen.add(key);
    return new Promise((resolve) => {
      state.queue.push({ ...options, speaker, text, referenceId, session: state.session, resolve });
      pump();
    });
  }

  function cancel(reason = "cancelled") {
    state.session = String(Number(state.session || 0) + 1 || Date.now());
    for (const controller of state.fetchControllers) {
      try { controller.abort(reason); } catch (error) { /* best effort */ }
    }
    state.fetchControllers.clear();
    releaseAudio();
    for (const item of state.queue.splice(0)) item.resolve?.(false);
    for (const entry of state.prepareQueue.splice(0)) entry.resolve?.(null);
    for (const entry of state.prepared.values()) entry.resolve?.(null);
    state.prepared.clear();
    for (const url of [...state.objectUrls]) revokeUrl(url);
    state.running = false;
    emitStatus("idle");
  }

  global.HatsuFishTts = {
    PRONUNCIATION_RULES,
    ALLOWED_TAGS,
    DEFAULT_REFERENCE_ID,
    SAKI_REFERENCE_ID,
    TEMARI_REFERENCE_ID,
    DEFAULT_PROXY_URL,
    DEFAULT_WORKER_ORIGIN,
    DEFAULT_MODEL,
    TSUBAME_REFERENCE_ID,
    SUMIKA_REFERENCE_ID,
    MAO_REFERENCE_ID,
    RINHA_REFERENCE_ID,
    ASARI_REFERENCE_ID,
    configure,
    getDefaultProxyUrl,
    getConfig,
    beginSession,
    prepare,
    playPrepared,
    stopPlayback,
    enqueue,
    cancel,
    isKotoneSpeaker,
    referenceIdForSpeaker,
    parseLocalizedText,
    sanitizeFishTags,
    stripTtsTags
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
