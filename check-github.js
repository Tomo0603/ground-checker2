import { chromium } from 'playwright';
import fs from 'fs';

const GROUNDS_CONFIG = [
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
  {
    name: '中外ライフサイエンスパーク横浜 グラウンド',
    kind: 'chugai',
    url: 'https://www.chugailspyokohamayoyaku.jp/chugai-pharm',
    menuUrl: 'https://www.chugailspyokohamayoyaku.jp/chugai-pharm?menu=25',
    keywords: ['○', '◯', '空き', '予約可', '△']
  }
];

const STATE_FILE = 'state.json';

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
      try { const el = await page.$(sel); if (el) { await el.fill(loginId); break; } } catch (e) {}
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
    // menu=25のページへ
    console.log(`  📍 ${ground.menuUrl}`);
    await page.goto(ground.menuUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // HTML内の「予約可」リンクをすべて取得
    const reserveLinks = await page.evaluate(() => {
      const results = [];
      // href付きのすべてのaタグ
      Array.from(document.querySelectorAll('a[href]')).forEach(el => {
        const href = el.href;
        const text = el.textContent?.trim() || '';
        // 予約系URLを含むもの
        if (href.includes('reserve') || href.includes('yoyaku') || 
            href.includes('date') || href.includes('menu') ||
            href.includes('calendar') || href.includes('schedule')) {
          results.push({ text, href });
        }
      });
      return results;
    });

    console.log(`  🔗 予約関連リンク (${reserveLinks.length}件):`);
    reserveLinks.slice(0, 10).forEach(l => console.log(`     "${l.text}" → ${l.href}`));

    // HTMLから直接「予約可」テキストを含む要素のhrefを探す
    const allHrefs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a'))
        .map(el => ({ text: el.textContent?.trim(), href: el.href }))
        .filter(l => l.href && !l.href.endsWith('#'))
        .slice(0, 50);
    });

    // 「chugai-pharm」を含むリンクを全て表示
    const chugaiLinks = allHrefs.filter(l => l.href.includes('chugai-pharm'));
    console.log(`  🔗 chugai-pharmリンク一覧:`);
    chugaiLinks.forEach(l => console.log(`     "${l.text}" → ${l.href}`));

    // HTML内のscriptタグからURLを探す
    const scriptUrls = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script'));
      const urls = [];
      scripts.forEach(s => {
        const matches = s.textContent?.match(/https?:\/\/[^\s"']+chugai[^\s"']*/g) || [];
        urls.push(...matches);
      });
      return [...new Set(urls)];
    });
    if (scriptUrls.length > 0) {
      console.log(`  📜 scriptタグ内URL: ${scriptUrls.join(', ')}`);
    }

    // カレンダーAPIを直接試す（EDISONEシステムの一般的なパターン）
    const calendarUrls = [
      `https://www.chugailspyokohamayoyaku.jp/chugai-pharm/reserve?menu=25`,
      `https://www.chugailspyokohamayoyaku.jp/chugai-pharm/calendar?menu=25`,
      `https://www.chugailspyokohamayoyaku.jp/chugai-pharm/schedule?menu=25`,
    ];

    for (const calUrl of calendarUrls) {
      try {
        await page.goto(calUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.waitForTimeout(2000);
        const title = await page.title();
        const url = page.url();
        const bodyText = (await page.evaluate(() => document.body.innerText)).substring(0, 300);
        console.log(`  📅 試行: ${calUrl}`);
        console.log(`     → タイトル: ${title}`);
        console.log(`     → URL: ${url}`);
        console.log(`     → テキスト: ${bodyText.substring(0, 100)}`);
      } catch (e) {
        console.log(`  📅 ${calUrl} → エラー: ${e.message.substring(0, 50)}`);
      }
    }

    return { available: [] };
  } finally {
    await page.close();
  }
}

async function main() {
  console.log('===========================================');
  console.log(`チェック開始: ${new Date().toLocaleString('ja-JP')}`);
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
          try { result = await checkEKanagawa(page, ground); } finally { await page.close(); }
        } else if (ground.kind === 'chugai') {
          result = await checkChugai(browser, ground);
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
  console.log('===========================================');
}

main().catch(err => { console.error(err); process.exit(1); });
