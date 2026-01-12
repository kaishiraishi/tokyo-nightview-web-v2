#!/usr/bin/env python3
"""
DSM API Server - Step 1 (FAST)
- Open DSM once (startup)
- Batch sample elevations via dataset.sample (NO dataset.read(1) per point)
"""
from typing import List, Optional, Tuple
import math

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import rasterio
from pyproj import Transformer, Geod

DSM_PATH = "/Users/kaishiraishi/Desktop/PLATEAU_AWARD/Plateau_tokyo_DSM/dsm_out/DSM_tokyo.tif"

app = FastAPI(title="DSM Profile API", version="1.0.0")

# ※ local dev向け。credentials使うなら "*" は避ける
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Global singletons (opened once) ----
DS = None
TRANSFORMER = None
GEOD = Geod(ellps="WGS84")
BOUNDS = None
NODATA = None


class ProfileRequest(BaseModel):
    start: List[float] = Field(..., description="[lng, lat] WGS84")
    end: List[float] = Field(..., description="[lng, lat] WGS84")
    sample_count: int = Field(120, ge=2, le=2000)


class ProfileResponse(BaseModel):
    distances_m: List[float]
    elev_m: List[Optional[float]]


@app.on_event("startup")
def startup():
    global DS, TRANSFORMER, BOUNDS, NODATA
    DS = rasterio.open(DSM_PATH)  # <- open once
    if DS.crs is None:
        raise RuntimeError("DSM GeoTIFF has no CRS metadata.")
    TRANSFORMER = None
    try:
        TRANSFORMER = Transformer.from_crs("EPSG:4326", DS.crs, always_xy=True)
    except Exception as e:
        print(f"[DSM] Warning: Failed to create transformer from DS.crs ({e}). Trying EPSG:6677 fallback.")
        try:
            TRANSFORMER = Transformer.from_crs("EPSG:4326", "EPSG:6677", always_xy=True)
        except Exception as e2:
            raise RuntimeError(f"Failed to create transformer even with fallback EPSG:6677: {e2}")

    BOUNDS = DS.bounds
    NODATA = DS.nodata
    print(f"[DSM] opened: {DSM_PATH}")
    print(f"[DSM] CRS: {DS.crs}, size={DS.width}x{DS.height}, nodata={NODATA}")


@app.on_event("shutdown")
def shutdown():
    global DS
    if DS is not None:
        DS.close()
        DS = None
        print("[DSM] closed")


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "dsm_path": DSM_PATH,
        "crs": str(DS.crs) if DS else None,
        "nodata": NODATA,
    }


def _in_bounds(x: float, y: float) -> bool:
    return (BOUNDS.left <= x <= BOUNDS.right) and (BOUNDS.bottom <= y <= BOUNDS.top)


@app.post("/profile", response_model=ProfileResponse)
def get_profile(req: ProfileRequest):
    # FastAPIは sync def を threadpool で走らせるので rasterio と相性が良い
    if len(req.start) != 2 or len(req.end) != 2:
        raise HTTPException(status_code=400, detail="start/end must be [lng, lat]")

    lon1, lat1 = req.start
    lon2, lat2 = req.end
    n = req.sample_count

    # 距離（測地線）
    az12, _, total_dist = GEOD.inv(lon1, lat1, lon2, lat2)
    if not math.isfinite(total_dist) or total_dist <= 0:
        return ProfileResponse(distances_m=[0.0], elev_m=[None])

    # サンプル点（測地線上）: start + (n-2)点 + end
    if n == 2:
        points_wgs = [(lon1, lat1), (lon2, lat2)]
    else:
        mids = GEOD.npts(lon1, lat1, lon2, lat2, n - 2)  # [(lon,lat),...]
        points_wgs = [(lon1, lat1), *mids, (lon2, lat2)]

    # 距離配列（等間隔でOK。厳密にやるなら逐次距離でも可）
    distances_m = [float(total_dist * i / (n - 1)) for i in range(n)]

    # WGS84 -> DSM CRS (EPSG:6677)
    xy = [TRANSFORMER.transform(lon, lat) for lon, lat in points_wgs]

    # bounds外を弾く（外は None）
    elev_m: List[Optional[float]] = [None] * n
    valid_idx = [i for i, (x, y) in enumerate(xy) if _in_bounds(x, y)]
    valid_xy = [xy[i] for i in valid_idx]

    if valid_xy:
        # ★ここが最重要：dataset.sample でバッチ取得（dataset.read(1)は禁止）
        for out_i, v in zip(valid_idx, DS.sample(valid_xy, indexes=1)):
            val = float(v[0])
            if (NODATA is not None and val == float(NODATA)) or math.isnan(val):
                elev_m[out_i] = None
            else:
                elev_m[out_i] = val

    return ProfileResponse(distances_m=distances_m, elev_m=elev_m)
