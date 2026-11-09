import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { skipsConfiguredHairRootCollider } from '../gakumas-secondary-motion.js';

const variants = ['ssmk-cstm-0000', 'ssmk-schl-0000', 'ssmk-cstm-0009'];

test('Sumika restores the previous side-hair and back-hair shoulder exclusions', async () => {
    const manifest = JSON.parse(await readFile(new URL('../resource-manifest.json', import.meta.url)));
    for (const variant of variants) {
        const key = `secondary-motion-profiles/${variant}.json`;
        const bytes = await readFile(new URL(`../${key}`, import.meta.url));
        const profile = JSON.parse(bytes);
        const sideHair = profile.springs.filter(spring => /^(Left|Right)SideHair\d+_S(?:_End)?$/.test(spring.bone));
        assert.ok(sideHair.length, `${variant} has side hair`);
        for (const spring of sideHair) {
            const side = spring.bone.startsWith('Left') ? 'Left' : 'Right';
            assert.equal(skipsConfiguredHairRootCollider(spring.bone, `${side}Shoulder`, profile), true, `${variant}: ${spring.bone} is excluded`);
            assert.equal(skipsConfiguredHairRootCollider(spring.bone, 'Spine2', profile), true, `${variant}: ${spring.bone} keeps its Spine2 exclusion`);
        }
        for (const side of ['Left', 'Right']) {
            assert.equal(skipsConfiguredHairRootCollider(`${side}BackHair1_S`, `${side}Shoulder`, profile), true);
        }
        assert.equal(manifest.assets[key].size, bytes.length);
        assert.equal(manifest.assets[key].hash, createHash('sha256').update(bytes).digest('hex'));
    }
});
