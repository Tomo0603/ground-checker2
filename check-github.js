import { chromium } from 'playwright';
import fs from 'fs';

// ========== 設定 ==========

const GROUNDS_CONFIG = [
  // 神奈川県（e-kanagawa）
  // ※ ログイン不要の空き照会ページに直接アクセス
  {
    name: '保土ケ谷公園 サッカー場',
    kind: 'ekanagawa_kanagawa',
    url: 'https://yoyaku.e-kanagawa.lg.jp/Kanagawa/Web/Wg_KoukyouShisetsuYoyakuMoushikomi.aspx',
    facilityPath: ['スポーツ施設', '保土ケ谷公園', 'サッカー場'],
    keywords: ['空き', '○', '◯', '空有']
  },
  {
    name: '保土ケ谷公園 ラグビー場全面',
    kind: 'ekanagawa_kanagawa',
    url: 'https://yoyaku.e-kanagawa.lg.jp/Kanagawa/Web/Wg_KoukyouShisetsuYoyakuMoushikomi.aspx',
    facilityPath: ['スポーツ施設', '保土ケ谷公園', 'ラグビー場全面'],
    keywords: ['空き', '○', '◯', '空有']
  },
  {
    name: '境川遊水地公園 多目的グラウンド',
    kind: 'ekanagawa_kanagawa',
    url: 'https://yoyaku.e-kanagawa.lg.jp/Kanagawa/Web/Wg_KoukyouShisetsuYoyakuMoushikomi.aspx',
    facilityPath: ['スポーツ施設', '境川遊水地公園', '多目的グラウンド'],
    keywords: ['空き', '○', '◯', '空有']
  },
  {
    name: '県立スポーツセンター 球技場（天然芝）',
    kind: 'ekanagawa_kanagawa',
    url: 'https://yoyaku.e-kanagawa.lg.jp/Kanagawa/Web/Wg_KoukyouShisetsuYoyakuMoushikomi.aspx',
    facilityPath: ['スポーツ施設', '県立スポーツセンター', '球技場（天然芝）'],
    keywords: ['空き', '○', '◯', '空有']
  },
  {
    name: '県立スポーツセンター 球技場（人工芝）',
    kind: 'ekanagawa_kanagawa',
    url: 'https://yoyaku.e-kanagawa.lg.jp/Kanagawa/Web/Wg_KoukyouShisetsuYoyakuMoushikomi.aspx',
    facilityPath: ['スポーツ施設', '県立スポーツセンター', '球技場（人工芝）'],
    keywords: ['空き', '○', '◯', '空有']
  },

  // 海老名市（e-kanagawa） ← 前回成功
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

  // 茅ヶ崎市
  {
    name: '茅ヶ崎・柳島スポーツ公園',
    kind: 'chigasaki',
    url: 'https://yoyaku.city.chigasaki.kanagawa.jp/cultos/reserve/gin_init2',
    keywords: ['空き', '○', '◯', '空有']
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

// ========== 神奈川県チェック（直接URLアクセス） ==========

async function checkEKanagawaKanagawa(page, ground) {
  console.log(`  📍 URL: ${ground.url}`);
  await page.goto(ground.url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const topOpts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a, input[type="submit"], button'))
      .map(el => (el.textContent || el.value || '').trim()).filter(t => t.length > 0)
  );
  console.log(`  📋 ページのオプション: ${topOpts.join(' | ')}`);

  for (const pathItem of ground.facilityPath) {
    console.log(`  🔽 "${pathItem}" を選択中...`);
    const clicked = await clickItem(page, pathItem);
    if (!clicked) {
      const opts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a, input[type="submit"], button'))
          .map(el => (el.textContent || el.value || '').trim())
          .filter(t => t.length > 0 && t.length < 80).slice(0, 30)
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
          .filter(t => t.length > 0 && t.length < 80).slice(0, 30)
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

// ========== 茅ヶ崎チェック ==========

async function checkChigasaki(page, ground) {
  console.log(`  📍 URL: ${ground.url}`);
  await page.goto(ground.url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const available = extractAvailability(await page.content(), ground.keywords);
  console.log(`  📊 検出結果: ${available.length}件の空き`);
  return { available };
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
        if (ground.kind === 'ekanagawa_kanagawa') {
          result = await checkEKanagawaKanagawa(page, ground);
        } else if (ground.kind === 'chigasaki') {
          result = await checkChigasaki(page, ground);
        } else {
          result = await checkEKanagawa(page, ground);
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
