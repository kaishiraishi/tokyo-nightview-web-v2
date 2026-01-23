#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np

try:
    from osgeo import gdal, osr
except Exception as e:
    print("ERROR: osgeo(gdal) が import できません。")
    print("QGIS同梱のPythonで実行してください（例）:")
    print("  /Applications/QGIS.app/Contents/MacOS/bin/python3 make_viirs_rgb_tiles.py ...")
    print(f"detail: {e}")
    sys.exit(1)

gdal.UseExceptions()

TILE_SIZE = 256
MAX_24 = 16777215  # 2^24 - 1


def run(cmd: list[str]):
    print(" ".join(cmd))
    subprocess.run(cmd, check=True)


def which_or_die(name: str):
    p = shutil.which(name)
    if not p:
        print(f"ERROR: '{name}' が見つかりません。GDALがPATHに入っているか確認してください。")
        sys.exit(1)
    return p


def compute_percentile_max(warped_tif: str, band_index: int, percentile: float, sample_width: int) -> float:
    """
    warped_tif を sample_width まで縮小して読み、nodataを除いて percentile を取る
    """
    with tempfile.TemporaryDirectory() as td:
        small_tif = os.path.join(td, "small.tif")

        # 幅 sample_width に縮小（高さは自動）
        run([
            which_or_die("gdal_translate"),
            "-of", "GTiff",
            "-r", "average",
            "-outsize", str(sample_width), "0",
            warped_tif,
            small_tif
        ])

        ds = gdal.Open(small_tif, gdal.GA_ReadOnly)
        b = ds.GetRasterBand(band_index)
        nodata = b.GetNoDataValue()

        arr = b.ReadAsArray().astype(np.float32)
        if nodata is not None and np.isfinite(nodata):
            arr = arr[arr != nodata]
        arr = arr[np.isfinite(arr)]

        if arr.size == 0:
            raise RuntimeError("有効値がありません（nodataだらけ等）。入力を確認してください。")

        p = np.percentile(arr, percentile)
        # 0以下は困るので最低限ガード
        return float(max(p, 1e-6))


def encode_rgb_tiles(warped_tif: str, out_rgb_tif: str, band_index: int, max_value: float):
    ds = gdal.Open(warped_tif, gdal.GA_ReadOnly)
    b = ds.GetRasterBand(band_index)
    nodata = b.GetNoDataValue()

    xsize = ds.RasterXSize
    ysize = ds.RasterYSize

    driver = gdal.GetDriverByName("GTiff")
    out = driver.Create(
        out_rgb_tif, xsize, ysize, 3, gdal.GDT_Byte,
        options=["TILED=YES", "COMPRESS=DEFLATE", "PREDICTOR=2", "BIGTIFF=IF_SAFER"]
    )
    out.SetGeoTransform(ds.GetGeoTransform())
    out.SetProjection(ds.GetProjection())

    # ブロック単位で処理（メモリ節約）
    block_x, block_y = b.GetBlockSize()
    if block_x <= 0 or block_y <= 0:
        block_x, block_y = 512, 512

    inv_max = 1.0 / max_value

    for y in range(0, ysize, block_y):
        h = min(block_y, ysize - y)
        for x in range(0, xsize, block_x):
            w = min(block_x, xsize - x)

            arr = b.ReadAsArray(x, y, w, h).astype(np.float32)

            # nodata -> 0 扱い（光無し）
            if nodata is not None and np.isfinite(nodata):
                arr[arr == nodata] = 0.0
            arr[~np.isfinite(arr)] = 0.0

            # clamp 0..max_value
            arr = np.clip(arr, 0.0, max_value)

            # 0..1
            norm = arr * inv_max

            # 24bit int
            v24 = np.rint(norm * MAX_24).astype(np.uint32)

            r = (v24 >> 16).astype(np.uint8)
            g = ((v24 >> 8) & 255).astype(np.uint8)
            bb = (v24 & 255).astype(np.uint8)

            out.GetRasterBand(1).WriteArray(r, xoff=x, yoff=y)
            out.GetRasterBand(2).WriteArray(g, xoff=x, yoff=y)
            out.GetRasterBand(3).WriteArray(bb, xoff=x, yoff=y)

    out.FlushCache()
    out = None
    ds = None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_tif", help="VIIRS clip済み GeoTIFF")
    parser.add_argument("--out", default="./viirs_value_rgb", help="出力ディレクトリ")
    parser.add_argument("--band", type=int, default=1, help="使用するバンド(1始まり)")
    parser.add_argument("--zmin", type=int, default=10, help="タイル最小ズーム")
    parser.add_argument("--zmax", type=int, default=14, help="タイル最大ズーム")
    parser.add_argument("--percentile", type=float, default=99.5, help="MAX推定に使うパーセンタイル")
    parser.add_argument("--sample-width", type=int, default=2048, help="MAX推定用の縮小幅(px)")
    parser.add_argument("--max", type=float, default=None, help="MAXを手動指定（指定するとpercentileは無視）")
    parser.add_argument("--resampling-warp", default="bilinear", choices=["near", "bilinear", "cubic"], help="3857へのワープ時のリサンプル")
    parser.add_argument("--skip-warp", action="store_true", help="入力が既に3857の場合、再投影をスキップ")
    args = parser.parse_args()

    input_tif = os.path.abspath(args.input_tif)
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)

    gdalwarp = which_or_die("gdalwarp")
    gdal2tiles = which_or_die("gdal2tiles.py") or which_or_die("gdal2tiles")
    which_or_die("gdal_translate")

    warped_tif = os.path.join(out_dir, "viirs_3857.tif")
    rgb_tif = os.path.join(out_dir, "viirs_3857_rgb.tif")
    tiles_dir = os.path.join(out_dir, "tiles")

    # 1) EPSG:3857 にワープ（不要ならスキップ）
    if args.skip_warp:
        warped_tif = input_tif
    else:
        run([
            gdalwarp,
            "-t_srs", "EPSG:3857",
            "-r", args.resampling_warp,
            "-dstnodata", "0",
            "-multi",
            "-wo", "NUM_THREADS=ALL_CPUS",
            "-co", "TILED=YES",
            "-co", "COMPRESS=DEFLATE",
            "-co", "PREDICTOR=2",
            input_tif,
            warped_tif
        ])

    # 2) MAX決定（手動 or 99.5%tile）
    if args.max is not None:
        max_val = float(args.max)
    else:
        max_val = compute_percentile_max(warped_tif, args.band, args.percentile, args.sample_width)

    print(f"[MAX] using max_value = {max_val:.6f} (percentile={args.percentile} if auto)")

    # 3) 24bit RGBにエンコード（Byte 3band GeoTIFF）
    encode_rgb_tiles(warped_tif, rgb_tif, args.band, max_val)

    # 4) XYZタイル化（値保持のため resampling=near 推奨）
    if os.path.exists(tiles_dir):
        shutil.rmtree(tiles_dir)

    run([
        gdal2tiles,
        "--xyz",
        "-z", f"{args.zmin}-{args.zmax}",
        "-w", "none",
        "-r", "near",
        rgb_tif,
        tiles_dir
    ])

    print("\nDONE")
    print(f"- RGB GeoTIFF: {rgb_tif}")
    print(f"- Tiles:       {tiles_dir}/{{z}}/{{x}}/{{y}}.png")
    print("\nWeb側のデコード式（pixel r,g,b → norm）:")
    print("  val24 = r*65536 + g*256 + b")
    print("  norm  = val24 / 16777215")


if __name__ == "__main__":
    main()
