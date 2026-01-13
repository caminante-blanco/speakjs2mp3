import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test('Benchmark 4K MP4 Export v16', async ({ page }) => {
    test.setTimeout(300000); // 5 minutes

    const imagePath = path.join(process.cwd(), 'test_4k.png');
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.goto('data:text/html,<body style="background:black"></body>');
    await page.screenshot({ path: imagePath });

    await page.goto('http://localhost:8082');
    await expect(page.locator('#log-output')).toContainText('Ready');

    await page.fill('#text-input', 'This aint rock and roll, this is genocide');
    
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('#btn-video');
    const fileChooser = await fileChooserPromise;
    
    const startTime = Date.now();
    await fileChooser.setFiles(imagePath);

    const downloadPromise = page.waitForEvent('download', { timeout: 300000 });
    const download = await downloadPromise;
    const endTime = Date.now();

    const duration = (endTime - startTime) / 1000;
    console.log('--- v16 RESULTS ---');
    console.log('Total Time: ' + duration.toFixed(2) + 's');
});
