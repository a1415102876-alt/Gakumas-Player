import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNotices } from '../gakumas-player/notices.js';

test('通知按发布顺序显示，并忽略无效或重复的条目', () => {
  assert.deepEqual(normalizeNotices({ notices: [
    { id: ' new ', title: ' 更新 ', body: ' 第一行\n第二行 ', date: ' 2026-11-09 ' },
    { id: 'new', title: '重复', body: '不会显示' },
    { id: 'empty', title: '空内容', body: ' ' },
    { id: 'old', title: '旧通知', body: '<b>纯文本</b>' },
  ] }), [
    { id: 'new', title: '更新', body: '第一行\n第二行', date: '2026-11-09' },
    { id: 'old', title: '旧通知', body: '<b>纯文本</b>', date: '' },
  ]);
});

test('通知文件必须包含 notices 数组', () => {
  assert.throws(() => normalizeNotices({}), /通知格式不正确/);
  assert.deepEqual(normalizeNotices({ notices: [] }), []);
});
