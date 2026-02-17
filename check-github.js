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

  // 茅ヶ崎市（タイムアウトのため一時無効 → 復活させたい場合はコメントを外す）
  // {
  //   name: '茅ヶ崎・柳島スポーツ公園',
  //   kind: 'chigasaki',
  //   url: 'https://yoyaku.city.chigasaki.kanagawa.jp/cultos/reserve/gin_init2',
  //   keywords: ['空き', '○', '◯', '空有']
  // },

  // 中外製薬横浜（✅ ログイン確認済み）
  {
    name: '中外製薬横浜グラウンド',
    kind: 'chugai',
    url: 'https://www.chugailspyokohamayoyaku.jp/chugai-pharm',
    keywords: ['○', '◯', '空き', '予約可', '利用可', '△']
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

function extractAvailability(html, keywords) {
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

async function clickItem(page, text) {
  return await page.evaluate((text) => {
    const els = Array.from(document.querySelectorAll('a, input[type="submit"], button, input[type="button"]'));
    const target = els.find(el => (el.textContent || el.value || '').includes(text));
    if (target) { target.click(); return true; }
    return false;
  }, text);
}

// ========== 海老名チェック ==========

async function checkEKanagawa(page, ground) {
  console.log(`  📍 URL: ${ground.url}`);
  await page.goto(ground.url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  for (const pathItem of ground.facilityPath) {
    console.log(`  🔽 "${pathItem}" を選択中...`);
    const clicked = await clickItem(page, pathItem);
    if (!clicked) {
      const opts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a, input[type="submit"], button'))
          .map(el => (el.textContent || el.value || '').trim())
          .filter(t => t.length > 0 && t.length < 80).slice(0, 20)
      );
      console.log(`  💡 現在のオプション: ${opts.join(' | ')}`);
      throw new Error(`"${pathItem}" が見つかりません`);
    }
    console.log(`  ✓ "${pathItem}" を選択`);
    await page.waitForTimeout(2000);
  }

  const available = extractAvailability(await page.content(), ground.keywords);
  console.log(`  📊 検出結果: ${available.length}件の空き`);
  return { available };
}

// ========== 中外製薬チェック（自動ログイン） ==========

async function checkChugai(page, ground) {
  const loginId = process.env.CHUGAI_LOGIN_ID;
  const password = process.env.CHUGAI_PASSWORD;

  if (!loginId || !password) {
    throw new Error('CHUGAI_LOGIN_ID または CHUGAI_PASSWORD が未設定です');
  }

  console.log(`  📍 URL: ${ground.url}`);
  await page.goto(ground.url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // ログイン処理
  const hasPassword = await page.$('input[type="password"]');
  if (hasPassword) {
    console.log('  🔐 自動ログイン中...');

    // ID入力
    const idSelectors = [
      'input[type="text"]', 'input[name*="id" i]', 'input[name*="user" i]',
      'input[name*="login" i]', 'input[id*="id" i]',
    ];
    for (const sel of idSelectors) {
      try {
        const el = await page.$(sel);
        if (el) { await el.fill(loginId); console.log(`  ✓ ID入力完了`); break; }
      } catch (e) {}
    }

    await page.fill('input[type="password"]', password);
    console.log('  ✓ パスワード入力完了');

    for (const sel of ['button[type="submit"]', 'input[type="submit"]', 'input[value*="ログイン"]']) {
      try { await page.click(sel); console.log(`  ✓ ログインボタンクリック`); break; } catch (e) {}
    }

    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle').catch(() => {});
    console.log(`  ✓ ログイン後: ${await page.title()}`);
    console.log(`  ✓ 現在URL: ${page.url()}`);
  }

  // 現在のページURLを確認
  const currentUrl = page.url();
  console.log(`  📍 現在のURL: ${currentUrl}`);

  // 全リンクのURLとテキストをデバッグ表示
  const allLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a'))
      .map(el => ({ text: el.textContent?.trim(), href: el.href }))
      .filter(l => l.text && l.text.length > 0 && l.text.length < 50)
      .slice(0, 20)
  );
  console.log(`  💡 全リンク:`);
  allLinks.forEach(l => console.log(`     "${l.text}" → ${l.href}`));

  // 「店舗ページ」リンクのURLを取得して直接遷移
  const shopLink = allLinks.find(l => l.text.includes('店舗ページ'));
  if (shopLink && shopLink.href) {
    console.log(`  🔗 店舗ページへ移動: ${shopLink.href}`);
    await page.goto(shopLink.href, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    console.log(`  ✓ 遷移後ページ: ${await page.title()}`);
    console.log(`  ✓ 遷移後URL: ${page.url()}`);

    // 遷移後のリンクも確認
    const shopLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a'))
        .map(el => ({ text: el.textContent?.trim(), href: el.href }))
        .filter(l => l.text && l.text.length > 0 && l.text.length < 80)
        .slice(0, 30)
    );
    console.log(`  💡 店舗ページのリンク:`);
    shopLinks.forEach(l => console.log(`     "${l.text}" → ${l.href}`));
  }

  // カレンダーページのHTMLから空き情報を抽出
  const html = await page.content();

  // テーブルセルで○などの短いキーワードを探す
  const availableSlots = [];
  const cellPattern = /<(?:td|th|span)[^>]*>([\s\S]*?)<\/(?:td|th|span)>/gi;
  let match;
  while ((match = cellPattern.exec(html)) !== null) {
    const cellText = match[1].replace(/<[^>]+>/g, '').trim();
    if (cellText.length > 20) continue;
    if (!ground.keywords.some(kw => cellText === kw || cellText.includes(kw))) continue;

    const pos = match.index;
    const surrounding = html.substring(Math.max(0, pos - 300), pos + 300)
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    const hasDate = [/\d{1,2}月\d{1,2}日/, /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/].some(p => p.test(surrounding));
    const hasTime = [/\d{1,2}:\d{2}/, /\d{1,2}時/, /午前|午後/].some(p => p.test(surrounding));

    if (hasDate || hasTime) {
      const dateM = surrounding.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|\d{1,2}月\d{1,2}日)/);
      const timeM = surrounding.match(/(\d{1,2}:\d{2}|\d{1,2}時|\d{1,2}時\d{2}分)/);
      const slot = `${dateM?.[0] || ''} ${timeM?.[0] || ''} [${cellText}]`.trim();
      if (!availableSlots.includes(slot)) availableSlots.push(slot);
    }
  }

  console.log(`  📊 検出結果: ${availableSlots.length}件の空き`);
  if (availableSlots.length > 0) {
    availableSlots.slice(0, 5).forEach(s => console.log(`     → ${s}`));
  }
  return { available: availableSlots };
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
      const page = await browser.newPage();

      try {
        let result;
        switch (ground.kind) {
          case 'ekanagawa': result = await checkEKanagawa(page, ground); break;
          case 'chugai':    result = await checkChugai(page, ground);    break;
          default: throw new Error(`未知のkind: ${ground.kind}`);
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
      } finally {
        await page.close();
      }

      await new Promise(r => setTimeout(r, 2000));
    }
  } finally {
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
