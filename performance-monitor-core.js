const DEFAULT_WINDOW_MS = 1000;

function clockNow() {
    return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
}

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function createPerformanceBucket(now = clockNow()) {
    return {
        windowStart: finiteNumber(now, 0),
        frames: 0,
        skipped: 0,
        totalFrames: 0,
        totalMs: 0,
        updateMs: 0,
        renderMs: 0,
        phaseTotals: {},
        maxFrameMs: 0,
        latest: null,
    };
}

function windowSummary(bucket, now) {
    const elapsed = Math.max(1, finiteNumber(now, clockNow()) - finiteNumber(bucket.windowStart, now));
    const frames = Math.max(0, Number(bucket.frames) || 0);
    const phases = Object.fromEntries(Object.entries(bucket.phaseTotals || {}).map(([name, total]) => [
        name,
        frames ? total / frames : 0,
    ]));
    return {
        elapsedMs: elapsed,
        fps: frames * 1000 / elapsed,
        frameMs: frames ? bucket.totalMs / frames : 0,
        updateMs: frames ? bucket.updateMs / frames : 0,
        renderMs: frames ? bucket.renderMs / frames : 0,
        phases,
        maxFrameMs: Number(bucket.maxFrameMs) || 0,
        frames,
        skipped: Math.max(0, Number(bucket.skipped) || 0),
        totalFrames: Math.max(0, Number(bucket.totalFrames) || 0),
    };
}

function rotateWindow(bucket, now) {
    bucket.latest = windowSummary(bucket, now);
    bucket.windowStart = finiteNumber(now, clockNow());
    bucket.frames = 0;
    bucket.skipped = 0;
    bucket.totalMs = 0;
    bucket.updateMs = 0;
    bucket.renderMs = 0;
    bucket.phaseTotals = {};
    bucket.maxFrameMs = 0;
    return bucket.latest;
}

export function recordPerformanceSample(bucket, sample = {}, { windowMs = DEFAULT_WINDOW_MS } = {}) {
    if (!bucket || typeof bucket !== 'object') return null;
    const now = finiteNumber(sample.now, clockNow());
    if (!Number.isFinite(bucket.windowStart)) bucket.windowStart = now;
    const elapsed = now - bucket.windowStart;
    if (elapsed >= Math.max(100, Number(windowMs) || DEFAULT_WINDOW_MS)) rotateWindow(bucket, now);
    const skipped = sample.skipped === true;
    const totalMs = Math.max(0, finiteNumber(sample.totalMs));
    bucket.totalFrames = Math.max(0, Number(bucket.totalFrames) || 0) + 1;
    if (skipped) {
        bucket.skipped = Math.max(0, Number(bucket.skipped) || 0) + 1;
    } else {
        bucket.frames = Math.max(0, Number(bucket.frames) || 0) + 1;
        bucket.totalMs += totalMs;
        bucket.updateMs += Math.max(0, finiteNumber(sample.updateMs));
        bucket.renderMs += Math.max(0, finiteNumber(sample.renderMs));
        for (const [name, value] of Object.entries(sample.phases || {})) {
            const duration = finiteNumber(value);
            if (duration >= 0) bucket.phaseTotals[name] = (Number(bucket.phaseTotals[name]) || 0) + duration;
        }
        bucket.maxFrameMs = Math.max(Number(bucket.maxFrameMs) || 0, totalMs);
    }
    return snapshotPerformanceBucket(bucket, now);
}

export function snapshotPerformanceBucket(bucket, now = clockNow()) {
    if (!bucket || typeof bucket !== 'object') return windowSummary(createPerformanceBucket(now), now);
    const current = windowSummary(bucket, now);
    const latest = bucket.latest || {};
    return {
        ...latest,
        ...current,
        fps: current.frames ? current.fps : (Number(latest.fps) || 0),
        frameMs: current.frames ? current.frameMs : (Number(latest.frameMs) || 0),
        updateMs: current.frames ? current.updateMs : (Number(latest.updateMs) || 0),
        renderMs: current.frames ? current.renderMs : (Number(latest.renderMs) || 0),
        phases: current.frames ? current.phases : (latest.phases || {}),
        maxFrameMs: Math.max(Number(latest.maxFrameMs) || 0, current.maxFrameMs),
    };
}

export function performanceRecommendations(snapshot = {}) {
    const recommendations = [];
    const actors = Array.isArray(snapshot.actors) ? snapshot.actors : [];
    const active = actors.filter(actor => actor?.present && actor?.ready);
    const aggregate = snapshot.aggregate || {};
    const frameMs = Number(snapshot.frameMs) || 0;
    const updateMs = Number(aggregate.updateMs) || 0;
    const secondaryMotionMs = Number(aggregate.phases?.secondaryMotionMs) || 0;
    const renderMs = Number(aggregate.renderMs) || 0;
    const drawCalls = Number(aggregate.drawCalls) || 0;
    const triangles = Number(aggregate.triangles) || 0;
    if (active.length > 1 && renderMs >= 12) {
        recommendations.push('多角色的渲染时间偏高：当前每个偶像仍有独立 WebGL 渲染器和后处理通道，优先合并画布或降低非主讲角色的渲染频率。');
    }
    if (active.length > 1 && updateMs >= 8) {
        recommendations.push('动画更新时间偏高：重点检查非主讲角色的 SecondaryMotion、骨骼动画和面部更新是否可以降频。');
    }
    if (active.length > 1 && secondaryMotionMs >= 8) {
        recommendations.push('SecondaryMotion 占用较高：比较焦点与背景角色固定步数，确认后台是否在追赶跳过帧的物理债务。');
    }
    if (triangles >= 250000 || drawCalls >= 80) {
        recommendations.push('几何或绘制调用偏高：优先检查模型网格、描边多遍渲染、阴影和透明材质。');
    }
    if (frameMs >= 24 || (snapshot.fps > 0 && snapshot.fps < 42)) {
        recommendations.push('当前帧时间已经低于 42 FPS 的稳定区间；可以先关闭非主讲角色的 TAA/描边，再评估画面损失。');
    }
    if (!recommendations.length) recommendations.push('当前采样没有发现明显瓶颈，继续保持多角色场景运行 5–10 秒再判断。');
    return recommendations;
}

