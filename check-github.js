import { chromium } from 'playwright';
import fs from 'fs';

// ========== 設定 ==========
// ここを編集して監視したい施設を追加・変更してください

const GROUNDS_CONFIG = [
  // 神奈川県のe-kanagawaシステム
  {
    name: '保土ヶ谷公園 サッカー場',
    kind: 'ekanagawa',
    url: 'https://yoyaku.e-kanagawa.lg.jp/Kanagawa/Web/Wg_ModeSelect.aspx',
    facilityPath: ['スポーツ施設', '保土ヶ谷公園', 'サッカー場'],
    keywords: ['空き', '○', '◯', '空有']
  },
  {
    name: '保土ヶ谷公園 ラグビー場全面',
    kind: 'ekanagawa',
    url: 'https://yoyaku.e-kanagawa.lg.jp/Kanagawa/Web/Wg_ModeSelect.aspx',
    facilityPath: ['スポーツ施設', '保土ヶ谷公園', 'ラグビー場全面'],
    keywords: ['空き', '○', '◯', '空有']
  },
  {
    name: '境川遊水池公園 多目的グラウンド',
    kind: 'ekanagawa',
    url: 'https://yoyaku.e-kanagawa.lg.jp/Kanagawa/Web/Wg_ModeSelect.aspx',
    facilityPath: ['スポーツ施設', '境川遊水池公園', '多目的グラウンド'],
    keywords: ['空き', '○', '◯', '空有']
  },
  {
    name: '県立スポーツセンター 球技場（天然芝）',
    kind: 'ekanagawa',
    url: 'https://yoyaku.e-kanagawa.lg.jp/Kanagawa/Web/Wg_ModeSelect.aspx',
    facilityPath: ['スポーツ施設', '県立スポーツセンター', '球技場（天然芝）'],
    keywords: ['空き', '○', '◯', '空有']
  },
  {
    name: '県立スポーツセンター 球技場（人工芝）',
    kind: 'ekanagawa',
    url: 'https://yoyaku.e-kanagawa.lg.jp/Kanagawa/Web/Wg_ModeSelect.aspx',
    facilityPath: ['スポーツ施設', '県立スポーツセンター', '球技場（人工芝）'],
    keywords: ['空き', '○', '◯', '空有']
  },
  
  // 海老名市のe-kanagawaシステム
  {
    name: '海老名運動公園陸上競技場 陸上競技場',
    kind: 'ekanagawa',
    url: 'https://yoyaku.e-kanagawa.lg.jp/Ebina/Web/Wg_ModeSelect.aspx',
    facilityPath: ['海老名運動公園陸上競技場', '陸上競技場'],
    keywords: ['空き', '○', '◯', '空有']
  },
  {
    name: '中野公園人工芝グラウンド グラウンド',
    kind: 'ekanagawa',
    url: 'https://yoyaku.e-kanagawa.lg.jp/Ebina/Web/Wg_ModeSelect.aspx',
    facilityPath: ['中野公園人工芝グラウンド', 'グラウンド'],
    keywords: ['空き', '○', '◯', '空有']
  },
  
  // 茅ヶ崎市システム
  {
    name: '茅ヶ崎・柳島スポーツ公園',
    kind: 'chigasaki',
    url: 'https://yoyaku.city.chigasaki.kanagawa.jp/cultos/reserve/gin_init2',
    keywords: ['空き', '○', '◯', '空有']
  }
];

const STATE_FILE = 'state.json';

// ========== ユーティリティ関数 ==========

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('状態の読み込みエラー:', error.message);
  }
  return { notifiedSlots: [] };
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.error('状態の保存エラー:', error.message);
  }
}

function extractAvailability(html, keywords) {
  const availableSlots = [];
  const lines = html.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (!keywords.some(keyword => line.includes(keyword))) continue;
    
    const context = lines.slice(Math.max(0, i - 2), i + 3).join(' ');
    
    const datePatterns = [
      /(\d{1,2})月(\d{1,2})日/,
      /(\d{1,2})\/(\d{1,2})/,
      /(\d{4})-(\d{1,2})-(\d{1,2})/
    ];
    
    const timePatterns = [
      /(\d{1,2}):(\d{2})/,
      /午前|午後|AM|PM/,
      /\d{1,2}時/
    ];
    
    const hasDate = datePatterns.some(pattern => pattern.test(context));
    const hasTime = timePatterns.some(pattern => pattern.test(context));
    
    if (hasDate || hasTime) {
      const cleanContext = context
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100);
      
      if (cleanContext && !availableSlots.includes(cleanContext)) {
        availableSlots.push(cleanContext);
      }
    }
  }
  
  return availableSlots;
}

// ========== チェック処理 ==========

async function checkEKanagawa(page, ground) {
  console.log(`  📍 URL: ${ground.url}`);
  
  await page.goto(ground.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  // 施設検索ページへの遷移（神奈川県の場合のみ）
  if (ground.url.includes('/Kanagawa/')) {
    try {
      await page.click('input[value*="施設"]');
      console.log('  ✓ 施設検索ページに遷移');
      await page.waitForTimeout(2000);
    } catch (e) {
      console.log('  ℹ️ 既に施設検索ページ');
    }
  } else {
    // 海老名市の場合は直接施設選択
    console.log('  ℹ️ 海老名市システム - 施設選択画面');
  }
  
  // facilityPathを辿る
  for (const pathItem of ground.facilityPath) {
    console.log(`  🔽 "${pathItem}" を選択中...`);
    
    const clicked = await page.evaluate((text) => {
      const links = Array.from(document.querySelectorAll('a, input[type="submit"], button'));
      const target = links.find(el => {
        const content = el.textContent || el.value || '';
        return content.includes(text);
      });
      if (target) {
        target.click();
        return true;
      }
      return false;
    }, pathItem);
    
    if (!clicked) {
      throw new Error(`"${pathItem}" が見つかりません`);
    }
    
    console.log(`  ✓ "${pathItem}" を選択`);
    await page.waitForTimeout(2000);
  }
  
  const html = await page.content();
  const available = extractAvailability(html, ground.keywords);
  
  console.log(`  📊 検出結果: ${available.length}件の空き`);
  
  return { available };
}

async function checkChigasaki(page, ground) {
  console.log(`  📍 URL: ${ground.url}`);
  
  await page.goto(ground.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  const html = await page.content();
  const available = extractAvailability(html, ground.keywords);
  
  console.log(`  📊 検出結果: ${available.length}件の空き`);
  
  return { available };
}

async function checkGeneric(page, ground) {
  console.log(`  📍 URL: ${ground.url}`);
  
  await page.goto(ground.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  const html = await page.content();
  const available = extractAvailability(html, ground.keywords);
  
  console.log(`  📊 検出結果: ${available.length}件の空き`);
  
  return { available };
}

// ========== メイン処理 ==========

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
          case 'ekanagawa':
            result = await checkEKanagawa(page, ground);
            break;
          case 'chigasaki':
            result = await checkChigasaki(page, ground);
            break;
          default:
            result = await checkGeneric(page, ground);
        }
        
        const groundResult = {
          name: ground.name,
          allSlots: result.available || [],
          newSlots: []
        };
        
        if (result.available && result.available.length > 0) {
          result.available.forEach(slot => {
            const slotKey = `${ground.name}|${slot}`;
            if (!notifiedSet.has(slotKey)) {
              console.log(`  🆕 新規空き: ${slot}`);
              groundResult.newSlots.push(slot);
              notifiedSet.add(slotKey);
              newAvailabilityFound = true;
            } else {
              console.log(`  ℹ️  既知の空き: ${slot}`);
            }
          });
        }
        
        results.push(groundResult);
        
      } catch (error) {
        console.error(`  ❌ エラー: ${error.message}`);
        results.push({
          name: ground.name,
          error: error.message,
          allSlots: [],
          newSlots: []
        });
      } finally {
        await page.close();
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
  } finally {
    await browser.close();
  }
  
  // 状態を保存
  if (newAvailabilityFound) {
    state.notifiedSlots = Array.from(notifiedSet);
    state.lastUpdate = new Date().toISOString();
    saveState(state);
  }
  
  // 結果をファイルに保存（GitHub Actionsで使用）
  fs.writeFileSync('result.json', JSON.stringify(results, null, 2), 'utf8');
  
  // GitHub Actions の output を設定
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `new_availability=${newAvailabilityFound}\n`
    );
  }
  
  console.log('\n===========================================');
  console.log(`チェック完了: ${new Date().toLocaleString('ja-JP')}`);
  console.log(`新規空き発見: ${newAvailabilityFound ? 'あり' : 'なし'}`);
  console.log('===========================================');
}

main().catch(error => {
  console.error('エラーが発生しました:', error);
  process.exit(1);
});
