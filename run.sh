#!/bin/bash
# run.sh - Local Launch Script

set -e

# 1. Setup Environment
export PATH=$PWD/bin:$PATH
export PATH=$HOME/.local/bin:$PATH

echo "========================================"
echo "    Qucs-Web Local Launcher"
echo "========================================"

# 2. Check Dependencies
if ! python3 -c "import fastapi" &> /dev/null; then
    echo ">> Installing Python dependencies..."
    python3 -m pip install --user fastapi uvicorn python-multipart jinja2
else
    echo ">> Python dependencies OK."
fi

# 3. Check Qucsator
if which qucsator > /dev/null; then
    echo ">> Simulator Engine: $(which qucsator)"
else
    echo ">> Simulator Engine: INTERNAL FALLBACK (tiny_qucsator)"
    # We already added $PWD/bin to PATH, so 'qucsator' command will use our wrapper
fi

# 4. Start Server
echo ">> Starting Server at http://localhost:8000"
echo "   (Press Ctrl+C to stop)"
echo ""
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
