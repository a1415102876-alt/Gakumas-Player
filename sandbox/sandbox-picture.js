import { aaLevel } from '../gakumas-aa.js';

export const SANDBOX_PICTURE_KEY = 'hatsuSandboxPictureV1';

export function defaultSandboxPicture() {
  return { taa: true, aa: 'medium', plateSharpen: true, dialogueFontSize: 23, motionBlur: false };
}

export function normalizeSandboxPicture(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const defaults = defaultSandboxPicture();
  const requestedFontSize = Number(source.dialogueFontSize);
  const dialogueFontSize = Number.isFinite(requestedFontSize)
    && requestedFontSize >= 14
    && requestedFontSize <= 30
    ? Math.round(requestedFontSize)
    : defaults.dialogueFontSize;
  const requestedAa = typeof source.aa === 'string' ? aaLevel(source.aa) : null;
  const aa = requestedAa && requestedAa.id === source.aa
    ? requestedAa.id
    : (source.taa === false ? 'off' : defaults.aa);
  return {
    taa: aaLevel(aa).taa,
    aa,
    plateSharpen: typeof source.plateSharpen === 'boolean' ? source.plateSharpen : defaults.plateSharpen,
    dialogueFontSize,
    motionBlur: source.motionBlur === true,
  };
}

export function applyPictureTaaToggle(picture, taaOn) {
  const current = normalizeSandboxPicture(picture);
  const temporal = aaLevel(current.aa).taa;
  let aa = current.aa;
  if (taaOn && !temporal) aa = 'medium';
  if (!taaOn && temporal) aa = 'off';
  return normalizeSandboxPicture({ ...current, aa });
}
