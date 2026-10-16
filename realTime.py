import cv2
import mediapipe
import torch
import pandas as pd
import numpy as np
import subprocess
import threading
import time
from collections import deque, Counter

from CNNModel import CNNModel


# ============================================================
# WINDOWS TEXT-TO-SPEECH
# ============================================================

def speak_text(text):

    text = text.strip()

    if not text:
        print("Nothing to speak.")
        return

    print("Speaking:", text)

    def speech_worker():

        safe_text = (
            text.replace("'", "''")
                .replace("\n", " ")
                .replace("\r", " ")
        )

        command = (
            "Add-Type -AssemblyName System.Speech; "
            "$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            "$voice.Rate = 0; "
            "$voice.Volume = 100; "
            "$voice.Speak('"
            + safe_text
            + "'); "
            "$voice.Dispose();"
        )

        try:

            subprocess.run(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    command
                ],
                check=False
            )

            print("Speech finished:", text)

        except Exception as e:

            print("Speech error:", e)


    speech_thread = threading.Thread(
        target=speech_worker,
        daemon=True
    )

    speech_thread.start()


# ============================================================
# THUMBS-UP SPACE GESTURE
# ============================================================

def is_thumbs_up(hand_landmarks):

    landmarks = hand_landmarks.landmark

    # Thumb
    thumb_tip = landmarks[4]
    thumb_ip = landmarks[3]

    # Other four fingers
    index_tip = landmarks[8]
    index_pip = landmarks[6]

    middle_tip = landmarks[12]
    middle_pip = landmarks[10]

    ring_tip = landmarks[16]
    ring_pip = landmarks[14]

    pinky_tip = landmarks[20]
    pinky_pip = landmarks[18]


    # --------------------------------------------------------
    # Thumb must be pointing upward
    # --------------------------------------------------------

    thumb_up = thumb_tip.y < thumb_ip.y


    # --------------------------------------------------------
    # Other fingers should be folded
    # --------------------------------------------------------

    index_folded = index_tip.y > index_pip.y

    middle_folded = middle_tip.y > middle_pip.y

    ring_folded = ring_tip.y > ring_pip.y

    pinky_folded = pinky_tip.y > pinky_pip.y


    # --------------------------------------------------------
    # Final thumbs-up condition
    # --------------------------------------------------------

    if (
        thumb_up
        and index_folded
        and middle_folded
        and ring_folded
        and pinky_folded
    ):

        return True

    return False


# ============================================================
# LOAD ALPHABET MODEL
# ============================================================

alphabet_model = CNNModel()

alphabet_model.load_state_dict(
    torch.load(
        "CNN_model_alphabet_SIBI.pth",
        map_location=torch.device("cpu")
    )
)

alphabet_model.eval()


# ============================================================
# LOAD NUMBER MODEL
# ============================================================

number_model = CNNModel()

number_model.load_state_dict(
    torch.load(
        "CNN_model_number_SIBI.pth",
        map_location=torch.device("cpu")
    )
)

number_model.eval()


# ============================================================
# ALPHABET CLASSES
# ============================================================

alphabet_classes = {

    'A': 0,
    'B': 1,
    'C': 2,
    'D': 3,
    'E': 4,
    'F': 5,
    'G': 6,
    'H': 7,
    'I': 8,
    'J': 9,
    'K': 10,
    'L': 11,
    'M': 12,
    'N': 13,
    'O': 14,
    'P': 15,
    'Q': 16,
    'R': 17,
    'S': 18,
    'T': 19,
    'U': 20,
    'V': 21,
    'W': 22,
    'X': 23,
    'Y': 24,
    'Z': 25
}


# ============================================================
# NUMBER CLASSES
# ============================================================

number_classes = {

    '1': 0,
    '2': 1,
    '3': 2,
    '4': 3,
    '5': 4,
    '6': 5,
    '7': 6,
    '8': 7,
    '9': 8
}


# ============================================================
# MEDIAPIPE SETUP
# ============================================================

cap = cv2.VideoCapture(0)

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
# RECOGNIZED TEXT
# ============================================================

recognized_text = ""


# ============================================================
# SMOOTH / ROBUST GESTURE RECOGNITION
# ============================================================
# We keep a short history of predictions instead of trusting a
# single frame. A character is accepted only when one prediction
# dominates the recent history.
#
# IMPORTANT:
# After accepting a character, the recognizer LOCKS that character.
# It will not accept another character until the current gesture
# changes clearly or the hand is removed. This prevents:
#     O O O O O O
# and random transitions such as:
#     F L B J G K ...
#
# To type the SAME character twice (e.g. LL), briefly remove the
# hand from the camera and show the gesture again.

prediction_history = deque(maxlen=24)
confidence_history = deque(maxlen=24)

accepted_character = None
character_locked = False

# How many recent frames must agree.
MIN_HISTORY = 18

# Minimum proportion of the history occupied by the winning class.
# Example: 0.78 means at least 78% of the recent predictions agree.
MIN_DOMINANCE = 0.78

# Average confidence required for the winning character.
MIN_CONFIDENCE = 0.65

# Once a character is locked, a different prediction must remain
# stable for this many frames before we consider changing gestures.
UNLOCK_FRAMES = 12

different_prediction_count = 0
last_prediction = None


# ============================================================
# SPACE GESTURE STABILITY
# ============================================================

space_gesture_count = 0

SPACE_STABLE_FRAMES = 10

space_gesture_accepted = False


# ============================================================
# START MESSAGE
# ============================================================

print("--------------------------------------")
print(" Real-Time Sign Language Recognition")
print("--------------------------------------")
print("A      = Alphabet mode")
print("N      = Number mode")
print("👍     = Complete word + Speak")
print("      Hold one gesture = one character")
print("      Remove hand briefly to repeat the same character")
print("S      = Speak complete sentence")
print("C      = Clear text")
print("Q      = Quit")
print("--------------------------------------")


# ============================================================
# MAIN LOOP
# ============================================================

while True:

    ret, frame = cap.read()

    if not ret:

        print("Unable to access camera.")

        break


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
    # COORDINATE STORAGE
    # ========================================================

    coordinates = []

    x_Coordinates = []

    y_Coordinates = []

    z_Coordinates = []


    # ========================================================
    # HAND DETECTED
    # ========================================================

    if imgMediapipe.multi_hand_landmarks:

        # Use first detected hand
        handLandmarks = imgMediapipe.multi_hand_landmarks[0]


        # ====================================================
        # DRAW LANDMARKS
        # ====================================================

        drawing.draw_landmarks(

            frame,

            handLandmarks,

            handTracker.HAND_CONNECTIONS,

            drawingStyles.get_default_hand_landmarks_style(),

            drawingStyles.get_default_hand_connections_style()
        )


        # ====================================================
        # CHECK THUMBS-UP GESTURE
        # ====================================================

        thumbs_up = is_thumbs_up(
            handLandmarks
        )


        if thumbs_up:

            # -----------------------------------------------
            # Increase space gesture stability
            # -----------------------------------------------

            space_gesture_count += 1


            # Reset normal letter detection while the
            # space/completion gesture is active.
            prediction_history.clear()
            confidence_history.clear()

            accepted_character = None
            character_locked = False

            different_prediction_count = 0
            last_prediction = None


            # -----------------------------------------------
            # Show SPACE GESTURE
            # -----------------------------------------------

            cv2.putText(

                frame,

                "SPACE GESTURE",

                (20, 120),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.8,

                (0, 0, 0),

                2,

                cv2.LINE_AA
            )


            # -----------------------------------------------
            # Accept after stable detection
            # -----------------------------------------------

            if (
                space_gesture_count >= SPACE_STABLE_FRAMES
                and not space_gesture_accepted
            ):

                # Get the current word
                words = recognized_text.strip().split()


                if len(words) > 0:

                    current_word = words[-1]

                    print(
                        "Completed word:",
                        current_word
                    )


                    # Speak completed word
                    speak_text(
                        current_word
                    )


                    # Add space
                    recognized_text += " "


                    print(
                        "Current text:",
                        recognized_text
                    )


                else:

                    print(
                        "No word available."
                    )


                space_gesture_accepted = True


        else:

            # =================================================
            # NORMAL LETTER / NUMBER RECOGNITION
            # =================================================

            space_gesture_count = 0

            space_gesture_accepted = False


            # =================================================
            # COORDINATES
            # =================================================

            for i in range(
                len(handLandmarks.landmark)
            ):

                lm = handLandmarks.landmark[i]

                x_Coordinates.append(lm.x)

                y_Coordinates.append(lm.y)

                z_Coordinates.append(lm.z)


            # =================================================
            # NORMALIZE
            # =================================================

            data = {}

            for i, landmark in enumerate(
                handTracker.HandLandmark
            ):

                lm = handLandmarks.landmark[i]

                data[
                    f'{landmark.name}_x'
                ] = lm.x - min(x_Coordinates)

                data[
                    f'{landmark.name}_y'
                ] = lm.y - min(y_Coordinates)

                data[
                    f'{landmark.name}_z'
                ] = lm.z - min(z_Coordinates)


            coordinates.append(data)


            # =================================================
            # BOUNDING BOX
            # =================================================

            x1 = int(
                min(x_Coordinates) * width
            ) - 10

            y1 = int(
                min(y_Coordinates) * height
            ) - 10

            x2 = int(
                max(x_Coordinates) * width
            ) + 10

            y2 = int(
                max(y_Coordinates) * height
            ) + 10


            # =================================================
            # MODEL INPUT
            # =================================================

            coordinates = pd.DataFrame(
                coordinates
            )


            coordinates = np.reshape(

                coordinates.values,

                (
                    coordinates.shape[0],
                    63,
                    1
                )
            )


            coordinates = torch.from_numpy(
                coordinates
            ).float()


            # =================================================
            # SELECT MODEL + CONFIDENCE
            # =================================================

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

                    classes = number_classes

                # Convert model output to probabilities.
                probabilities = torch.softmax(outputs, dim=1)

                confidence_tensor, predicted = torch.max(
                    probabilities,
                    1
                )

                prediction_index = int(
                    predicted.cpu().numpy()[0]
                )

                prediction_confidence = float(
                    confidence_tensor.cpu().numpy()[0]
                )


            # =================================================
            # INDEX → CHARACTER
            # =================================================

            predicted_character = "?"

            for key, value in classes.items():

                if value == prediction_index:

                    predicted_character = key
                    break


            # =================================================
            # SMOOTH PREDICTIONS
            # =================================================

            prediction_history.append(
                predicted_character
            )

            confidence_history.append(
                prediction_confidence
            )

            # Most common prediction in the recent window.
            counts = Counter(prediction_history)

            candidate, candidate_count = counts.most_common(1)[0]

            candidate_dominance = (
                candidate_count / len(prediction_history)
            )

            candidate_confidences = [
                confidence_history[i]
                for i, char in enumerate(prediction_history)
                if char == candidate
            ]

            average_confidence = (
                sum(candidate_confidences)
                / len(candidate_confidences)
                if candidate_confidences
                else 0.0
            )


            # =================================================
            # CHARACTER LOCK / GESTURE CHANGE
            # =================================================

            if character_locked:

                # We have already accepted this gesture.
                # Do NOT keep adding the same character.
                if candidate != accepted_character:

                    if candidate == last_prediction:
                        different_prediction_count += 1
                    else:
                        last_prediction = candidate
                        different_prediction_count = 1

                    # A clearly different gesture has appeared.
                    # Unlock only after it remains stable.
                    if different_prediction_count >= UNLOCK_FRAMES:

                        character_locked = False
                        accepted_character = None
                        different_prediction_count = 0
                        prediction_history.clear()
                        confidence_history.clear()

                else:

                    different_prediction_count = 0

            else:

                # We are ready to accept a new character.
                if (
                    len(prediction_history) >= MIN_HISTORY
                    and candidate_dominance >= MIN_DOMINANCE
                    and average_confidence >= MIN_CONFIDENCE
                ):

                    recognized_text += candidate

                    accepted_character = candidate
                    character_locked = True

                    different_prediction_count = 0

                    print(
                        "Recognized:",
                        candidate
                    )

                    print(
                        "Confidence:",
                        round(average_confidence, 2)
                    )

                    print(
                        "Current text:",
                        recognized_text
                    )

                    # Start a fresh history so the accepted gesture
                    # cannot immediately trigger another character.
                    prediction_history.clear()
                    confidence_history.clear()


            # =================================================
            # RECOGNITION STATUS
            # =================================================

            if character_locked:

                status_text = (
                    "LOCKED: "
                    + str(accepted_character)
                    + " | Change gesture"
                )

            else:

                status_text = (
                    "Scanning... "
                    + str(candidate)
                    + " "
                    + str(round(candidate_dominance * 100))
                    + "%"
                )

            cv2.putText(
                frame,
                status_text,
                (20, 120),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (0, 0, 0),
                2,
                cv2.LINE_AA
            )


            # =================================================
            # DRAW BOUNDING BOX
            # =================================================

            cv2.rectangle(

                frame,

                (x1, y1),

                (x2, y2),

                (0, 0, 0),

                4
            )


            # =================================================
            # DISPLAY PREDICTION
            # =================================================

            cv2.putText(

                frame,

                predicted_character,

                (x1, y1 - 10),

                cv2.FONT_HERSHEY_SIMPLEX,

                1.3,

                (0, 0, 0),

                3,

                cv2.LINE_AA
            )


    else:

        # ====================================================
        # NO HAND
        # ====================================================

        # No hand = user has released the current gesture.
        # This fully re-arms the recognizer.
        prediction_history.clear()
        confidence_history.clear()

        accepted_character = None
        character_locked = False

        different_prediction_count = 0
        last_prediction = None

        space_gesture_count = 0
        space_gesture_accepted = False


    # ========================================================
    # CURRENT MODE
    # ========================================================

    if mode == "alphabet":

        mode_text = "MODE: ALPHABET (A-Z)"

    else:

        mode_text = "MODE: NUMBER (1-9)"


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
    # DISPLAY TEXT
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
    # INSTRUCTIONS
    # ========================================================

    cv2.putText(

        frame,

        "👍 SPACE = Complete Word + Speak",

        (20, height - 45),

        cv2.FONT_HERSHEY_SIMPLEX,

        0.55,

        (0, 0, 0),

        2,

        cv2.LINE_AA
    )


    cv2.putText(

        frame,

        "S = Speak All   C = Clear   Q = Quit",

        (20, height - 20),

        cv2.FONT_HERSHEY_SIMPLEX,

        0.55,

        (0, 0, 0),

        2,

        cv2.LINE_AA
    )


    # ========================================================
    # SHOW FRAME
    # ========================================================

    cv2.imshow(

        "Real-Time Sign Language Recognition",

        frame
    )


    # ========================================================
    # KEYBOARD
    # ========================================================

    key = cv2.waitKey(1) & 0xFF


    # ========================================================
    # ALPHABET MODE
    # ========================================================

    if key == ord('a') or key == ord('A'):

        mode = "alphabet"

        prediction_history.clear()
        confidence_history.clear()

        accepted_character = None
        character_locked = False

        different_prediction_count = 0
        last_prediction = None

        print(
            "Switched to ALPHABET mode"
        )


    # ========================================================
    # NUMBER MODE
    # ========================================================

    elif key == ord('n') or key == ord('N'):

        mode = "number"

        prediction_history.clear()
        confidence_history.clear()

        accepted_character = None
        character_locked = False

        different_prediction_count = 0
        last_prediction = None

        print(
            "Switched to NUMBER mode"
        )


    # ========================================================
    # S = SPEAK COMPLETE SENTENCE
    # ========================================================

    elif key == ord('s') or key == ord('S'):

        if recognized_text.strip():

            print(
                "Speaking complete sentence:",
                recognized_text
            )

            speak_text(
                recognized_text
            )

        else:

            print(
                "No text available to speak."
            )


    # ========================================================
    # C = CLEAR
    # ========================================================

    elif key == ord('c') or key == ord('C'):

        recognized_text = ""

        print(
            "Text cleared."
        )


    # ========================================================
    # Q = QUIT
    # ========================================================

    elif key == ord('q') or key == ord('Q'):

        break


# ============================================================
# RELEASE
# ============================================================

cap.release()

cv2.destroyAllWindows()