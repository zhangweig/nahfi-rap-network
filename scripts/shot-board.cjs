const {chromium} = require('C:/Users/ZhangWeiGuang/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');

const URL = 'http://localhost:5288/';

async function open(browser) {
  const page = await browser.newPage({viewport: {width: 1680, height: 1020}});
  await page.addInitScript(() => localStorage.removeItem('nahfi.board.offsets.v2'));
  page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 300)));
  await page.goto(URL, {waitUntil: 'networkidle'});
  await page.waitForTimeout(1600);
  return page;
}

(async () => {
  const browser = await chromium.launch({channel: 'msedge'});

  // A. default view
  let page = await open(browser);
  await page.screenshot({path: 'screenshots/board-1-default.png'});

  // B. deep zoom — check text / lines / avatars stay sharp
  const box = await page.locator('.board-viewport').boundingBox();
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.45);
  for (let i = 0; i < 10; i += 1) {
    await page.mouse.wheel(0, -150);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(500);
  await page.screenshot({path: 'screenshots/board-2-zoomed.png'});
  console.log('zoom scale', await page.evaluate(() => document.querySelector('.board-world')?.style.zoom));
  await page.close();

  // C. drag a province card
  page = await open(browser);
  const zones = await page.locator('.bz').all();
  let chosen = null;
  for (const zone of zones) {
    const b = await zone.boundingBox();
    const cls = await zone.getAttribute('class');
    if (b && b.width > 170 && b.height > 150 && !cls.includes('empty')) { chosen = {zone, b}; break; }
  }
  if (chosen) {
    const sx = chosen.b.x + chosen.b.width / 2;
    const sy = chosen.b.y + 12;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 14; i += 1) {
      await page.mouse.move(sx + i * 8, sy + i * 6);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
    console.log('saved offsets', await page.evaluate(() => localStorage.getItem('nahfi.board.offsets.v2')));
  }
  await page.screenshot({path: 'screenshots/board-3-dragged.png'});
  await page.close();

  // D. roster popover
  page = await open(browser);
  const tag = page.locator('.bz:not(.empty) .bz-tag .roster-open').first();
  await tag.click({force: true});
  await page.waitForTimeout(400);
  await page.screenshot({path: 'screenshots/board-4-roster.png'});
  console.log('roster rows', await page.locator('.roster-list button').count());
  await page.close();

  // E. search -> fly to
  page = await open(browser);
  await page.locator('input[aria-label="搜索人物、省份或作品"]').fill('马思唯');
  await page.waitForTimeout(350);
  await page.locator('.search-results button').first().click();
  await page.waitForTimeout(900);
  await page.screenshot({path: 'screenshots/board-5-flyto.png'});
  await page.close();

  await browser.close();
})();
