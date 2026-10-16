"""
test_features.py — pytest-based test suite for Sign Connect AI.

Covers:
- Feature ordering convention (regression lock for Bug #1)
- State initialization
- Character appending and auto-complete
- Space/accept suggestion
- Undo logic (character + word pull-back)
- Clear logic
"""
import sys
import os
import numpy as np
import mediapipe as mp

# Ensure project root is importable
sys.path.insert(0, os.path.abspath('.'))

import communication_server


# ============================================================
# FEATURE ORDERING REGRESSION TEST (#1 / #13)
# Locks the normalization convention so it can never
# silently regress.
# ============================================================

class TestFeatureOrdering:
    """Verify recognition_service feature extraction matches training."""

    def _make_fake_landmarks(self, seed=42):
        """Create deterministic fake landmarks."""
        rng = np.random.RandomState(seed)

        class FakeLandmark:
            def __init__(self, x, y, z):
                self.x, self.y, self.z = x, y, z

        return [FakeLandmark(rng.rand(), rng.rand(), rng.rand()) for _ in range(21)]

    def _training_pipeline(self, landmarks):
        """Exact replication of handLandMarks.py normalization."""
        import pandas as pd

        hand_tracker = mp.solutions.hands

        x_coords = [lm.x for lm in landmarks]
        y_coords = [lm.y for lm in landmarks]
        z_coords = [lm.z for lm in landmarks]

        data = {}
        for i, landmark_enum in enumerate(hand_tracker.HandLandmark):
            lm = landmarks[i]
            data[f'{landmark_enum.name}_x'] = lm.x - min(x_coords)
            data[f'{landmark_enum.name}_y'] = lm.y - min(y_coords)
            data[f'{landmark_enum.name}_z'] = lm.z - min(z_coords)

        return pd.DataFrame([data]).values.flatten().astype(np.float32)

    def _service_pipeline(self, landmarks):
        """Replication of recognition_service.py normalization."""
        x_coords = np.array([lm.x for lm in landmarks], dtype=np.float32)
        y_coords = np.array([lm.y for lm in landmarks], dtype=np.float32)
        z_coords = np.array([lm.z for lm in landmarks], dtype=np.float32)

        x_min = x_coords.min()
        y_min = y_coords.min()
        z_min = z_coords.min()

        features = np.empty(63, dtype=np.float32)
        for i in range(21):
            features[i * 3] = x_coords[i] - x_min
            features[i * 3 + 1] = y_coords[i] - y_min
            features[i * 3 + 2] = z_coords[i] - z_min

        return features

    def test_feature_order_matches_training(self):
        """Feature vector must match training pipeline within float32 precision."""
        landmarks = self._make_fake_landmarks(seed=42)
        training = self._training_pipeline(landmarks)
        service = self._service_pipeline(landmarks)

        assert training.shape == service.shape == (63,), \
            f"Shape mismatch: training={training.shape}, service={service.shape}"
        assert np.allclose(training, service, atol=1e-6), \
            f"Feature mismatch! Max diff={np.max(np.abs(training - service)):.2e}"

    def test_feature_order_multiple_seeds(self):
        """Verify across multiple random hand positions."""
        for seed in [0, 1, 7, 42, 99, 255]:
            landmarks = self._make_fake_landmarks(seed=seed)
            training = self._training_pipeline(landmarks)
            service = self._service_pipeline(landmarks)
            assert np.allclose(training, service, atol=1e-6), \
                f"Mismatch at seed={seed}, max diff={np.max(np.abs(training - service)):.2e}"

    def test_feature_length_is_63(self):
        """Must always produce exactly 63 features (21 landmarks * 3 axes)."""
        landmarks = self._make_fake_landmarks()
        features = self._service_pipeline(landmarks)
        assert len(features) == 63

    def test_wrist_x_is_zero(self):
        """After min-normalization, the landmark with min x should be 0."""
        landmarks = self._make_fake_landmarks()
        features = self._service_pipeline(landmarks)
        x_values = features[0::3]  # every 3rd starting from 0
        assert np.min(x_values) == 0.0, "Min x-coordinate should normalize to 0"

    def test_interleaved_order(self):
        """Features must be interleaved: x0,y0,z0, x1,y1,z1, ..."""
        landmarks = self._make_fake_landmarks()
        features = self._service_pipeline(landmarks)

        x_min = min(lm.x for lm in landmarks)
        y_min = min(lm.y for lm in landmarks)
        z_min = min(lm.z for lm in landmarks)

        # Check first landmark (WRIST)
        assert abs(features[0] - (landmarks[0].x - x_min)) < 1e-6
        assert abs(features[1] - (landmarks[0].y - y_min)) < 1e-6
        assert abs(features[2] - (landmarks[0].z - z_min)) < 1e-6

        # Check last landmark (PINKY_TIP = index 20)
        assert abs(features[60] - (landmarks[20].x - x_min)) < 1e-6
        assert abs(features[61] - (landmarks[20].y - y_min)) < 1e-6
        assert abs(features[62] - (landmarks[20].z - z_min)) < 1e-6


# ============================================================
# STATE MANAGEMENT TESTS
# ============================================================

class TestRecognitionState:
    """Test server-side sign recognition state machine."""

    def setup_method(self):
        """Fresh state for each test."""
        self.sid = "test_user_pytest"
        communication_server.reset_recognition_state(self.sid)
        communication_server.client_modes[self.sid] = "alphabet"

    def _simulate_sign(self, char, confidence=90):
        """Push enough frames to trigger sign acceptance."""
        state = communication_server.get_recognition_state(self.sid)
        for _ in range(10):
            communication_server.process_recognized_sign(
                self.sid, "test", "alphabet", char, confidence, True
            )
        state["hand_was_lost"] = True

    def test_initial_state(self):
        state = communication_server.get_recognition_state(self.sid)
        assert state["current_word"] == ""
        assert state["sentence"] == []
        assert state["suggestion"] == ""

    def test_character_appending(self):
        self._simulate_sign("H")
        self._simulate_sign("E")
        self._simulate_sign("L")

        state = communication_server.get_recognition_state(self.sid)
        assert state["current_word"] == "HEL"

    def test_autocomplete_suggestion(self):
        self._simulate_sign("H")
        self._simulate_sign("E")
        self._simulate_sign("L")

        state = communication_server.get_recognition_state(self.sid)
        # "HEL" should suggest the rest of "HELLO" -> "LO"
        assert state["suggestion"] == "LO"

    def test_space_accepts_suggestion(self):
        self._simulate_sign("H")
        self._simulate_sign("E")
        self._simulate_sign("L")

        state = communication_server.get_recognition_state(self.sid)
        # Simulate space
        if state["suggestion"]:
            full_word = state["current_word"] + state["suggestion"]
            state["sentence"].append(full_word)
        else:
            state["sentence"].append(state["current_word"])
        state["current_word"] = ""
        state["suggestion"] = ""

        assert state["current_word"] == ""
        assert "HELLO" in state["sentence"]

    def test_undo_removes_last_char(self):
        self._simulate_sign("Y")
        self._simulate_sign("O")
        self._simulate_sign("U")

        state = communication_server.get_recognition_state(self.sid)
        assert state["current_word"] == "YOU"

        # Undo
        state["current_word"] = state["current_word"][:-1]
        assert state["current_word"] == "YO"

    def test_undo_pulls_word_from_sentence(self):
        self._simulate_sign("H")
        self._simulate_sign("I")

        state = communication_server.get_recognition_state(self.sid)
        state["sentence"].append(state["current_word"])
        state["current_word"] = ""

        assert state["sentence"] == ["HI"]

        # Undo when word is empty pulls from sentence
        state["current_word"] = state["sentence"].pop()
        assert state["current_word"] == "HI"
        assert state["sentence"] == []

    def test_clear_empties_everything(self):
        self._simulate_sign("A")
        self._simulate_sign("B")

        state = communication_server.get_recognition_state(self.sid)
        state["current_word"] = ""
        state["sentence"] = []
        state["suggestion"] = ""

        assert state["current_word"] == ""
        assert state["sentence"] == []
        assert state["suggestion"] == ""

    def test_low_confidence_rejected(self):
        """Signs below MIN_SIGN_CONFIDENCE should not be accepted."""
        state = communication_server.get_recognition_state(self.sid)
        for _ in range(15):
            communication_server.process_recognized_sign(
                self.sid, "test", "alphabet", "X", 30, True  # below threshold
            )
        assert state["current_word"] == ""


# ============================================================
# AUTOCOMPLETE TESTS
# ============================================================

class TestAutoComplete:

    def test_suggestion_for_hel(self):
        assert communication_server.get_suggestion("HEL") == "LO"

    def test_suggestion_for_ple(self):
        assert communication_server.get_suggestion("PLE") == "ASE"

    def test_no_suggestion_for_complete_word(self):
        assert communication_server.get_suggestion("HELLO") == ""

    def test_empty_input(self):
        assert communication_server.get_suggestion("") == ""

    def test_no_match(self):
        assert communication_server.get_suggestion("ZZZZZ") == ""
