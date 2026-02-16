name: グラウンド空き監視

on:
  schedule:
    # 1時間ごとに実行（UTC時刻）
    - cron: '0 * * * *'
  workflow_dispatch:  # 手動実行も可能

permissions:
  issues: write
  contents: read

jobs:
  check-availability:
    runs-on: ubuntu-latest
    
    steps:
      - name: チェックアウト
        uses: actions/checkout@v4
      
      - name: Node.jsセットアップ
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: 依存関係をインストール
        run: npm install
      
      - name: Playwrightブラウザをインストール
        run: npx playwright install chromium --with-deps
      
      - name: 前回の状態を復元
        uses: actions/cache@v4
        with:
          path: state.json
          key: notification-state-${{ github.run_id }}
          restore-keys: |
            notification-state-
      
      - name: グラウンド空きチェック
        id: check
        run: node check-github.js
        continue-on-error: true
      
      - name: 新しい空きが見つかった場合にIssue作成
        if: steps.check.outputs.new_availability == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const result = JSON.parse(fs.readFileSync('result.json', 'utf8'));
            
            let body = '新しい空き枠が見つかりました！\n\n';
            
            result.forEach(item => {
              if (item.newSlots && item.newSlots.length > 0) {
                body += `## 🎉 ${item.name}\n\n`;
                item.newSlots.forEach(slot => {
                  body += `- ${slot}\n`;
                });
                body += '\n';
              }
            });
            
            body += `\n---\n検出時刻: ${new Date().toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'})}`;
            
            // 新しいIssueを作成
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `🎉 グラウンド空き発見！ (${new Date().toLocaleDateString('ja-JP')})`,
              body: body,
              labels: ['空き通知']
            });
      
      - name: 状態を保存
        uses: actions/cache/save@v4
        if: always()
        with:
          path: state.json
          key: notification-state-${{ github.run_id }}
      
      - name: ログをアップロード
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: check-logs-${{ github.run_number }}
          path: |
            *.log
            *.json
          retention-days: 7
