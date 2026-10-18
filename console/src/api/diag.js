// SPDX-License-Identifier: Apache-2.0
// A Ping or Traceroute job on the router: started once, then read every half
// second until it ends. Stop reads the last results once more. Reads of one
// job are serialized, so no result is appended twice.

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const message = failure => failure?.message ?? String(failure);

export function createJob(client, { onUpdate = () => {}, every = 500, wait = delay } = {}) {
 let current = null;
 let state = { results: [], running: false, error: null };
 const update = changes => { state = { ...state, ...changes }; onUpdate(state); };

 function read(job) {
  job.reading = job.reading.then(async () => {
   const reply = await client.call('routerdeck', 'diag', { action: 'poll', id: job.id, from: job.from });
   if (!reply?.ok) throw new Error(reply?.message ?? 'The job has ended');
   job.from = reply.next;
   if (current === job || job.stopping) update({ results: reply.results.length ? [...state.results, ...reply.results] : state.results });
   return reply.running;
  });
  return job.reading;
 }

 async function stop() {
  const job = current;
  current = null;
  if (!job) return;
  job.stopping = true;
  if (job.id) {
   try {
    await client.call('routerdeck', 'diag', { action: 'stop', id: job.id });
    await read(job);
   } catch {
    // The job ends on its own once nobody reads it.
   }
  }
  job.stopping = false;
  update({ running: false });
 }

 async function start(args) {
  await stop();
  const job = { id: null, from: 0, reading: Promise.resolve(), stopping: false };
  current = job;
  update({ results: [], running: true, error: null });
  try {
   const reply = await client.call('routerdeck', 'diag', { action: 'start', ...args });
   if (!reply?.ok) throw new Error(reply?.message ?? 'The router did not start it');
   job.id = reply.id;
   while (current === job) {
    await wait(every);
    if (current !== job || !(await read(job))) break;
   }
  } catch (failure) {
   if (current === job) update({ error: message(failure) });
  }
  if (current === job) {
   current = null;
   update({ running: false });
  }
 }

 return { start, stop, state: () => state };
}
