#!/usr/bin/env python3
"""
DSM API Server - TerrainRGB Backend
- Uses local TerrainRGB tiles (XYZ) instead of a single GeoTIFF
- Zoom level fixed at 14 for max precision
"""
from typing import List, Optional, Tuple
import math
import os
from functools import lru_cache

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from PIL import Image
import mercantile
import numpy as np
from pyproj import Geod

# Configuration
TILE_DIR_REL = "../../tile_DSM/terrainrgb_out/tiles"
# Resolve absolute path to avoid CWD issues
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TILE_DIR = os.environ.get("TILE_DIR") or os.path.normpath(os.path.join(BASE_DIR, TILE_DIR_REL))

ZOOM_LEVEL = 14

app = FastAPI(title="DSM Profile API (TerrainRGB)", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://kaishiraishi.github.io",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global Geod for distance calculations
GEOD = Geod(ellps="WGS84")

class ProfileRequest(BaseModel):
    start: List[float] = Field(..., description="[lng, lat] WGS84")
    end: List[float] = Field(..., description="[lng, lat] WGS84")
    sample_count: int = Field(120, ge=2, le=2000)

class ProfileResponse(BaseModel):
    distances_m: List[float]
    elev_m: List[Optional[float]]
    lngs: List[float]
    lats: List[float]

@lru_cache(maxsize=128)
def load_tile_image(z: int, x: int, y: int) -> Optional[Image.Image]:
    """
    Load a tile image with LRU caching.
    Returns None if tile does not exist.
    """
    path = os.path.join(TILE_DIR, str(z), str(x), f"{y}.png")
    if not os.path.exists(path):
        return None
    try:
        return Image.open(path).convert('RGB')
    except Exception as e:
        print(f"[DSM] Error opening tile {z}/{x}/{y}: {e}")
        return None

def get_elevation_at_point(lng: float, lat: float) -> Optional[float]:
    """
    Get elevation in meters for a given lng/lat using TerrainRGB tiles.
    Returns None if tile is missing or out of bounds.
    """
    # 1. Get tile coordinates
    tile = mercantile.tile(lng, lat, ZOOM_LEVEL)
    
    # 2. Load image (cached)
    img = load_tile_image(tile.z, tile.x, tile.y)
    if img is None:
        return None
    
    # 3. Calculate pixel position within the tile
    # mercantile.bounds returns (west, south, east, north)
    bounds = mercantile.bounds(tile)
    
    # Width/Height of the tile (usually 256 or 512, TerrainRGB output often 256 or 512)
    # We assume 256 or 512, checking image size is safer
    width, height = img.size
    
    # Normalized coordinates (0.0 to 1.0) within the tile
    # valid longitude: bounds.west to bounds.east
    # valid latitude: bounds.south to bounds.north (Note: Web Mercator Y grows Southwards in pixel coords, but lat grows Northwards)
    
    # X: linear from west to east
    x_frac = (lng - bounds.west) / (bounds.east - bounds.west)
    
    # Y: Mercator projection is non-linear for lat, but mercantile handles logic if we used pixels directly.
    # However, since we have the bounds of this specific tile in lat/lng, and the tile is small (Zoom 14),
    # treating it as linear within the tile for pixel picking is usually an acceptable approximation,
    # BUT `mercantile` provides exact logic. 
    # Better approach: Get exact pixel coordinates for the global map, then mod by tile size.
    
    # Global pixel coordinates
    # mercantile.xy returns meters. We need pixels.
    # mercantile doesn't have a direct 'latlon_to_pixel_in_tile' but has logic for it.
    
    # Let's use simple interpolation based on bounds for now, as standard Web Mercator logic:
    # bounds.north is y=0 (top), bounds.south is y=height (bottom)
    # BE CAREFUL: standard tile origin is Top-Left.
    # Web Mercator Y decreases as Latitude increases.
    
    # Using mercantile to get fractional tile coordinates for precision
    # tile_exact = mercantile.tile(lng, lat, ZOOM_LEVEL) -> returns integer tile. 
    # We need fractional.
    
    # Manual calculation for fractional pixel:
    # Project to Web Mercator Meters
    mx, my = mercantile.xy(lng, lat)
    
    # Get meters range for the tile
    # bounds (west, south, east, north) in LatLng -> convert to XY
    min_mx, min_my = mercantile.xy(bounds.west, bounds.south)
    max_mx, max_my = mercantile.xy(bounds.east, bounds.north)
    
    # Percentages
    # X grows Right: (mx - min_mx) / (max_mx - min_mx)
    px_frac = (mx - min_mx) / (max_mx - min_mx)
    
    # Y grows Down (Top-Left origin): 
    # Top is max_my (North), Bottom is min_my (South)
    # pixel_y_frac = (max_my - my) / (max_my - min_my)
    py_frac = (max_my - my) / (max_my - min_my)
    
    px = int(px_frac * width)
    py = int(py_frac * height)
    
    # Clamp to valid range (just in case of precision issues on edges)
    px = max(0, min(width - 1, px))
    py = max(0, min(height - 1, py))
    
    try:
        r, g, b = img.getpixel((px, py))
        # Mapbox Terrain-RGB formula: -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
        elevation = -10000 + ((r * 256 * 256 + g * 256 + b) * 0.1)
        return elevation
    except Exception:
        return None

@app.on_event("startup")
def startup():
    if not os.path.exists(TILE_DIR):
        print(f"[DSM] WARNING: Tile directory not found at {TILE_DIR}")
    else:
        print(f"[DSM] Tile directory: {TILE_DIR}")
        print(f"[DSM] Zoom Level: {ZOOM_LEVEL}")

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "backend": "terrain-rgb-tiles",
        "tile_dir": TILE_DIR,
        "tile_dir_exists": os.path.exists(TILE_DIR),
        "zoom": ZOOM_LEVEL
    }

@app.post("/profile", response_model=ProfileResponse)
def get_profile(req: ProfileRequest):
    if not os.path.exists(TILE_DIR):
        raise HTTPException(
            status_code=500, 
            detail=f"DSM Tile directory not found: {TILE_DIR}"
        )
    
    if len(req.start) != 2 or len(req.end) != 2:
        raise HTTPException(status_code=400, detail="start/end must be [lng, lat]")

    lon1, lat1 = req.start
    lon2, lat2 = req.end
    n = req.sample_count

    # 1. Calculate Geodesic Distance
    az12, _, total_dist = GEOD.inv(lon1, lat1, lon2, lat2)
    
    if not math.isfinite(total_dist) or total_dist <= 0:
        return ProfileResponse(distances_m=[0.0], elev_m=[None], lngs=[lon1], lats=[lat1])

    # 2. Generate Points
    if n == 2:
        points_wgs = [(lon1, lat1), (lon2, lat2)]
    else:
        mids = GEOD.npts(lon1, lat1, lon2, lat2, n - 2)
        points_wgs = [(lon1, lat1), *mids, (lon2, lat2)]

    # 3. Calculate Elevations
    elev_m: List[Optional[float]] = []
    
    # Optimization: processing points
    # Since we have LRU cache, simple sequential access is efficient enough for ~120 points.
    for (lon, lat) in points_wgs:
        elev = get_elevation_at_point(lon, lat)
        elev_m.append(elev)

    # 4. Generate Distances
    distances_m = [float(total_dist * i / (n - 1)) for i in range(n)]

    return ProfileResponse(
        distances_m=distances_m,
        elev_m=elev_m,
        lngs=[lon for lon, lat in points_wgs],
        lats=[lat for lon, lat in points_wgs],
    )
