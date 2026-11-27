import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', timeout: 90000, workers: 1, reporter: [['list'], ['html', { open: 'never' }]], use: { baseURL: process.env.WEB_URL || 'http://localhost:5173', trace: 'retain-on-failure' } });
