// Keeps business playback waiting on the same generated segment when only a
// resource failed. Retrying must not request another AI reply or lose callbacks.
export class ResourceBarrier {
    constructor({ prepare, beforeRetry = () => {}, isCurrent = () => true }) {
        this.prepare = prepare; this.beforeRetry = beforeRetry; this.isCurrent = isCurrent;
        this.cancelled = false; this.resume = null;
    }
    async run() {
        while (!this.cancelled && this.isCurrent()) {
            try { return await this.prepare(); }
            catch (error) {
                if (this.cancelled || !this.isCurrent() || error.name === 'AbortError') return false;
                const retry = await new Promise(resolve => { this.resume = resolve; });
                this.resume = null;
                if (!retry || this.cancelled || !this.isCurrent()) return false;
                await this.beforeRetry();
            }
        }
        return false;
    }
    retry() { this.resume?.(true); }
    cancel() { this.cancelled = true; this.resume?.(false); this.resume = null; }
}
