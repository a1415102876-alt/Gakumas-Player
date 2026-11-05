// Module worker entry. One worker serves one actor's secondary-motion solver.
import { SecondaryMotionHost } from './secondary-motion-host.js?v=20261106-physics-worker-v1';

const host = new SecondaryMotionHost();

self.onmessage = event => {
    const message = event.data;
    try {
        if (message?.type === 'dispose') {
            host.dispose();
            self.close();
            return;
        }
        const result = host.handle(message);
        if (result) self.postMessage(result.reply, result.transfer || []);
    } catch (error) {
        self.postMessage({ type: 'error', epoch: message?.epoch, message: String(error?.stack || error) });
    }
};
