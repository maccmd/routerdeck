import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('real dashboard adapter tolerates no WAN and starts fresh after device changes',async()=>{
 let now=1000, interfaces=[], devices={};
 const responses={ 'system.board':{hostname:'test'}, 'system.info':{uptime:1} };
 const context=vm.createContext({
  view:{extend:value=>value},
  rpc:{declare:spec=>()=>Promise.resolve(spec.object==='network.interface'?interfaces:spec.method==='getNetworkDevices'?devices:responses[spec.object+'.'+spec.method]||{})},
  fs:{trimmed:()=>Promise.resolve(null)}, performance:{now:()=>now},
  L:{resolveDefault:(promise,fallback)=>promise.catch(()=>fallback)}
 });
 vm.runInContext(readFileSync('luci-theme-routerdeck/htdocs/luci-static/routerdeck/core.js','utf8'),context);
 const adapter=vm.runInContext('(function(){'+readFileSync('luci-app-routerdeck/htdocs/luci-static/resources/view/routerdeck/dashboard.js','utf8')+'})()',context);
 adapter.history=[]; adapter.previous=null;
 const missing=await adapter.fetch(); assert.equal(missing.wan,null); assert.equal(missing.history[0].rx,null);
 interfaces=[{interface:'wan',l3_device:'eth1',route:[{target:'0.0.0.0',mask:0}]}];
 devices={eth1:{stats:{rx_bytes:1000,tx_bytes:500}}}; now+=5000;
 assert.equal((await adapter.fetch()).history.at(-1).rx,null);
 devices.eth1.stats.rx_bytes+=5000; now+=5000;
 assert.equal((await adapter.fetch()).history.at(-1).rx,1000);
 interfaces=[]; now+=5000;
 assert.equal((await adapter.fetch()).history.at(-1).rx,null);
});
