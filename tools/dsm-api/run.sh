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
export $(cat .env | grep -v '^#' | xargs)
uvicorn server:app --reload --port "${PORT:-8787}"
