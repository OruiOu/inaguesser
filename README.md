# イナゲッサー

イナズマイレブンのキャラクターを、所属チーム・ポジション・性別・学年・属性・初登場作品のヒントから当てる推理ゲーム（ポケゲッサー風）。
ルームコードで友達とオンライン対戦できます。カギ付きリンクを知っている人だけが遊べます。

- 非公式ファンゲームです。キャラクターデータは [イナズマイレブン公式選手図鑑 Inagle](https://zukan.inazuma.jp/) を元にしています。©LEVEL-5 Inc.
- 対戦モードの通信は PeerJS（WebRTC）。サーバー不要。

## ファイル構成
| ファイル | 役割 |
|---|---|
| `config.js` | 題材ごとの設定（タイトル・ヒント項目・フィルター）★別作品ではここを差し替え |
| `data.src.js` | キャラデータ（平文・コミットしない）★別作品ではここを差し替え |
| `build-data.js` | `data.src.js` を暗号化して `data.bin` を生成 |
| `index.html` / `style.css` / `app.js` / `loader.js` | 共通エンジン |
| `docs/新しい題材で作る.md` | 別の作品で作るときの手順書 |

## 更新のしかた
```bash
node build-data.js   # data.src.js を変えたとき
git add -A && git commit -m "..." && git push   # 約1分で GitHub Pages に反映
```
