/* ================================================================
   題材ごとの設定ファイル
   別のアニメ・作品で作るときは、基本的にこのファイルと data.src.js だけを差し替える。
   （app.js / loader.js / index.html / style.css は共通エンジン）
   ================================================================ */
window.GAME_CONFIG = {
  // --- 識別子（localStorage と PeerJS ルームIDの接頭辞。題材ごとに必ず変える） ---
  id: "inaguesser",
  // --- 公開URL（build-data.js が共有リンクを表示するのに使う） ---
  siteUrl: "https://so-sons.github.io/inaguesser/",

  // --- 見た目の文言 ---
  title: "イナゲッサー",
  kicker: "INAZUMA ELEVEN CHARACTER GUESSER",
  heroTitle: "イナズマイレブンのキャラを\nヒントから当てよう",
  itemLabel: "キャラ",       // 「キャラ名を入力」「メインキャラのみ」などに使う
  unit: "人",                // 候補数の単位（人 / 匹 / 体 …）
  credit: "非公式ファンゲームです。キャラクターデータは",
  creditLink: { label: "イナズマイレブン公式選手図鑑 Inagle", url: "https://zukan.inazuma.jp/" },
  creditTail: "を元にしています。©LEVEL-5 Inc.",

  // --- ルール ---
  soloMax: 10,               // ひとりで遊ぶの回数制限
  maxPlayers: 4,             // 対戦の最大人数

  // --- 画像（空文字にすると画像なしで動く） ---
  imageBase: "https://dxi4wb638ujep.cloudfront.net/1/",
  imageExt: ".webp",

  // --- キャラデータの読み方 ---
  fields: { name: "n", kana: "k", alias: "a", image: "i", main: "m" },
  // 候補リストの右側に出す補足（任意）
  suggestSub: (c) => c.p + "・" + c.t.slice(0, 2).join(" / "),

  // --- ヒント項目（この順でタイルが並ぶ） ---
  //  type: "exact"   … 一致 / 不一致
  //        "set"     … 配列。全一致=緑、1つ以上共通=黄、共通なし=灰
  //        "ordinal" … 順序あり。orderKey（数値）で ▲▼ を出す。labels を指定すると表示名を data.lists から引く
  attrs: [
    { key: "t",  label: "所属チーム", type: "set", wide: true, empty: "所属なし" },
    { key: "p",  label: "ポジション", type: "exact" },
    { key: "g",  label: "性別",       type: "exact" },
    { key: "gr", label: "学年",       type: "ordinal", orderKey: "go", up: "正解はもっと上の学年", down: "正解はもっと下の学年" },
    { key: "e",  label: "属性",       type: "exact" },
    { key: "f",  label: "初登場",     fullLabel: "初登場作品", type: "ordinal", labels: "short", fullLabels: "works", up: "正解はもっと後の作品", down: "正解はもっと前の作品" },
  ],

  // --- 出題範囲フィルター（チェックボックス）。不要なら null ---
  filter: { key: "f", label: "出題範囲（初登場作品）", options: "works", optionLabel: (w) => w.replace("イナズマイレブン", "イナイレ") },

  // --- 難易度（main フラグ）。不要なら null ---
  difficulty: { mainLabel: "メインキャラのみ", mainNote: "約150人", allLabel: "全キャラ", allNote: "チーム所属の全選手" },

  // --- ルール説明の補足 ---
  notes: [
    "学年は原則として初登場時のもの。大人・小学生などは学年の代わりに年代を表示します（「超越」などは矢印なし）。",
  ],
};
