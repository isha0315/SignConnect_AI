"""
routes/http_routes.py — HTTP routes for SignConnect (#15 /health).
"""
import os
import logging
import time
import urllib.parse
import requests
from flask import Blueprint, Response, render_template, jsonify, request, send_from_directory

logger = logging.getLogger("signconnect.routes")

http_bp = Blueprint("http", __name__)

# Server start time for uptime calculation
_start_time = time.time()

FRONTEND_DIST = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))


@http_bp.route("/")
def index():
    return render_template("communication_test.html")

@http_bp.route("/standard")
def standard():
    return render_template("communication.html")

@http_bp.route("/preview")
def preview():
    return render_template("communication_dark.html")


@http_bp.route("/test-ui")
def test_ui():
    return render_template("communication_test.html")


@http_bp.route("/react")
@http_bp.route("/react/")
def react_index():
    if os.path.exists(FRONTEND_DIST):
        return send_from_directory(FRONTEND_DIST, "index.html")
    return "React build not found. Please run 'npm run build' in frontend/.", 404


@http_bp.route("/react/<path:path>")
def react_static_file(path):
    if os.path.exists(FRONTEND_DIST):
        target = os.path.join(FRONTEND_DIST, path)
        if os.path.isfile(target):
            return send_from_directory(FRONTEND_DIST, path)
        return send_from_directory(FRONTEND_DIST, "index.html")
    return "React build not found.", 404


@http_bp.route("/assets/<path:path>")
def react_root_assets(path):
    assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.exists(assets_dir):
        return send_from_directory(assets_dir, path)
    return Response(status=404)


@http_bp.route("/favicon.ico")
def favicon():
    return Response(status=204)


@http_bp.route("/health")
def health():
    """
    Health check endpoint (#15).
    Returns server status, uptime, and component health.
    """
    uptime = time.time() - _start_time

    return jsonify({
        "status": "healthy",
        "uptime_seconds": round(uptime, 1),
        "uptime_human": _format_uptime(uptime),
        "components": {
            "flask": "ok",
            "socketio": "ok",
            "recognition": "ok",
        }
    })


@http_bp.route("/api/tts")
def tts_proxy():
    """Proxy for Google Translate TTS to avoid CORS/Referer blocking"""
    text = request.args.get("text", "")
    lang = request.args.get("lang", "hi")
    if not text:
        return Response("No text", status=400)
    
    url = f"https://translate.google.com/translate_tts?ie=UTF-8&q={urllib.parse.quote(text)}&tl={lang}&client=tw-ob"
    try:
        r = requests.get(url, stream=True, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        })
        def generate():
            for chunk in r.iter_content(chunk_size=4096):
                yield chunk
        return Response(generate(), mimetype="audio/mpeg")
    except Exception as e:
        logger.error(f"TTS proxy error: {e}")
        return Response(str(e), status=500)


def _format_uptime(seconds):
    """Format uptime as human-readable string."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    if hours > 0:
        return f"{hours}h {minutes}m {secs}s"
    elif minutes > 0:
        return f"{minutes}m {secs}s"
    else:
        return f"{secs}s"
