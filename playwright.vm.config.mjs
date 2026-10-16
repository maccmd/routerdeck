import { defineConfig } from '@playwright/test';
const port = process.env.ROUTERDECK_VM_PORT || '8088';
if (!['8088','8089'].includes(port)) throw new Error('VM tests only target the isolated local QEMU ports 8088/8089');
export default defineConfig({
 testDir: './tests/vm',
 outputDir: './output/playwright/vm-results-' + port,
 timeout: 150000,
 workers: 1,
 reporter: [['list'], ['html', { outputFolder: 'output/playwright/vm-report-' + port, open: 'never' }]],
 use: { baseURL: `http://127.0.0.1:${port}`, trace: 'off', screenshot: 'only-on-failure' },
 projects: ['chromium', 'webkit'].flatMap(browserName => [[1440,900], [1920,1080], [1280,800], [390,844]].map(([width,height]) => ({ name: `${browserName}-${width}`, use: { browserName, viewport: { width,height } } })))
});
