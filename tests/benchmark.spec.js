import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test('Benchmark 4K MP4 Export', async ({ page }) => {
    test.setTimeout(300000); // 5 minutes

    // 1. Generate 4K image
    const imagePath = path.join(process.cwd(), 'test_4k.png');
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.goto('data:text/html,<body style="background:black"></body>');
    await page.screenshot({ path: imagePath });
    console.log('4K Image Generated.');

    // 2. Navigate to App
    await page.goto('http://localhost:8082');
    await expect(page.locator('#log-output')).toContainText('Ready');
    console.log('App Ready.');

    // 3. Fill and Trigger
    await page.fill('#text-input', 'This aint rock and roll, this is genocide');
    
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('#btn-video');
    const fileChooser = await fileChooserPromise;
    
    const startTime = Date.now();
    await fileChooser.setFiles(imagePath);
    console.log('Rendering started...');

    // 4. Wait for download
    const downloadPromise = page.waitForEvent('download');
    const download = await downloadPromise;
    const endTime = Date.now();

    const duration = (endTime - startTime) / 1000;
    const downloadPath = path.join(process.cwd(), 'benchmark_result.mp4');
    await download.saveAs(downloadPath);
    
    const fileSize = fs.statSync(downloadPath).size;
    console.log('--- RESULTS ---');
    console.log('Time: ' + duration.toFixed(2) + 's');
    console.log('Size: ' + (fileSize / 1024 / 1024).toFixed(2) + 'MB');
});
