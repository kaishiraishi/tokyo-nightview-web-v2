#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

# Activate virtual environment
source .venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -q -r requirements.txt

# Load environment variables and start server
echo "Starting DSM API server..."
if [ -f ".env" ]; then
    set -a
    source ".env"
    set +a
fi

# Prefer env var overrides; default to 8000 to match frontend dev config
uvicorn server:app --reload --port "${PORT:-8000}"
