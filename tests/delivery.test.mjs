import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryPolicy} from '../public/core/delivery.mjs';
test('delivery checks match each independently usable task type',()=>{for(const [type,expected] of [['writing',/citations/],['career',/Never invent/],['analysis',/units/],['presentation',/editable/],['literature',/source/]]){const p=deliveryPolicy({type});assert.match(p,expected);assert.match(p,/not run/);assert.doesNotMatch(p,/require.*Prism|require.*NanoLab/i);}});
test('fixed child work does not inherit full parent deliverable obligation',()=>{assert.equal(deliveryPolicy({type:'presentation',parentTaskId:'parent'}),'');});
test('generic requests retain user format and honest validation limits',()=>{const p=deliveryPolicy({type:'general'});assert.match(p,/requested format/);assert.match(p,/Do not claim/);assert.ok(p.length<2500);});
