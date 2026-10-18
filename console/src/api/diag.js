// SPDX-License-Identifier: Apache-2.0
// A job on the router (Ping, Traceroute, a package operation, a script):
// started once, then read every half second until it ends. Stop reads the
// last results once more. Reads of one job are serialized, so no result is
// appended twice. Diagnostics start with `diag`; package operations and
// scripts are changes and start with `task`. `attach` reads a job that is
// already running, such as one started before the page was reloaded.

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const message = failure => failure?.message ?? String(failure);

export function createJob(client, { onUpdate = () => {}, every = 500, wait = delay, method = 'diag', onStarted = () => {} } = {}) {
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
    await client.call('routerdeck', method, { action: 'stop', id: job.id });
    await read(job);
   } catch {
    // The job ends on its own once nobody reads it.
   }
  }
  job.stopping = false;
  update({ running: false });
 }

 async function start(args, attach = null) {
  await stop();
  const job = { id: null, from: 0, reading: Promise.resolve(), stopping: false };
  current = job;
  update({ results: [], running: true, error: null });
  try {
   if (attach) job.id = attach;
   else {
    const reply = await client.call('routerdeck', method, { action: 'start', ...args });
    if (!reply?.ok) throw new Error(reply?.message ?? 'The router did not start it');
    job.id = reply.id;
    onStarted(reply.id);
   }
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

 // Stops reading without stopping the job on the router.
 const detach = () => { current = null; };
 return { start, attach: id => start(null, id), stop, detach, state: () => state };
}
