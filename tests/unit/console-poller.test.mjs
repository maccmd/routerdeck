import test from 'node:test';
import assert from 'node:assert/strict';
import { createPoller } from '../../console/src/api/poller.js';

// Manual clock and timer so ticks are explicit.
function harness({ hidden = false } = {}) {
 let time = 0, tick = null;
 const state = { hidden };
 const poller = createPoller({ now: () => time, hidden: () => state.hidden, setTimer: fn => { tick = fn; return 1; }, clearTimer: () => { tick = null; } });
 return { poller, state, advance: ms => { time += ms; tick?.(); }, running: () => !!tick };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('windows sharing a source cause one load per interval', async () => {
 const { poller, advance } = harness();
 let loads = 0;
 const load = async () => ++loads;
 const seen = [];
 poller.subscribe('devices', load, 1000, entry => seen.push(['a', entry.value]));
 poller.subscribe('devices', load, 1000, entry => seen.push(['b', entry.value]));
 await settle();
 assert.equal(loads, 1);
 advance(1000);
 await settle();
 assert.equal(loads, 2);
 assert.deepEqual(seen.slice(-2), [['a', 2], ['b', 2]]);
});

test('slower sources wait for their interval and stop with their last subscriber', async () => {
 const { poller, advance, running } = harness();
 let loads = 0;
 const stop = poller.subscribe('uci:network', async () => ++loads, 5000, () => {});
 await settle();
 for (let i = 0; i < 4; i++) { advance(1000); await settle(); }
 assert.equal(loads, 1);
 advance(1000);
 await settle();
 assert.equal(loads, 2);
 stop();
 assert.equal(running(), false);
});

test('nothing is polled while the page is hidden', async () => {
 const { poller, advance, state } = harness();
 let loads = 0;
 poller.subscribe('log', async () => ++loads, 1000, () => {});
 await settle();
 state.hidden = true;
 advance(1000); advance(1000);
 await settle();
 assert.equal(loads, 1);
});

test('refresh supersedes a slower request still in flight', async () => {
 const { poller } = harness();
 const releases = [];
 const values = [];
 poller.subscribe('history', () => new Promise(resolve => releases.push(resolve)), 5000, entry => values.push(entry.value));
 await settle();
 const refreshed = poller.refresh(key => key === 'history');
 await settle();
 releases[1]('new');
 await refreshed;
 releases[0]('old');
 await settle();
 assert.deepEqual(values, ['new']);
 assert.equal(poller.state('history').value, 'new');
});

test('errors are kept per source and cleared by the next success', async () => {
 const { poller, advance } = harness();
 let fail = true;
 poller.subscribe('routes4', async () => { if (fail) throw new Error('timeout'); return []; }, 1000, () => {});
 await settle();
 assert.equal(poller.state('routes4').error.message, 'timeout');
 fail = false;
 advance(1000);
 await settle();
 assert.equal(poller.state('routes4').error, null);
 assert.deepEqual(poller.state('routes4').value, []);
});
