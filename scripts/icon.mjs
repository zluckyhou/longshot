/**
 * Renders the Longshot mark to PNG at every size the manifest needs.
 *
 * Same family as FixedShot's app icon — accent tile, cream stroke-only glyph,
 * round caps (see FixedShot/Sources/FixedShot/AppIconImage.swift). Where
 * FixedShot draws a closed viewfinder (a fixed frame), Longshot draws the
 * viewfinder's shoulders with the shot running out of the bottom.
 *
 * At 16px the shoulders collide with the arrow, so that size drops them and
 * lets one bolder arrow carry the tile.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'icons');
const CHROME =
  process.env.LONGSHOT_CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// FixedShot's Zapier palette: accent #FF4F00 on onAccent #FFFEFB.
const ACCENT = '#ff4f00';
const ACCENT_DEEP = '#e04600';
const CREAM = '#fffefb';

const SHOULDERS = `
  <path d="M8.4 13.2V9.6a1.2 1.2 0 0 1 1.2-1.2h3.4"/>
  <path d="M23.6 13.2V9.6a1.2 1.2 0 0 0-1.2-1.2h-3.4"/>`;
const ARROW = `
  <path d="M16 9.8v11.4"/>
  <path d="M11.5 16.8 16 21.3l4.5-4.5"/>`;
// 16px: the shoulders merge into the shaft, so that size drops them and lets a
// single bolder arrow fill the tile instead.
const ARROW_BOLD = `
  <path d="M16 8.4v12"/>
  <path d="M10.6 15.4 16 20.8l5.4-5.4"/>`;

const mark = ({ stroke, simplified }) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${ACCENT}"/>
      <stop offset="1" stop-color="${ACCENT_DEEP}"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="7.7" fill="url(#tile)"/>
  <g fill="none" stroke="${CREAM}" stroke-width="${stroke}"
     stroke-linecap="round" stroke-linejoin="round">
    ${simplified ? '' : SHOULDERS}
    ${simplified ? ARROW_BOLD : ARROW}
  </g>
</svg>`;

// Strokes get heavier as the tile shrinks, or the glyph dissolves.
const SPEC = [
  { size: 16, stroke: 4.4, simplified: true },
  { size: 32, stroke: 3.0, simplified: false },
  { size: 48, stroke: 2.6, simplified: false },
  { size: 128, stroke: 2.3, simplified: false },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--force-color-profile=srgb'],
});
const page = await browser.newPage();
fs.mkdirSync(OUT, { recursive: true });

for (const { size, stroke, simplified } of SPEC) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>` +
      mark({ stroke, simplified })
  );
  await page.screenshot({ path: path.join(OUT, `icon${size}.png`), omitBackground: true });
  console.log(`icons/icon${size}.png`);
}

// A big flat version for the store listing.
await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
await page.setContent(
  `<style>html,body{margin:0;background:transparent}svg{display:block;width:512px;height:512px}</style>` +
    mark({ stroke: 2.3, simplified: false })
);
await page.screenshot({ path: path.join(OUT, 'mark512.png'), omitBackground: true });
console.log('icons/mark512.png');

await browser.close();
