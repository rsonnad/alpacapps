#!/usr/bin/env node
/**
 * Capture business card front & back as print-ready PNGs + CMYK TIFs
 * GotPrint specs: 2.625" x 4.125" bleed
 * 350 DPI =  919 x 1444 px (standard)
 * 1200 DPI = 3150 x 4950 px (max quality, ~62 MB TIF — under 75 MB limit)
 */
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DPI = 1200;
const W = Math.round(2.625 * DPI);  // 3150
const H = Math.round(4.125 * DPI);  // 4950

async function capture() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 2000, height: 3000, deviceScaleFactor: 4 });

  await page.goto(`file://${path.join(__dirname, 'business-card.html')}`, {
    waitUntil: 'networkidle0',
    timeout: 30000,
  });

  await page.waitForFunction(() => {
    const imgs = document.querySelectorAll('img');
    return [...imgs].every(img => img.complete && img.naturalHeight > 0);
  }, { timeout: 15000 }).catch(() => console.log('Some images may not have loaded'));

  const cards = await page.$$('.card-bleed');
  const sides = ['front', 'back'];

  for (let i = 0; i < Math.min(cards.length, 2); i++) {
    const rawFile = path.join(__dirname, `business-card-${sides[i]}-raw.png`);
    const pngFile = path.join(__dirname, `business-card-${sides[i]}-gotprint.png`);
    const tifFile = path.join(__dirname, `business-card-${sides[i]}-cmyk.tif`);

    await cards[i].screenshot({ path: rawFile, type: 'png' });

    // Resize to exact dimensions and set density
    execSync(`magick "${rawFile}" -resize ${W}x${H}! -density ${DPI} -units PixelsPerInch "${pngFile}"`);
    console.log(`✓ ${sides[i]} PNG: ${pngFile} (${W}x${H} @ ${DPI} DPI)`);

    // CMYK TIF for best print results
    execSync(`magick "${pngFile}" -colorspace CMYK -compress LZW "${tifFile}"`);
    console.log(`✓ ${sides[i]} TIF: ${tifFile}`);

    // Clean up raw
    execSync(`rm "${rawFile}"`);
  }

  await browser.close();
  console.log(`\nAll files: ${W}x${H}px @ ${DPI} DPI`);
}

capture().catch(err => { console.error(err); process.exit(1); });
