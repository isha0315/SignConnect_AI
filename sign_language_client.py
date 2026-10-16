import cv2
import mediapipe
import torch
import pandas as pd
import numpy as np
import socketio
import time
import os
import webbrowser

from urllib.parse import quote
from CNNModel import CNNModel


# ============================================================
# SIGNCONNECT SIGN LANGUAGE CLIENT
# ============================================================

print()
print("============================================================")
print("             SIGNCONNECT SIGN LANGUAGE CLIENT")
print("============================================================")


# ============================================================
# SERVER CONNECTION
# ============================================================

SERVER_URL = os.environ.get(
    "SIGNCONNECT_SERVER_URL",
    "http://127.0.0.1:5000"
).rstrip("/")

print("Server:", SERVER_URL)


# ============================================================
# SOCKET.IO CLIENT
# ============================================================

sio = socketio.Client(
    reconnection=True,
    reconnection_attempts=0,       # 0 = keep retrying
    reconnection_delay=1,
    reconnection_delay_max=5
)


# ============================================================
# USER NAME
# ============================================================

username = input("Enter your name: ").strip()

if username == "":
    username = "Sign User"

print("User:", username)


# ============================================================
# SOCKET.IO EVENTS
# ============================================================

@sio.event
def connect():

    print()
    print("------------------------------------------------------------")
    print("CONNECTED TO SIGNCONNECT SERVER")
    print("User:", username)
    print("Server:", SERVER_URL)
    print("------------------------------------------------------------")


@sio.event
def disconnect():

    print()
    print("[Socket.IO] Disconnected from server.")
    print("[Socket.IO] Recognition will continue locally.")
    print("[Socket.IO] Waiting for automatic reconnection...")


@sio.on("connect_error")
def connect_error(data):

    print("[Socket.IO] Connection error:", data)


@sio.on("system_message")
def system_message(message):

    print("[SERVER]", message)


@sio.on("receive_message")
def receive_message(data):

    sender = data.get(
        "username",
        "User"
    )

    message = data.get(
        "message",
        ""
    )

    if message:

        print()
        print(
            f"[{sender}] {message}"
        )
        print()


# ============================================================
# BROWSER CONTROL
# ============================================================

pending_control = None


@sio.on("recognition_control")
def recognition_control(data):

    """
    Receive controls from the SignConnect browser UI.

    Browser buttons:
        alphabet
        number
        space
        send
        clear
        undo
    """

    global pending_control

    if data.get("username") == username:

        pending_control = data.get(
            "command"
        )

        print(
            "[BROWSER CONTROL]",
            pending_control
        )


# ============================================================
# SAFE SOCKET EMITTER
# ============================================================

def safe_emit(event_name, data):

    """
    Safely send data through Socket.IO.

    IMPORTANT:
    If the server disconnects, this function DOES NOT crash
    the CNN/MediaPipe recognition program.

    The Socket.IO client will automatically try to reconnect.
    """

    # Socket.IO object exists but namespace is not connected.
    if not sio.connected:

        return False

    if "/" not in getattr(
        sio,
        "namespaces",
        {}
    ):

        return False

    try:

        sio.emit(
            event_name,
            data,
            namespace="/"
        )

        return True

    except socketio.exceptions.BadNamespaceError:

        print(
            "[Socket.IO] Namespace disconnected."
        )

        return False

    except socketio.exceptions.ConnectionError:

        print(
            "[Socket.IO] Connection lost."
        )

        return False

    except OSError as e:

        print(
            "[Socket.IO] Network error:",
            e
        )

        return False

    except Exception as e:

        print(
            "[Socket.IO] Emit failed:",
            e
        )

        return False


# ============================================================
# CONNECT TO SERVER
# ============================================================

print()
print("Connecting to SignConnect server...")
print("Server:", SERVER_URL)


try:

    sio.connect(
        SERVER_URL,
        transports=["polling"],
        wait_timeout=10
    )

except Exception as e:

    print()
    print("============================================================")
    print("SERVER CONNECTION FAILED")
    print("============================================================")
    print("Server:", SERVER_URL)
    print("Error :", e)
    print()
    print("Make sure communication_server.py is running.")
    print()

    raise SystemExit(1)


# ============================================================
# OPEN SIGNCONNECT BROWSER UI
# ============================================================

try:

    browser_url = (
        SERVER_URL
        + "/?user="
        + quote(username)
    )

    print()
    print("Opening SignConnect browser UI...")
    print("Browser:", browser_url)

    webbrowser.open(
        browser_url
    )

except Exception as e:

    print(
        "Could not open browser automatically:",
        e
    )


# ============================================================
# LOAD ALPHABET MODEL
# ============================================================

print()
print("Loading alphabet model...")

alphabet_model = CNNModel()

alphabet_model.load_state_dict(
    torch.load(
        "CNN_model_alphabet_SIBI.pth",
        map_location=torch.device("cpu")
    )
)

alphabet_model.eval()

print(
    "Alphabet model loaded."
)


# ============================================================
# LOAD NUMBER MODEL
# ============================================================

print()
print("Loading number model...")

number_model = CNNModel()

number_model.load_state_dict(
    torch.load(
        "CNN_model_number_SIBI.pth",
        map_location=torch.device("cpu")
    )
)

number_model.eval()

print(
    "Number model loaded."
)


# ============================================================
# ALPHABET CLASSES
# ============================================================

alphabet_classes = {

    "A": 0,
    "B": 1,
    "C": 2,
    "D": 3,
    "E": 4,
    "F": 5,
    "G": 6,
    "H": 7,
    "I": 8,
    "J": 9,
    "K": 10,
    "L": 11,
    "M": 12,
    "N": 13,
    "O": 14,
    "P": 15,
    "Q": 16,
    "R": 17,
    "S": 18,
    "T": 19,
    "U": 20,
    "V": 21,
    "W": 22,
    "X": 23,
    "Y": 24,
    "Z": 25

}


# ============================================================
# NUMBER CLASSES
# ============================================================

number_classes = {

    "1": 0,
    "2": 1,
    "3": 2,
    "4": 3,
    "5": 4,
    "6": 5,
    "7": 6,
    "8": 7,
    "9": 8

}


# ============================================================
# MEDIAPIPE
# ============================================================

print()
print("Starting camera...")


cap = cv2.VideoCapture(0)


if not cap.isOpened():

    print(
        "ERROR: Camera could not be opened."
    )

    try:

        if sio.connected:

            sio.disconnect()

    except Exception:

        pass

    raise SystemExit(1)


# ============================================================
# MEDIAPIPE HANDS
# ============================================================

handTracker = mediapipe.solutions.hands

drawing = mediapipe.solutions.drawing_utils

drawingStyles = mediapipe.solutions.drawing_styles


handDetector = handTracker.Hands(

    static_image_mode=False,

    min_detection_confidence=0.5,

    min_tracking_confidence=0.5

)


# ============================================================
# STARTING MODE
# ============================================================

mode = "alphabet"


# ============================================================
# TEXT BUFFER
# ============================================================

recognized_text = ""


# ============================================================
# GESTURE STABILITY
# ============================================================

last_prediction = None

stable_count = 0

STABLE_FRAMES = 15

gesture_accepted = False


# ============================================================
# BROWSER UPDATE TIMER
# ============================================================

last_status_at = 0

STATUS_UPDATE_INTERVAL = 0.25


# ============================================================
# PUBLISH RECOGNITION
# ============================================================

def publish_recognition(
    character="—",
    confidence=0,
    hand_detected=False
):

    """
    Send recognition data to SignConnect browser.

    A network failure MUST NOT stop recognition.
    """

    global last_status_at

    now = time.monotonic()

    if (
        now - last_status_at
        < STATUS_UPDATE_INTERVAL
    ):

        return False

    last_status_at = now


    success = safe_emit(

        "recognition_update",

        {

            "username": username,

            "mode": mode,

            "character": character,

            "confidence": round(
                confidence
            ),

            "message": recognized_text,

            "hand_detected": bool(
                hand_detected
            )

        }

    )

    return success


# ============================================================
# ADD CHARACTER
# ============================================================

def add_character(character):

    global recognized_text

    recognized_text += character

    print(
        "Current text:",
        recognized_text
    )

    publish_recognition(
        character,
        100,
        True
    )


# ============================================================
# SEND COMPLETE MESSAGE
# ============================================================

def send_complete_message():

    """
    Send the completed sign-language message.

    If the server is temporarily disconnected,
    the application DOES NOT crash.
    """

    global recognized_text

    message = recognized_text.strip()


    if not message:

        print(
            "Nothing to send."
        )

        return


    success = safe_emit(

        "send_message",

        {

            "username": username,

            "message": message,

            "message_type": "sign"

        }

    )


    if success:

        print(
            "Complete sign message sent:",
            message
        )

        recognized_text = ""

        publish_recognition(
            "—",
            0,
            True
        )

    else:

        print(
            "[Socket.IO] Message was NOT sent."
        )

        print(
            "[Socket.IO] Your text is still kept locally."
        )


# ============================================================
# MAIN CAMERA LOOP
# ============================================================

print()
print("============================================================")
print("SIGN LANGUAGE RECOGNITION STARTED")
print("============================================================")
print()
print("A       = Alphabet")
print("N       = Numbers")
print("SPACE   = Add space")
print("S       = Send")
print("C       = Clear")
print("Q       = Quit")
print()
print("============================================================")


while True:

    # ========================================================
    # CAMERA FRAME
    # ========================================================

    ret, frame = cap.read()


    if not ret:

        print(
            "Unable to access camera."
        )

        break


    # ========================================================
    # MIRROR CAMERA
    # ========================================================

    frame = cv2.flip(
        frame,
        1
    )


    height, width, _ = frame.shape


    # ========================================================
    # BGR → RGB
    # ========================================================

    frameRGB = cv2.cvtColor(
        frame,
        cv2.COLOR_BGR2RGB
    )


    # ========================================================
    # MEDIAPIPE
    # ========================================================

    imgMediapipe = handDetector.process(
        frameRGB
    )


    # ========================================================
    # HAND DETECTED
    # ========================================================

    if imgMediapipe.multi_hand_landmarks:

        handLandmarks = (
            imgMediapipe
            .multi_hand_landmarks[0]
        )


        # ====================================================
        # DRAW HAND LANDMARKS
        # ====================================================

        drawing.draw_landmarks(

            frame,

            handLandmarks,

            handTracker.HAND_CONNECTIONS,

            drawingStyles
            .get_default_hand_landmarks_style(),

            drawingStyles
            .get_default_hand_connections_style()

        )


        # ====================================================
        # GET LANDMARK COORDINATES
        # ====================================================

        x_Coordinates = []

        y_Coordinates = []

        z_Coordinates = []


        for i in range(
            len(
                handLandmarks.landmark
            )
        ):

            lm = handLandmarks.landmark[i]

            x_Coordinates.append(
                lm.x
            )

            y_Coordinates.append(
                lm.y
            )

            z_Coordinates.append(
                lm.z
            )


        # ====================================================
        # NORMALIZATION
        # ====================================================

        data = {}


        for i, landmark in enumerate(
            handTracker.HandLandmark
        ):

            lm = handLandmarks.landmark[i]


            data[
                f"{landmark.name}_x"
            ] = (
                lm.x
                - min(x_Coordinates)
            )


            data[
                f"{landmark.name}_y"
            ] = (
                lm.y
                - min(y_Coordinates)
            )


            data[
                f"{landmark.name}_z"
            ] = (
                lm.z
                - min(z_Coordinates)
            )


        # ====================================================
        # BOUNDING BOX
        # ====================================================

        x1 = max(

            0,

            int(
                min(x_Coordinates)
                * width
            ) - 20

        )


        y1 = max(

            0,

            int(
                min(y_Coordinates)
                * height
            ) - 20

        )


        x2 = min(

            width - 1,

            int(
                max(x_Coordinates)
                * width
            ) + 20

        )


        y2 = min(

            height - 1,

            int(
                max(y_Coordinates)
                * height
            ) + 20

        )


        # ====================================================
        # DATAFRAME
        # ====================================================

        coordinates = pd.DataFrame(
            [data]
        )


        # ====================================================
        # RESHAPE
        # ====================================================

        coordinates = np.reshape(

            coordinates.values,

            (
                1,
                63,
                1
            )

        )


        # ====================================================
        # TORCH TENSOR
        # ====================================================

        coordinates = torch.from_numpy(
            coordinates
        ).float()


        # ====================================================
        # MODEL PREDICTION
        # ====================================================

        with torch.no_grad():

            if mode == "alphabet":

                outputs = alphabet_model(
                    coordinates
                )

                classes = alphabet_classes


            else:

                outputs = number_model(
                    coordinates
                )

                # Number model has 9 classes.
                outputs = outputs[:, :9]

                classes = number_classes


            # =================================================
            # PROBABILITIES
            # =================================================

            probabilities = torch.softmax(
                outputs,
                dim=1
            )


            confidence, predicted = torch.max(

                probabilities,

                dim=1

            )


        # ====================================================
        # PREDICTION INDEX
        # ====================================================

        prediction_index = int(
            predicted.item()
        )


        prediction_confidence = (
            float(
                confidence.item()
            )
            * 100
        )


        # ====================================================
        # INDEX → CHARACTER
        # ====================================================

        predicted_character = "?"


        for key, value in classes.items():

            if value == prediction_index:

                predicted_character = key

                break


        # ====================================================
        # STABILITY
        # ====================================================

        if (
            predicted_character
            == last_prediction
        ):

            stable_count += 1


        else:

            last_prediction = (
                predicted_character
            )

            stable_count = 1

            gesture_accepted = False


        # ====================================================
        # ACCEPT GESTURE
        # ====================================================

        if (

            stable_count
            >= STABLE_FRAMES

            and not gesture_accepted

        ):

            add_character(
                predicted_character
            )

            gesture_accepted = True


        # ====================================================
        # BOUNDING BOX
        # ====================================================

        if gesture_accepted:

            box_color = (
                0,
                220,
                120
            )

        else:

            box_color = (
                255,
                210,
                0
            )


        cv2.rectangle(

            frame,

            (x1, y1),

            (x2, y2),

            box_color,

            3

        )


        # ====================================================
        # PREDICTED CHARACTER
        # ====================================================

        cv2.putText(

            frame,

            predicted_character,

            (

                x1,

                max(
                    35,
                    y1 - 15
                )

            ),

            cv2.FONT_HERSHEY_SIMPLEX,

            1.25,

            (255, 255, 255),

            4,

            cv2.LINE_AA

        )


        cv2.putText(

            frame,

            predicted_character,

            (

                x1,

                max(
                    35,
                    y1 - 15
                )

            ),

            cv2.FONT_HERSHEY_SIMPLEX,

            1.25,

            (0, 0, 0),

            2,

            cv2.LINE_AA

        )


        # ====================================================
        # SEND RECOGNITION TO BROWSER
        # ====================================================

        publish_recognition(

            predicted_character,

            prediction_confidence,

            True

        )


    # ========================================================
    # NO HAND
    # ========================================================

    else:

        stable_count = 0

        last_prediction = None

        gesture_accepted = False

        publish_recognition(
            "—",
            0,
            False
        )


    # ========================================================
    # MODE DISPLAY
    # ========================================================

    if mode == "alphabet":

        mode_text = (
            "MODE: ALPHABET (A-Z)"
        )

    else:

        mode_text = (
            "MODE: NUMBER (1-9)"
        )


    cv2.putText(

        frame,

        mode_text,

        (20, 40),

        cv2.FONT_HERSHEY_SIMPLEX,

        0.8,

        (0, 0, 0),

        2,

        cv2.LINE_AA

    )


    # ========================================================
    # LOCAL TEXT
    # ========================================================

    cv2.putText(

        frame,

        "Text: " + recognized_text,

        (20, 80),

        cv2.FONT_HERSHEY_SIMPLEX,

        0.8,

        (0, 0, 0),

        2,

        cv2.LINE_AA

    )


    # ========================================================
    # CONNECTION STATUS
    # ========================================================

    if (

        sio.connected
        and "/"
        in getattr(
            sio,
            "namespaces",
            {}
        )

    ):

        connection_text = (
            "SERVER: CONNECTED"
        )

    else:

        connection_text = (
            "SERVER: RECONNECTING..."
        )


    cv2.putText(

        frame,

        connection_text,

        (20, 115),

        cv2.FONT_HERSHEY_SIMPLEX,

        0.65,

        (0, 120, 0),

        2,

        cv2.LINE_AA

    )


    # ========================================================
    # INSTRUCTIONS
    # ========================================================

    controls = (
        "A: Alphabet  "
        "N: Numbers  "
        "SPACE: Word  "
        "S: Send  "
        "C: Clear  "
        "Q: Quit"
    )


    cv2.putText(

        frame,

        controls,

        (
            18,
            height - 20
        ),

        cv2.FONT_HERSHEY_SIMPLEX,

        0.55,

        (40, 40, 40),

        1,

        cv2.LINE_AA

    )


    # ========================================================
    # SHOW CAMERA
    # ========================================================

    cv2.imshow(

        "Sign Language Communication",

        frame

    )


    # ========================================================
    # KEYBOARD
    # ========================================================

    key = cv2.waitKey(1) & 0xFF


    # ========================================================
    # BROWSER CONTROLS
    # ========================================================

    if pending_control:

        command = pending_control

        pending_control = None


        # ----------------------------------------------------
        # UNDO
        # ----------------------------------------------------

        if command == "undo":

            if recognized_text:

                recognized_text = (
                    recognized_text[:-1]
                )

            publish_recognition(
                "—",
                0,
                True
            )

            continue


        # ----------------------------------------------------
        # CONVERT BROWSER COMMAND TO KEY
        # ----------------------------------------------------

        key = {

            "alphabet": ord("a"),

            "number": ord("n"),

            "space": 32,

            "send": ord("s"),

            "clear": ord("c")

        }.get(
            command,
            key
        )


    # ========================================================
    # ALPHABET MODE
    # ========================================================

    if (

        key == ord("a")
        or key == ord("A")

    ):

        mode = "alphabet"

        last_prediction = None

        stable_count = 0

        gesture_accepted = False


        print(
            "Switched to ALPHABET mode"
        )


        publish_recognition(
            "—",
            0,
            False
        )


    # ========================================================
    # NUMBER MODE
    # ========================================================

    elif (

        key == ord("n")
        or key == ord("N")

    ):

        mode = "number"

        last_prediction = None

        stable_count = 0

        gesture_accepted = False


        print(
            "Switched to NUMBER mode"
        )


        publish_recognition(
            "—",
            0,
            False
        )


    # ========================================================
    # SPACE
    # ========================================================

    elif key == 32:

        if (

            recognized_text
            and not recognized_text.endswith(" ")

        ):

            recognized_text += " "


            print(
                "SPACE added"
            )


            publish_recognition(
                "SPACE",
                100,
                True
            )


    # ========================================================
    # SEND
    # ========================================================

    elif (

        key == ord("s")
        or key == ord("S")

    ):

        send_complete_message()


    # ========================================================
    # CLEAR
    # ========================================================

    elif (

        key == ord("c")
        or key == ord("C")

    ):

        recognized_text = ""

        last_prediction = None

        stable_count = 0

        gesture_accepted = False


        print(
            "Text cleared."
        )


        publish_recognition(
            "—",
            0,
            True
        )


    # ========================================================
    # QUIT
    # ========================================================

    elif (

        key == 27
        or key == ord("q")
        or key == ord("Q")

    ):

        break


# ============================================================
# CLEANUP
# ============================================================

print()
print("Closing SignConnect...")


try:

    cap.release()

except Exception:

    pass


try:

    cv2.destroyAllWindows()

except Exception:

    pass


try:

    handDetector.close()

except Exception:

    pass


try:

    if sio.connected:

        sio.disconnect()

except Exception:

    pass


print(
    "SignConnect closed."
)