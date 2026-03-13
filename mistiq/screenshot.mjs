import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 3000, deviceScaleFactor: 1 });
await page.goto(`file://${path.join(__dirname, 'business-card.html')}`, { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForFunction(() => [...document.querySelectorAll('img')].every(i => i.complete), { timeout: 10000 }).catch(() => {});

const cards = await page.$$('.card-bleed');
if (cards[0]) await cards[0].screenshot({ path: path.join(__dirname, 'preview-front.png'), type: 'png' });
if (cards[1]) await cards[1].screenshot({ path: path.join(__dirname, 'preview-back.png'), type: 'png' });

await browser.close();
console.log('Done');
