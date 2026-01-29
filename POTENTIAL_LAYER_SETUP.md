# 夜景ポテンシャルレイヤーの実装手順

本ドキュメントでは、夜景ポテンシャルレイヤーの地図表示およびUI操作の実装手順を記録します。

## 1. タイルデータの再生成
既存のタイルデータに座標の不一致（Null Island付近に表示される）およびデータ形式（TMS/XYZ）の混同があったため、ソースのGeoTIFFから再生成しました。

### 使用データ
- **ソースファイル**: `/Users/kaishiraishi/Desktop/PLATEAU_AWARD/plateau_tokyo_DSM_v2/temp/tokyo_potential_FINAL.tif`
- **座標系**: EPSG:6677 (平面直角座標系第IX系)

### 実行スクリプト
`scripts/make-potential-tiles.sh` を作成し、以下の工程を自動化しました。
1. **投影変換**: `gdalwarp` を使用し、Webメルカトル (EPSG:3857) へ変換。
2. **着色**: `gdaldem color-relief` を使用し、ポテンシャル値 (0.0 - 0.4) をカラーランプ（青→緑→黄→赤）にマッピング。
3. **タイル化**: `gdal2tiles.py --xyz` を使用し、標準的な XYZ 形式の PNG タイルを生成 (ズームレベル 10-14)。

## 2. 地図エンジン (MapLibre GL JS) への追加
[src/hooks/useMapLibre.ts](src/hooks/useMapLibre.ts) に以下の実装を追加しました。

- `POTENTIAL_SOURCE_ID` および `POTENTIAL_LAYER_ID` の定義。
- `addPotentialLayer` 関数の実装（ラスタソースとして `public/NightViewPotential_tiles/{z}/{x}/{y}.png` を追加）。
- デフォルトでは `visibility: 'none'` とし、後述のUIから制御可能に設定。

## 3. UI表示および制御の実装
### 状態管理
[src/components/map/MapViewExplore.tsx](src/components/map/MapViewExplore.tsx) に `potentialEnabled` ステートを追加し、地図レイヤーの `visibility` プロパティと連動させました。

### レイヤー設定メニュー
[src/components/layout/LayerSettings.tsx](src/components/layout/LayerSettings.tsx) にトグルスイッチを追加しました。
- 緑色のインジケーターを採用し、直感的にポテンシャル表示を識別可能にしました。
- `ScanControlPanel` および `PostListPanel` からこの設定を制御できるようにプロパティを拡張しました。

## 4. 動作確認済み事項
- 東京エリアにおいて、ポテンシャルレイヤーが正しい位置（都心部）に表示されること。
- ズームレベル 10 〜 14 でタイルの欠損なく表示されること。
- UIのトグルスイッチ（ON/OFF）が正しく地図表示に反映されること。
- 他のレイヤー（航空写真・VIIRS夜間光）との排他制御および重ね合わせが正常であること。
