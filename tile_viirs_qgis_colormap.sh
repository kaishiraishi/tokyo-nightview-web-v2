#!/usr/bin/env bash
set -euo pipefail

# ---- INPUTS ----
IN_TIF="/Users/kaishiraishi/Desktop/PLATEAU_AWARD/NASA_VIIRS/VNP46A2_A2024366_h31v05_DNB_BRDF_Corrected_NTL_tokyo_clip.tif"
QGIS_CMAP="/Users/kaishiraishi/Desktop/VIIRS_color.txt"

# ---- OUTPUT ----
OUT_DIR="./viirs_heat_tiles"
WORK="${OUT_DIR}/work"
mkdir -p "$WORK" "${OUT_DIR}/tiles"

# ---- PARAMS ----
# VIIRSのFill値候補（あなたの統計に出てるmin）
SRC_NODATA="-999.9000244140625"
DST_NODATA="-9999"

# もとの解像度は約0.0041667°（≒400〜500m級）なので、WebMercatorはこの辺が妥当
TR_M="450"

# だいたいこの解像度なら maxzoom 10 前後で十分
MINZ="4"
MAXZ="10"

# -----------------------------
# Sanity checks
# -----------------------------
if [ ! -f "$IN_TIF" ]; then
  echo "ERROR: input tif not found: $IN_TIF"
  exit 1
fi
if [ ! -f "$QGIS_CMAP" ]; then
  echo "ERROR: QGIS colormap not found: $QGIS_CMAP"
  exit 1
fi

command -v gdalwarp >/dev/null 2>&1 || { echo "ERROR: gdalwarp not found"; exit 1; }
command -v gdaldem >/dev/null 2>&1 || { echo "ERROR: gdaldem not found"; exit 1; }
command -v gdal_translate >/dev/null 2>&1 || { echo "ERROR: gdal_translate not found"; exit 1; }
command -v gdal2tiles.py >/dev/null 2>&1 || { echo "ERROR: gdal2tiles.py not found"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 not found"; exit 1; }

echo "[1/6] Extract band 1 (NTL)..."
gdal_translate -q -b 1 "$IN_TIF" "$WORK/viirs_band1.tif" \
  -a_nodata "${SRC_NODATA}" \
  -co TILED=YES -co COMPRESS=DEFLATE -co BIGTIFF=IF_SAFER

echo "[2/6] Reproject to EPSG:3857 @ ${TR_M}m (with NoData handling)..."
gdalwarp -q \
  "$WORK/viirs_band1.tif" "$WORK/viirs_3857_${TR_M}m.tif" \
  -t_srs EPSG:3857 \
  -tr "${TR_M}" "${TR_M}" -tap \
  -r bilinear \
  -srcnodata "${SRC_NODATA}" -dstnodata "${DST_NODATA}" \
  -multi -wo NUM_THREADS=ALL_CPUS \
  -co TILED=YES -co COMPRESS=DEFLATE -co BIGTIFF=IF_SAFER

echo "[3/6] Convert QGIS colormap -> GDAL ramp (value R G B A)..."
RAMP_TXT="$WORK/viirs_ramp_gdal.txt"

python3 - << 'PY'
import csv, sys, math, pathlib

qgis_path = pathlib.Path(r"/Users/kaishiraishi/Desktop/VIIRS_color.txt")
out_path  = pathlib.Path(r"./viirs_heat_tiles/work/viirs_ramp_gdal.txt")

DST_NODATA = -9999.0
# QGISファイルのFill値（あなたのファイル上の値）
QGIS_FILL  = -999.9000244140625

lines = qgis_path.read_text(encoding="utf-8").splitlines()

rows = []
for ln in lines:
    ln = ln.strip()
    if not ln:
        continue
    if ln.startswith("#"):
        continue
    if ln.startswith("INTERPOLATION:"):
        continue
    # value,r,g,b,a,label
    parts = ln.split(",")
    if len(parts) < 5:
        continue
    try:
        v = float(parts[0])
        r = int(float(parts[1]))
        g = int(float(parts[2]))
        b = int(float(parts[3]))
        a = int(float(parts[4]))
    except Exception:
        continue
    rows.append((v, r, g, b, a))

# valueが重複してる（-999.900...が複数行）ので、valueごとに最初の1つだけ採用
seen = set()
uniq = []
for v,r,g,b,a in rows:
    key = v
    if key in seen:
        continue
    seen.add(key)
    uniq.append((v,r,g,b,a))

# ソート
uniq.sort(key=lambda x: x[0])

# GDAL ramp 出力
out = []
out.append("# value  R  G  B  A")

# ✅ NoData は必ず透明に上書き（重要）
out.append(f"{DST_NODATA:g} 0 0 0 0")

for v,r,g,b,a in uniq:
    # QGISのFill値は NoData として透明化（塗りつぶしを防ぐ）
    if math.isclose(v, QGIS_FILL, rel_tol=0, abs_tol=1e-6) or v <= -999:
        out.append(f"{v:.10g} 0 0 0 0")
    else:
        out.append(f"{v:.10g} {r} {g} {b} {a}")

out_path.write_text("\n".join(out) + "\n", encoding="utf-8")
print("WROTE:", out_path)
PY

echo "[4/6] Colorize (gdaldem color-relief) -> RGBA GeoTIFF..."
# -alpha を付けると、ランプのAが反映される
gdaldem color-relief \
  "$WORK/viirs_3857_${TR_M}m.tif" \
  "$RAMP_TXT" \
  "$WORK/viirs_rgba_tmp.tif" \
  -alpha -of GTiff

# 圧縮タイル化（gdaldemの出力は圧縮オプションが反映されない場合があるため）
gdal_translate -q \
  "$WORK/viirs_rgba_tmp.tif" \
  "$OUT_DIR/viirs_heatmap_rgba_3857_${TR_M}m.tif" \
  -co TILED=YES -co COMPRESS=DEFLATE -co BIGTIFF=IF_SAFER

echo "[5/6] Build XYZ PNG tiles z=${MINZ}-${MAXZ}..."
gdal2tiles.py \
  --xyz -z "${MINZ}-${MAXZ}" \
  --resampling bilinear \
  --webviewer none \
  "$OUT_DIR/viirs_heatmap_rgba_3857_${TR_M}m.tif" \
  "$OUT_DIR/tiles"

echo ""
echo "✅ DONE"
echo "RGBA GeoTIFF: $OUT_DIR/viirs_heatmap_rgba_3857_${TR_M}m.tif"
echo "Tiles:        $OUT_DIR/tiles/{z}/{x}/{y}.png"
echo "Ramp used:    $RAMP_TXT"
