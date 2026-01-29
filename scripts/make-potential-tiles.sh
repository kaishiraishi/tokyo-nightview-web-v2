#!/usr/bin/env bash
set -euo pipefail

# ---- INPUTS ----
IN_TIF="/Users/kaishiraishi/Desktop/PLATEAU_AWARD/plateau_tokyo_DSM_v2/temp/tokyo_potential_FINAL.tif"

# ---- OUTPUT ----
OUT_DIR="./public/NightViewPotential_tiles"
WORK="./public/NightViewPotential_tiles/work"
mkdir -p "$WORK"

# ---- PARAMS ----
MINZ="10"
MAXZ="14"

# -----------------------------
# 1. Reproject to EPSG:3857
# -----------------------------
echo "[1/4] Reprojecting to EPSG:3857..."
gdalwarp -t_srs EPSG:3857 \
  -r bilinear \
  -dstnodata -9999 \
  -co COMPRESS=DEFLATE \
  "$IN_TIF" "$WORK/potential_3857.tif" -overwrite

# -----------------------------
# 2. Create Color Ramp (0.0 - 0.4)
# -----------------------------
echo "[2/4] Creating color ramp..."
RAMP="$WORK/ramp.txt"
cat << EOF > "$RAMP"
-9999 0 0 0 0
0.0   0 0 0 0
0.01  0 50 150 100
0.1   0 200 100 150
0.2   100 255 100 200
0.3   255 255 0 220
0.4   255 0 0 250
EOF

# -----------------------------
# 3. Colorize
# -----------------------------
echo "[3/4] Colorizing..."
gdaldem color-relief -alpha \
  "$WORK/potential_3857.tif" \
  "$RAMP" \
  "$WORK/potential_rgba.tif" -of GTiff -co COMPRESS=DEFLATE

# -----------------------------
# 4. Generate XYZ Tiles
# -----------------------------
echo "[4/4] Generating XYZ tiles..."
# Remove old tiles (only zoom dirs) to avoid confusion
rm -rf "$OUT_DIR/10" "$OUT_DIR/11" "$OUT_DIR/12" "$OUT_DIR/13" "$OUT_DIR/14" "$OUT_DIR/15" "$OUT_DIR/16"

gdal2tiles.py --xyz -z "${MINZ}-${MAXZ}" \
  --resampling bilinear \
  --webviewer none \
  "$WORK/potential_rgba.tif" \
  "$OUT_DIR"

echo "✅ DONE: Tiles generated in $OUT_DIR"
