import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = process.env.DEMO_TEST_URL || 'http://127.0.0.1:4173';
const timeout = Number(process.env.DEMO_TEST_TIMEOUT_MS || 30000);
const localBrowser = fileURLToPath(new URL('../.sites-runtime/browser/chrome-headless-shell-linux64/chrome-headless-shell', import.meta.url));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
  executablePath: process.env.CHROMIUM_EXECUTABLE || (existsSync(localBrowser) ? localBrowser : undefined) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(timeout);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir('test-results', { recursive: true });
const ready = () => page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false' && document.querySelector('#tracking-canvas').dataset.frameId);
const current = () => page.locator('#scene-code').innerText();
const seek = async time => {
  await page.locator('#seek').evaluate((el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); }, time);
  await page.waitForFunction(value => Math.abs(document.querySelector('#cipher-video').currentTime - value) < .01 && !document.querySelector('#cipher-video').seeking && document.querySelector('#tracking-canvas').dataset.frameId === String(Math.floor(value * 25 + .0001) + 1), time);
};
const actualIDs = async () => page.evaluate(async () => {
  const scene = document.querySelector('#scene-code').textContent;
  const overlay = document.querySelector('#tracking-canvas');
  const frame = Number(overlay.dataset.frameId) - 1;
  const data = await (await fetch(`media/${scene}/tracks.json`)).json();
  return { actual: document.querySelector('#id-list').dataset.ids, expected: data.frames[frame].map(object => object.id).join(','), frame, width: data.width, height: data.height, canvasWidth: overlay.width, source: overlay.dataset.source };
});
try {
  await page.goto(base, { waitUntil: 'networkidle', timeout }); await ready();
  assert.equal(await page.locator('.scene-item').count(), 8);
  assert.equal(await page.locator('video').count(), 2);
  assert.equal(await page.locator('.scene-thumbnail img').count(), 8);
  assert.equal(await current(), 'I_BS_01');
  assert.equal(await page.locator('#error-banner').isVisible(), false);
  assert.equal(await page.locator('#tracking-canvas').evaluate(el => el.parentElement.id), 'cipher-surface');
  await page.locator('#play-button').click();
  await page.waitForFunction(() => document.querySelector('#raw-video').currentTime > .2);
  assert.equal(await page.locator('#app').evaluate(el => el.classList.contains('is-playing')), true);
  await page.locator('#play-button').click();
  await seek(3.04);
  const proof = await actualIDs();
  assert.equal(proof.actual, proof.expected); assert.equal(proof.source, 'encrypted');
  assert.equal(proof.canvasWidth, proof.width * 2);
  const overlay = await page.locator('#tracking-canvas').evaluate(el => {
    const pixels = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
    let filled = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) filled++;
    return { filled, ratio: filled / (el.width * el.height) };
  });
  assert.ok(overlay.filled > 0 && overlay.ratio < .25, 'Tracking canvas must contain boxes on a transparent background');
  assert.ok(await page.evaluate(() => Math.abs(document.querySelector('#raw-video').currentTime-document.querySelector('#cipher-video').currentTime) <= .12));
  const chip = page.locator('.target-chip').first();
  await chip.click(); assert.equal(await chip.getAttribute('aria-pressed'), 'true');
  await chip.click(); assert.equal(await chip.getAttribute('aria-pressed'), 'false');
  await page.locator('#overlay-toggle').click();
  assert.equal(await page.locator('#overlay-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#tracking-canvas').evaluate(el => el.getContext('2d').getImageData(0,0,el.width,el.height).data.some((value,index) => index % 4 === 3 && value > 0)), false);
  await page.locator('#overlay-toggle').click();
  await page.getByRole('button', { name: '放大加密跟踪画面', exact: true }).click();
  assert.equal(await page.locator('#viewer').evaluate(el => el.open), true);
  // Outside the annotation pixels, the enlarged result must exactly match the
  // encrypted frame, proving that the original video is not the result's base.
  const baseProof = await page.evaluate(() => {
    const viewer = document.querySelector('#viewer-canvas'), overlay = document.querySelector('#tracking-canvas');
    const reference = document.createElement('canvas'); reference.width = viewer.width; reference.height = viewer.height;
    reference.getContext('2d').drawImage(document.querySelector('#cipher-video'), 0, 0, reference.width, reference.height);
    const expected = reference.getContext('2d').getImageData(0,0,reference.width,reference.height).data;
    const actual = viewer.getContext('2d').getImageData(0,0,viewer.width,viewer.height).data;
    const boxes = overlay.getContext('2d').getImageData(0,0,overlay.width,overlay.height).data;
    let difference = 0, samples = 0;
    for (let pixel = 0; pixel < boxes.length; pixel += 4 * 173) {
      if (boxes[pixel + 3]) continue;
      for (let channel = 0; channel < 3; channel++) difference += Math.abs(actual[pixel + channel] - expected[pixel + channel]);
      samples++;
    }
    return { samples, difference: difference / (samples * 3), source: viewer.dataset.source };
  });
  assert.ok(baseProof.samples > 100); assert.ok(baseProof.difference < 1); assert.equal(baseProof.source, 'encrypted');
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#viewer').evaluate(el => el.open), false);
  await page.locator('#scene-title').click();
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.locator('#theater-button').click();
  assert.equal(await page.locator('body').evaluate(el => el.classList.contains('is-theater')), true);
  await page.screenshot({ path: 'test-results/theater.png', fullPage: true });
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#theater-button').getAttribute('aria-pressed'), 'false');
  await page.locator('#theater-button').focus(); await page.keyboard.press('f');
  assert.equal(await page.locator('#theater-button').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape');
  await page.locator('#next-button').click(); await ready(); assert.equal(await current(), 'I_BS_02');
  await page.locator('#prev-button').click(); await ready(); assert.equal(await current(), 'I_BS_01');
  await page.locator('#speed').selectOption('2');
  assert.equal(await page.locator('#raw-video').evaluate(el => el.playbackRate), 2);
  await page.locator('#play-button').click();
  await page.locator('#raw-video').evaluate(el => { el.currentTime = el.duration - .12; });
  await page.waitForFunction(() => document.querySelector('#scene-code').textContent === 'I_BS_02'); await ready();
  await page.waitForFunction(() => document.querySelector('#app').classList.contains('is-playing'));
  await page.locator('#play-button').click(); await page.locator('.auto-next').click();
  assert.equal(await page.locator('#auto-next').isChecked(), false);
  await page.locator('#play-button').click();
  await page.locator('#raw-video').evaluate(el => { el.currentTime = el.duration - .12; });
  await page.waitForFunction(() => document.querySelector('#raw-video').ended);
  assert.equal(await current(), 'I_BS_02');
  await page.locator('.auto-next').click();
  const scenes = ['I_BS_01','I_BS_02','I_MB_02','I_MC_02','I_SI_02','O_CL_02','O_MC_01','O_RA_02'];
  for (const [index, scene] of scenes.entries()) {
    await page.locator('.scene-item').nth(index).click(); await ready();
    assert.equal(await current(), scene);
    const frame = await actualIDs();
    assert.equal(frame.actual, frame.expected); assert.equal(frame.source, 'encrypted');
    assert.equal(await page.locator('video').count(), 2);
    console.log(`Verified encrypted tracking scene ${index + 1}/8: ${scene}`);
  }
  await page.locator('#play-button').click();
  await page.locator('#raw-video').evaluate(el => { el.currentTime = el.duration - .12; });
  await page.waitForFunction(() => document.querySelector('#play-button span').textContent === '重新播放全部');
  await page.locator('#play-button').click();
  await page.waitForFunction(() => document.querySelector('#scene-code').textContent === 'I_BS_01'); await ready();
  if (await page.locator('#app').evaluate(el => el.classList.contains('is-playing'))) await page.locator('#play-button').click();
  // Rapid chapter changes must discard stale frame listeners and stale boxes.
  await page.evaluate(() => { const buttons = document.querySelectorAll('.scene-item'); buttons[3].click(); buttons[6].click(); buttons[0].click(); });
  await ready(); assert.equal(await current(), 'I_BS_01');
  await page.locator('#speed').selectOption('1');
  await seek(3.04);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#inline-play-button').click();
  await page.waitForFunction(() => document.querySelector('#raw-video').currentTime > 3.2);
  await page.locator('#inline-play-button').click(); await seek(3.04);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 360, height: 800 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  await writeFile('test-results/report.json', JSON.stringify({ passed: true, url: base, networkWaitTimeoutMs: timeout,
    checks: ['exactly two video feeds', '8 scenes shown sequentially', 'actual tracking IDs in all 8 scenes', 'transparent boxes over encrypted video', 'encrypted base in enlarged viewer', 'target highlighting', 'box visibility toggle', 'video sync', 'play/pause', 'seek', 'previous/next', 'playback speed', 'automatic next scene', 'stop without automatic next', 'last-scene stop and restart', 'rapid scene switching', 'presentation mode', 'zoom', '390px and 360px mobile layout'],
    encryptedBasePixelError: baseProof.difference, desktop: 'desktop.png', theater: 'theater.png', mobile: 'mobile.png' }, null, 2));
  console.log('Browser checks passed: encrypted overlays, all 8 scenes, controls, presentation mode and mobile layout');
} catch (error) {
  await page.screenshot({ path: 'test-results/failure.png', fullPage: true }).catch(() => {});
  await writeFile('test-results/failure-diagnostic.json', JSON.stringify(await page.evaluate(() => ({ scene: document.querySelector('#scene-code')?.textContent, error: document.querySelector('#error-message')?.textContent, frame: document.querySelector('#tracking-canvas')?.dataset.frameId, videos: [...document.querySelectorAll('video')].map(el => ({ src: el.currentSrc, currentTime: el.currentTime, readyState: el.readyState, seeking: el.seeking, error: el.error?.message })) })).catch(() => ({})),null,2));
  throw error;
} finally { await browser.close(); }
