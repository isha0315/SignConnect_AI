import os
import sys
import base64
import threading
import time

# ============================================================
# PROJECT PATH
# ============================================================

BASE_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

# ============================================================
# BUNDLED VENDOR RUNTIME
# ============================================================

LOCAL_RUNTIME = os.path.join(
    BASE_DIR,
    "vendor"
)

if os.path.isdir(LOCAL_RUNTIME):
    sys.path.insert(0, LOCAL_RUNTIME)

# ============================================================
# FLASK
# ============================================================

from flask import (
    Flask,
    Response,
    render_template,
    request
)

from flask_socketio import (
    SocketIO,
    emit
)

# ============================================================
# OPENCV
# ============================================================

import cv2
import numpy as np

# ============================================================
# AI RECOGNITION
# ============================================================

from recognition_service import (
    SignRecognitionService
)

# ============================================================
# APPLICATION
# ============================================================

app = Flask(__name__)

app.config["SECRET_KEY"] = (
    "sign-language-project"
)

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading"
)

# ============================================================
# AI SERVICE
# ============================================================

print()
print("[AI] Starting recognition service...")

recognizer = SignRecognitionService()

print("[AI] Recognition service ready.")
print()

# ============================================================
# RECOGNITION LOCK
# ============================================================

recognition_lock = threading.Lock()

# ============================================================
# USER RECOGNITION STATE
# ============================================================

client_modes = {}

# ------------------------------------------------------------
# IMPORTANT:
# Each browser/user gets its own sign recognition state.
#
# Example:
#
# H -> E -> L -> L -> O
#
# becomes:
#
# HELLO
#
# The server also prevents:
#
# H H H H H H
#
# when the user is simply holding the H sign.
# ------------------------------------------------------------

client_recognition_state = {}

# ============================================================
# RECOGNITION SETTINGS
# ============================================================

# Number of consecutive frames required before accepting
# a detected character.
STABLE_FRAMES_REQUIRED = 3

# Minimum confidence required before accepting a sign.
MIN_SIGN_CONFIDENCE = 60

# After accepting a sign, wait this long before accepting
# another sign if the hand has not disappeared.
SIGN_COOLDOWN = 0.8


# ============================================================
# CREATE USER STATE
# ============================================================

def create_recognition_state():
    return {
        "phrase": "",

        # Candidate sign currently being observed.
        "candidate": "",

        # How many consecutive frames contain the candidate.
        "candidate_count": 0,

        # Last accepted character.
        "last_accepted": "",

        # Time when last sign was accepted.
        "last_accepted_time": 0,

        # Whether the hand disappeared after the last sign.
        #
        # This allows:
        #
        # L -> hand removed -> L
        #
        # to create "LL".
        "hand_was_lost": True,
    }


# ============================================================
# GET USER STATE
# ============================================================

def get_recognition_state(sid):

    if sid not in client_recognition_state:

        client_recognition_state[sid] = (
            create_recognition_state()
        )

    return client_recognition_state[sid]


# ============================================================
# RESET USER STATE
# ============================================================

def reset_recognition_state(sid):

    client_recognition_state[sid] = (
        create_recognition_state()
    )


# ============================================================
# ROUTES
# ============================================================

@app.route("/")
def index():

    return render_template(
        "communication.html"
    )


@app.route("/favicon.ico")
def favicon():

    return Response(
        status=204
    )


# ============================================================
# CONNECTION
# ============================================================

@socketio.on("connect")
def handle_connect():

    sid = request.sid

    client_modes[sid] = "alphabet"

    reset_recognition_state(sid)

    print(
        "[SOCKET] User connected:",
        sid
    )

    emit(
        "system_message",
        "Connected to the SignConnect communication server."
    )


# ============================================================
# DISCONNECT
# ============================================================

@socketio.on("disconnect")
def handle_disconnect():

    sid = request.sid

    client_modes.pop(
        sid,
        None
    )

    client_recognition_state.pop(
        sid,
        None
    )

    print(
        "[SOCKET] User disconnected:",
        sid
    )


# ============================================================
# CHAT / SIGN MESSAGE
# ============================================================

@socketio.on("send_message")
def handle_message(data):

    if not isinstance(data, dict):
        return

    message = str(
        data.get(
            "message",
            ""
        )
    ).strip()

    if not message:
        return

    username = str(
        data.get(
            "username",
            "User"
        )
    ).strip()

    if not username:
        username = "User"

    message_type = data.get(
        "message_type",
        "typed"
    )

    payload = {

    "sender_id": request.sid,

    "username": username,

    "message": message,

    "message_type": message_type

}

    print(
        f"[MESSAGE] "
        f"{username}: {message}"
    )

    emit(
        "receive_message",
        payload,
        broadcast=True
    )


# ============================================================
# RECOGNITION CONTROL
# ============================================================

@socketio.on("recognition_control")
def handle_recognition_control(data):

    if not isinstance(data, dict):
        return

    sid = request.sid

    # --------------------------------------------------------
    # Support both command and action.
    # --------------------------------------------------------

    command = data.get(
        "command"
    )

    if command is None:

        command = data.get(
            "action"
        )

    if command is None:
        return

    command = str(
        command
    ).strip().lower()

    username = str(
        data.get(
            "username",
            "User"
        )
    ).strip()

    if not username:
        username = "User"

    # Get this user's recognition state.
    recognition_state = get_recognition_state(sid)

    # ========================================================
    # MODE SELECTION
    # ========================================================

    if command in (
        "alphabet",
        "a",
        "a-z",
        "letters"
    ):

        client_modes[sid] = "alphabet"

        # Reset sign detection when switching mode.
        recognition_state["candidate"] = ""
        recognition_state["candidate_count"] = 0
        recognition_state["last_accepted"] = ""
        recognition_state["hand_was_lost"] = True

        print(
            f"[AI CONTROL] "
            f"{username} -> alphabet"
        )

    elif command in (
        "number",
        "numbers",
        "n",
        "1-9"
    ):

        client_modes[sid] = "number"

        recognition_state["candidate"] = ""
        recognition_state["candidate_count"] = 0
        recognition_state["last_accepted"] = ""
        recognition_state["hand_was_lost"] = True

        print(
            f"[AI CONTROL] "
            f"{username} -> number"
        )

    # ========================================================
    # SPACE
    # ========================================================

    elif command == "space":

        if recognition_state["phrase"]:

            if not recognition_state["phrase"].endswith(" "):

                recognition_state["phrase"] += " "

        print(
            f"[AI CONTROL] "
            f"{username} -> space"
        )

        send_phrase_update(
            sid,
            username,
            client_modes.get(
                sid,
                "alphabet"
            ),
            "—",
            0,
            False
        )

    # ========================================================
    # UNDO
    # ========================================================

    elif command == "undo":

        phrase = recognition_state["phrase"]

        if phrase:

            recognition_state["phrase"] = phrase[:-1]

        print(
            f"[AI CONTROL] "
            f"{username} -> undo"
        )

        send_phrase_update(
            sid,
            username,
            client_modes.get(
                sid,
                "alphabet"
            ),
            "—",
            0,
            False
        )

    # ========================================================
    # CLEAR
    # ========================================================

    elif command == "clear":

        recognition_state["phrase"] = ""

        recognition_state["candidate"] = ""

        recognition_state["candidate_count"] = 0

        recognition_state["last_accepted"] = ""

        recognition_state["hand_was_lost"] = True

        print(
            f"[AI CONTROL] "
            f"{username} -> clear"
        )

        send_phrase_update(
            sid,
            username,
            client_modes.get(
                sid,
                "alphabet"
            ),
            "—",
            0,
            False
        )

    # ========================================================
    # SEND
    # ========================================================

    elif command == "send":

        phrase = recognition_state["phrase"].strip()

        if phrase:

            print(
                f"[SIGN SEND] "
                f"{username}: {phrase}"
            )

            # We intentionally DO NOT broadcast here.
            #
            # The JS already sends the final phrase using
            # send_message.
            #
            # This avoids duplicate messages.

        recognition_state["phrase"] = ""

        recognition_state["candidate"] = ""

        recognition_state["candidate_count"] = 0

        recognition_state["last_accepted"] = ""

        recognition_state["hand_was_lost"] = True

    else:

        print(
            f"[AI CONTROL] "
            f"Unknown command: {command}"
        )

        return

    # ========================================================
    # SYNC CONTROL WITH BROWSERS
    # ========================================================

    emit(
        "recognition_control",
        {
            "username": username,
            "command": command,
            "mode": client_modes.get(
                sid,
                "alphabet"
            ),
            "current_phrase":
                recognition_state["phrase"]
        },
        broadcast=True
    )


# ============================================================
# SEND PHRASE UPDATE
# ============================================================

def send_phrase_update(
    sid,
    username,
    mode,
    character,
    confidence,
    hand_detected
):

    state = get_recognition_state(sid)

    payload = {

        "username": username,

        "mode": mode,

        "character": character,

        "confidence": confidence,

        "message": state["phrase"],

        "current_phrase": state["phrase"],

        "hand_detected": hand_detected

    }

    socketio.emit(
        "recognition_update",
        payload,
        to=sid
    )


# ============================================================
# PROCESS SIGN
# ============================================================

def process_recognized_sign(
    sid,
    username,
    mode,
    character,
    confidence,
    hand_detected
):

    state = get_recognition_state(sid)

    current_time = time.time()

    # ========================================================
    # NO HAND
    # ========================================================

    if not hand_detected:

        state["candidate"] = ""

        state["candidate_count"] = 0

        # This is VERY important.
        #
        # If the user removes their hand, the next appearance
        # of the same sign can be accepted again.
        #
        # Example:
        #
        # L -> remove hand -> L
        #
        # = LL
        state["hand_was_lost"] = True

        return

    # ========================================================
    # INVALID CHARACTER
    # ========================================================

    if not character or character == "—":

        return

    # ========================================================
    # LOW CONFIDENCE
    # ========================================================

    if confidence < MIN_SIGN_CONFIDENCE:

        state["candidate"] = ""

        state["candidate_count"] = 0

        return

    # ========================================================
    # SAME CANDIDATE
    # ========================================================

    if character == state["candidate"]:

        state["candidate_count"] += 1

    else:

        state["candidate"] = character

        state["candidate_count"] = 1

    # ========================================================
    # NOT STABLE YET
    # ========================================================

    if state["candidate_count"] < STABLE_FRAMES_REQUIRED:

        return

    # ========================================================
    # PREVENT DUPLICATE SAME SIGN
    # ========================================================

    # If the hand has not disappeared and the same character
    # was already accepted, do not add it again.
    if (
        character == state["last_accepted"]
        and not state["hand_was_lost"]
    ):

        return

    # ========================================================
    # COOLDOWN
    # ========================================================

    if (
        current_time - state["last_accepted_time"]
        < SIGN_COOLDOWN
        and character == state["last_accepted"]
        and not state["hand_was_lost"]
    ):

        return

    # ========================================================
    # ACCEPT SIGN
    # ========================================================

    state["phrase"] += character

    state["last_accepted"] = character

    state["last_accepted_time"] = current_time

    state["hand_was_lost"] = False

    # Reset candidate counter.
    state["candidate_count"] = 0

    print(
        f"[AI SIGN] "
        f"{username}: "
        f"{character} "
        f"({confidence}%) "
        f"-> {state['phrase']}"
    )


# ============================================================
# BROWSER CAMERA FRAME → AI RECOGNITION
# ============================================================

@socketio.on("recognition_frame")
def handle_recognition_frame(data):

    """
    Browser:

        camera
          ↓
        canvas
          ↓
        JPEG/base64
          ↓
        recognition_frame
          ↓
        this function
          ↓
        recognition_service.py
          ↓
        existing CNN
          ↓
        character + confidence
          ↓
        phrase builder
          ↓
        recognition_update
    """

    if not isinstance(data, dict):
        return

    sid = request.sid

    # ========================================================
    # IMAGE DATA
    # ========================================================

    image_data = data.get(
        "image"
    )

    if not image_data:
        return

    # ========================================================
    # REMOVE DATA URL PREFIX
    # ========================================================

    if "," in image_data:

        image_data = image_data.split(
            ",",
            1
        )[1]

    # ========================================================
    # BASE64 → BYTES
    # ========================================================

    try:

        image_bytes = base64.b64decode(
            image_data
        )

    except Exception as error:

        print(
            "[AI] Invalid base64 frame:",
            error
        )

        return

    # ========================================================
    # BYTES → NUMPY
    # ========================================================

    try:

        np_buffer = np.frombuffer(
            image_bytes,
            dtype=np.uint8
        )

        frame = cv2.imdecode(
            np_buffer,
            cv2.IMREAD_COLOR
        )

    except Exception as error:

        print(
            "[AI] Frame decoding error:",
            error
        )

        return

    if frame is None:

        print(
            "[AI] Could not decode camera frame."
        )

        return

    # ========================================================
    # RECOGNITION MODE
    # ========================================================

    requested_mode = data.get(
        "mode"
    )

    if requested_mode in (
        "alphabet",
        "number"
    ):

        mode = requested_mode

        # Keep server state synchronized.
        client_modes[sid] = mode

    else:

        mode = client_modes.get(
            sid,
            "alphabet"
        )

    # ========================================================
    # USERNAME
    # ========================================================

    username = str(
        data.get(
            "username",
            "Sign User"
        )
    ).strip()

    if not username:

        username = "Sign User"

    # ========================================================
    # RUN AI MODEL
    # ========================================================

    try:

        with recognition_lock:

            result = recognizer.recognize(
                frame,
                mode=mode
            )

    except Exception as error:

        print(
            "[AI] Recognition error:",
            error
        )

        emit(
            "recognition_error",
            {
                "message":
                    "AI recognition failed."
            }
        )

        return

    # ========================================================
    # NORMALIZE RESULT
    # ========================================================

    character = result.get(
        "character",
        "—"
    )

    confidence = result.get(
        "confidence",
        0
    )

    hand_detected = bool(
        result.get(
            "hand_detected",
            False
        )
    )

    try:

        confidence = int(
            confidence
        )

    except (
        TypeError,
        ValueError
    ):

        confidence = 0

    confidence = max(
        0,
        min(
            100,
            confidence
        )
    )

    # ========================================================
    # BUILD PHRASE
    # ========================================================

    process_recognized_sign(
        sid=sid,
        username=username,
        mode=mode,
        character=character,
        confidence=confidence,
        hand_detected=hand_detected
    )

    # ========================================================
    # GET CURRENT PHRASE
    # ========================================================

    state = get_recognition_state(sid)

    # ========================================================
    # SEND RESULT BACK TO CURRENT BROWSER
    # ========================================================

    payload = {

        "username": username,

        "mode": mode,

        "character": character,

        "confidence": confidence,

        # Complete phrase.
        "message": state["phrase"],

        # Explicit phrase property.
        "current_phrase": state["phrase"],

        "hand_detected": hand_detected

    }

    emit(
        "recognition_update",
        payload
    )


# ============================================================
# RECOGNITION UPDATE
# ============================================================

@socketio.on("recognition_update")
def handle_recognition_update(data):

    """
    Allows an external client to send a recognition update.

    This is kept for compatibility with the existing project.
    """

    if not isinstance(data, dict):
        return

    try:

        confidence = int(
            data.get(
                "confidence",
                0
            )
        )

    except (
        TypeError,
        ValueError
    ):

        confidence = 0

    confidence = max(
        0,
        min(
            100,
            confidence
        )
    )

    payload = {

        "username": str(
            data.get(
                "username",
                "Sign User"
            )
        ).strip() or "Sign User",

        "mode": data.get(
            "mode",
            "alphabet"
        ),

        "character": data.get(
            "character",
            "—"
        ),

        "confidence": confidence,

        "message": str(
            data.get(
                "message",
                ""
            )
        ),

        "current_phrase": str(
            data.get(
                "current_phrase",
                data.get(
                    "message",
                    ""
                )
            )
        ),

        "hand_detected": bool(
            data.get(
                "hand_detected",
                False
            )
        )

    }

    emit(
        "recognition_update",
        payload,
        broadcast=True
    )


# ============================================================
# WEBRTC SIGNALING
# ============================================================

@socketio.on("webrtc_signal")
def handle_webrtc_signal(data):

    if not isinstance(data, dict):
        return

    signal_type = data.get(
        "type"
    )

    if signal_type not in {
        "offer",
        "answer",
        "candidate",
        "end"
    }:

        return

    payload = {

        "type": signal_type,

        "sender": request.sid

    }

    for key in (
        "sdp",
        "candidate",
        "username"
    ):

        if key in data:

            payload[key] = data[key]

    # Keep the existing WebRTC behavior.
    emit(
        "webrtc_signal",
        payload,
        broadcast=True
    )


# ============================================================
# SHUTDOWN RECOGNITION
# ============================================================

@socketio.on("shutdown_recognition")
def shutdown_recognition():

    print(
        "[AI] Recognition shutdown requested."
    )


# ============================================================
# START SERVER
# ============================================================

if __name__ == "__main__":

    port = int(
        os.environ.get(
            "PORT",
            "5000"
        )
    )

    print()
    print(
        "=============================================="
    )

    print(
        "        SIGNCONNECT COMMUNICATION SERVER"
    )

    print(
        "=============================================="
    )

    print(
        f"Server: http://127.0.0.1:{port}"
    )

    print(
        f"Network: http://0.0.0.0:{port}"
    )

    print(
        "AI recognition: READY"
    )

    print(
        "WebRTC signaling: READY"
    )

    print(
        "Socket.IO: READY"
    )

    print(
        "Browser frame recognition: READY"
    )

    print(
        "Sign phrase building: READY"
    )

    print(
        "=============================================="
    )

    print()

    try:

        socketio.run(
            app,
            host="0.0.0.0",
            port=port,
            debug=False,
            allow_unsafe_werkzeug=True
        )

    finally:

        try:

            recognizer.close()

        except Exception:

            pass