# Sign Connect AI 🤟
### Next-Generation Real-Time AI Sign Language Recognition & WebRTC Video Communication Platform

[![Python](https://img.shields.io/badge/Python-3.10%20%7C%203.11%20%7C%203.12-blue.svg)](https://www.python.org/)
[![PyTorch](https://img.shields.io/badge/PyTorch-2.14-ee4c2c.svg)](https://pytorch.org/)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-0.10-00c853.svg)](https://mediapipe.dev/)
[![WebRTC](https://img.shields.io/badge/WebRTC-P2P%20Encrypted-333333.svg)](https://webrtc.org/)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

**Sign Connect AI** is an advanced assistive telecommunications platform engineered to bridge the digital divide between deaf / hard-of-hearing sign language users and non-signing individuals during live video calls.

Combining **Google MediaPipe**, **PyTorch 1D Convolutional Neural Networks (CNN)**, **WebRTC P2P mesh**, and **NLP grammar smoothing**, the platform enables signers to make natural hand gestures in front of a standard webcam and have them translated, smoothed, spoken aloud via Text-to-Speech, and streamed over encrypted video in real time.

---

## 🌟 Key Features

- **⚡ Real-Time Hand Landmark Tracking:** MediaPipe 21 3D hand joints tracked at 30+ FPS with sub-50ms latency.
- **🧠 Deep Learning Classification:** 
  - **A–Z Alphabets:** Trained SIBI / ISL 1D-CNN model (`CNN_model_alphabet_SIBI.pth`).
  - **1–9 Numbers:** Trained numeric 1D-CNN model (`CNN_model_number_SIBI.pth`).
  - **Special Expressive Gestures:** 3D geometric heuristic classification for *YES*, *NO*, *I LOVE YOU*, *STOP*, *WATER*, *GOOD MORNING*, *NICE TO MEET YOU*, *HOW ARE YOU*.
- **📹 Peer-to-Peer WebRTC Video Calling:** Room-scoped encrypted audio/video calling with Google STUN NAT traversal.
- **✨ Expressive Multimodal Feedback:**
  - Client-side 21-point neon skeleton overlay.
  - Room-wide animated visual stickers triggered by gestures.
  - Bidirectional Text-to-Speech (TTS Proxy) with Indian English and Hindi audio support.
- **✍️ NLP Autocomplete & Grammar Smoothing:**
  - Prefix trie ghost-text completions.
  - Contextual sentence recommendation chips.
  - Telegraphic sign expansion (*"I GO STORE"* &rarr; *"I am going to the store."*).
  - Debounced grammar correction using LanguageTool.
- **🔒 Reconnection Resilience:** Cryptographically secure session tokens preserve in-progress sentences and state across network hiccups.
- **🌐 Zero-Config Global Access:** Bundled Cloudflare Tunnel (`cloudflared.exe`) allows instant multi-device video calls across mobile phones and PCs without port forwarding.

---

## 📁 Project Structure

```text
Sign Language Recognition/
├── communication_server.py        # Main production server & orchestrator
├── recognition_service.py         # PyTorch CNN inference & MediaPipe CV engine
├── CNNModel.py                    # 6-layer 1D-CNN neural network architecture
├── CNN_model_alphabet_SIBI.pth    # Trained alphabet weights (A-Z)
├── CNN_model_number_SIBI.pth      # Trained numeric weights (1-9)
├── test_features.py               # Automated pytest regression suite (12 tests)
├── requirements.txt               # Pinned Python package dependencies
├── cloudflared.exe                # Cloudflare Tunnel for multi-device public URLs
├── SignConnect_AI_Complete_Documentation.pdf # 25-page comprehensive technical manual
├── routes/
│   └── http_routes.py             # HTTP endpoints (/, /health, /api/tts, /preview)
├── services/
│   ├── inference_worker.py        # Asynchronous background AI worker thread
│   └── state_manager.py           # Per-user session tokens & reconnection state
├── sockets/
│   └── events.py                  # WebRTC signaling, AI frame handling & room events
├── nlp/
│   ├── autocomplete.py            # Word/Sentence suggestions & lexical dictionary
│   └── smoothing.py               # Telegraphic expansion & debounced LanguageTool
├── static/
│   ├── css/communication.css      # Glassmorphism dark/light stylesheet
│   ├── js/communication.js        # WebRTC, camera control, Socket.IO & UI logic
│   └── img/stickers/              # Animated communicative sticker graphics
├── templates/
│   ├── communication.html         # Main dashboard interface
│   └── communication_dark.html    # Dark mode variant preview
└── frontend/                      # Optional React 19 + Vite frontend
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Python 3.10, 3.11, or 3.12** installed on your system.
- Standard HD Webcam & Google Chrome or Microsoft Edge.

### 2. Setup Virtual Environment & Install Dependencies
Open a terminal in the project directory:

```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows PowerShell:
.\venv\Scripts\Activate.ps1
# Linux / macOS:
source venv/bin/activate

# Install required packages
pip install -r requirements.txt
```

### 3. Verify Installation (Optional)
Run the automated test suite to ensure PyTorch and landmark normalization work properly:
```bash
python test_features.py
```

### 4. Launch the Server
```bash
python communication_server.py
```
Open your browser and visit:
👉 **`http://localhost:5000`**

### Available Interface Variants:
* **Standard Production UI:** [`http://localhost:5000/`](http://localhost:5000/) — Clean, responsive production communication dashboard.
* **Extended Test UI Studio:** [`http://localhost:5000/test-ui`](http://localhost:5000/test-ui) — Feature testing harness with simulated controls and diagnostics.
* **Dark Mode Preview:** [`http://localhost:5000/preview`](http://localhost:5000/preview) — Dedicated sleek dark theme variant.


## 📱 Multi-Device & Mobile Calling (Cloudflare Tunnel)

To connect between two different devices (e.g. your laptop and your smartphone, or with someone in another city):

1. Keep `python communication_server.py` running in Terminal 1.
2. In a second terminal window, run:
   ```bash
   .\cloudflared.exe tunnel --url http://127.0.0.1:5000
   ```
3. Copy the secure `https://<random-name>.trycloudflare.com` URL provided in the console.
4. Open this URL on your phone or share it with a friend. Both participants can join and start a video call instantly!

---

## 📖 Complete Technical Documentation

For an exhaustive, in-depth architectural breakdown, mathematical formulation of the landmark preprocessing, CNN layer shapes, WebRTC signaling protocol tables, and full API references, see:

📄 **[`SignConnect_AI_Complete_Documentation.pdf`](./SignConnect_AI_Complete_Documentation.pdf)** *(25 pages, included in this folder)*

---

## ⌨️ Keyboard Shortcuts
- **`A`**: Switch to Alphabet mode (A–Z)
- **`N`**: Switch to Number mode (1–9)
- **`G`**: Switch to Special Gestures mode
- **`Space`**: Accept suggestion / Add space
- **`S`**: Send current sign / sentence
- **`C`**: Clear current word & sentence
- **`Esc`**: Exit / Reset
