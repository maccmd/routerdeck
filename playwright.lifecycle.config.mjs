import { defineConfig } from '@playwright/test';
const port = process.env.ROUTERDECK_VM_PORT || '8088';
if (!['8088','8089'].includes(port)) throw new Error('Only the local QEMU VM is supported');
export default defineConfig({
 testDir:'./tests/lifecycle', timeout:120000, workers:1,
 outputDir:'./output/playwright/lifecycle-' + port,
 use:{ baseURL:`http://127.0.0.1:${port}`, browserName:'chromium', viewport:{width:1440,height:900}, trace:'off' }
});
