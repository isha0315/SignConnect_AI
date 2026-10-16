import logging

import cv2
import mediapipe as mp
import torch
import numpy as np

logger = logging.getLogger("signconnect.recognition")

from CNNModel import CNNModel


class SignRecognitionService:
    """
    Reusable sign-language recognition engine.

    IMPORTANT:
    - Uses the existing trained CNN models.
    - Does NOT retrain anything.
    - Does NOT modify the .pth files.
    - Keeps the same MediaPipe landmark preprocessing
      used by the existing sign_language_client.py.
    """

    def __init__(self):

        logger.info("Loading sign-language models...")

        # ------------------------------------------------------
        # Alphabet model
        # ------------------------------------------------------

        self.alphabet_model = CNNModel()

        self.alphabet_model.load_state_dict(
            torch.load(
                "CNN_model_alphabet_SIBI.pth",
                map_location=torch.device("cpu")
            )
        )

        self.alphabet_model.eval()

        logger.info("Alphabet model loaded.")

        # ------------------------------------------------------
        # Number model
        # ------------------------------------------------------

        self.number_model = CNNModel()

        self.number_model.load_state_dict(
            torch.load(
                "CNN_model_number_SIBI.pth",
                map_location=torch.device("cpu")
            )
        )

        self.number_model.eval()

        logger.info("Number model loaded.")

        # ------------------------------------------------------
        # Cached index-to-class lookups (avoid per-frame dict scan)
        # ------------------------------------------------------

        self.alphabet_idx_to_class = {
            0: "A", 1: "B", 2: "C", 3: "D", 4: "E", 5: "F",
            6: "G", 7: "H", 8: "I", 9: "J", 10: "K", 11: "L",
            12: "M", 13: "N", 14: "O", 15: "P", 16: "Q", 17: "R",
            18: "S", 19: "T", 20: "U", 21: "V", 22: "W",
            23: "X", 24: "Y", 25: "Z"
        }

        self.number_idx_to_class = {
            0: "1", 1: "2", 2: "3", 3: "4", 4: "5",
            5: "6", 6: "7", 7: "8", 8: "9"
        }

        # ------------------------------------------------------
        # Pre-allocate tensor for inference (shape 1, 63, 1)
        # ------------------------------------------------------

        self.input_tensor = torch.zeros(
            (1, 63, 1), dtype=torch.float32
        )

        # ------------------------------------------------------
        # Temporal EMA smoothing state (per-client)
        # ------------------------------------------------------

        self.ema_states = {}
        self.alpha = 0.5

        # ------------------------------------------------------
        # MediaPipe — tuned for stability
        # ------------------------------------------------------

        self.hand_tracker = mp.solutions.hands

        self.hand_detector = self.hand_tracker.Hands(
            static_image_mode=False,
            max_num_hands=1,
            model_complexity=1,
            min_detection_confidence=0.6,
            min_tracking_confidence=0.6
        )

        logger.info("MediaPipe initialized.")

    # ==========================================================
    # SPECIAL GESTURES CLASSIFIER (STICKERS / DIRECT SIGNS)
    # ==========================================================

    def classify_special_gesture(self, hand_landmarks):
        """
        Classify hand pose into special sticker gesture words using 3D geometry.
        Returns: (gesture_name, confidence) or (None, 0)
        """
        lms = hand_landmarks.landmark
        if len(lms) < 21:
            return None, 0

        import math
        def dist(p1, p2):
            return math.hypot(p1.x - p2.x, p1.y - p2.y)

        wrist = lms[0]
        thumb_cmc, thumb_mcp, thumb_ip, thumb_tip = lms[1], lms[2], lms[3], lms[4]
        index_mcp, index_pip, index_dip, index_tip = lms[5], lms[6], lms[7], lms[8]
        middle_mcp, middle_pip, middle_dip, middle_tip = lms[9], lms[10], lms[11], lms[12]
        ring_mcp, ring_pip, ring_dip, ring_tip = lms[13], lms[14], lms[15], lms[16]
        pinky_mcp, pinky_pip, pinky_dip, pinky_tip = lms[17], lms[18], lms[19], lms[20]

        # Robust hand size: immune to wrist foreshortening
        palm_width = dist(index_mcp, pinky_mcp)
        hand_size = max(0.01, dist(wrist, middle_mcp), palm_width * 1.2)

        # A finger is extended upright if tip is higher than pip and tip distance from mcp > 1.08 * pip distance
        def is_up(mcp, pip, tip):
            return (tip.y < pip.y) and (dist(tip, mcp) > dist(pip, mcp) * 1.08)

        index_up = is_up(index_mcp, index_pip, index_tip)
        middle_up = is_up(middle_mcp, middle_pip, middle_tip)
        ring_up = is_up(ring_mcp, ring_pip, ring_tip)
        pinky_up = is_up(pinky_mcp, pinky_pip, pinky_tip)

        # Fist condition: none of the 4 fingers are pointing upright
        fist_closed = (not index_up) and (not middle_up) and (not ring_up) and (not pinky_up)

        # Thumb extension: thumb tip is separated from knuckles
        thumb_ext = dist(thumb_tip, thumb_mcp) > hand_size * 0.28

        # Thumb direction (Screen Y coordinates: increases downwards)
        thumb_pointing_down = (
            thumb_ext and 
            (thumb_tip.y > thumb_ip.y) and 
            (thumb_tip.y > thumb_mcp.y + hand_size * 0.08) and 
            (thumb_tip.y > index_mcp.y)
        )
        thumb_pointing_up = (
            thumb_ext and 
            (thumb_tip.y < thumb_ip.y) and 
            (thumb_tip.y < thumb_mcp.y - hand_size * 0.08) and 
            (thumb_tip.y < index_mcp.y)
        )

        # 1. NO (Thumbs Down)
        if thumb_pointing_down and fist_closed:
            return "NO", 97

        # 2. YES (Thumbs Up)
        if thumb_pointing_up and fist_closed:
            return "YES", 97

        # 3. I LOVE YOU (Thumb + Index + Pinky extended upright, Middle + Ring curled)
        if thumb_ext and index_up and (not middle_up) and (not ring_up) and pinky_up:
            return "I LOVE YOU", 98

        # 4. STOP (All 5 fingers extended upright spread wide or flat palm)
        if thumb_ext and index_up and middle_up and ring_up and pinky_up:
            spread = (dist(index_tip, middle_tip) + dist(middle_tip, ring_tip) + dist(ring_tip, pinky_tip)) / hand_size
            if spread > 0.35:
                return "STOP", 96
            return "STOP", 92

        # 5. WATER (W sign: Index, Middle, Ring extended upright, Pinky curled)
        if index_up and middle_up and ring_up and (not pinky_up):
            return "WATER", 96

        # 6. GOOD MORNING (V / Peace sign: Index + Middle extended upright, Ring + Pinky curled)
        if index_up and middle_up and (not ring_up) and (not pinky_up):
            return "GOOD MORNING", 95

        # 7. NICE TO MEET YOU (OK sign: Pinch Thumb & Index, 3 others extended)
        pinch = dist(thumb_tip, index_tip) < hand_size * 0.32
        if pinch and middle_up and ring_up and pinky_up:
            return "NICE TO MEET YOU", 96

        # 8. HOW ARE YOU (Shaka: Thumb + Pinky extended, 3 others curled)
        if thumb_ext and pinky_up and (not index_up) and (not middle_up) and (not ring_up):
            return "HOW ARE YOU", 95

        return None, 0

    # ==========================================================
    # PROCESS FRAME
    # ==========================================================

    def recognize(self, frame, mode="alphabet", sid=None):

        """
        Receive one BGR OpenCV frame.

        Returns:

        {
            "character": "H",
            "confidence": 94,
            "hand_detected": True
        }

        If no hand is detected:

        {
            "character": "—",
            "confidence": 0,
            "hand_detected": False
        }
        """

        if frame is None:

            return {
                "character": "—",
                "confidence": 0,
                "hand_detected": False
            }

        # ------------------------------------------------------
        # BGR -> RGB
        # ------------------------------------------------------

        frame_rgb = cv2.cvtColor(
            frame,
            cv2.COLOR_BGR2RGB
        )

        # ------------------------------------------------------
        # MediaPipe
        # ------------------------------------------------------

        result = self.hand_detector.process(
            frame_rgb
        )

        if not result.multi_hand_landmarks:
            # Reset EMA state when hand disappears
            if sid and sid in self.ema_states:
                del self.ema_states[sid]

            return {
                "character": "—",
                "confidence": 0,
                "hand_detected": False
            }

        # ------------------------------------------------------
        # First detected hand
        # ------------------------------------------------------

        hand_landmarks = (
            result.multi_hand_landmarks[0]
        )

        # Build landmarks list for client-side skeleton overlay (#10)
        landmarks_list = []
        for lm in hand_landmarks.landmark:
            landmarks_list.append({
                "x": round(lm.x, 4),
                "y": round(lm.y, 4),
                "z": round(lm.z, 4)
            })

        # Strict Mode Isolation:
        # Special gestures are ONLY evaluated when the user has explicitly selected the 'gesture' / 'special' tab.
        # When in Alphabet (mode="alphabet") or Numbers (mode="number"), gestures are completely bypassed.
        if mode in ("gesture", "special"):
            special_gesture, gesture_conf = self.classify_special_gesture(hand_landmarks)
            if special_gesture and gesture_conf >= 70:
                return {
                    "character": special_gesture,
                    "confidence": gesture_conf,
                    "hand_detected": True,
                    "landmarks": landmarks_list,
                    "is_gesture": True,
                    "gesture": special_gesture
                }
            return {
                "character": "—",
                "confidence": 0,
                "hand_detected": True,
                "landmarks": landmarks_list,
                "is_gesture": True
            }


        # ------------------------------------------------------
        # EXACT SAME NORMALIZATION AS TRAINING (handLandMarks.py)
        #
        # Training code builds a dict with keys in this order:
        #   WRIST_x, WRIST_y, WRIST_z, THUMB_CMC_x, ...
        # Then pd.DataFrame([data]).values flattens to that order.
        #
        # We replicate that EXACT order here using numpy:
        #   1. Collect x_coords, y_coords, z_coords separately
        #   2. Compute per-axis minimums independently
        #   3. Build the 63-element feature array in the same
        #      interleaved order: x0,y0,z0, x1,y1,z1, ...
        # ------------------------------------------------------

        x_coords = np.empty(21, dtype=np.float32)
        y_coords = np.empty(21, dtype=np.float32)
        z_coords = np.empty(21, dtype=np.float32)

        for i in range(21):
            lm = hand_landmarks.landmark[i]
            x_coords[i] = lm.x
            y_coords[i] = lm.y
            z_coords[i] = lm.z

        # Per-axis min (same as training: min(x_Coordinates), etc.)
        x_min = x_coords.min()
        y_min = y_coords.min()
        z_min = z_coords.min()

        # Build 63-element feature vector in training order:
        # [WRIST_x-xmin, WRIST_y-ymin, WRIST_z-zmin,
        #  THUMB_CMC_x-xmin, THUMB_CMC_y-ymin, THUMB_CMC_z-zmin, ...]
        features = np.empty(63, dtype=np.float32)
        for i in range(21):
            features[i * 3]     = x_coords[i] - x_min
            features[i * 3 + 1] = y_coords[i] - y_min
            features[i * 3 + 2] = z_coords[i] - z_min

        # ------------------------------------------------------
        # Temporal EMA smoothing (reduces jitter/flicker)
        # ------------------------------------------------------

        if sid is not None:
            if sid not in self.ema_states:
                self.ema_states[sid] = features.copy()
            else:
                self.ema_states[sid] = (
                    self.alpha * features
                    + (1 - self.alpha) * self.ema_states[sid]
                )
            features = self.ema_states[sid]

        # ------------------------------------------------------
        # Copy to pre-allocated tensor: CNN expects (1, 63, 1)
        # ------------------------------------------------------

        self.input_tensor[0, :, 0] = torch.from_numpy(features)

        # ------------------------------------------------------
        # Select model
        # ------------------------------------------------------

        if mode == "number":
            model = self.number_model
            idx_to_class = self.number_idx_to_class
        else:
            model = self.alphabet_model
            idx_to_class = self.alphabet_idx_to_class

        # ------------------------------------------------------
        # Prediction (torch.inference_mode is faster than no_grad)
        # ------------------------------------------------------

        with torch.inference_mode():

            outputs = model(self.input_tensor)

            if mode == "number":
                # Ensure we only slice if the model outputs more than 9 classes
                # (backward compat for older 26-class models)
                if outputs.shape[1] > 9:
                    outputs = outputs[:, :9]
            probabilities = torch.softmax(
                outputs, dim=1
            )[0]

            # --------------------------------------------------
            # Top-2 confidence margin rejection
            # If top1 and top2 are too close, the prediction
            # is ambiguous — reject it instead of returning
            # a wrong character.
            # --------------------------------------------------

            top2_probs, top2_indices = torch.topk(
                probabilities, 2
            )

            top1_prob = top2_probs[0].item()
            top2_prob = top2_probs[1].item()

            # Relax margin for 9-class number predictions to avoid false rejections
            margin = 0.06 if mode == "number" else 0.15

            if (top1_prob - top2_prob) < margin:
                return {
                    "character": "—",
                    "confidence": 0,
                    "hand_detected": True
                }

            confidence = top1_prob * 100
            prediction_index = top2_indices[0].item()

        character = idx_to_class.get(prediction_index, "?")

        # Build landmarks list for client-side skeleton overlay (#10)
        landmarks_list = []
        for lm in hand_landmarks.landmark:
            landmarks_list.append({
                "x": round(lm.x, 4),
                "y": round(lm.y, 4),
                "z": round(lm.z, 4)
            })

        return {
            "character": character,
            "confidence": round(confidence),
            "hand_detected": True,
            "landmarks": landmarks_list
        }

    # ==========================================================
    # CLEANUP
    # ==========================================================

    def clear_client(self, sid):
        """Clear EMA state for a specific client to prevent memory leaks."""
        if sid in self.ema_states:
            del self.ema_states[sid]

    def close(self):

        try:

            self.hand_detector.close()

        except Exception:

            pass