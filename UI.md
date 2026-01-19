# UIコンポーネント解説: サイドパネル & ボトムシート

このプロジェクトで使用されている、デバイスに応じて形状が変化するUIコンポーネント（`LayerMenu`）についての解説です。

## 1. UIの名称と役割

このUIは、画面サイズに応じて2つの異なるデザインパターンを組み合わせています。

| デバイス | 名称 | 特徴 |
| :--- | :--- | :--- |
| **PC (Desktop)** | **サイドパネル (Side Panel)** | 画面の左端（または右端）に配置され、広い画面を活用して情報を常時表示または展開します。 |
| **スマホ (Mobile)** | **ボトムシート (Bottom Sheet)** | 画面下部から引き出されるパネルです。親指で操作しやすく、地図などのメインコンテンツを隠さずに情報の提示が可能です。 |

---

## 2. 実装方法の概要

### ① レスポンシブ配置 (Tailwind CSS)
Tailwind CSSのブレークポイント（`md:`）を使用して、一つのコンポーネントで配置を切り替えています。

```tsx
/* LayerMenu.tsx での例 */
className={`
  /* スマホ版（基本設定）: 画面下部に固定 */
  fixed bottom-0 left-0 right-0 z-30 transition-transform duration-300
  
  /* PC版（md以上）: 左側に浮かせて配置 */
  md:absolute md:top-4 md:left-4 md:bottom-4 md:w-80 md:rounded-2xl
`}
```

### ② 開閉のアニメーション (`transform`)
`isOpen` という状態（boolean）に応じて、位置を移動させています。

- **スマホ**: `translate-y` (上下) を使用。閉じた時もハンドル部分（55px）だけ見えるように `calc` を使用。
- **PC**: `translate-x` (左右) を使用。

```tsx
className={`... ${isOpen
    ? 'translate-y-0 md:translate-x-0' // 開いている状態
    : 'translate-y-[calc(100%-55px)] md:-translate-x-[calc(100%+16px)]' // 閉じている状態
}`}
```

### ③ インタラクション (Pointer Events)
モバイルユーザー向けに、指で直接パネルをドラッグして動かせる機能を実装しています。
`onPointerDown`, `onPointerMove`, `onPointerUp` を使用して、現在のドラッグ量を `translateY` に動的に反映させています。

---

## 3. 実用的なコードスニペット

以下は、他のプロジェクトでも再利用しやすいシンプルな構成例です。

```tsx
import { useState } from 'react';

export default function ResponsivePanel() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`
      fixed bottom-0 left-0 right-0 z-50 bg-white shadow-2xl transition-transform duration-300
      md:top-4 md:left-4 md:bottom-4 md:w-80 md:rounded-xl
      ${isOpen ? 'translate-y-0 md:translate-x-0' : 'translate-y-[80%] md:-translate-x-[110%]'}
    `}>
      {/* スマホ用ハンドル / PC用トグルボタン */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-12 flex items-center justify-center md:absolute md:-right-12 md:top-0 md:w-10 md:bg-white md:rounded-r-lg"
      >
        <div className="w-10 h-1 bg-gray-300 rounded-full md:hidden" />
        <span className="hidden md:block">{isOpen ? '←' : '→'}</span>
      </button>

      <div className="p-4 h-full overflow-y-auto">
        <h2 className="text-xl font-bold">メニュー内容</h2>
        <p>ここにコンテンツを配置します。</p>
      </div>
    </div>
  );
}
```

## 4. 参考ファイル
詳細な実装（ドラッグ操作やテーマ切り替えなど）については、以下のファイルを参照してください。
- [src/components/LayerMenu.tsx](src/components/LayerMenu.tsx)
- [src/App.tsx](src/App.tsx)

---

## 4. デザインシステム概要

このアプリケーション全体の統一感を維持するためのデザインルールです。

### ① カラーパレット

| 種類 | ダークモード (Dark) | ライトモード (Light) |
| :--- | :--- | :--- |
| **ベース背景** | `bg-black/60` (不透明度60%) | `bg-white/80` (不透明度80%) |
| **メインテキスト** | `text-white` | `text-gray-900` |
| **サブテキスト** | `text-gray-400` | `text-gray-500` |
| **アクセント** | `text-blue-300`, `text-yellow-300` | `text-blue-500`, `text-orange-500` |
| **枠線 (Border)** | `border-white/10` | `border-black/5` |

- **ユーザー位置**: `#1a73e8` （Google Maps互換の青）

### ② ガラス効果 (Glassmorphism)
すべてのフローティングパネルには共通の背景処理が施されています。
- **効果**: `backdrop-blur-md` (背景ぼかし)
- **影**: `shadow-lg` または `shadow-2xl`
- **角丸**: `rounded-2xl` (1rem / 16px) または `rounded-xl`

### ③ レイヤリング (Z-index)
奥行きの管理は以下の数値で統一されています。
- `z-10`: 凡例パネル (`LegendPanel`)
- `z-30`: メインメニューコンテナ (`LayerMenu`)
- `z-[1100]`: 現在地ボタン (`CurrentLocationButton`) ※メニューより上に表示

---

## 5. 実装方法のカスタマイズ

### テーマ切り替えの実装
各コンポーネントは `theme` プロップを受け取り、Tailwindのクラスを条件分岐させています。

```tsx
const isDark = theme === 'dark';

return (
  <div className={`
    p-4 transition-colors duration-300
    ${isDark ? 'bg-black/60 text-white' : 'bg-white/80 text-gray-900'}
    backdrop-blur-md border
    ${isDark ? 'border-white/10' : 'border-black/5'}
  `}>
    /* コンテンツ */
  </div>
);
```

### 凡例のグラデーション定義
地図上の解析データ（Viewshed）と連動した、一貫性のあるグラデーションを使用しています。

- **東京タワー**: オレンジ (`rgb(255,245,235)` 〜 `rgb(177,58,3)`)
- **スカイツリー**: 赤 (`rgb(255,245,240)` 〜 `rgb(103,0,13)`)
- **ドコモタワー**: 紫 (`rgb(252,251,253)` 〜 `rgb(63,0,125)`)
- **都庁**: 青 (`rgb(247,251,255)` 〜 `rgb(8,48,107)`)

詳細は [src/components/LegendPanel.tsx](src/components/LegendPanel.tsx) を参照してください。
