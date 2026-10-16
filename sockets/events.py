"""
sockets/events.py — All Socket.IO event handlers (#7, #8, #10, #11).

This module registers all socket event handlers on the given
SocketIO instance. It depends on the StateManager, InferenceWorker,
and NLP modules.
"""
import logging
import base64
import time

import cv2
import numpy as np
from flask import request
from flask_socketio import emit, join_room, leave_room

from nlp.autocomplete import get_suggestion, get_sentence_suggestions
from nlp.smoothing import smooth_sentence, expand_word_gesture

import threading

logger = logging.getLogger("signconnect.sockets")


# ============================================================
# RECOGNITION SETTINGS
# ============================================================

HISTORY_LENGTH = 7
STABLE_FRAMES_REQUIRED = 4
MIN_SIGN_CONFIDENCE = 60
SIGN_COOLDOWN = 0.8

SPECIAL_GESTURE_WORDS = {
    "I LOVE YOU", "STOP", "YES", "NO", "WATER", "GOOD MORNING",
    "NICE TO MEET YOU", "HELLO", "GOODBYE", "THANK YOU", "PLEASE",
    "HELP", "SORRY", "WELCOME", "HOW ARE YOU"
}


# ============================================================
# ROOM MANAGEMENT (#7)
# ============================================================

# { room_id: set(sid, ...) }
_rooms = {}
# { sid: room_id }
_sid_to_room = {}
# { sid: threading.Timer } for disconnect grace period
_disconnect_timers = {}


def register_events(socketio, state_mgr, inference_worker):
    """
    Register all Socket.IO event handlers.

    Args:
        socketio: Flask-SocketIO instance
        state_mgr: StateManager instance
        inference_worker: InferenceWorker instance
    """

    # ========================================================
    # CONNECTION (#11 session restore)
    # ========================================================

    @socketio.on("connect")
    def handle_connect():
        sid = request.sid
        # Check for session token in query params for reconnection
        session_token = request.args.get("session_token", None)

        state, token, restored, mode = state_mgr.connect(sid, session_token)

        logger.info(
            "User connected: %s (restored=%s)", sid, restored
        )

        # Send session token to client for reconnection
        emit("session_init", {
            "session_token": token,
            "restored": restored,
            "mode": mode,
            "current_word": state["current_word"],
            "sentence": state["sentence"],
            "suggestion": state["suggestion"],
        })

        emit(
            "system_message",
            "Connected to the SignConnect communication server."
        )

    # ========================================================
    # DISCONNECT
    # ========================================================

    @socketio.on("disconnect")
    def handle_disconnect():
        sid = request.sid

        # Check if client was in a room
        room_id = _sid_to_room.pop(sid, None)

        def _delayed_peer_left(leaving_sid, target_room):
            _disconnect_timers.pop(leaving_sid, None)
            if target_room and target_room in _rooms:
                _rooms[target_room].discard(leaving_sid)
                peer_cnt = len(_rooms[target_room])
                if not peer_cnt:
                    _rooms.pop(target_room, None)
                else:
                    logger.info("Grace period expired: emitting peer_left for %s in room %s (peers left: %d)",
                                leaving_sid, target_room, peer_cnt)
                    socketio.emit("peer_left", {
                        "sender": leaving_sid,
                        "peer_count": peer_cnt
                    }, room=target_room)

        if room_id and room_id in _rooms:
            # Grant a 6-second grace period for mobile reconnection / network handoff
            t = threading.Timer(6.0, _delayed_peer_left, args=[sid, room_id])
            t.daemon = True
            _disconnect_timers[sid] = t
            t.start()
            logger.info("User %s disconnected from room %s (6s grace period armed)", sid, room_id)
        else:
            logger.info("User %s disconnected", sid)

        # Preserve state for reconnection (not deleted)
        state_mgr.disconnect(sid)
        inference_worker.remove_client(sid)

    # ========================================================
    # JOIN ROOM (#7 room-based WebRTC)
    # ========================================================

    @socketio.on("join_room")
    def handle_join_room(data):
        if not isinstance(data, dict):
            return

        sid = request.sid
        room_id = str(data.get("room_id", "default")).strip()
        username = str(data.get("username", "User")).strip() or "User"

        # Cancel any pending disconnect timer for this sid
        old_timer = _disconnect_timers.pop(sid, None)
        if old_timer:
            try:
                old_timer.cancel()
            except Exception:
                pass

        # Leave old room if in one
        old_room = _sid_to_room.get(sid)
        if old_room:
            leave_room(old_room)
            if old_room in _rooms:
                _rooms[old_room].discard(sid)

        # Join new room
        join_room(room_id)
        _sid_to_room[sid] = room_id
        if room_id not in _rooms:
            _rooms[room_id] = set()
        other_peers = [s for s in _rooms[room_id] if s != sid]
        _rooms[room_id].add(sid)
        peer_count = len(_rooms[room_id])

        logger.info("%s (%s) joined room %s (total peers: %d)", username, sid, room_id, peer_count)

        emit("room_joined", {
            "room_id": room_id,
            "username": username,
            "sender": sid,
            "peer_count": peer_count
        }, room=room_id)

        emit("room_status", {
            "room_id": room_id,
            "peer_count": peer_count,
            "has_remote": len(other_peers) > 0
        })

    # ========================================================
    # LEAVE ROOM
    # ========================================================

    @socketio.on("leave_room")
    def handle_leave_room(data):
        sid = request.sid
        old_timer = _disconnect_timers.pop(sid, None)
        if old_timer:
            try:
                old_timer.cancel()
            except Exception:
                pass
        room_id = _sid_to_room.pop(sid, None)
        if room_id:
            leave_room(room_id)
            if room_id in _rooms:
                _rooms[room_id].discard(sid)
                emit("room_left", {
                    "sid": sid,
                    "room_id": room_id
                }, room=room_id)
                emit("peer_left", {
                    "sender": sid,
                    "peer_count": len(_rooms[room_id])
                }, room=room_id)

    # ========================================================
    # CHAT / SIGN MESSAGE
    # ========================================================

    @socketio.on("send_message")
    def handle_message(data):
        if not isinstance(data, dict):
            return

        message = str(data.get("message", "")).strip()
        if not message:
            return

        username = str(data.get("username", "User")).strip() or "User"
        message_type = data.get("message_type", "typed")

        payload = {
            "sender_id": request.sid,
            "username": username,
            "message": message,
            "message_type": message_type
        }

        logger.info("[MESSAGE] %s: %s (type: %s)", username, message, message_type)

        # Route to room if in one, otherwise broadcast (#7)
        room_id = _sid_to_room.get(request.sid)
        if room_id:
            emit("receive_message", payload, room=room_id)
        else:
            emit("receive_message", payload, broadcast=True)

        # If it's a sticker message, ONLY trigger animated sticker popup if sender is in Special Gestures mode!
        if message_type == "sticker":
            sender_mode = state_mgr.get_mode(request.sid)
            if sender_mode in ("gesture", "special"):
                gesture_key = message.lower().replace("_", " ").strip()
                sticker_payload = {
                    "username": username,
                    "gesture": gesture_key,
                    "message": message,
                    "mode": "gesture"
                }
                if room_id:
                    emit("sticker_gesture", sticker_payload, room=room_id, include_self=True)
                else:
                    emit("sticker_gesture", sticker_payload, broadcast=True, include_self=True)
            else:
                logger.info("[STICKER BLOCKED] Sender %s is in mode '%s', not gesture mode", username, sender_mode)

    # ========================================================
    # DIRECT STICKER SEND (#12)
    # ========================================================

    @socketio.on("send_sticker")
    def handle_send_sticker(data):
        if not isinstance(data, dict):
            return
        sender_mode = state_mgr.get_mode(request.sid)
        username = str(data.get("username", "User")).strip() or "User"
        if sender_mode not in ("gesture", "special"):
            logger.info("[STICKER SEND BLOCKED] %s attempted sticker send in mode '%s'", username, sender_mode)
            return

        gesture = str(data.get("gesture", "")).strip().lower().replace("_", " ")
        if not gesture:
            return
        sticker_payload = {
            "username": username,
            "gesture": gesture,
            "message": gesture.title(),
            "mode": "gesture"
        }
        msg_payload = {
            "sender_id": request.sid,
            "username": username,
            "message": gesture,
            "message_type": "sticker"
        }
        logger.info("[STICKER SEND] %s: %s", username, gesture)
        room_id = _sid_to_room.get(request.sid)
        if room_id:
            emit("sticker_gesture", sticker_payload, room=room_id, include_self=True)
            emit("receive_message", msg_payload, room=room_id)
        else:
            emit("sticker_gesture", sticker_payload, broadcast=True, include_self=True)
            emit("receive_message", msg_payload, broadcast=True)

    # ========================================================
    # RECOGNITION CONTROL
    # ========================================================

    @socketio.on("recognition_control")
    def handle_recognition_control(data):
        if not isinstance(data, dict):
            return

        sid = request.sid
        command = data.get("command") or data.get("action")
        if command is None:
            return

        command = str(command).strip().lower()
        username = str(data.get("username", "User")).strip() or "User"

        state = state_mgr.get_state(sid)

        # ---- MODE SELECTION ----
        if command in ("alphabet", "a", "a-z", "letters"):
            state_mgr.set_mode(sid, "alphabet")
            state["candidate"] = ""
            state["last_accepted"] = ""
            state["hand_was_lost"] = True
            logger.info("[AI CONTROL] %s -> alphabet", username)

        elif command in ("number", "numbers", "n", "1-9"):
            state_mgr.set_mode(sid, "number")
            state["candidate"] = ""
            state["last_accepted"] = ""
            state["hand_was_lost"] = True
            logger.info("[AI CONTROL] %s -> number", username)

        elif command in ("gesture", "gestures", "g", "special"):
            state_mgr.set_mode(sid, "gesture")
            state["candidate"] = ""
            state["last_accepted"] = ""
            state["hand_was_lost"] = True
            logger.info("[AI CONTROL] %s -> gesture", username)

        # ---- SPACE / ACCEPT SUGGESTION (#9 debounce: use_nlp=True) ----
        elif command == "space":
            if state["current_word"]:
                # Check for word-level gesture expansion (#12)
                expanded = expand_word_gesture(state["current_word"])
                if expanded:
                    for word in expanded.split():
                        state["sentence"].append(word)
                elif state["suggestion"]:
                    full_word = state["current_word"] + state["suggestion"]
                    state["sentence"].append(full_word)
                else:
                    state["sentence"].append(state["current_word"])

                state["current_word"] = ""
                state["suggestion"] = ""

            logger.info("[AI CONTROL] %s -> space", username)
            _send_phrase_update(
                socketio, state_mgr, sid, username,
                "—", 0, False, use_nlp=True  # NLP on space
            )

        # ---- ACCEPT WORD SUGGESTION ----
        elif command == "accept_word":
            if state["current_word"] and state["suggestion"]:
                completed_word = state["current_word"] + state["suggestion"]
                state["sentence"].append(completed_word)
                state["current_word"] = ""
                state["suggestion"] = ""
                logger.info("[AI CONTROL] %s -> accept_word: %s", username, completed_word)
                _send_phrase_update(socketio, state_mgr, sid, username, "—", 0, False, use_nlp=True)

        # ---- ACCEPT SENTENCE SUGGESTION ----
        elif command == "accept_sentence":
            phrase = str(data.get("word", "")).strip()
            if phrase:
                # Discard partial word since the chip replaces it
                state["current_word"] = ""
                state["suggestion"] = ""
                state["sentence"].append(phrase)
                logger.info("[AI CONTROL] %s -> accept_sentence: %s", username, phrase)
                _send_phrase_update(socketio, state_mgr, sid, username, "—", 0, False, use_nlp=True)

        # ---- UNDO ----
        elif command == "undo":
            if state["current_word"]:
                state["current_word"] = state["current_word"][:-1]
                state["suggestion"] = get_suggestion(state["current_word"])
            elif state["sentence"]:
                state["current_word"] = state["sentence"].pop()
                state["suggestion"] = get_suggestion(state["current_word"])

            logger.info("[AI CONTROL] %s -> undo", username)
            _send_phrase_update(
                socketio, state_mgr, sid, username,
                "—", 0, False
            )

        # ---- CLEAR ----
        elif command == "clear":
            state["current_word"] = ""
            state["sentence"] = []
            state["suggestion"] = ""
            state["candidate"] = ""
            state["last_accepted"] = ""
            state["last_accepted_time"] = 0
            state["hand_was_lost"] = True
            state["history"] = []

            logger.info("[AI CONTROL] %s -> clear", username)
            _send_phrase_update(
                socketio, state_mgr, sid, username,
                "—", 0, False
            )

        # ---- SEND (#9 debounce: use_nlp=True on send) ----
        elif command == "send":
            full_message = " ".join(state["sentence"])
            if state["current_word"]:
                full_message = (full_message + " " + state["current_word"]).strip()

            if full_message:
                logger.info("[SIGN SEND] %s: %s", username, full_message)

            state["current_word"] = ""
            state["sentence"] = []
            state["suggestion"] = ""
            state["candidate"] = ""
            state["last_accepted"] = ""
            state["last_accepted_time"] = 0
            state["hand_was_lost"] = True
            state["history"] = []

        else:
            logger.warning("[AI CONTROL] Unknown command: %s", command)
            return

        # Sync control with browsers
        mode = state_mgr.get_mode(sid)
        current_combined = _build_phrase(state)
        full_arr = state["sentence"] + (
            [state["current_word"]] if state["current_word"] else []
        )
        # Rule-based only for control sync (no NLP per-frame)
        smoothed = smooth_sentence(full_arr, use_nlp=False)
        final = smoothed if smoothed else current_combined

        emit("recognition_control", {
            "username": username,
            "command": command,
            "mode": mode,
            "current_phrase": final
        }, to=sid)

    # ========================================================
    # RECOGNITION FRAME → Background Worker (#2/#6)
    # ========================================================

    @socketio.on("recognition_frame")
    def handle_recognition_frame(data):
        """
        Non-blocking frame handler. Decodes the image, then
        submits it to the background inference worker.
        The socket handler returns IMMEDIATELY.
        """
        if not isinstance(data, dict):
            return

        sid = request.sid
        image_data = data.get("image")
        if not image_data:
            return

        # Remove data URL prefix
        if "," in image_data:
            image_data = image_data.split(",", 1)[1]

        # Base64 → bytes
        try:
            image_bytes = base64.b64decode(image_data)
        except Exception as error:
            logger.warning("Invalid base64 frame: %s", error)
            return

        # Bytes → numpy
        try:
            np_buffer = np.frombuffer(image_bytes, dtype=np.uint8)
            frame = cv2.imdecode(np_buffer, cv2.IMREAD_COLOR)
        except Exception as error:
            logger.warning("Frame decoding error: %s", error)
            return

        if frame is None:
            logger.warning("Could not decode camera frame")
            return

        # Mode
        requested_mode = data.get("mode")
        if requested_mode in ("alphabet", "number", "gesture", "special"):
            state_mgr.set_mode(sid, requested_mode)
            mode = requested_mode
        else:
            mode = state_mgr.get_mode(sid)

        username = str(data.get("username", "Sign User")).strip() or "Sign User"

        # Submit to background worker — returns immediately! (#2/#6)
        inference_worker.submit_frame(sid, frame, mode, username)

        # Emit ack so client knows frame was received (prevents stall)
        emit("frame_ack", {"sid": sid})

    # ========================================================
    # EXTERNAL RECOGNITION UPDATE (compatibility)
    # ========================================================



    # ========================================================
    # WEBRTC SIGNALING (#7 room-scoped)
    # ========================================================

    @socketio.on("webrtc_signal")
    def handle_webrtc_signal(data):
        if not isinstance(data, dict):
            return

        signal_type = data.get("type")
        if signal_type not in {"offer", "answer", "candidate", "end"}:
            return

        payload = {
            "type": signal_type,
            "sender": request.sid
        }

        for key in ("sdp", "candidate", "username"):
            if key in data:
                payload[key] = data[key]

        # Route to room if in one, otherwise broadcast (#7)
        room_id = _sid_to_room.get(request.sid)
        logger.info("[WebRTC] Routing '%s' from %s (%s) to %s",
                    signal_type, request.sid, payload.get("username", "anon"),
                    f"room '{room_id}'" if room_id else "broadcast")
        if room_id:
            emit("webrtc_signal", payload, room=room_id,
                 include_self=False)
        else:
            emit("webrtc_signal", payload, broadcast=True,
                 include_self=False)

    # ========================================================
    # SHUTDOWN RECOGNITION
    # ========================================================

    @socketio.on("shutdown_recognition")
    def shutdown_recognition():
        logger.info("Recognition shutdown requested.")


# ============================================================
# HELPER: Build phrase from state
# ============================================================

def _build_phrase(state):
    """Build the combined phrase string from sentence + current_word."""
    combined = " ".join(state["sentence"])
    if state["current_word"]:
        combined = (combined + " " + state["current_word"]).strip()
    return combined


# ============================================================
# HELPER: Send phrase update to client
# ============================================================

def _send_phrase_update(socketio, state_mgr, sid, username, character,
                        confidence, hand_detected, use_nlp=False):
    """Build and emit a recognition_update payload."""
    state = state_mgr.get_state(sid)
    mode = state_mgr.get_mode(sid)
    current_combined = _build_phrase(state)

    full_arr = state["sentence"] + (
        [state["current_word"]] if state["current_word"] else []
    )
    # Only run LanguageTool when explicitly triggered (#9)
    smoothed = smooth_sentence(full_arr, use_nlp=use_nlp)
    final = smoothed if smoothed else current_combined

    # Get sentence suggestions for the UI (both for typing prefix & completed gestures)
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
        "hand_detected": hand_detected
    }

    socketio.emit("recognition_update", payload, to=sid)


# ============================================================
# PROCESS SIGN (used by inference worker callback)
# ============================================================

def process_recognized_sign(state, character, confidence, hand_detected, mode="alphabet"):
    """
    Process a recognized sign into the state machine.
    Returns True if a new character was accepted.
    """
    current_time = time.time()

    # No hand
    if not hand_detected:
        state["candidate"] = ""
        state["hand_was_lost"] = True
        return False

    # Invalid
    if not character or character == "—":
        return False

    # Low confidence
    if confidence < MIN_SIGN_CONFIDENCE:
        state["history"].append(("", 0))
        if len(state["history"]) > HISTORY_LENGTH:
            state["history"].pop(0)
        return False

    # Sliding window
    state["history"].append((character, confidence))
    if len(state["history"]) > HISTORY_LENGTH:
        state["history"].pop(0)

    scores = {}
    for c, conf in state["history"]:
        if c:
            scores[c] = scores.get(c, 0) + conf

    best_char = max(scores, key=scores.get) if scores else ""

    # Strictly isolated: special gestures only trigger if current mode is 'gesture' or 'special'
    is_special_word = (mode in ("gesture", "special")) and (character in SPECIAL_GESTURE_WORDS or len(character) > 1)

    # Special gestures need 2 stable frames (~300ms) for snappy responsiveness; letters need 4
    required_frames = 2 if is_special_word else STABLE_FRAMES_REQUIRED
    min_conf = 70 if is_special_word else MIN_SIGN_CONFIDENCE
    required_score = required_frames * min_conf

    if best_char != character or scores.get(best_char, 0) < required_score:
        return False

    # Prevent duplicate same sign without resetting hand
    if character == state["last_accepted"] and not state["hand_was_lost"]:
        return False

    # Adaptive cooldown: gestures get a generous 2.0s cooldown to prevent any spam
    cooldown = 2.0 if is_special_word else (SIGN_COOLDOWN * (1.0 - (confidence / 200.0)))
    if (current_time - state["last_accepted_time"] < cooldown
            and character == state["last_accepted"]
            and not state["hand_was_lost"]):
        return False

    # Accept sign / gesture
    if is_special_word:
        # If user had a partial typed word in progress, commit it first
        if state["current_word"]:
            state["sentence"].append(state["current_word"])
            state["current_word"] = ""
        state["sentence"].append(character)
        state["suggestion"] = ""
        state["last_accepted"] = character
        state["last_accepted_time"] = current_time
        state["hand_was_lost"] = False
        state["history"] = []

        logger.info(
            "[AI SPECIAL GESTURE] %s (%d%%) -> Appended to sentence: %s",
            character, confidence, " ".join(state["sentence"])
        )
        return True
    else:
        state["current_word"] += character
        state["suggestion"] = get_suggestion(state["current_word"])
        state["last_accepted"] = character
        state["last_accepted_time"] = current_time
        state["hand_was_lost"] = False
        state["history"] = []

        logger.info(
            "[AI SIGN] %s (%d%%) -> %s",
            character, confidence, state["current_word"]
        )
        return True
