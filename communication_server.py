"""
communication_server.py — SignConnect Communication Server.

Refactored into a thin orchestrator that wires together:
  - routes/    → HTTP endpoints (Flask Blueprints)
  - sockets/   → Socket.IO event handlers
  - services/  → Inference worker, state management
  - nlp/       → Grammar smoothing, autocomplete

Previous monolith (1370 lines) is now ~200 lines of wiring.
"""
import os
import sys
import logging
import time

# ============================================================
# LOGGING (#15 — structured logging instead of print())
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("signconnect")

# ============================================================
# PROJECT PATH
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ============================================================
# BUNDLED VENDOR RUNTIME
# ============================================================

LOCAL_RUNTIME = os.path.join(BASE_DIR, "vendor")
if os.path.isdir(LOCAL_RUNTIME):
    sys.path.insert(0, LOCAL_RUNTIME)

# ============================================================
# FLASK + SOCKET.IO
# ============================================================

from flask import Flask
from flask_socketio import SocketIO

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "default-sign-language-project-dev-key")
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.jinja_env.auto_reload = True

cors_origins = os.environ.get("CORS_ALLOWED_ORIGINS", "*").split(",") if os.environ.get("CORS_ALLOWED_ORIGINS") else "*"

socketio = SocketIO(
    app,
    cors_allowed_origins=cors_origins,
    async_mode="threading",
    ping_timeout=60,
    ping_interval=25,
    max_http_buffer_size=10 * 1024 * 1024
)

# ============================================================
# REGISTER HTTP ROUTES (#8)
# ============================================================

from routes.http_routes import http_bp
app.register_blueprint(http_bp)

# ============================================================
# AI RECOGNITION SERVICE
# ============================================================

logger.info("Starting recognition service...")

from recognition_service import SignRecognitionService
recognizer = SignRecognitionService()

logger.info("Recognition service ready")

# ============================================================
# STATE MANAGER (#11 — session-token reconnection)
# ============================================================

from services.state_manager import StateManager
state_mgr = StateManager()

# ============================================================
# NLP MODULE (#9 — debounced smoothing)
# ============================================================

from nlp.smoothing import smooth_sentence
from nlp.autocomplete import get_suggestion, get_sentence_suggestions

# Pre-init LanguageTool in background to avoid first-call latency
import threading
threading.Thread(
    target=lambda: smooth_sentence(["test"], use_nlp=True),
    name="NLPWarmup",
    daemon=True
).start()

# ============================================================
# INFERENCE WORKER (#2/#6 — background AI thread)
# ============================================================

from services.inference_worker import InferenceWorker
from sockets.events import (
    process_recognized_sign as events_process_recognized_sign, _build_phrase, _send_phrase_update
)


def _on_inference_result(sid, username, mode, result):
    """
    Callback from the inference worker thread.
    Processes the AI result and emits to the client.
    """
    character = result.get("character", "—")
    confidence = result.get("confidence", 0)
    hand_detected = bool(result.get("hand_detected", False))
    landmarks = result.get("landmarks", None)

    try:
        confidence = int(confidence)
    except (TypeError, ValueError):
        confidence = 0
    confidence = max(0, min(100, confidence))

    state = state_mgr.get_state(sid)

    # Process through state machine
    accepted = events_process_recognized_sign(
        state, character, confidence, hand_detected, mode=mode
    )

    is_gesture = (mode in ("gesture", "special")) and (bool(result.get("is_gesture")) or len(character) > 1)

    # Broadcast animated sticker to room peers and record in chat ONLY when user is in gesture mode
    if accepted and is_gesture and mode in ("gesture", "special") and character != "—":
        from sockets.events import _sid_to_room
        room_id = _sid_to_room.get(sid)
        gesture_key = character.lower().replace("_", " ").strip()
        sticker_payload = {
            "username": username,
            "gesture": gesture_key,
            "message": character
        }
        msg_payload = {
            "sender_id": sid,
            "username": username,
            "message": gesture_key,
            "message_type": "sticker"
        }
        if room_id:
            socketio.emit("sticker_gesture", sticker_payload, to=room_id)
            socketio.emit("receive_message", msg_payload, to=room_id)
        else:
            socketio.emit("sticker_gesture", sticker_payload, to=sid)
            socketio.emit("receive_message", msg_payload, to=sid)

    # Build phrase (rule-based only, no NLP per-frame — #9)
    current_combined = _build_phrase(state)
    full_arr = state["sentence"] + (
        [state["current_word"]] if state["current_word"] else []
    )
    smoothed = smooth_sentence(full_arr, use_nlp=False)
    final = smoothed if smoothed else current_combined

    # Get sentence / follow-up recommendations (both for typing prefix & completed gestures)
    last_token = state["current_word"] if state["current_word"] else (state["sentence"][-1] if state["sentence"] else "")
    suggestions = get_sentence_suggestions(
        state["current_word"],
        last_token=last_token,
        limit=4
    )

    payload = {
        "username": username,
        "mode": mode,
        "character": character,
        "confidence": confidence,
        "message": final,
        "current_phrase": final,
        "current_word": state["current_word"],
        "sentence": [smoothed] if smoothed else state["sentence"],
        "suggestion": state["suggestion"],
        "sentence_suggestions": suggestions,
        "hand_detected": hand_detected,
        "is_gesture": is_gesture,
    }

    # Include landmarks for client-side skeleton overlay (#10)
    if landmarks is not None:
        payload["landmarks"] = landmarks

    socketio.emit("recognition_update", payload, to=sid)


inference_worker = InferenceWorker(
    recognizer=recognizer,
    process_result_callback=_on_inference_result,
    interval=0.05  # ~20 FPS max
)

# ============================================================
# REGISTER SOCKET EVENTS (#8)
# ============================================================

from sockets.events import register_events
register_events(socketio, state_mgr, inference_worker)

# ============================================================
# BACKWARD COMPATIBILITY EXPORTS
# ============================================================
# test_features.py and other scripts import these directly.

client_modes = {}  # Deprecated: now in state_mgr
client_recognition_state = {}  # Deprecated: now in state_mgr


def get_recognition_state(sid):
    """Backward compat wrapper for tests."""
    return state_mgr.get_state(sid)


def reset_recognition_state(sid):
    """Backward compat wrapper for tests."""
    return state_mgr.reset_state(sid)


# Re-export for tests
process_recognized_sign_compat = events_process_recognized_sign


def process_recognized_sign(sid, username, mode, character,
                            confidence, hand_detected):
    """Backward compat wrapper matching old signature."""
    state = state_mgr.get_state(sid)
    from sockets.events import process_recognized_sign as _prs
    return _prs(state, character, confidence, hand_detected, mode=mode)


# ============================================================
# SESSION CLEANUP (periodic)
# ============================================================

def _cleanup_loop():
    """Periodically clean up expired sessions."""
    while True:
        time.sleep(300)  # Every 5 minutes
        state_mgr.cleanup_expired()


threading.Thread(
    target=_cleanup_loop,
    name="SessionCleanup",
    daemon=True
).start()

# ============================================================
# START SERVER
# ============================================================

if __name__ == "__main__":

    port = int(os.environ.get("PORT", "5000"))

    logger.info("")
    logger.info("==============================================")
    logger.info("        SIGN CONNECT AI SERVER")
    logger.info("==============================================")
    logger.info("Server (Test UI): http://127.0.0.1:%d/test-ui", port)
    logger.info("Network (Test UI): http://0.0.0.0:%d/test-ui", port)
    logger.info("AI recognition: READY (background worker)")
    logger.info("WebRTC signaling: READY (room-scoped)")
    logger.info("Socket.IO: READY")
    logger.info("NLP smoothing: DEBOUNCED (space/send only)")
    logger.info("Session tokens: ENABLED")
    logger.info("Health check: /health")
    logger.info("==============================================")
    logger.info("")

    # Start inference worker
    inference_worker.start()

    try:
        socketio.run(
            app,
            host="0.0.0.0",
            port=port,
            debug=False,
            allow_unsafe_werkzeug=True
        )
    finally:
        inference_worker.stop()
        try:
            recognizer.close()
        except Exception:
            pass