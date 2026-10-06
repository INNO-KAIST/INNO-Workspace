import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatClock,formatShortDateTime,formatDateTime} from '../public/core/time-format.mjs';

// H9-5 (phone check, 2026-10-06): times are shown on a 24-hour clock, never 오전/오후.
const seoul={timeZone:'Asia/Seoul'};

test('times are formatted on a 24-hour clock',()=>{
 assert.equal(formatClock('2026-10-06T05:18:09Z',seoul),'14:18');
 assert.equal(formatClock('2026-10-05T15:05:00Z',seoul),'00:05');
 assert.equal(formatShortDateTime('2026-10-06T05:18:09Z',seoul),'10월 6일 14:18');
 assert.match(formatDateTime('2026-10-06T05:18:09Z',seoul),/^2026\. 10\. 06\. 14:18:09$/);
 for(const format of [formatClock,formatShortDateTime,formatDateTime])assert.equal(format('not a date',seoul),'');
});

test('page modules format times only through the 24-hour helpers',()=>{
 for(const file of ['public/app.mjs','public/delivery-recovery-ui.mjs','public/model-diagnostics-ui.mjs','public/model-policy-ui.mjs','public/review-observation-ui.mjs']){
  const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/(?:new Date\([^)]*\)|\b(?:date|d)\b)\.toLocale(?:Time)?String\(/,file);
 }
});
