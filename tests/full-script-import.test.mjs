import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeirdContinuationPrompt, buildWeirdScriptPrompt, prepareGeneratedJapaneseScript } from '../sandbox/sandbox-weird-script.js';
import { normalizeChatReply } from '../beat-chat.js';
import { parseBeatScript } from '../beat-protocol.js';
import { GP_MAX_INPUT, readFullScriptFile, readGpDraft, writeGpDraft } from '../gakumas-player/gakumas-player-model.js';

const chinese = '藤田琴音：早上好。';
const japanese = '藤田ことね：おはようございます。';

test('TXT imports preserve CJK text and reject unsupported or oversized files', async () => {
  const utf8 = new File([`\uFEFF${chinese}\r\n${japanese}`], 'draft.TXT');
  const utf16 = new File([Buffer.from(`\uFEFF${japanese}`, 'utf16le')], 'draft.txt');
  assert.equal(await readFullScriptFile(utf8), `${chinese}\n${japanese}`);
  const utf16be = new File([Buffer.from(`\uFEFF${japanese}`, 'utf16le').swap16()], 'draft.txt');
  assert.equal(await readFullScriptFile(utf16), japanese);
  assert.equal(await readFullScriptFile(utf16be), japanese);
  await assert.rejects(readFullScriptFile(new File([chinese], 'draft.md')), /\.txt/);
  await assert.rejects(readFullScriptFile(new File([Uint8Array.of(0x82, 0xa0)], 'draft.txt')), /UTF-8/);
  await assert.rejects(readFullScriptFile(new File([' '], 'draft.txt')), /没有文案/);
  await assert.rejects(readFullScriptFile(new File(['あ'.repeat(GP_MAX_INPUT + 1)], 'draft.txt')), /超过/);
});

test('full-text drafts retain both versions and open legacy drafts with an empty translation', () => {
  let stored = JSON.stringify({ mode: 'full', input: chinese });
  const storage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
  assert.equal(readGpDraft(storage).japaneseText, '');
  writeGpDraft({ mode: 'full', input: chinese, japaneseText: japanese }, storage);
  assert.deepEqual(readGpDraft(storage), { mode: 'full', input: chinese, japaneseText: japanese, script: '' });
});

test('full-script generation and continuation use the supplied Japanese text', () => {
  const options = { text: chinese, japaneseText: japanese, locations: ['教室-午.png'] };
  for (const prompt of [buildWeirdScriptPrompt(options), buildWeirdContinuationPrompt(options)]) {
    assert.ok(prompt.includes(chinese));
    assert.ok(prompt.includes(japanese));
    assert.match(prompt, /逐字复制日文译稿/);
  }
  assert.doesNotMatch(buildWeirdScriptPrompt({ ...options, mode: 'expand' }), /日文译稿/);
  assert.doesNotMatch(buildWeirdContinuationPrompt({ ...options, style: true }), /日文译稿/);
  assert.doesNotMatch(buildWeirdScriptPrompt({ text: chinese }), /日文译稿/);
});

test('Japanese text is accepted only when it occurs in the supplied translation', () => {
  const beat = text => `<beat speaker="kotone"><display lang="zh">早。</display><tts lang="ja">${text}</tts></beat>`;
  for (const [tts, source] of [['おはようございます。', japanese], ['A &amp; B', '「A & B」'], ['おはよう。', '']]) {
    assert.equal(prepareGeneratedJapaneseScript(beat(tts), source), beat(tts));
  }
  assert.throws(() => prepareGeneratedJapaneseScript(beat('おはよう。'), japanese), /译稿中找不到/);
});

test('Japanese readings survive reply normalization and use source wording for verification', () => {
  const beat = '<beat speaker="kotone"><display lang="zh">贺阳同学，SyngUp! 的事。</display>'
    + '<tts lang="ja"><ruby>賀陽さん<rt>カヤサン</rt></ruby>、<ruby>SyngUp!<rt>シングアップ</rt></ruby>の件です。</tts></beat>';
  const { ok, script } = normalizeChatReply(beat, { preserveBackground: true, preserveStaging: true });
  assert.equal(ok, true);
  const source = '藤田ことね：賀陽さん、SyngUp!の件です。';
  const prepared = prepareGeneratedJapaneseScript(script, source);
  assert.match(prepared, /<display lang="zh">贺阳同学，SyngUp! 的事。<\/display>/);
  assert.equal(parseBeatScript(prepared).beats[0].ttsText, 'カヤサン、シングアップの件です。');
  assert.throws(() => prepareGeneratedJapaneseScript(script.replace('の件です', 'の予定です'), source), /译稿中找不到/);
  assert.throws(() => prepareGeneratedJapaneseScript(script.replace('カヤサン', 'かやさん'), source), /注音格式有误/);
});
