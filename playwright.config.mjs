import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir: './tests/e2e',
 outputDir: './output/playwright/results',
 timeout: 30000,
 fullyParallel: true,
 workers: 4,
 reporter: [['list'], ['html', { outputFolder: 'output/playwright/report', open: 'never' }]],
 use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
 webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
 projects: ['chromium', 'webkit'].flatMap(browserName => [[1920,1080], [1440,900], [1280,800], [390,844]].map(([width,height]) => ({ name: `${browserName}-${width}`, use: { browserName, viewport: { width,height } } })))
});
