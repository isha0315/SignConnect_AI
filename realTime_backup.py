import cv2
import mediapipe
import torch
import pandas as pd
import numpy as np
from CNNModel import CNNModel


# ============================================================
# LOAD BOTH TRAINED MODELS
# ============================================================

alphabet_model = CNNModel()
alphabet_model.load_state_dict(
    torch.load("CNN_model_alphabet_SIBI.pth", map_location=torch.device("cpu"))
)
alphabet_model.eval()

number_model = CNNModel()
number_model.load_state_dict(
    torch.load("CNN_model_number_SIBI.pth", map_location=torch.device("cpu"))
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
    static_image_mode=True,
    min_detection_confidence=0.2
)


# ============================================================
# STARTING MODE
# ============================================================

mode = "alphabet"

print("--------------------------------------")
print(" Real-Time Sign Language Recognition")
print("--------------------------------------")
print("Press A = Alphabet mode")
print("Press N = Number mode")
print("Press Q = Quit")
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

    # Convert BGR → RGB for MediaPipe
    frameRGB = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    imgMediapipe = handDetector.process(frameRGB)

    # Store coordinates
    coordinates = []
    x_Coordinates = []
    y_Coordinates = []
    z_Coordinates = []


    # ========================================================
    # HAND DETECTED
    # ========================================================

    if imgMediapipe.multi_hand_landmarks:

        for handLandmarks in imgMediapipe.multi_hand_landmarks:

            # Draw hand landmarks
            drawing.draw_landmarks(
                frame,
                handLandmarks,
                handTracker.HAND_CONNECTIONS,
                drawingStyles.get_default_hand_landmarks_style(),
                drawingStyles.get_default_hand_connections_style()
            )

            data = {}

            # ------------------------------------------------
            # Get landmark coordinates
            # ------------------------------------------------

            for i in range(len(handLandmarks.landmark)):

                lm = handLandmarks.landmark[i]

                x_Coordinates.append(lm.x)
                y_Coordinates.append(lm.y)
                z_Coordinates.append(lm.z)


            # ------------------------------------------------
            # Normalize coordinates
            # ------------------------------------------------

            for i, landmark in enumerate(handTracker.HandLandmark):

                lm = handLandmarks.landmark[i]

                data[f'{landmark.name}_x'] = (
                    lm.x - min(x_Coordinates)
                )

                data[f'{landmark.name}_y'] = (
                    lm.y - min(y_Coordinates)
                )

                data[f'{landmark.name}_z'] = (
                    lm.z - min(z_Coordinates)
                )

            coordinates.append(data)


        # ====================================================
        # BOUNDING BOX
        # ====================================================

        x1 = int(min(x_Coordinates) * width) - 10
        y1 = int(min(y_Coordinates) * height) - 10

        x2 = int(max(x_Coordinates) * width) - 10
        y2 = int(max(y_Coordinates) * height) - 10


        # ====================================================
        # CONVERT LANDMARKS TO MODEL INPUT
        # ====================================================

        coordinates = pd.DataFrame(coordinates)

        coordinates = np.reshape(
            coordinates.values,
            (coordinates.shape[0], 63, 1)
        )

        coordinates = torch.from_numpy(
            coordinates
        ).float()


        # ====================================================
        # SELECT MODEL BASED ON MODE
        # ====================================================

        with torch.no_grad():

            if mode == "alphabet":

                outputs = alphabet_model(coordinates)

                classes = alphabet_classes

            else:

                outputs = number_model(coordinates)

                classes = number_classes


            # Get prediction
            _, predicted = torch.max(outputs.data, 1)

            predictions = predicted.cpu().numpy()


        # ====================================================
        # CONVERT PREDICTION NUMBER TO CHARACTER
        # ====================================================

        predicted_character = "?"

        for key, value in classes.items():

            if value == predictions[0]:

                predicted_character = key
                break


        # ====================================================
        # DRAW BOUNDING BOX
        # ====================================================

        cv2.rectangle(
            frame,
            (x1, y1),
            (x2, y2),
            (0, 0, 0),
            4
        )


        # ====================================================
        # DISPLAY PREDICTION
        # ====================================================

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


    # ========================================================
    # DISPLAY CURRENT MODE
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
        0.9,
        (0, 0, 0),
        2,
        cv2.LINE_AA
    )


    # ========================================================
    # DISPLAY INSTRUCTIONS
    # ========================================================

    cv2.putText(
        frame,
        "A: Alphabet   N: Numbers   Q: Quit",
        (20, height - 20),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 0, 0),
        2,
        cv2.LINE_AA
    )


    # ========================================================
    # SHOW FRAME
    # ========================================================

    cv2.imshow("frame", frame)


    # ========================================================
    # KEYBOARD CONTROLS
    # ========================================================

    key = cv2.waitKey(1) & 0xFF

    if key == ord('a') or key == ord('A'):

        mode = "alphabet"
        print("Switched to ALPHABET mode")


    elif key == ord('n') or key == ord('N'):

        mode = "number"
        print("Switched to NUMBER mode")


    elif key == ord('q') or key == ord('Q'):

        break


# ============================================================
# RELEASE RESOURCES
# ============================================================

cap.release()
cv2.destroyAllWindows()