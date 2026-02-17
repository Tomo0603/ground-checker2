import { chromium } from 'playwright';
import fs from 'fs';

// ========== 設定 ==========

const GROUNDS_CONFIG = [
  // 海老名市（✅ 動作確認済み）
  {
    name: '海老名運動公園陸上競技場 陸上競技場',
    kind: 'ekanagawa',
    url: 'https://yoyaku.e-kanagawa.lg.jp/Ebina/Web/Wg_ModeSelect.aspx',
    facilityPath: ['スポーツ施設', '海老名運動公園陸上競技場', '陸上競技場'],
    keywords: ['空き', '○', '◯', '空有']
  },
  {
    name: '中野公園人工芝グラウンド グラウンド',
    kind: 'ekanagawa',
    url: 'https://yoyaku.e-kanagawa.lg.jp/Ebina/Web/Wg_ModeSelect.aspx',
    facilityPath: ['スポーツ施設', '中野公園人工芝グラウンド', 'グラウンド'],
    keywords: ['空き', '○', '◯', '空有']
  },

  // 中外製薬横浜グラウンド（✅ ログイン確認済み、menu=25がグラウンド）
  {
    name: '中外ライフサイエンスパーク横浜 グラウンド',
    kind: 'chugai',
    url: 'https://www.chugailspyokohamayoyaku.jp/chugai-pharm',
    menuUrl: 'https://www.chugailspyokohamayoyaku.jp/chugai-pharm?menu=25',
    keywords: ['○', '◯', '空き', '予約可', '△']
  }
];

const STATE_FILE = 'state.json';

// ========== ユーティリティ ==========

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {}
  return { notifiedSlots: [] };
}

function saveState(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8'); } catch (e) {}
}

async function clickItem(page, text) {
  return await page.evaluate((text) => {
    const els = Array.from(document.querySelectorAll('a, input[type="submit"], button, input[type="button"]'));
    const target = els.find(el => (el.textContent || el.value || '').includes(text));
    if (target) { target.click(); return true; }
    return false;
  }, text);
}

function extractAvailabilityGeneric(html, keywords) {
  const availableSlots = [];
  const lines = html.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!keywords.some(kw => line.includes(kw))) continue;
    const context = lines.slice(Math.max(0, i - 2), i + 3).join(' ');
    const hasDate = [/\d{1,2}月\d{1,2}日/, /\d{1,2}\/\d{1,2}/, /\d{4}-\d{1,2}-\d{1,2}/].some(p => p.test(context));
    const hasTime = [/\d{1,2}:\d{2}/, /午前|午後/, /\d{1,2}時/].some(p => p.test(context));
    if (hasDate || hasTime) {
      const clean = context.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().substring(0, 100);
      if (clean && !availableSlots.includes(clean)) availableSlots.push(clean);
    }
  }
  return availableSlots;
}

// ========== 海老名チェック ==========

async function checkEKanagawa(page, ground) {
  console.log(`  📍 URL: ${ground.url}`);
  await page.goto(ground.url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  for (const pathItem of ground.facilityPath) {
    console.log(`  🔽 "${pathItem}" を選択中...`);
    const clicked = await clickItem(page, pathItem);
    if (!clicked) throw new Error(`"${pathItem}" が見つかりません`);
    console.log(`  ✓ "${pathItem}" を選択`);
    await page.waitForTimeout(2000);
  }

  const available = extractAvailabilityGeneric(await page.content(), ground.keywords);
  console.log(`  📊 検出結果: ${available.length}件の空き`);
  return { available };
}

// ========== 中外製薬チェック ==========

let chugaiLoggedIn = false;
let chugaiContext = null;

async function ensureChugaiLogin(browser) {
  if (chugaiLoggedIn && chugaiContext) return chugaiContext;

  const loginId = process.env.CHUGAI_LOGIN_ID;
  const password = process.env.CHUGAI_PASSWORD;
  if (!loginId || !password) throw new Error('CHUGAI_LOGIN_ID または CHUGAI_PASSWORD が未設定です');

  chugaiContext = await browser.newContext();
  const page = await chugaiContext.newPage();

  console.log('  🔐 中外製薬にログイン中...');
  await page.goto('https://www.chugailspyokohamayoyaku.jp/chugai-pharm', {
    waitUntil: 'networkidle', timeout: 30000
  });
  await page.waitForTimeout(2000);

  const hasPassword = await page.$('input[type="password"]');
  if (hasPassword) {
    for (const sel of ['input[type="text"]', 'input[name*="id" i]', 'input[name*="user" i]']) {
      try {
        const el = await page.$(sel);
        if (el) { await el.fill(loginId); break; }
      } catch (e) {}
    }
    await page.fill('input[type="password"]', password);
    for (const sel of ['button[type="submit"]', 'input[type="submit"]']) {
      try { await page.click(sel); break; } catch (e) {}
    }
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle').catch(() => {});
    console.log(`  ✓ ログイン完了`);
    chugaiLoggedIn = true;
  }

  await page.close();
  return chugaiContext;
}

async function checkChugai(browser, ground) {
  const context = await ensureChugaiLogin(browser);
  const page = await context.newPage();

  try {
    console.log(`  📍 menuURL: ${ground.menuUrl}`);
    await page.goto(ground.menuUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    console.log(`  ✓ ページ: ${await page.title()}`);

    // テーブルを行単位で取得
    const tableRows = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tr'));
      return rows.map(row => {
        const cells = Array.from(row.querySelectorAll('td, th'));
        return cells.map(c => c.textContent?.trim() || '').join(' | ');
      }).filter(r => r.trim());
    });

    console.log(`  📊 テーブル行数: ${tableRows.length}`);
    if (tableRows.length > 0) {
      console.log(`  📊 最初の15行:`);
      tableRows.slice(0, 15).forEach(row => console.log(`     ${row}`));
    }

    // 空き検出
    const availableSlots = [];
    for (const row of tableRows) {
      if (!ground.keywords.some(kw => row.includes(kw))) continue;
      // 「×」だけの行はスキップ（全埋まり）
      if (row.replace(/[|×\s]/g, '') === '') continue;
      const hasDate = /\d{1,2}月\d{1,2}日|\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|\d{1,2}\/\d{1,2}/.test(row);
      const hasTime = /\d{1,2}:\d{2}|\d{1,2}時|午前|午後/.test(row);
      if ((hasDate || hasTime) && !availableSlots.includes(row)) {
        availableSlots.push(row.substring(0, 100));
      }
    }

    console.log(`  📊 検出結果: ${availableSlots.length}件の空き`);
    return { available: availableSlots };
  } finally {
    await page.close();
  }
}

// ========== メイン ==========

async function main() {
  console.log('===========================================');
  console.log(`チェック開始: ${new Date().toLocaleString('ja-JP')}`);
  console.log(`監視施設数: ${GROUNDS_CONFIG.length}件`);
  console.log('===========================================');

  const state = loadState();
  const notifiedSet = new Set(state.notifiedSlots || []);
  let newAvailabilityFound = false;
  const results = [];

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    for (const ground of GROUNDS_CONFIG) {
      console.log(`\n🔍 チェック中: ${ground.name}`);

      try {
        let result;
        if (ground.kind === 'ekanagawa') {
          const page = await browser.newPage();
          try { result = await checkEKanagawa(page, ground); }
          finally { await page.close(); }
        } else if (ground.kind === 'chugai') {
          result = await checkChugai(browser, ground);
        } else {
          throw new Error(`未知のkind: ${ground.kind}`);
        }

        const groundResult = { name: ground.name, allSlots: result.available || [], newSlots: [] };
        for (const slot of result.available || []) {
          const key = `${ground.name}|${slot}`;
          if (!notifiedSet.has(key)) {
            console.log(`  🆕 新規空き: ${slot}`);
            groundResult.newSlots.push(slot);
            notifiedSet.add(key);
            newAvailabilityFound = true;
          }
        }
        results.push(groundResult);
      } catch (error) {
        console.error(`  ❌ エラー: ${error.message}`);
        results.push({ name: ground.name, error: error.message, allSlots: [], newSlots: [] });
      }

      await new Promise(r => setTimeout(r, 2000));
    }
  } finally {
    if (chugaiContext) await chugaiContext.close().catch(() => {});
    await browser.close();
  }

  if (newAvailabilityFound) {
    state.notifiedSlots = Array.from(notifiedSet);
    state.lastUpdate = new Date().toISOString();
    saveState(state);
  }

  fs.writeFileSync('result.json', JSON.stringify(results, null, 2), 'utf8');
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `new_availability=${newAvailabilityFound}\n`);
  }

  console.log('\n===========================================');
  console.log(`チェック完了: ${new Date().toLocaleString('ja-JP')}`);
  console.log(`新規空き発見: ${newAvailabilityFound ? 'あり' : 'なし'}`);
  console.log('===========================================');
}

main().catch(err => { console.error(err); process.exit(1); });
