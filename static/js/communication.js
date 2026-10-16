(() => {
  "use strict";

  // ==========================================================
  // SIGN CONNECT AI
  // VIDEO CALL + SIGN LANGUAGE AI RECOGNITION
  // ==========================================================

  const $ = (id) => document.getElementById(id);

  // ==========================================================
  // SOCKET.IO
  // ==========================================================

  const socket = window.io
    ? window.io({
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 25,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        query: { session_token: localStorage.getItem("sessionToken") || "" }
      })
    : null;

  if (!socket) {
    console.error("[Sign Connect AI] Socket.IO is not available.");
  }

  // ==========================================================
  // APPLICATION STATE
  // ==========================================================

  const state = {
    voiceEnabled: false,
    lastSpoken: "",

    recognitionMode: "alphabet",
    recognizedPhrase: "",
    recognitionHistory: [],
    lastAcceptedCharacter: "",
    mode: "alphabet",
    character: null,
    confidence: 0,
    handDetected: false,

    overlayCharacter: "—",
    overlayConfidence: 0,

    // WebRTC
    localStream: null,
    remoteStream: null,
    isSyntheticVideo: false,
    peerConnection: null,
    pendingIceCandidates: [],
    inCall: false,
    callStartedByMe: false,
    cameraEnabled: false,
    microphoneEnabled: false,
    remoteUsername: "",

    recognitionInterval: null,
    recognitionBusy: false,
    recognitionEnabled: true,
    recognitionCanvas: document.createElement("canvas"),
    recognitionContext: null,
    recognitionFPS: 6,
    frameSeqId: 0,

    remotePeerId: null,
    hasRemotePeer: false,
    makingOffer: false,

    // Session token for reconnection (#11)
    sessionToken: null,

    // Hand skeleton overlay canvas (#10)
    handOverlayCanvas: null,
    handOverlayCtx: null,
  };

  window.state = state;
  window.__signConnectState = state;

  state.recognitionContext = state.recognitionCanvas.getContext("2d");

  // ==========================================================
  // ELEMENTS
  // ==========================================================

  const els = {
    status: $("connectionStatus"),

    username: $("username"),
    profileName: $("profileName"),
    profileAvatar: $("profileAvatar"),

    input: $("message"),
    send: $("sendButton"),
    clear: $("clearButton"),
    messages: $("messages"),

    voice: $("voiceButton"),
    voiceLabel: $("voiceLabel"),

    mode: $("recognitionMode"),
    character: $("detectedCharacter"),
    confidence: $("confidenceValue"),
    bar: $("confidenceBar"),
    recognizedSentence: $("recognizedSentence"),
    sentenceSuggestions: $("sentenceSuggestions"),
    recognizedWord: $("recognizedWord"),
    wordSuggestion: $("wordSuggestion"),
    acceptWordBtn: $("acceptWordBtn"),
    sendWordBtn: $("sendWordBtn"),
    hand: $("handStatus"),

    localVideo: $("localVideo"),
    remoteVideo: $("remoteVideo"),

    localPlaceholder: $("localPlaceholder"),
    remotePlaceholder: $("remotePlaceholder"),

    localVideoName: $("localVideoName"),
    remoteVideoName: $("remoteVideoName"),
    remoteParticipantName: $("remoteParticipantName"),

    localMediaStatus: $("localMediaStatus"),
    remoteMediaStatus: $("remoteMediaStatus"),

    localMediaState: $("localMediaState"),
    remoteMediaState: $("remoteMediaState"),

    remotePlaceholderTitle: $("remotePlaceholderTitle"),
    remotePlaceholderText: $("remotePlaceholderText"),

    remoteAvatar: $("remoteAvatar"),

    localLiveIndicator: $("localLiveIndicator"),
    remoteLiveIndicator: $("remoteLiveIndicator"),

    callStatusBadge: $("callStatusBadge"),

    cameraButton: $("cameraButton"),
    microphoneButton: $("microphoneButton"),

    cameraLabel: $("cameraLabel"),
    microphoneLabel: $("microphoneLabel"),

    startCallButton: $("startCallButton"),
    endCallButton: $("endCallButton"),

    alphabetMode: $("alphabetMode"),
    numberMode: $("numberMode"),
    gestureMode: $("gestureMode"),

    undoSignButton: $("undoSignButton"),
    spaceSignButton: $("spaceSignButton"),
    sendSignButton: $("sendSignButton"),
    clearSignButton: $("clearSignButton"),

    undoButton: $("undoButton"),
    spaceButton: $("spaceButton"),
    sendSign: $("sendSign"),

    keyboardFallback: $("keyboardFallback"),

    overlayCharacter: $("overlayCharacter"),
    overlayConfidence: $("overlayConfidence"),
  };

  // ==========================================================
  // UTILITY FUNCTIONS
  // ==========================================================

  function safeText(element, value) {
    if (element) {
      element.textContent = value;
    }
  }

  function safeClass(element, className, enabled) {
    if (!element) return;

    element.classList.toggle(className, Boolean(enabled));
  }

  // ==========================================================
  // USERNAME
  // ==========================================================

  function name() {
    const storedName = String(
      localStorage.getItem("signconnect_username") || "",
    ).trim();

    const fieldName = els.username
      ? String(els.username.value || "").trim()
      : "";

    const username = fieldName || storedName;

    if (username && els.username && els.username.value !== username) {
      els.username.value = username;
    }

    if (username) {
      localStorage.setItem("signconnect_username", username);
    }

    return username;
  }

  function setConnectionStatus(text) {
    safeText(els.status, text);
  }

  function setCallBadge(text) {
    safeText(els.callStatusBadge, text);
  }

  // ==========================================================
  // CALL BUTTON STATE
  // ==========================================================

  function updateCallButtonState(callState) {
    const activeStates = ["Calling...", "Connecting...", "Connected"];

    const canEnd = activeStates.includes(callState);

    if (els.startCallButton) {
      els.startCallButton.disabled = canEnd;
    }

    if (els.endCallButton) {
      els.endCallButton.disabled = !canEnd;
    }
  }

  function setLocalName(username) {
    safeText(els.localVideoName, username);

    safeText(els.profileName, username);
  }

  function setRemoteName(username) {
    const remote = String(username || "").trim();

    state.remoteUsername = remote;

    safeText(els.remoteVideoName, remote);

    safeText(els.remoteParticipantName, remote);

    if (els.remoteAvatar) {
      els.remoteAvatar.textContent = remote.charAt(0).toUpperCase();
    }
  }

  // ==========================================================
  // CONNECTION UI
  // ==========================================================

  function updateConnectionUI(connected) {
    if (connected) {
      setConnectionStatus("Connected");
    } else {
      setConnectionStatus("Connection lost");
    }
  }

  // ==========================================================
  // SOCKET CONNECTION
  // ==========================================================

  if (socket) {
    socket.on("connect", () => {
      console.log("[Socket.IO] Connected:", socket.id);

      const urlParams = new URLSearchParams(window.location.search);
      let roomId = urlParams.get('room');
      if (!roomId) {
        roomId = Math.random().toString(36).substring(2, 9);
        window.history.replaceState({}, '', `?room=${roomId}`);
      }

      socket.emit("join_room", {
          room_id: roomId,
          username: name()
      });

      updateConnectionUI(true);
    });

    socket.on("disconnect", () => {
      console.log("[Socket.IO] Disconnected");

      updateConnectionUI(false);
    });

    socket.on("connect_error", (error) => {
      console.error("[Socket.IO] Connection error:", error);

      setConnectionStatus("Connection error");
    });
  }

  // ==========================================================
  // SYSTEM MESSAGE
  // ==========================================================

  if (socket) {
    socket.on("system_message", (message) => {
      console.log("[SYSTEM]", message);
    });
  }

  // ==========================================================
  // CHAT MESSAGE UI
  // ==========================================================

  function addMessage(
    username,
    message,
    messageType = "typed",
    isOwnMessage = false,
  ) {
    if (!els.messages) {
      console.log(`[${username}] ${message}`);

      return;
    }

    const wrapper = document.createElement("div");

    wrapper.className = "message-item";

    wrapper.dataset.messageType = messageType;

    wrapper.dataset.sender = isOwnMessage ? "self" : "other";

    /*
     * Keep existing classes untouched where possible.
     * The inline properties below provide the WhatsApp-like
     * alignment without requiring HTML/CSS changes.
     */
    wrapper.style.display = "flex";

    wrapper.style.flexDirection = "column";

    wrapper.style.alignItems = isOwnMessage ? "flex-end" : "flex-start";

    wrapper.style.marginLeft = isOwnMessage ? "auto" : "";

    wrapper.style.marginRight = isOwnMessage ? "" : "auto";

    const sender = document.createElement("div");

    sender.className = "message-sender";

    sender.textContent = username || "";

    const body = document.createElement("div");

    body.className = "message-body";

    body.textContent = message || "";

    const meta = document.createElement("div");

    meta.className = "message-meta";

    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    meta.textContent = isOwnMessage ? `${time} ✓✓` : time;

    wrapper.appendChild(sender);

    wrapper.appendChild(body);

    wrapper.appendChild(meta);

    els.messages.appendChild(wrapper);

    els.messages.scrollTop = els.messages.scrollHeight;

    if (state.voiceEnabled) {
      // Clear lastSpoken so it doesn't get blocked if the same message is repeated
      state.lastSpoken = "";
      speakText(message);
    }

    // 3D Avatar: trigger animation for matching phrases
    if (window.SignAvatar && message) {
      window.SignAvatar.detectAndPlay(message);
    }
  }

  // ==========================================================
  // RECEIVE CHAT MESSAGE
  // ==========================================================

  if (socket) {
    socket.on("receive_message", (data) => {
      if (!data) return;

      const message = String(data.message || "");

      if (!message) return;

      const senderName = String(data.username || "").trim();

      /*
       * IMPORTANT:
       * Never identify the sender by username.
       *
       * Two PCs can have the same username.
       * The server provides the unique Socket.IO sender ID.
       */
      const senderId = String(data.sender_id || "").trim();

      const isOwnMessage = Boolean(
        senderId && socket && socket.id && senderId === socket.id,
      );

      /*
       * The sender already displays the message locally.
       * Ignore only the server echo belonging to this browser.
       */
      if (isOwnMessage) {
        return;
      }

      addMessage(senderName, message, data.message_type || "typed", false);
    });
  }

  // ==========================================================
  // SEND NORMAL TEXT MESSAGE
  // ==========================================================
  function sendMessage() {
    if (!socket) return;

    if (!els.input) return;

    const message = String(els.input.value || "").trim();

    if (!message) return;

    const username = name();

    socket.emit("send_message", {
      username: username,

      message: message,

      message_type: "typed",
    });

    /*
     * Display immediately on the sender's side.
     * The receive handler ignores the server echo.
     */
    addMessage(username, message, "typed", true);

    els.input.value = "";
  }

  if (els.send) {
    els.send.addEventListener("click", sendMessage);
  }

  if (els.input) {
    els.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();

        sendMessage();
      }
    });
  }

  if (els.clear) {
    els.clear.addEventListener("click", () => {
      if (els.input) {
        els.input.value = "";
      }
    });
  }

  // ==========================================================
  // VOICE
  // ==========================================================

  // Prevent garbage collection of utterances (Chrome bug)
  window.activeUtterances = [];

  // Preload voices
  if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
    window.speechSynthesis.getVoices();
  }

  async function speakText(text) {
    if (!text || !("speechSynthesis" in window)) {
      return;
    }

    if (state.lastSpoken === text) {
      return;
    }

    state.lastSpoken = text;

    window.speechSynthesis.cancel();

    const langSelect = document.getElementById("languageSelect");
    const targetLang = langSelect ? langSelect.value : "en-IN";

    let textToSpeak = text;

    if (targetLang === "hi-IN") {
      try {
        const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|hi`);
        const data = await response.json();
        if (data.responseData && data.responseData.translatedText) {
          textToSpeak = data.responseData.translatedText;
        }
      } catch (e) {
        console.error("[Translation] Failed to translate:", e);
      }

      // Use our backend TTS proxy for Hindi
      try {
        const audioUrl = `/api/tts?text=${encodeURIComponent(textToSpeak)}&lang=hi`;
        const audio = new Audio(audioUrl);
        await audio.play();
        return; // Skip Web Speech API
      } catch (e) {
        console.error("[TTS] Failed to play audio fallback:", e);
      }
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);

    utterance.lang = targetLang;
    
    // Try to explicitly grab the selected language voice or a fallback
    const voices = window.speechSynthesis.getVoices();
    const normalizedTarget = targetLang.replace('_', '-').toLowerCase();
    
    let voice = voices.find(v => v.lang.replace('_', '-').toLowerCase() === normalizedTarget);
    
    // Fallback for English if specific locale is missing
    if (!voice && targetLang.startsWith("en")) {
      voice = voices.find(v => v.lang.toLowerCase().startsWith("en"));
    }
    
    // Fallback for Hindi if specific locale is missing
    if (!voice && targetLang.startsWith("hi")) {
      voice = voices.find(v => v.lang.toLowerCase().startsWith("hi"));
    }

    if (voice) {
      utterance.voice = voice;
    }

    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onend = () => {
      const idx = window.activeUtterances.indexOf(utterance);
      if (idx > -1) {
        window.activeUtterances.splice(idx, 1);
      }
    };
    
    window.activeUtterances.push(utterance);

    window.speechSynthesis.speak(utterance);
  }

  function toggleVoice() {
    state.voiceEnabled = !state.voiceEnabled;

    if (els.voice) {
      els.voice.classList.toggle("active", state.voiceEnabled);
    }

    safeText(els.voiceLabel, state.voiceEnabled ? "Voice On" : "Voice Off");
  }

  if (els.voice) {
    els.voice.addEventListener("click", toggleVoice);
  }

  // ==========================================================
  // RECOGNITION UI
  // ==========================================================

  function updateConfidence(value) {
    let confidence = Number(value) || 0;

    confidence = Math.max(0, Math.min(100, confidence));

    state.confidence = confidence;

    const confidenceText = `${Math.round(confidence)}%`;

    safeText(els.confidence, confidenceText);

    if (els.bar) {
      els.bar.style.width = `${confidence}%`;
    }

    safeText(els.overlayConfidence, `Confidence ${confidenceText}`);
  }

  function updateHandStatus(detected) {
    state.handDetected = Boolean(detected);

    safeText(els.hand, detected ? "Hand detected" : "No hand detected");

    if (els.hand) {
      els.hand.classList.toggle("active", detected);
    }
  }

  function updateRecognitionCharacter(character) {
    const detectedCharacter = character || "—";

    state.character = detectedCharacter;

    // Dynamically scale font size based on text length to keep layout neat and premium
    const len = detectedCharacter.length;
    let overlaySize = "32px";
    let detectedSize = "42px";
    let spacing = "normal";

    if (len > 10) {
      overlaySize = "13px";
      detectedSize = "15px";
      spacing = "0.02em";
    } else if (len > 6) {
      overlaySize = "15px";
      detectedSize = "18px";
      spacing = "0.03em";
    } else if (len > 3) {
      overlaySize = "18px";
      detectedSize = "22px";
      spacing = "0.04em";
    } else if (len > 1) {
      overlaySize = "22px";
      detectedSize = "28px";
      spacing = "0.04em";
    }

    if (els.character) {
      els.character.textContent = detectedCharacter;
      els.character.style.fontSize = detectedSize;
      els.character.style.letterSpacing = spacing;
      els.character.style.whiteSpace = "nowrap";
    }

    if (els.overlayCharacter) {
      els.overlayCharacter.textContent = detectedCharacter;
      els.overlayCharacter.style.fontSize = overlaySize;
      els.overlayCharacter.style.letterSpacing = spacing;
      els.overlayCharacter.style.whiteSpace = "nowrap";
    }
  }

  // ==========================================================
  // CURRENT PHRASE
  // ==========================================================

  function updateRecognizedPhrase(data) {
    if (data === null || data === undefined || data === "") {
      state.recognizedPhrase = "";
      if (els.recognizedSentence) els.recognizedSentence.textContent = "";
      if (els.recognizedWord) els.recognizedWord.textContent = "Waiting for sign…";
      if (els.wordSuggestion) els.wordSuggestion.textContent = "";
      if (els.acceptWordBtn) els.acceptWordBtn.style.display = "none";
      if (els.sendWordBtn) els.sendWordBtn.style.display = "none";
      if (els.sentenceSuggestions) els.sentenceSuggestions.innerHTML = "";
      state.lastSentenceSuggestions = "[]";
      return;
    }
    
    // We can fall back to checking if data is just a string (for legacy support).
    if (typeof data === "string") {
      state.recognizedPhrase = data;
      if (els.recognizedSentence) els.recognizedSentence.textContent = data;
      if (els.recognizedWord) els.recognizedWord.textContent = data ? data : "Waiting for sign…";
      if (els.wordSuggestion) els.wordSuggestion.textContent = "";
      return;
    }

    const word = typeof data.current_word === "string" ? data.current_word : "";
    const sentenceArr = Array.isArray(data.sentence) ? data.sentence : [];
    const sentence = sentenceArr.join(" ");
    const suggestion = typeof data.suggestion === "string" ? data.suggestion : "";
    const sentenceSuggestionsJson = JSON.stringify(data.sentence_suggestions || []);

    state.recognizedPhrase = data.current_phrase || "";

    if (els.recognizedSentence) {
      els.recognizedSentence.textContent = sentence;
    }
    if (els.recognizedWord) {
      els.recognizedWord.textContent = word || "Waiting for sign…";
    }
    if (els.wordSuggestion) {
      els.wordSuggestion.textContent = suggestion;
      if (els.acceptWordBtn) {
        els.acceptWordBtn.style.display = suggestion ? "inline-block" : "none";
      }
      if (els.sendWordBtn) {
        els.sendWordBtn.style.display = suggestion ? "inline-block" : "none";
      }
    }

    if (els.sentenceSuggestions) {
      if (state.lastSentenceSuggestions !== sentenceSuggestionsJson) {
        state.lastSentenceSuggestions = sentenceSuggestionsJson;
        els.sentenceSuggestions.innerHTML = "";
        if (data.sentence_suggestions && Array.isArray(data.sentence_suggestions)) {
        data.sentence_suggestions.forEach(sugg => {
          const wrapper = document.createElement("div");
          wrapper.style.display = "inline-flex";
          wrapper.style.gap = "1px";

          const acceptBtn = document.createElement("button");
          acceptBtn.textContent = sugg;
          acceptBtn.className = "suggestion-chip";
          acceptBtn.style.borderTopRightRadius = "0";
          acceptBtn.style.borderBottomRightRadius = "0";
          acceptBtn.type = "button";
          acceptBtn.onclick = () => {
            socket.emit("recognition_control", {
              command: "accept_sentence",
              word: sugg,
              username: name()
            });
          };

          const sendBtn = document.createElement("button");
          sendBtn.innerHTML = '<span class="material-icons" style="font-size: 16px;">send</span>';
          sendBtn.className = "suggestion-chip";
          sendBtn.style.borderTopLeftRadius = "0";
          sendBtn.style.borderBottomLeftRadius = "0";
          sendBtn.style.padding = "4px 8px";
          sendBtn.style.background = "#22c55e";
          sendBtn.style.color = "white";
          sendBtn.type = "button";
          sendBtn.title = "Send this sentence directly";
          sendBtn.onclick = () => {
            // Send directly to chat
            const roomId = new URLSearchParams(window.location.search).get("room") || "default_room";
            socket.emit("send_message", {
              username: name(),
              message: sugg,
              message_type: "sign"
            });
            addMessage(name(), sugg, "sign", true);
            // Clear current sign phrase on backend
            socket.emit("recognition_control", {
              command: "clear",
              username: name()
            });
          };

          wrapper.appendChild(acceptBtn);
          wrapper.appendChild(sendBtn);
          els.sentenceSuggestions.appendChild(wrapper);
        });
      }
      }
    }

    console.log("[AI PHRASE]", state.recognizedPhrase || "—");
  }

  // ==========================================================
  // RECOGNITION RESULT
  // ==========================================================

  function recognition(data) {
    if (!data) return;

    const character = data.character || "—";

    const confidence = Number(data.confidence) || 0;

    const handDetected = Boolean(data.hand_detected);

    updateRecognitionCharacter(character);

    updateConfidence(confidence);

    updateHandStatus(handDetected);

    // Call updateRecognizedPhrase directly with the new payload
    if (data.current_word !== undefined || data.sentence !== undefined) {
      updateRecognizedPhrase(data);
    } else if (typeof data.current_phrase === "string") {
      updateRecognizedPhrase(data.current_phrase);
    } else if (typeof data.message === "string") {
      updateRecognizedPhrase(data.message);
    }

    if (els.overlayCharacter) {
      els.overlayCharacter.textContent = character;
    }

    if (els.overlayConfidence) {
      els.overlayConfidence.textContent = `Confidence ${Math.round(
        confidence,
      )}%`;
    }

    // Draw hand skeleton overlay (#10)
    if (data.landmarks && Array.isArray(data.landmarks)) {
      drawHandSkeleton(data.landmarks, confidence);
    } else if (!handDetected) {
      clearHandSkeleton();
    }

    // Adaptive Frame Sending: trigger next frame immediately
    // Only schedule if we're still in the same frame sequence (prevents duplicate chains)
    state.recognitionBusy = false;
    scheduleNextFrame();
  }

  // ==========================================================
  // HAND SKELETON OVERLAY (#10)
  // ==========================================================

  // MediaPipe hand connections (pairs of landmark indices)
  const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],       // Thumb
    [0,5],[5,6],[6,7],[7,8],       // Index
    [0,9],[9,10],[10,11],[11,12],  // Middle
    [0,13],[13,14],[14,15],[15,16],// Ring
    [0,17],[17,18],[18,19],[19,20],// Pinky
    [5,9],[9,13],[13,17]           // Palm
  ];

  function ensureOverlayCanvas() {
    if (state.handOverlayCanvas) return;

    const videoContainer = els.localVideo ? els.localVideo.parentElement : null;
    if (!videoContainer) return;

    const canvas = document.createElement("canvas");
    canvas.id = "handOverlayCanvas";
    canvas.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      object-fit: cover;
      transform: scaleX(-1);
      pointer-events: none;
      z-index: 10;
    `;
    videoContainer.style.position = "relative";
    videoContainer.appendChild(canvas);

    state.handOverlayCanvas = canvas;
    state.handOverlayCtx = canvas.getContext("2d");
  }

  function drawHandSkeleton(landmarks, confidence) {
    ensureOverlayCanvas();
    if (!state.handOverlayCanvas || !state.handOverlayCtx) return;

    const video = els.localVideo;
    if (!video) return;

    const canvas = state.handOverlayCanvas;
    const ctx = state.handOverlayCtx;

    // Match canvas intrinsic resolution to video's actual resolution
    // CSS object-fit: cover will handle the scaling/cropping to match the video
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Confidence-based color: green (high) -> yellow (mid) -> red (low)
    const confNorm = Math.min(100, Math.max(0, confidence)) / 100;
    const r = Math.round(255 * (1 - confNorm));
    const g = Math.round(255 * confNorm);
    const color = `rgba(${r}, ${g}, 80, 0.85)`;
    const dotColor = `rgba(${r}, ${g}, 120, 0.95)`;

    // Draw connections
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";

    for (const [i, j] of HAND_CONNECTIONS) {
      if (landmarks[i] && landmarks[j]) {
        // CSS transform: scaleX(-1) handles the mirroring, so we just map directly
        const x1 = landmarks[i].x * canvas.width;
        const y1 = landmarks[i].y * canvas.height;
        const x2 = landmarks[j].x * canvas.width;
        const y2 = landmarks[j].y * canvas.height;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    // Draw landmark dots
    ctx.fillStyle = dotColor;
    for (let i = 0; i < landmarks.length; i++) {
      const x = landmarks[i].x * canvas.width;
      const y = landmarks[i].y * canvas.height;
      const radius = (i === 0 || i === 5 || i === 9 || i === 13 || i === 17)
        ? 5 : 3.5;  // Larger dots for palm base landmarks

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw confidence ring around wrist
    if (landmarks[0]) {
      const wx = landmarks[0].x * canvas.width;
      const wy = landmarks[0].y * canvas.height;
      const ringRadius = 18;

      ctx.beginPath();
      ctx.arc(wx, wy, ringRadius, 0, Math.PI * 2 * confNorm);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();

      // Background ring (dim)
      ctx.beginPath();
      ctx.arc(wx, wy, ringRadius, Math.PI * 2 * confNorm, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  function clearHandSkeleton() {
    if (state.handOverlayCtx && state.handOverlayCanvas) {
      state.handOverlayCtx.clearRect(
        0, 0,
        state.handOverlayCanvas.width,
        state.handOverlayCanvas.height
      );
    }
  }

  if (socket) {
    socket.on("recognition_update", recognition);

    socket.on("sticker_gesture", (data) => {
      console.log("[STICKER GESTURE received]", data);
      if (state.recognitionMode === "gesture" && window.SignAvatar && data && data.gesture) {
        window.SignAvatar.playAnimation(data.gesture);
      }
    });
  }

  // ==========================================================
  // SESSION INIT (#11 — reconnection-safe state)
  // ==========================================================

  if (socket) {
    socket.on("session_init", (data) => {
      if (data.session_token) {
        state.sessionToken = data.session_token;
        localStorage.setItem("sessionToken", state.sessionToken);
        console.log("[SESSION] Token received:", data.session_token.substring(0, 8) + "...");
      }

      if (data.restored) {
        console.log("[SESSION] State restored from previous session");
        // Restore UI state
        if (data.current_word || data.sentence) {
          updateRecognizedPhrase({
            current_word: data.current_word || "",
            sentence: data.sentence || [],
            suggestion: data.suggestion || "",
            current_phrase: (data.sentence || []).join(" ") +
              (data.current_word ? " " + data.current_word : "")
          });
        }
        if (data.mode) {
          state.recognitionMode = data.mode;
          state.mode = data.mode;
          updateModeUI();
        }
      }
    });

    // Handle frame acknowledgment (prevents stall)
    socket.on("frame_ack", () => {
      // Frame was received by server - recognition_update will follow
    });
  }

  // ==========================================================
  // RECOGNITION ERROR
  // ==========================================================

  if (socket) {
    socket.on("recognition_error", (data) => {
      console.error("[AI]", data);
    });
  }

  // ==========================================================
  // SERVER CONTROL UPDATE
  // ==========================================================

  if (socket) {
    socket.on("recognition_control", (data) => {
      if (!data) return;

      if (data.mode === "alphabet" || data.mode === "number" || data.mode === "gesture") {
        state.recognitionMode = data.mode;

        state.mode = data.mode;

        updateModeUI();
      }

      if (data.command === "clear" || data.command === "send") {
        updateRecognizedPhrase("");
        if (els.recognizedSentence) els.recognizedSentence.textContent = "";
        if (els.recognizedWord) els.recognizedWord.textContent = "Waiting for sign…";
        if (els.wordSuggestion) els.wordSuggestion.textContent = "";
        if (els.acceptWordBtn) els.acceptWordBtn.style.display = "none";
        if (els.sendWordBtn) els.sendWordBtn.style.display = "none";
        if (els.sentenceSuggestions) els.sentenceSuggestions.innerHTML = "";
        state.lastSentenceSuggestions = "[]";
        state.recognizedPhrase = "";
        state.character = "—";
        updateRecognitionCharacter("—");
        updateConfidence(0);
      } else if (typeof data.current_phrase === "string") {
        updateRecognizedPhrase(data.current_phrase);
      }
    });
  }

  // ==========================================================
  // MODE UI
  // ==========================================================

  function updateModeUI() {
    safeText(
      els.mode,
      state.recognitionMode === "number" ? "Numbers" : (state.recognitionMode === "gesture" ? "Special Gestures" : "Alphabet"),
    );

    if (els.alphabetMode) {
      const isActive = state.recognitionMode === "alphabet";
      els.alphabetMode.classList.toggle("active", isActive);
      els.alphabetMode.setAttribute("aria-pressed", isActive ? "true" : "false");
    }

    if (els.numberMode) {
      const isActive = state.recognitionMode === "number";
      els.numberMode.classList.toggle("active", isActive);
      els.numberMode.setAttribute("aria-pressed", isActive ? "true" : "false");
    }

    if (els.gestureMode) {
      const isActive = state.recognitionMode === "gesture";
      els.gestureMode.classList.toggle("active", isActive);
      els.gestureMode.setAttribute("aria-pressed", isActive ? "true" : "false");
    }

    // Tab-specific controls: only display 2D stickers dock when Special Gestures tab is active!
    if (window.SignAvatar && typeof window.SignAvatar.updateVisibility === "function") {
      window.SignAvatar.updateVisibility();
    } else {
      const avatarControls = document.getElementById("avatar2dControls");
      if (avatarControls) {
        avatarControls.style.display = state.recognitionMode === "gesture" ? "flex" : "none";
      }
    }

    // Dismiss any active sticker popups if user switches to Alphabet or Numbers tab
    if (state.recognitionMode !== "gesture") {
      if (window.SignAvatar && typeof window.SignAvatar.dismissPopup === "function") {
        window.SignAvatar.dismissPopup();
      }
    }
  }

  window.updateModeUI = updateModeUI;

  function sendRecognitionControl(command) {
    if (!socket) return;

    socket.emit("recognition_control", {
      username: name(),

      command: command,

      action: command,
    });
  }

  function setRecognitionMode(mode) {
    if (mode !== "alphabet" && mode !== "number" && mode !== "gesture") {
      return;
    }

    state.recognitionMode = mode;

    state.mode = mode;

    state.lastAcceptedCharacter = "";

    state.recognitionHistory = [];

    updateModeUI();

    sendRecognitionControl(mode);
  }

  if (els.alphabetMode) {
    els.alphabetMode.addEventListener("click", () => {
      setRecognitionMode("alphabet");
    });
  }

  if (els.numberMode) {
    els.numberMode.addEventListener("click", () => {
      setRecognitionMode("number");
    });
  }

  if (els.gestureMode) {
    els.gestureMode.addEventListener("click", () => {
      setRecognitionMode("gesture");
    });
  }

  // ==========================================================
  // SIGN PHRASE CONTROLS
  // ==========================================================

  function sendSignControl(command) {
    if (!socket) return;

    socket.emit("recognition_control", {
      username: name(),

      command: command,

      action: command,
    });
  }

  function undoSign() {
    sendSignControl("undo");
  }

  function addSpaceToSign() {
    sendSignControl("space");
  }

  function clearSignPhrase() {
    sendSignControl("clear");

    updateRecognizedPhrase("");

    if (els.recognizedSentence) {
      els.recognizedSentence.textContent = "";
    }
    if (els.recognizedWord) {
      els.recognizedWord.textContent = "Waiting for sign…";
    }
    if (els.wordSuggestion) {
      els.wordSuggestion.textContent = "";
    }
    if (els.acceptWordBtn) {
      els.acceptWordBtn.style.display = "none";
    }
    if (els.sendWordBtn) {
      els.sendWordBtn.style.display = "none";
    }
    if (els.sentenceSuggestions) {
      els.sentenceSuggestions.innerHTML = "";
    }
    state.lastSentenceSuggestions = "[]";
    state.recognizedPhrase = "";
    state.character = "—";
    updateRecognitionCharacter("—");
    updateConfidence(0);

    state.recognitionHistory = [];
    state.lastAcceptedCharacter = "";
  }
  window.clearSignPhrase = clearSignPhrase;
  if (els.acceptWordBtn) els.acceptWordBtn.addEventListener("click", () => {
    socket.emit("recognition_control", {
      command: "accept_word",
      username: name()
    });
  });

  if (els.sendWordBtn) els.sendWordBtn.addEventListener("click", () => {
    // We send the current completed word directly
    const completedWord = (state.character || "") + (els.wordSuggestion ? els.wordSuggestion.textContent : "");
    // If the word isn't fully formed in state, we take the recognizedWord + suggestion
    const currentWordText = els.recognizedWord ? els.recognizedWord.textContent : "";
    const fullWord = currentWordText === "Waiting for sign…" ? "" : currentWordText;
    const finalToSend = fullWord + (els.wordSuggestion ? els.wordSuggestion.textContent : "");
    
    if (finalToSend) {
      const roomId = new URLSearchParams(window.location.search).get("room") || "default_room";
      socket.emit("send_message", {
        username: name(),
        message: finalToSend,
        message_type: "sign"
      });
      addMessage(name(), finalToSend, "sign", true);
      // Clear current sign phrase on backend
      socket.emit("recognition_control", {
        command: "clear",
        username: name()
      });
    }
  });
  // ==========================================================
  // SEND SIGN PHRASE
  // ==========================================================

  function sendSignPhrase() {
    const phrase = String(state.recognizedPhrase || "").trim();

    if (!phrase) {
      console.log("[SIGN] Nothing to send.");

      return;
    }

    console.log("[SIGN SEND]", phrase);

    // 3D Avatar: trigger animation for the sent sign phrase
    if (window.SignAvatar) {
      window.SignAvatar.detectAndPlay(phrase);
    }

    if (socket) {
      socket.emit("send_message", {
        username: name(),

        message: phrase,

        message_type: "sign",
      });

      /*
       * Sign phrase uses the SAME messaging system.
       */
      addMessage(name(), phrase, "sign", true);
    }

    sendSignControl("send");

    updateRecognizedPhrase("");

    state.recognitionHistory = [];

    state.lastAcceptedCharacter = "";
  }

  // ==========================================================
  // BUTTON ALIASES
  // ==========================================================

  const undoElement = els.undoSignButton || els.undoButton;

  const spaceElement = els.spaceSignButton || els.spaceButton;

  const sendSignElement = els.sendSignButton || els.sendSign;

  const clearSignElement = els.clearSignButton || els.clearSign;

  if (undoElement) {
    undoElement.addEventListener("click", undoSign);
  }

  if (spaceElement) {
    spaceElement.addEventListener("click", addSpaceToSign);
  }

  if (sendSignElement) {
    sendSignElement.addEventListener("click", sendSignPhrase);
  }

  if (clearSignElement) {
    clearSignElement.addEventListener("click", clearSignPhrase);
  }
  // ==========================================================
  // BROWSER CAMERA → AI
  // ==========================================================

  /**
   * Schedule the next frame safely.
   * Uses frameSeqId to guarantee only ONE chain is ever active.
   * Every call to scheduleNextFrame increments the seqId;
   * when the scheduled callback fires it checks whether its
   * captured seqId still matches — if not, another chain
   * already took over and this one silently dies.
   */
  function scheduleNextFrame() {
    if (!state.recognitionEnabled) return;
    const seq = ++state.frameSeqId;
    const minInterval = Math.max(140, 1000 / (state.recognitionFPS || 6));
    setTimeout(() => {
      if (seq === state.frameSeqId) {
        sendRecognitionFrame();
      }
    }, minInterval);
  }

  function sendRecognitionFrame() {
    if (!socket) return;

    if (!state.recognitionEnabled) {
      return;
    }

    if (!state.localStream) {
      return;
    }

    if (!els.localVideo) {
      return;
    }

    if (state.recognitionBusy) {
      return;
    }

    const video = els.localVideo;

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      // Video not ready yet — retry on next frame
      scheduleNextFrame();
      return;
    }

    const width = video.videoWidth;

    const height = video.videoHeight;

    if (!width || !height) {
      return;
    }

    // --------------------------------------------------------
    // Resize image
    // --------------------------------------------------------

    const targetWidth = 480;

    const targetHeight = Math.round(height * (targetWidth / width));

    state.recognitionCanvas.width = targetWidth;

    state.recognitionCanvas.height = targetHeight;

    // --------------------------------------------------------
    // Draw current camera frame
    // --------------------------------------------------------

    state.recognitionContext.drawImage(video, 0, 0, targetWidth, targetHeight);

    state.recognitionBusy = true;

    // Capture seqId BEFORE emitting so the timeout can check it
    const sentSeqId = state.frameSeqId;

    try {
      const image = state.recognitionCanvas.toDataURL("image/jpeg", 0.55);

      socket.emit("recognition_frame", {
        image: image,

        username: name(),

        mode: state.recognitionMode,
      });

      // ------------------------------------------------------
      // Fallback timeout: if server drops this frame (no
      // recognition_update emitted), unlock after 500ms.
      // The seqId check prevents this timeout from spawning
      // a duplicate chain if the response already arrived.
      // ------------------------------------------------------
      window.setTimeout(() => {
        if (state.recognitionBusy && state.frameSeqId === sentSeqId) {
          state.recognitionBusy = false;
          scheduleNextFrame();
        }
      }, 500);
    } catch (error) {
      console.error("[AI] Could not capture frame:", error);

      state.recognitionBusy = false;
      scheduleNextFrame();
    }
  }

  // ==========================================================
  // START RECOGNITION
  // ==========================================================

  function startRecognitionStream() {
    stopRecognitionStream();

    if (!state.recognitionEnabled) {
      return;
    }

    // Kick off the single adaptive chain
    state.recognitionBusy = false;
    state.frameSeqId = 0;
    sendRecognitionFrame();

    console.log("[AI] Browser recognition started (Adaptive).");
  }

  // ==========================================================
  // STOP RECOGNITION
  // ==========================================================

  function stopRecognitionStream() {
    // Increment seqId to cancel any pending timeout/rAF callbacks
    state.frameSeqId++;
    state.recognitionBusy = false;
    console.log("[AI] Browser recognition stopped.");
  }

  // ==========================================================
  // SYNTHETIC VIDEO FEED (Multi-Tab / Camera Lockout Fallback)
  // ==========================================================
  function createSyntheticVideoTrack(userName) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d");
      let angle = 0;

      function renderFrame() {
        angle += 0.04;
        const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        grad.addColorStop(0, "#0b1329");
        grad.addColorStop(1, "#1e293b");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Grid lines (futuristic aesthetic)
        ctx.strokeStyle = "rgba(52, 211, 153, 0.07)";
        ctx.lineWidth = 1;
        for (let x = 0; x < canvas.width; x += 36) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
          ctx.stroke();
        }
        for (let y = 0; y < canvas.height; y += 36) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
          ctx.stroke();
        }

        // Center coordinates
        const cx = canvas.width / 2;
        const cy = canvas.height / 2 - 25;
        const pulse = Math.sin(angle) * 8;

        // Animated glowing radar ring
        ctx.strokeStyle = "rgba(52, 211, 153, 0.28)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 60 + pulse, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = "rgba(16, 185, 129, 0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 52, 0, Math.PI * 2);
        ctx.stroke();

        // Avatar gradient circle
        const avatarGrad = ctx.createLinearGradient(cx - 45, cy - 45, cx + 45, cy + 45);
        avatarGrad.addColorStop(0, "#10b981");
        avatarGrad.addColorStop(1, "#047857");
        ctx.fillStyle = avatarGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, 45, 0, Math.PI * 2);
        ctx.fill();

        // User initial
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 38px 'Outfit', 'Inter', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const initial = (userName || "U").charAt(0).toUpperCase();
        ctx.fillText(initial, cx, cy);

        // User name
        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 20px 'Outfit', 'Inter', sans-serif";
        ctx.fillText(userName || "Sign User", cx, cy + 70);

        // Status pill
        ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(cx - 150, cy + 96, 300, 32, 16);
          ctx.fill();
        } else {
          ctx.fillRect(cx - 150, cy + 96, 300, 32);
        }
        ctx.strokeStyle = "rgba(52, 211, 153, 0.4)";
        ctx.lineWidth = 1;
        if (ctx.roundRect) {
          ctx.stroke();
        }

        // Live green dot
        ctx.fillStyle = "#10b981";
        ctx.beginPath();
        ctx.arc(cx - 130, cy + 112, 5, 0, Math.PI * 2);
        ctx.fill();

        // Text explanation
        ctx.fillStyle = "#cbd5e1";
        ctx.font = "600 12px 'Inter', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("Active Feed (Camera in use by Tab 1)", cx - 118, cy + 116);
      }

      renderFrame();
      const interval = setInterval(renderFrame, 1000 / 15);
      const canvasStream = canvas.captureStream(15);
      const track = canvasStream.getVideoTracks()[0];
      if (track) {
        track.addEventListener("ended", () => clearInterval(interval));
        return track;
      }
    } catch (e) {
      console.warn("[Media] createSyntheticVideoTrack failed:", e);
    }
    return null;
  }

  // ==========================================================
  // CAMERA / MICROPHONE
  // ==========================================================

  async function getLocalMedia() {
    // Check if existing stream has live video tracks
    if (state.localStream) {
      const hasLiveVideo = state.localStream.getVideoTracks().some(t => t.readyState === "live");
      const hasLiveAudio = state.localStream.getAudioTracks().some(t => t.readyState === "live");
      if (hasLiveVideo || hasLiveAudio) {
        return state.localStream;
      }
      // Tracks are ended/dead — release and re-acquire
      console.warn("[Media] Existing stream has no live tracks, re-acquiring...");
      state.localStream.getTracks().forEach(t => { try { t.stop(); } catch(e){} });
      state.localStream = null;
    }

    const constraintOptions = [
      {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: true,
      },
      {
        video: { facingMode: "user" },
        audio: true,
      },
      {
        video: true,
        audio: true,
      },
      {
        video: true,
        audio: false,
      },
      {
        video: false,
        audio: true,
      },
    ];

    let stream = null;
    let lastError = null;

    for (const constraints of constraintOptions) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (stream) {
          console.log("[Media] getUserMedia succeeded with constraints:", constraints);
          break;
        }
      } catch (err) {
        lastError = err;
        console.warn("[Media] Constraints attempt failed:", constraints, err);
      }
    }

    if (!stream) {
      console.error("[Media] All getUserMedia attempts failed:", lastError);
      setConnectionStatus("Camera/microphone permission required");
      throw lastError || new Error("Could not access camera/microphone");
    }

    // If hardware webcam was blocked (e.g. multi-tab testing on same PC), generate a synthetic video track
    // so peer connection always has an active, animated video stream instead of a black box!
    if (!stream.getVideoTracks().length) {
      console.warn("[Media] Hardware camera unavailable (locked by another tab or missing). Providing synthetic video stream.");
      const synTrack = createSyntheticVideoTrack(name());
      if (synTrack) {
        stream.addTrack(synTrack);
        state.isSyntheticVideo = true;
      }
    } else {
      state.isSyntheticVideo = false;
    }

    state.localStream = stream;

    state.cameraEnabled = stream
      .getVideoTracks()
      .some((track) => track.enabled);

    state.microphoneEnabled = stream
      .getAudioTracks()
      .some((track) => track.enabled);

    // If a WebRTC peer connection is already open, sync newly acquired tracks
    if (state.peerConnection) {
      const pc = state.peerConnection;
      const senders = pc.getSenders();
      stream.getTracks().forEach((track) => {
        const matchingSender = senders.find(
          (s) => s.track && s.track.kind === track.kind
        ) || senders.find(
          (s) => !s.track && s.track === null
        );
        if (matchingSender) {
          try {
            matchingSender.replaceTrack(track);
            console.log("[WebRTC] Replaced track on existing sender:", track.kind);
          } catch (e) {
            console.warn("[WebRTC] replaceTrack error:", e);
          }
        } else {
          try {
            pc.addTrack(track, stream);
            console.log("[WebRTC] Added local track to existing pc:", track.kind);
          } catch (e) {
            console.warn("[WebRTC] addTrack to existing pc failed:", e);
          }
        }
      });
    }

    // ------------------------------------------------------
    // Local video
    // ------------------------------------------------------

    if (els.localVideo) {
      els.localVideo.srcObject = stream;
      els.localVideo.muted = true;
      els.localVideo.playsInline = true;
      els.localVideo.setAttribute("playsinline", "true");
      els.localVideo.setAttribute("webkit-playsinline", "true");

      try {
        await els.localVideo.play();
      } catch (error) {
        console.warn("[Media] Video autoplay:", error);
      }
    }

    updateLocalMediaUI();

    // ------------------------------------------------------
    // START AI RECOGNITION
    // ------------------------------------------------------

    if (state.cameraEnabled) {
      startRecognitionStream();
    }

    console.log("[Media] Camera and microphone ready.");

    return stream;
  }

  // ==========================================================
  // LOCAL MEDIA UI
  // ==========================================================

  function updateLocalMediaUI() {
    safeText(
      els.localMediaStatus,
      state.cameraEnabled ? "Camera ready" : "Camera off",
    );

    safeText(
      els.localMediaState,
      state.microphoneEnabled ? "Microphone ready" : "Microphone off",
    );

    if (els.cameraButton) {
      els.cameraButton.classList.toggle("off", !state.cameraEnabled);
      els.cameraButton.setAttribute("aria-pressed", state.cameraEnabled.toString());
      const span = els.cameraButton.querySelector('span');
      if (span) span.textContent = state.cameraEnabled ? "Camera On" : "Camera";
    }

    if (els.microphoneButton) {
      els.microphoneButton.classList.toggle("off", !state.microphoneEnabled);
      els.microphoneButton.setAttribute("aria-pressed", state.microphoneEnabled.toString());
      const span = els.microphoneButton.querySelector('span');
      if (span) span.textContent = state.microphoneEnabled ? "Mic On" : "Microphone";
    }

    if (els.localPlaceholder) {
      els.localPlaceholder.style.display = state.cameraEnabled ? "none" : "";
    }

    if (els.localLiveIndicator) {
      els.localLiveIndicator.style.display = state.cameraEnabled ? "" : "none";
    }
  }

  // ==========================================================
  // ==========================================================
  // CAMERA TOGGLE (Physically releases webcam to turn LED off)
  // ==========================================================

  async function toggleCamera() {
    try {
      if (state.cameraEnabled) {
        // --------------------------------------------------------
        // TURN CAMERA OFF:
        // Calling track.stop() physically shuts down the hardware
        // camera sensor so the laptop LED indicator turns OFF.
        // --------------------------------------------------------
        state.cameraEnabled = false;

        if (state.localStream) {
          const videoTracks = state.localStream.getVideoTracks();
          videoTracks.forEach((track) => {
            try {
              track.stop(); // Releases hardware sensor -> laptop LED turns OFF!
            } catch (e) {
              console.warn("[Camera] track.stop error:", e);
            }
            try {
              state.localStream.removeTrack(track);
            } catch (e) {}
          });
        }

        // WebRTC: replace video track with null so remote peer sees video muted
        if (state.peerConnection) {
          try {
            const senders = state.peerConnection.getSenders();
            senders.forEach((sender) => {
              if (sender.track && sender.track.kind === "video") {
                sender.replaceTrack(null);
                console.log("[WebRTC] Video sender replaced with null (camera off)");
              }
            });
          } catch (e) {
            console.warn("[WebRTC] replaceTrack null error:", e);
          }
        }

        updateLocalMediaUI();

        stopRecognitionStream();
        clearHandSkeleton();
        updateRecognitionCharacter("—");
        updateConfidence(0);
        updateHandStatus(false);
        if (els.overlayCharacter) safeText(els.overlayCharacter, "—");
        if (els.overlayConfidence) safeText(els.overlayConfidence, "Camera Off");

      } else {
        // --------------------------------------------------------
        // TURN CAMERA ON:
        // Re-acquire fresh hardware stream from browser/OS
        // --------------------------------------------------------
        const videoConstraintOptions = [
          { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } },
          { video: { facingMode: "user" } },
          { video: true },
        ];

        let freshStream = null;
        let lastError = null;

        for (const constraints of videoConstraintOptions) {
          try {
            freshStream = await navigator.mediaDevices.getUserMedia(constraints);
            if (freshStream && freshStream.getVideoTracks().length > 0) {
              break;
            }
          } catch (err) {
            lastError = err;
            console.warn("[Camera] getUserMedia retry failed:", constraints, err);
          }
        }

        if (!freshStream || !freshStream.getVideoTracks().length) {
          console.warn("[Camera] Hardware camera locked or unavailable. Providing synthetic video stream fallback.");
          const synTrack = createSyntheticVideoTrack(name());
          if (synTrack) {
            freshStream = new MediaStream([synTrack]);
            state.isSyntheticVideo = true;
          } else {
            console.error("[Camera] All attempts to acquire camera video failed:", lastError);
            setConnectionStatus("Could not re-enable camera");
            return;
          }
        } else {
          state.isSyntheticVideo = false;
        }

        const newVideoTrack = freshStream.getVideoTracks()[0];

        if (!state.localStream) {
          state.localStream = new MediaStream([newVideoTrack]);
        } else {
          // Remove any stale video tracks
          state.localStream.getVideoTracks().forEach((t) => {
            try { state.localStream.removeTrack(t); } catch (e) {}
          });
          state.localStream.addTrack(newVideoTrack);
        }

        if (els.localVideo) {
          els.localVideo.srcObject = state.localStream;
          els.localVideo.muted = true;
          els.localVideo.playsInline = true;
          try {
            await els.localVideo.play();
          } catch (err) {
            console.warn("[Camera] localVideo.play error:", err);
          }
        }

        // WebRTC: update peer connection with new camera track
        if (state.peerConnection) {
          try {
            const senders = state.peerConnection.getSenders();
            const videoSender = senders.find(
              (s) => (s.track && s.track.kind === "video") || (!s.track && s.kind === "video") || (!s.track)
            );
            if (videoSender) {
              await videoSender.replaceTrack(newVideoTrack);
              console.log("[WebRTC] Replaced video track with fresh camera track");
            } else {
              state.peerConnection.addTrack(newVideoTrack, state.localStream);
              console.log("[WebRTC] Added fresh camera track to peer connection");
            }
          } catch (e) {
            console.warn("[WebRTC] Error syncing fresh video track to peer connection:", e);
          }
        }

        state.cameraEnabled = true;
        updateLocalMediaUI();
        startRecognitionStream();
      }
    } catch (error) {
      console.error("[Camera]", error);
    }
  }

  // ==========================================================
  // MICROPHONE TOGGLE
  // ==========================================================

  async function toggleMicrophone() {
    try {
      if (!state.localStream) {
        await getLocalMedia();

        return;
      }

      const tracks = state.localStream.getAudioTracks();

      if (!tracks.length) {
        return;
      }

      state.microphoneEnabled = !state.microphoneEnabled;

      tracks.forEach((track) => {
        track.enabled = state.microphoneEnabled;
      });

      updateLocalMediaUI();
    } catch (error) {
      console.error("[Microphone]", error);
    }
  }

  if (els.cameraButton) {
    els.cameraButton.addEventListener("click", toggleCamera);
  }

  if (els.microphoneButton) {
    els.microphoneButton.addEventListener("click", toggleMicrophone);
  }

  // ==========================================================
  // WEBRTC CONFIGURATION
  // ==========================================================

  // ==========================================================
  // WEBRTC CONFIGURATION (STUN + TURN RELAY)
  // ==========================================================

  // ==========================================================
  // WEBRTC CONFIGURATION (STUN + TURN RELAY)
  // ==========================================================

  const rtcConfiguration = {
    iceServers: [
      {
        urls: [
          "stun:stun.l.google.com:19302",
          "stun:stun1.l.google.com:19302",
          "stun:stun2.l.google.com:19302",
          "stun:stun3.l.google.com:19302",
          "stun:stun4.l.google.com:19302",
          "stun:global.stun.twilio.com:3478",
          "stun:stun.cloudflare.com:3478",
          "stun:standard.relay.metered.ca:80",
        ],
      },
      {
        urls: [
          "turn:standard.relay.metered.ca:80",
          "turn:standard.relay.metered.ca:80?transport=tcp",
          "turn:standard.relay.metered.ca:443",
          "turn:standard.relay.metered.ca:443?transport=tcp",
          "turn:a.relay.metered.ca:80",
          "turn:a.relay.metered.ca:443",
          "turn:a.relay.metered.ca:443?transport=tcp",
        ],
        username: "openrelayproject",
        credential: "openrelayproject",
      },
    ],
    iceCandidatePoolSize: 10,
  };

  // ==========================================================
  // CREATE PEER CONNECTION
  // ==========================================================

  function createPeerConnection() {
    if (state.peerConnection && state.peerConnection.connectionState !== "closed" && state.peerConnection.connectionState !== "failed") {
      return state.peerConnection;
    }

    if (state.peerConnection) {
      try {
        state.peerConnection.close();
      } catch (e) {}
      state.peerConnection = null;
    }

    console.log("[WebRTC] Creating fresh RTCPeerConnection...");
    const pc = new RTCPeerConnection(rtcConfiguration);

    state.peerConnection = pc;

    // --------------------------------------------------------
    // Local tracks attachment
    // --------------------------------------------------------
    if (state.localStream) {
      const senders = pc.getSenders();
      state.localStream.getTracks().forEach((track) => {
        const alreadyAdded = senders.some((sender) => sender.track === track);
        if (!alreadyAdded) {
          try {
            pc.addTrack(track, state.localStream);
            console.log("[WebRTC] Attached local track to PC:", track.kind);
          } catch (e) {
            console.warn("[WebRTC] addTrack error:", e);
          }
        }
      });
    }

    // If local stream lacks video or audio, add recvonly transceiver so incoming stream is negotiated
    const hasVideo = state.localStream && state.localStream.getVideoTracks().length > 0;
    const hasAudio = state.localStream && state.localStream.getAudioTracks().length > 0;

    if (!hasVideo) {
      try {
        pc.addTransceiver("video", { direction: "recvonly" });
      } catch (e) {
        console.warn("[WebRTC] video recvonly transceiver fallback:", e);
      }
    }
    if (!hasAudio) {
      try {
        pc.addTransceiver("audio", { direction: "recvonly" });
      } catch (e) {
        console.warn("[WebRTC] audio recvonly transceiver fallback:", e);
      }
    }

    // --------------------------------------------------------
    // Remote stream receiving
    // --------------------------------------------------------

    pc.ontrack = (event) => {
      console.log("[WebRTC] Remote track received:", event.track ? event.track.kind : "unknown", event);

      if (!els.remoteVideo) {
        return;
      }

      if (!state.remoteStream) {
        state.remoteStream = new MediaStream();
      }

      if (event.track) {
        // If a track of this kind already exists on remoteStream, remove old one first
        state.remoteStream.getTracks().forEach((t) => {
          if (t.kind === event.track.kind && t.id !== event.track.id) {
            try { state.remoteStream.removeTrack(t); } catch (e) {}
          }
        });
        const alreadyHasTrack = state.remoteStream.getTracks().some((t) => t.id === event.track.id);
        if (!alreadyHasTrack) {
          state.remoteStream.addTrack(event.track);
          console.log(`[WebRTC] Attached track ${event.track.kind} (${event.track.id}) to remoteStream`);
        }
      } else if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach((track) => {
          const already = state.remoteStream.getTracks().some((t) => t.id === track.id);
          if (!already) state.remoteStream.addTrack(track);
        });
      }

      // CRITICAL FOR CHROMIUM:
      // When audio track arrives first, srcObject gets bound to audio-only pipeline.
      // When video track arrives next, we MUST re-bind srcObject so video decoder engages!
      if (els.remoteVideo.srcObject !== state.remoteStream) {
        els.remoteVideo.srcObject = state.remoteStream;
      } else if (event.track && event.track.kind === "video") {
        els.remoteVideo.srcObject = null;
        els.remoteVideo.srcObject = state.remoteStream;
      }

      // 2. Configure video playback attributes for inline autoplay
      els.remoteVideo.autoplay = true;
      els.remoteVideo.playsInline = true;
      els.remoteVideo.setAttribute("playsinline", "true");
      els.remoteVideo.setAttribute("webkit-playsinline", "true");

      // 3. Guaranteed playback with muted fallback (prevents browser autoplay block)
      const attemptPlayback = () => {
        if (!els.remoteVideo) return;
        const playPromise = els.remoteVideo.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              console.log("[WebRTC] Remote video playback active.");
            })
            .catch((error) => {
              console.warn("[WebRTC] Autoplay with sound blocked, ensuring muted playback:", error);
              els.remoteVideo.muted = true;
              els.remoteVideo.play()
                .then(() => {
                  console.log("[WebRTC] Remote video playing muted.");
                })
                .catch((e) => console.error("[WebRTC] Video playback failed even muted:", e));
            });
        }
      };

      attemptPlayback();

      // Trigger playback when actual RTP packets arrive (onunmute)
      if (event.track) {
        event.track.onunmute = () => {
          console.log("[WebRTC] Remote track unmuted (RTP flowing):", event.track.kind);
          if (event.track.kind === "video") {
            if (els.remoteVideo.srcObject !== state.remoteStream) {
              els.remoteVideo.srcObject = state.remoteStream;
            }
          }
          attemptPlayback();
        };
      }

      // 4. Update UI
      if (els.remotePlaceholder) {
        els.remotePlaceholder.style.display = "none";
      }

      if (els.remoteLiveIndicator) {
        els.remoteLiveIndicator.style.display = "";
      }

      safeText(els.remoteMediaStatus, "Connected");
      safeText(els.remoteMediaState, "Live");
    };

    // --------------------------------------------------------
    // ICE candidate gathering
    // --------------------------------------------------------

    pc.onicecandidate = (event) => {
      if (!event.candidate || !event.candidate.candidate || !socket) {
        return;
      }

      const candData = event.candidate.toJSON ? event.candidate.toJSON() : {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
        usernameFragment: event.candidate.usernameFragment,
      };

      socket.emit("webrtc_signal", {
        type: "candidate",
        candidate: candData,
        username: name(),
      });
    };

    // --------------------------------------------------------
    // Connection state
    // --------------------------------------------------------

    pc.onconnectionstatechange = () => {
      console.log("[WebRTC] Connection state:", pc.connectionState);

      switch (pc.connectionState) {
        case "connected":
          setCallBadge("Connected");
          state.inCall = true;
          updateCallButtonState("Connected");
          if (els.remoteVideo) {
            if (state.remoteStream && els.remoteVideo.srcObject !== state.remoteStream) {
              els.remoteVideo.srcObject = state.remoteStream;
            }
            els.remoteVideo.play().catch(() => {});
          }
          break;

        case "connecting":
          setCallBadge("Connecting...");
          updateCallButtonState("Connecting...");
          break;

        case "disconnected":
          console.warn("[WebRTC] Connection state is disconnected; waiting for ICE reconnect or recovery...");
          setCallBadge("Reconnecting...");
          clearTimeout(state.iceDisconnectTimer);
          state.iceDisconnectTimer = setTimeout(() => {
            if (state.peerConnection && state.peerConnection.connectionState === "disconnected") {
              setCallBadge("Disconnected");
              updateCallButtonState("Disconnected");
            }
          }, 6000);
          break;

        case "failed":
          console.warn("[WebRTC] Peer connection failed. Resetting for reconnect.");
          setCallBadge("Connection failed");
          state.inCall = false;
          state.callStartedByMe = false;
          if (state.peerConnection) {
            try { state.peerConnection.close(); } catch (e) {}
            state.peerConnection = null;
          }
          updateCallButtonState("Failed");
          break;

        case "closed":
          setCallBadge("Call ended");
          state.inCall = false;
          state.callStartedByMe = false;
          state.peerConnection = null;
          updateCallButtonState("Closed");
          break;
      }
    };

    // --------------------------------------------------------
    // ICE state
    // --------------------------------------------------------

    pc.oniceconnectionstatechange = () => {
      console.log("[WebRTC] ICE state:", pc.iceConnectionState);
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        if (els.remoteVideo) {
          if (state.remoteStream && els.remoteVideo.srcObject !== state.remoteStream) {
            els.remoteVideo.srcObject = state.remoteStream;
          }
          els.remoteVideo.play().catch(() => {});
        }
      } else if (pc.iceConnectionState === "failed") {
        console.warn("[WebRTC] ICE failed. Resetting peer connection.");
        setCallBadge("Connection failed");
        state.inCall = false;
        state.callStartedByMe = false;
        if (state.peerConnection) {
          try { state.peerConnection.close(); } catch (e) {}
          state.peerConnection = null;
        }
        updateCallButtonState("Failed");
      }
    };

    return pc;
  }

  // ==========================================================
  // START CALL
  // ==========================================================

  async function startCall(force = false) {
    if (!socket) {
      console.error("[WebRTC] Socket unavailable.");
      return;
    }

    if (state.makingOffer) {
      console.warn("[WebRTC] Offer creation in progress, ignoring duplicate trigger.");
      return;
    }

    if (!force && state.peerConnection && (state.peerConnection.connectionState === "connected" || state.peerConnection.connectionState === "connecting")) {
      console.log("[WebRTC] Call already active or connecting. Click Start Video Call to force refresh.");
      return;
    }

    // Clean up any stale or previous failed connection to start fresh
    if (state.peerConnection) {
      try {
        state.peerConnection.close();
      } catch (e) {}
      state.peerConnection = null;
    }
    state.inCall = false;

    // Check if another peer is in room
    if (!state.hasRemotePeer) {
      safeText(els.remotePlaceholderTitle, "Waiting for Participant");
      safeText(els.remotePlaceholderText, "No other participant in room yet. Open in another tab or share Invite Link to connect!");
      setCallBadge("Waiting for peer");
    }

    try {
      await getLocalMedia();

      state.pendingIceCandidates = [];
      state.callStartedByMe = true;
      state.makingOffer = true;
      state.inCall = true;

      const pc = createPeerConnection();

      setCallBadge("Calling...");
      updateCallButtonState("Calling...");

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("webrtc_signal", {
        type: "offer",
        sdp: {
          type: offer.type,
          sdp: offer.sdp,
        },
        username: name(),
      });

      state.makingOffer = false;
      console.log("[WebRTC] Offer sent.");
    } catch (error) {
      console.error("[WebRTC] Start call failed:", error);
      state.inCall = false;
      state.callStartedByMe = false;
      state.makingOffer = false;
      if (state.peerConnection) {
        try { state.peerConnection.close(); } catch (e) {}
        state.peerConnection = null;
      }
      setCallBadge("Call failed");
      updateCallButtonState("Failed");
    }
  }

  // ==========================================================
  // END CALL
  // ==========================================================

  function endCall(notifyRemote = true) {
    console.log("[WebRTC] Ending call. Notify remote:", notifyRemote);

    /*
     * IMPORTANT:
     * Do NOT stop the recognition stream here.
     *
     * The camera is shared with sign-language recognition.
     * Ending a WebRTC call must NOT disable recognition.
     */

    // --------------------------------------------------------
    // Notify remote peer first
    // --------------------------------------------------------

    if (notifyRemote && socket) {
      socket.emit("webrtc_signal", {
        type: "end",

        username: name(),
      });
    }

    // --------------------------------------------------------
    // Close WebRTC connection
    // --------------------------------------------------------

    const pc = state.peerConnection;

    if (pc) {
      try {
        pc.ontrack = null;

        pc.onicecandidate = null;

        pc.onconnectionstatechange = null;

        pc.oniceconnectionstatechange = null;

        pc.close();
      } catch (error) {
        console.warn("[WebRTC] Close:", error);
      }
    }

    // --------------------------------------------------------
    // Reset WebRTC state
    // --------------------------------------------------------

    state.peerConnection = null;

    state.pendingIceCandidates = [];

    state.inCall = false;

    state.callStartedByMe = false;

    state.makingOffer = false;

    state.remotePeerId = null;

    // --------------------------------------------------------
    // Clear remote video
    // --------------------------------------------------------

    if (state.remoteStream) {
      state.remoteStream.getTracks().forEach((t) => {
        try { t.stop(); } catch (e) {}
      });
      state.remoteStream = null;
    }

    if (els.remoteVideo) {
      els.remoteVideo.srcObject = null;
    }

    if (els.remotePlaceholder) {
      els.remotePlaceholder.style.display = "";
    }

    if (els.remoteLiveIndicator) {
      els.remoteLiveIndicator.style.display = "none";
    }

    safeText(els.remoteMediaStatus, "Waiting");

    safeText(els.remoteMediaState, "Offline");

    // --------------------------------------------------------
    // Reset remote participant
    // --------------------------------------------------------

    setRemoteName("");

    // --------------------------------------------------------
    // Call status
    // --------------------------------------------------------

    setCallBadge("Call ended");

    updateCallButtonState("Call ended");

    /*
     * Do NOT stop local camera/recognition when the call ends.
     * The user may want to keep signing solo after a call.
     * Only the WebRTC peer connection is torn down.
     */
    updateRecognitionCharacter("—");
    updateConfidence(0);
    updateHandStatus(false);
    console.log("[WebRTC] Call ended.");
  }

  // ==========================================================
  // CALL BUTTONS
  // ==========================================================

  if (els.startCallButton) {
    els.startCallButton.addEventListener("click", () => startCall(true));
  }

  if (els.endCallButton) {
    els.endCallButton.addEventListener("click", () => {
      if (state.peerConnection || state.inCall) {
        endCall(true);
      }
    });
  }

  if (socket) {
    /*
     * GLARE FIX: Only the EXISTING peer in the room initiates calls.
     * The newly joining peer does NOT auto-call — it waits to receive
     * an offer and answers it. This prevents both peers from sending
     * offers simultaneously (dual-offer collision / "WebRTC glare").
     */
    socket.on("room_status", (data) => {
      if (!data) return;
      console.log("[Socket.IO] Current room status:", data);
      state.hasRemotePeer = !!data.has_remote;
      if (data.has_remote) {
        setRemoteName("Participant 2");
        safeText(els.remotePlaceholderTitle, "Peer in Room");
        safeText(els.remotePlaceholderText, "Another participant is here. Connecting...");
        setCallBadge("Connecting...");
        console.log("[WebRTC] I am the JOINER — waiting for existing peer to send offer (fallback armed).");

        // Fallback: If existing peer does not send offer within 2.5s (e.g. host camera start delay), joiner initiates call!
        clearTimeout(state.joinerFallbackTimer);
        state.joinerFallbackTimer = setTimeout(() => {
          if (!state.peerConnection || (state.peerConnection.connectionState !== "connected" && state.peerConnection.connectionState !== "connecting")) {
            console.log("[WebRTC] Joiner fallback triggered — initiating call.");
            startCall(false);
          }
        }, 2500);
      } else {
        safeText(els.remotePlaceholderTitle, "Waiting for Participant");
        safeText(els.remotePlaceholderText, "Share the Invite Link with another person (or open in a second tab) to connect!");
      }
    });

    socket.on("room_joined", (data) => {
      if (!data) return;
      console.log("[Socket.IO] Peer joined room:", data);
      clearTimeout(state.peerLeftGraceTimer);
      const isOtherUser = (data.sender && socket.id && data.sender !== socket.id) ||
                          (data.username && data.username !== name());
      if (isOtherUser) {
        state.hasRemotePeer = true;
        const peerName = (data.username && data.username !== name()) ? data.username : "Participant 2";
        setRemoteName(peerName);

        // If WebRTC is already connected, just keep it live!
        const isConnected = state.peerConnection && state.peerConnection.connectionState === "connected";
        if (isConnected) {
          setCallBadge("Connected");
          updateCallButtonState("Connected");
        } else {
          safeText(els.remotePlaceholderTitle, `${peerName} is Ready`);
          safeText(els.remotePlaceholderText, `${peerName} joined the room. Connecting call...`);
          setTimeout(() => {
            if (!state.peerConnection || state.peerConnection.connectionState !== "connected") {
              console.log("[WebRTC] New peer joined room — initiating call to joiner.");
              startCall(false);
            }
          }, 300);
        }
      }
    });

    socket.on("peer_left", (data) => {
      console.log("[Socket.IO] Peer left room:", data);

      // If WebRTC is actively connected and streaming media, DO NOT kill the call immediately!
      // The peer's signaling socket might just be reconnecting over mobile/tunnel.
      if (state.peerConnection && state.peerConnection.connectionState === "connected") {
        console.log("[WebRTC] Signaling peer_left received, but WebRTC media stream is still healthy. Maintaining call and waiting for signaling reconnect...");
        setCallBadge("Signaling reconnecting...");

        clearTimeout(state.peerLeftGraceTimer);
        state.peerLeftGraceTimer = setTimeout(() => {
          // If WebRTC connection dropped or is no longer connected after 10s, teardown call
          if (!state.peerConnection || state.peerConnection.connectionState !== "connected") {
            console.log("[WebRTC] Peer did not reconnect within grace period. Ending call.");
            state.hasRemotePeer = false;
            endCall(false);
            safeText(els.remotePlaceholderTitle, "Participant Left");
            safeText(els.remotePlaceholderText, "The other participant left the room. Waiting for someone to join...");
            setCallBadge("Peer left");
            updateCallButtonState("Ready");
          } else {
            setCallBadge("Connected");
          }
        }, 10000);
        return;
      }

      state.hasRemotePeer = false;
      endCall(false);
      safeText(els.remotePlaceholderTitle, "Participant Left");
      safeText(els.remotePlaceholderText, "The other participant left the room. Waiting for someone to join...");
      setCallBadge("Peer left");
      updateCallButtonState("Ready");
    });
  }

  // ==========================================================
  // WEBRTC SIGNALING RECEIVER
  // ==========================================================

  if (socket) {
    socket.on("webrtc_signal", async (data) => {
      if (!data) return;

      // ----------------------------------------------------
      // Ignore our own signal
      // ----------------------------------------------------

      if (data.sender && socket.id && data.sender === socket.id) {
        return;
      }

      console.log("[WebRTC] Signal received:", data.type);

/* Duplicate self-signal check removed — already handled above */

try {
        // --------------------------------------------------
        // END
        // --------------------------------------------------

        if (data.type === "end") {
          /*
           * Remote end signal must NOT be sent back.
           */
          endCall(false);

          return;
        }

        // --------------------------------------------------
        // OFFER
        // --------------------------------------------------

        if (data.type === "offer") {
          clearTimeout(state.joinerFallbackTimer);

          /*
           * GLARE HANDLING (MDN Perfect Negotiation Polite Peer pattern):
           * An offer collision occurs if we are making an offer or our PC is not stable.
           */
          const pcCurrent = state.peerConnection;
          const isCollision = (state.makingOffer || (pcCurrent && pcCurrent.signalingState !== "stable"));

          if (isCollision) {
            // Determine politeness: tie-break using socket.id vs data.sender
            const isPolite = socket.id ? (socket.id < (data.sender || "")) : false;
            console.warn(`[WebRTC] Glare/Collision detected! isPolite: ${isPolite}, signalingState: ${pcCurrent ? pcCurrent.signalingState : 'none'}`);

            if (!isPolite) {
              console.log("[WebRTC] Impolite peer: ignoring incoming colliding offer; waiting for remote peer to accept mine.");
              return;
            }

            console.log("[WebRTC] Polite peer: yielding to remote offer.");
            if (pcCurrent && pcCurrent.signalingState === "have-local-offer") {
              try {
                await pcCurrent.setLocalDescription({ type: "rollback" });
              } catch (rbErr) {
                console.warn("[WebRTC] Rollback error, closing old PC:", rbErr);
                try { pcCurrent.close(); } catch(e){}
                state.peerConnection = null;
              }
            }
            state.makingOffer = false;
            state.callStartedByMe = false;
          }

          try {
            await getLocalMedia();
          } catch (mediaErr) {
            console.warn("[WebRTC] Could not acquire local media for answering offer:", mediaErr);
          }

          // Ensure any stale PC is cleanly closed before accepting incoming remote offer
          if (state.peerConnection) {
            try {
              state.peerConnection.close();
            } catch (error) {
              console.warn("[WebRTC] Previous peer close:", error);
            }
            state.peerConnection = null;
          }

          state.pendingIceCandidates = [];
          state.callStartedByMe = false;
          state.inCall = true;

          setRemoteName(data.username || "");

          const pc = createPeerConnection();

          setCallBadge("Connecting...");
          updateCallButtonState("Connecting...");

          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          await applyPendingIceCandidates();

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          socket.emit("webrtc_signal", {
            type: "answer",
            sdp: {
              type: answer.type,
              sdp: answer.sdp,
            },
            username: name(),
          });

          setCallBadge("Connected");
          updateCallButtonState("Connected");
          console.log("[WebRTC] Answer sent.");
          return;
        }

        // --------------------------------------------------
        // ANSWER
        // --------------------------------------------------

        if (data.type === "answer") {
          clearTimeout(state.joinerFallbackTimer);
          const pc = state.peerConnection;

          if (!pc) {
            console.warn("[WebRTC] No peer connection for answer.");
            return;
          }

          if (pc.signalingState !== "have-local-offer") {
            console.warn(`[WebRTC] Safely ignoring answer because signalingState is '${pc.signalingState}' (expected 'have-local-offer').`);
            return;
          }

          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          await applyPendingIceCandidates();

          setRemoteName(data.username || "");
          setCallBadge("Connected");
          updateCallButtonState("Connected");
          console.log("[WebRTC] Remote answer accepted. WebRTC connected.");
          return;
        }

        // --------------------------------------------------
        // ICE CANDIDATE
        // --------------------------------------------------

        if (data.type === "candidate") {
          clearTimeout(state.joinerFallbackTimer);
          const candidate = data.candidate;
          if (!candidate || !candidate.candidate) {
            return;
          }

          const pc = state.peerConnection;

          /*
           * Candidate may arrive before
           * remoteDescription.
           */
          if (!pc || !pc.remoteDescription) {
            state.pendingIceCandidates.push(candidate);

            return;
          }

          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (error) {
            console.warn("[WebRTC] ICE candidate error:", error);
          }
        }
      } catch (error) {
        console.error("[WebRTC] Signal handling error:", error);
      }
    });
  }
  // ==========================================================
  // APPLY PENDING ICE CANDIDATES
  // ==========================================================

  async function applyPendingIceCandidates() {
    const pc = state.peerConnection;

    if (!pc) {
      return;
    }

    if (!pc.remoteDescription) {
      return;
    }

    const pending = state.pendingIceCandidates;

    state.pendingIceCandidates = [];

    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.warn("[WebRTC] Pending ICE error:", error);
      }
    }
  }

  // ==========================================================
  // KEYBOARD FALLBACK
  // ==========================================================

  document.addEventListener("keydown", (event) => {
    // Don't intercept normal typing in any text-entry context.
    if (
      event.target &&
      (event.target.tagName === "INPUT" ||
       event.target.tagName === "TEXTAREA" ||
       event.target.isContentEditable)
    ) {
      return;
    }

    const key = event.key.toLowerCase();

    // ------------------------------------------------------
    // Alphabet
    // ------------------------------------------------------

    if (key === "a") {
      setRecognitionMode("alphabet");

      return;
    }

    // ------------------------------------------------------
    // Numbers
    // ------------------------------------------------------

    if (key === "n") {
      setRecognitionMode("number");

      return;
    }

    // ------------------------------------------------------
    // Special Gestures
    // ------------------------------------------------------

    if (key === "g") {
      setRecognitionMode("gesture");

      return;
    }

    // ------------------------------------------------------
    // Space
    // ------------------------------------------------------

    if (event.code === "Space") {
      event.preventDefault();

      addSpaceToSign();

      return;
    }

    // ------------------------------------------------------
    // Send
    // ------------------------------------------------------

    if (key === "s") {
      sendSignPhrase();

      return;
    }

    // ------------------------------------------------------
    // Clear
    // ------------------------------------------------------

    if (key === "c") {
      clearSignPhrase();

      return;
    }

    // ------------------------------------------------------
    // Undo
    // ------------------------------------------------------

    if (key === "u") {
      undoSign();

      return;
    }

    // ------------------------------------------------------
    // Escape
    // ------------------------------------------------------

    if (event.key === "Escape") {
      endCall(true);
    }
  });

  // ==========================================================
  // USERNAME / PROFILE
  // ==========================================================

  function updateProfile() {
    const username = name();

    setLocalName(username);

    if (els.profileAvatar) {
      els.profileAvatar.textContent = username.charAt(0).toUpperCase();
    }
  }

  if (els.username) {
    /*
     * Restore the saved username when the page
     * is refreshed on the same PC.
     */
    const savedUsername = String(
      localStorage.getItem("signconnect_username") || "",
    ).trim();

    if (savedUsername && !els.username.value) {
      els.username.value = savedUsername;
    }

    els.username.addEventListener("input", () => {
      const username = String(els.username.value || "").trim();

      if (username) {
        localStorage.setItem("signconnect_username", username);
      }

      updateProfile();
    });
  }

  updateProfile();

  // ==========================================================
  // PAGE VISIBILITY
  // ==========================================================

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      return;
    }

    if (state.localStream && state.cameraEnabled) {
      startRecognitionStream();
    }
  });

  // ==========================================================
  // INITIAL UI
  // ==========================================================

  updateModeUI();

  updateConfidence(0);

  updateHandStatus(false);

  updateRecognitionCharacter("—");

  updateRecognizedPhrase("");

  setCallBadge("Ready");

  updateCallButtonState("Ready");

  // ==========================================================
  // INITIAL VIDEO OVERLAY
  // ==========================================================

  safeText(els.overlayCharacter, "—");

  safeText(els.overlayConfidence, "Confidence 0%");

  // ==========================================================
  // INITIAL LOCAL NAME
  // ==========================================================

  setLocalName(name());

  // ==========================================================
  // DONE
  // ==========================================================

  console.log("%cSign Connect AI initialized.", "font-weight:bold;");

  console.log("[AI] Recognition mode:", state.recognitionMode);
// ============================================================
// SIGN CONNECT AI HAND GESTURE GUIDE
// ============================================================

const sibiAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const sibiNumbers = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
const sibiAlphabetDetails = {
  A: {
    icon: "✊",
    img: "/static/images/sibi/A.png",
    desc: "Upright closed fist facing forward, four fingers curled into palm, thumb extended straight upright along side of index finger."
  },
  B: {
    icon: "✋",
    img: "/static/images/sibi/B.png",
    desc: "Flat open hand pointing straight up with all 4 fingers held tightly together; thumb folded flat horizontally across palm."
  },
  C: {
    icon: "🫳",
    img: "/static/images/sibi/C.png",
    desc: "Hand turned sideways with curved fingers and thumb forming an open, rounded 'C' arc shape facing outward."
  },
  D: {
    icon: "☝️",
    img: "/static/images/sibi/D.png",
    desc: "Index finger pointing straight up; thumb touches curled tips of middle, ring, and pinky fingers to form an 'O' ring below."
  },
  E: {
    icon: "✊",
    img: "/static/images/sibi/E.png",
    desc: "Hand facing forward with all 4 fingertips curled tightly down, resting directly on top of thumb folded across palm."
  },
  F: {
    icon: "👌",
    img: "/static/images/sibi/F.png",
    desc: "Thumb and index fingertip touching in a circle; middle, ring, and pinky fingers held straight upright together."
  },
  G: {
    icon: "👉",
    img: "/static/images/sibi/G.png",
    desc: "Hand turned sideways horizontally, index finger pointing forward, thumb held parallel right above it, other fingers curled."
  },
  H: {
    icon: "✌️",
    img: "/static/images/sibi/H.png",
    desc: "Hand turned sideways horizontally, index and middle fingers extended together pointing forward, thumb folded against palm."
  },
  I: {
    icon: "🤙",
    img: "/static/images/sibi/I.png",
    desc: "Closed fist facing forward with only the pinky finger extended straight upright; thumb folded across curled fingers."
  },
  J: {
    icon: "🤙",
    img: "/static/images/sibi/J.png",
    desc: "Pinky finger upright, tracing a smooth 'J' curve in the air (swooping downward and hooking slightly upward)."
  },
  K: {
    icon: "✌️",
    img: "/static/images/sibi/K.png",
    desc: "Index finger straight up, middle finger extended forward/up, thumb placed upright between the index and middle fingers."
  },
  L: {
    icon: "👆",
    img: "/static/images/sibi/L.png",
    desc: "Thumb and index finger extended at a 90° right angle forming an 'L' shape; remaining 3 fingers curled into palm."
  },
  M: {
    icon: "✊",
    img: "/static/images/sibi/M.png",
    desc: "Closed fist with thumb tucked under first three fingers (index, middle, ring), knuckles draping over thumb."
  },
  N: {
    icon: "✊",
    img: "/static/images/sibi/N.png",
    desc: "Closed fist with thumb tucked under first two fingers (index and middle), knuckles draping over thumb."
  },
  O: {
    icon: "👌",
    img: "/static/images/sibi/O.png",
    desc: "All five fingertips curved and touching thumb tip to form a complete, hollow 'O' ring shape."
  },
  P: {
    icon: "👇",
    img: "/static/images/sibi/P.png",
    desc: "Inverted downward 'K' handshape: middle finger pointing down, index finger forward/down, thumb between them."
  },
  Q: {
    icon: "👇",
    img: "/static/images/sibi/Q.png",
    desc: "Inverted downward 'G' handshape: index finger and thumb extended pointing straight downward toward the ground."
  },
  R: {
    icon: "🤞",
    img: "/static/images/sibi/R.png",
    desc: "Index and middle fingers extended upright and tightly crossed over one another (middle finger over index finger)."
  },
  S: {
    icon: "✊",
    img: "/static/images/sibi/S.png",
    desc: "Closed fist facing forward with thumb wrapped tightly across the front of the curled index, middle, and ring fingers."
  },
  T: {
    icon: "✊",
    img: "/static/images/sibi/T.png",
    desc: "Closed fist with thumb tucked between index and middle fingers, thumb tip peeking up through first knuckle gap."
  },
  U: {
    icon: "✌️",
    img: "/static/images/sibi/U.png",
    desc: "Index and middle fingers extended straight upright and held pressed tightly together; thumb folded over curled ring and pinky."
  },
  V: {
    icon: "✌️",
    img: "/static/images/sibi/V.png",
    desc: "Index and middle fingers extended upright and spread apart into a 'V' peace sign; thumb folded over ring and pinky."
  },
  W: {
    icon: "🖖",
    img: "/static/images/sibi/W.png",
    desc: "Index, middle, and ring fingers extended upright and spread apart into a 'W' shape; thumb folded across curled pinky."
  },
  X: {
    icon: "☝️",
    img: "/static/images/sibi/X.png",
    desc: "Closed fist with index finger bent at knuckle into a hook / claw shape facing forward."
  },
  Y: {
    icon: "🤙",
    img: "/static/images/sibi/Y.png",
    desc: "Thumb and pinky finger extended outward to sides (shaka / hang loose); middle three fingers curled into palm."
  },
  Z: {
    icon: "☝️",
    img: "/static/images/sibi/Z.png",
    desc: "Index finger extended pointing forward/up, tracing a 'Z' zigzag stroke path in the air."
  }
};

const sibiNumbersDetails = {
  1: {
    icon: "☝️",
    img: "/static/images/sibi_numbers/1.png",
    desc: "Upright closed fist facing forward with index finger extended straight up; thumb holds remaining curled fingers."
  },
  2: {
    icon: "✌️",
    img: "/static/images/sibi_numbers/2.png",
    desc: "Upright closed fist with index and middle fingers extended straight up in a 'V' shape; thumb holds curled ring and pinky."
  },
  3: {
    icon: "🖖",
    img: "/static/images/sibi_numbers/3.png",
    desc: "Thumb, index, and middle fingers extended outward (thumb pointing sideways, index and middle upright); ring and pinky curled into palm."
  },
  4: {
    icon: "✋",
    img: "/static/images/sibi_numbers/4.png",
    desc: "Four fingers (index, middle, ring, pinky) extended straight upright and spread apart; thumb folded flat across palm."
  },
  5: {
    icon: "🖐️",
    img: "/static/images/sibi_numbers/5.png",
    desc: "Open hand facing forward with all five fingers extended straight upright and spread wide open."
  },
  6: {
    icon: "👌",
    img: "/static/images/sibi_numbers/6.png",
    desc: "Thumb tip touches pinky fingertip forming a loop; index, middle, and ring fingers extended straight upright together."
  },
  7: {
    icon: "👌",
    img: "/static/images/sibi_numbers/7.png",
    desc: "Thumb tip touches ring fingertip forming a loop; index, middle, and pinky fingers extended straight upright."
  },
  8: {
    icon: "👌",
    img: "/static/images/sibi_numbers/8.png",
    desc: "Thumb tip touches middle fingertip forming a loop; index, ring, and pinky fingers extended straight upright."
  },
  9: {
    icon: "👌",
    img: "/static/images/sibi_numbers/9.png",
    desc: "Thumb tip touches index fingertip forming an 'OK' circle; middle, ring, and pinky fingers extended straight upright."
  },
  10: {
    icon: "👍",
    img: "/static/images/sibi_numbers/10.png",
    desc: "Closed fist facing forward with thumb extended straight upright and gently shaken/wiggled side-to-side."
  }
};

const sibiGestures = [
  { name: "I LOVE YOU", desc: "🤟 Thumb, Index & Pinky extended, Middle & Ring curled" },
  { name: "YES", desc: "👍 Thumbs up with closed fist" },
  { name: "NO", desc: "👎 Thumbs down with closed fist" },
  { name: "STOP", desc: "✋ Open hand facing camera with fingers spread" },
  { name: "WATER", desc: "🖖 'W' handshape — Index, Middle, Ring extended, Pinky curled" },
  { name: "GOOD MORNING", desc: "✌️ Peace / 'V' sign — Index & Middle extended" },
  { name: "NICE TO MEET YOU", desc: "👌 OK sign — Thumb & Index circle, other 3 extended" },
  { name: "HOW ARE YOU", desc: "🤙 'L' shape — Thumb & Index extended at 90°" },
  { name: "THANK YOU", desc: "🙏 Flat palm upright facing forward, fingers together" },
  { name: "HELP", desc: "✊ Closed fist facing camera" },
  { name: "HELLO", desc: "🖐️ Open hand with fingers upright and waving" },
  { name: "WELCOME", desc: "👐 Open hand welcoming gesture" },
  { name: "PLEASE", desc: "🤲 Open palm gently tilted forward" },
  { name: "SORRY", desc: "✊ Closed fist circled gently over chest" },
  { name: "GOODBYE", desc: "👋 Open hand waving goodbye" }
];

let sibiGuideMode = "alphabet";
let sibiGuideIndex = 0;

const sibiAlphabetTab = $("sibiAlphabetTab");
const sibiNumberTab = $("sibiNumberTab");
const sibiGestureTab = $("sibiGestureTab");
const sibiPrevious = $("sibiPrevious");
const sibiNext = $("sibiNext");
const sibiCurrentSign = $("sibiCurrentSign");
const sibiGuideCounter = $("sibiGuideCounter");
const sibiSignInstruction = $("sibiSignInstruction");
const sibiReferenceLetter = $("sibiReferenceLetter");
const sibiReferenceText = $("sibiReferenceText");
const sibiReferenceLink = $("sibiReferenceLink");
const sibiOfficialExternalLink = $("sibiOfficialExternalLink");
const sibiOfficialText = $("sibiOfficialText");

// Modal elements
const sibiModal = $("sibiModal");
const sibiModalCloseBtn = $("sibiModalCloseBtn");
const sibiModalDoneBtn = $("sibiModalDoneBtn");
const modalAlphabetTab = $("modalAlphabetTab");
const modalNumbersTab = $("modalNumbersTab");
const modalGesturesTab = $("modalGesturesTab");
const modalChartTab = $("modalChartTab");
const sibiModalGrid = $("sibiModalGrid");
const sibiVisualImg = $("sibiVisualImg");
const sibiVisualPreviewWrapper = $("sibiVisualPreviewWrapper");

function renderModalGrid(tab) {
  if (!sibiModalGrid) return;
  sibiModalGrid.innerHTML = "";

  if (modalAlphabetTab) modalAlphabetTab.classList.toggle("active", tab === "alphabet");
  if (modalNumbersTab) modalNumbersTab.classList.toggle("active", tab === "numbers");
  if (modalGesturesTab) modalGesturesTab.classList.toggle("active", tab === "gestures");
  if (modalChartTab) modalChartTab.classList.toggle("active", tab === "chart");

  if (tab === "chart") {
    const container = document.createElement("div");
    container.className = "sibi-chart-container";
    container.innerHTML = `
      <div style="margin-bottom: 16px; text-align: center;">
        <span style="font-size: 11px; font-weight: 700; color: #10b981; letter-spacing: 0.05em; text-transform: uppercase;">OFFICIAL KEMENDIKDASMEN STANDARDS</span>
        <h4 style="margin: 4px 0 0; font-size: 18px; font-weight: 700; color: #0f172a; font-family: 'Outfit', sans-serif;">Official SIBI Reference Charts</h4>
        <p style="margin: 4px 0 0; font-size: 13px; color: #64748b;">Complete standard illustrations for Numbers (1–10) and Alphabet (A–Z)</p>
      </div>

      <div style="display: flex; flex-direction: column; gap: 20px; width: 100%; align-items: center;">
        <div style="width: 100%; text-align: center;">
          <h5 style="margin: 0 0 8px; font-size: 14px; font-weight: 700; color: #1e293b;">1. Isyarat Angka SIBI (Numbers 1–10)</h5>
          <a href="/static/images/sibi_numbers_chart.png" target="_blank" title="Click to view full resolution image in new tab">
            <img src="/static/images/sibi_numbers_chart.png" alt="Official Isyarat Angka SIBI Chart" style="max-width: 100%; max-height: 40vh; object-fit: contain; border-radius: 10px; border: 1px solid #cbd5e1; box-shadow: 0 4px 10px rgba(0,0,0,0.06);">
          </a>
        </div>

        <div style="width: 100%; text-align: center;">
          <h5 style="margin: 0 0 8px; font-size: 14px; font-weight: 700; color: #1e293b;">2. Abjad dalam SIBI (Alphabet A–Z)</h5>
          <a href="/static/images/sibi_alphabet_chart.jpg" target="_blank" title="Click to view full resolution image in new tab">
            <img src="/static/images/sibi_alphabet_chart.jpg" alt="Official Abjad dalam SIBI Chart" style="max-width: 100%; max-height: 40vh; object-fit: contain; border-radius: 10px; border: 1px solid #cbd5e1; box-shadow: 0 4px 10px rgba(0,0,0,0.06);">
          </a>
        </div>
      </div>
      <p style="margin: 14px 0 0; font-size: 12px; color: #94a3b8;">💡 Click any chart above to open full resolution in new tab</p>
    `;
    sibiModalGrid.appendChild(container);
    return;
  }

  if (tab === "alphabet") {
    Object.keys(sibiAlphabetDetails).forEach(letter => {
      const item = sibiAlphabetDetails[letter];
      const el = document.createElement("div");
      el.className = "sibi-grid-item";
      el.innerHTML = `
        <div class="sibi-grid-item-top">
          <div>
            <span class="sibi-grid-item-sign">Sign ${letter}</span>
            <span style="font-size: 10px; color: #10b981; font-weight: 700; display: block; margin-top: 2px;">SIBI STANDARD</span>
          </div>
          <img class="sibi-grid-item-thumb" src="${item.img}" alt="Sign ${letter}">
        </div>
        <p class="sibi-grid-item-desc">${item.desc}</p>
      `;
      el.addEventListener("click", () => {
        sibiGuideMode = "alphabet";
        sibiGuideIndex = sibiAlphabet.indexOf(letter);
        if (sibiAlphabetTab) {
          sibiAlphabetTab.classList.add("active");
          if (sibiNumberTab) sibiNumberTab.classList.remove("active");
          if (sibiGestureTab) sibiGestureTab.classList.remove("active");
        }
        updateSibiGuide();
        closeSibiModal();
      });
      sibiModalGrid.appendChild(el);
    });
  } else if (tab === "numbers") {
    Object.keys(sibiNumbersDetails).forEach(num => {
      const item = sibiNumbersDetails[num];
      const el = document.createElement("div");
      el.className = "sibi-grid-item";
      el.innerHTML = `
        <div class="sibi-grid-item-top">
          <div>
            <span class="sibi-grid-item-sign">Number ${num}</span>
            <span style="font-size: 10px; color: #10b981; font-weight: 700; display: block; margin-top: 2px;">SIBI ANGKA</span>
          </div>
          <img class="sibi-grid-item-thumb" src="${item.img}" alt="Number ${num}">
        </div>
        <p class="sibi-grid-item-desc">${item.desc}</p>
      `;
      el.addEventListener("click", () => {
        sibiGuideMode = "numbers";
        sibiGuideIndex = sibiNumbers.indexOf(num);
        if (sibiNumberTab) {
          sibiNumberTab.classList.add("active");
          if (sibiAlphabetTab) sibiAlphabetTab.classList.remove("active");
          if (sibiGestureTab) sibiGestureTab.classList.remove("active");
        }
        updateSibiGuide();
        closeSibiModal();
      });
      sibiModalGrid.appendChild(el);
    });
  } else {
    sibiGestures.forEach((gesture, idx) => {
      const el = document.createElement("div");
      el.className = "sibi-grid-item";
      el.innerHTML = `
        <div class="sibi-grid-item-top">
          <span class="sibi-grid-item-sign">${gesture.name}</span>
          <span class="sibi-grid-item-icon">✨</span>
        </div>
        <p class="sibi-grid-item-desc">${gesture.desc}</p>
      `;
      el.addEventListener("click", () => {
        sibiGuideMode = "gestures";
        sibiGuideIndex = idx;
        if (sibiGestureTab) {
          sibiGestureTab.classList.add("active");
          if (sibiAlphabetTab) sibiAlphabetTab.classList.remove("active");
          if (sibiNumberTab) sibiNumberTab.classList.remove("active");
        }
        updateSibiGuide();
        closeSibiModal();
      });
      sibiModalGrid.appendChild(el);
    });
  }
}

function openSibiModal() {
  if (sibiModal) {
    sibiModal.style.display = "flex";
    renderModalGrid(sibiGuideMode === "numbers" ? "numbers" : (sibiGuideMode === "gestures" ? "gestures" : "alphabet"));
  }
}

function closeSibiModal() {
  if (sibiModal) sibiModal.style.display = "none";
}

if (sibiReferenceLink) {
  sibiReferenceLink.addEventListener("click", (e) => {
    e.preventDefault();
    openSibiModal();
  });
}
if (sibiModalCloseBtn) sibiModalCloseBtn.addEventListener("click", closeSibiModal);
if (sibiModalDoneBtn) sibiModalDoneBtn.addEventListener("click", closeSibiModal);
if (sibiModal) {
  sibiModal.addEventListener("click", (e) => {
    if (e.target === sibiModal) closeSibiModal();
  });
}
if (modalAlphabetTab) modalAlphabetTab.addEventListener("click", () => renderModalGrid("alphabet"));
if (modalNumbersTab) modalNumbersTab.addEventListener("click", () => renderModalGrid("numbers"));
if (modalGesturesTab) modalGesturesTab.addEventListener("click", () => renderModalGrid("gestures"));
if (modalChartTab) modalChartTab.addEventListener("click", () => renderModalGrid("chart"));

function updateSibiGuide() {
  let signs;
  if (sibiGuideMode === "alphabet") {
    signs = sibiAlphabet;
  } else if (sibiGuideMode === "numbers") {
    signs = sibiNumbers;
  } else {
    signs = sibiGestures.map(g => g.name);
  }

  const currentSign = signs[sibiGuideIndex];

  safeText(sibiCurrentSign, currentSign);
  safeText(sibiReferenceLetter, currentSign);

  if (sibiGuideMode === "gestures") {
    const gestureInfo = sibiGestures[sibiGuideIndex] || { desc: "Perform hand gesture" };
    if (sibiVisualPreviewWrapper) sibiVisualPreviewWrapper.style.display = "none";
    safeText(sibiReferenceText, `Special Gesture: ${currentSign}`);
    safeText(sibiSignInstruction, gestureInfo.desc);
    if (sibiReferenceLink) {
      sibiReferenceLink.style.display = "inline-flex";
      const span = sibiReferenceLink.querySelector("span");
      if (span) {
        span.textContent = `Open Gesture Handbook (${currentSign})`;
      } else {
        sibiReferenceLink.textContent = `Open Gesture Handbook (${currentSign}) ↗`;
      }
    }
  } else if (sibiGuideMode === "numbers") {
    const info = sibiNumbersDetails[currentSign] || { icon: "☝️", desc: "Make SIBI number gesture", img: `/static/images/sibi_numbers/${currentSign}.png` };
    if (sibiVisualPreviewWrapper) sibiVisualPreviewWrapper.style.display = "flex";
    if (sibiVisualImg) {
      sibiVisualImg.src = info.img || `/static/images/sibi_numbers/${currentSign}.png`;
      sibiVisualImg.alt = `SIBI Number ${currentSign}`;
    }
    safeText(
      sibiReferenceText,
      `✋ Posture: ${info.desc}`
    );
    safeText(
      sibiSignInstruction,
      `Make SIBI number gesture for '${currentSign}' in front of camera`
    );
    if (sibiReferenceLink) {
      sibiReferenceLink.style.display = "inline-flex";
      const span = sibiReferenceLink.querySelector("span");
      if (span) {
        span.textContent = `Open Number Handbook (${currentSign})`;
      } else {
        sibiReferenceLink.textContent = `Open Number Handbook (${currentSign}) ↗`;
      }
    }
  } else {
    const info = sibiAlphabetDetails[currentSign] || { icon: "✊", desc: "Make SIBI hand gesture", img: `/static/images/sibi/${currentSign}.png` };
    if (sibiVisualPreviewWrapper) sibiVisualPreviewWrapper.style.display = "flex";
    if (sibiVisualImg) {
      sibiVisualImg.src = info.img || `/static/images/sibi/${currentSign}.png`;
      sibiVisualImg.alt = `SIBI Sign ${currentSign}`;
    }
    safeText(
      sibiReferenceText,
      `✋ Posture: ${info.desc}`
    );
    safeText(
      sibiSignInstruction,
      `Make SIBI hand gesture for '${currentSign}' in front of camera`
    );
    if (sibiReferenceLink) {
      sibiReferenceLink.style.display = "inline-flex";
      const span = sibiReferenceLink.querySelector("span");
      if (span) {
        span.textContent = `Open Alphabet Handbook (${currentSign})`;
      } else {
        sibiReferenceLink.textContent = `Open Alphabet Handbook (${currentSign}) ↗`;
      }
    }
  }

  if (sibiOfficialExternalLink) {
    if (sibiGuideMode === "alphabet") {
      const letterNumber = sibiGuideIndex + 1;
      sibiOfficialExternalLink.href = `https://pkplk.kemendikdasmen.go.id/sibi/kosakata/katadasar/${letterNumber}`;
      if (sibiOfficialText) sibiOfficialText.textContent = `Official SIBI ${currentSign} Portal ↗`;
    } else if (sibiGuideMode === "numbers") {
      sibiOfficialExternalLink.href = "https://pkplk.kemendikdasmen.go.id/sibi/kosakata/angka";
      if (sibiOfficialText) sibiOfficialText.textContent = `Official Number ${currentSign} Portal ↗`;
    } else {
      sibiOfficialExternalLink.href = "https://pkplk.kemendikdasmen.go.id/sibi/kosakata/katadasar";
      if (sibiOfficialText) sibiOfficialText.textContent = `Official ${currentSign} Portal ↗`;
    }
  }

  safeText(
    sibiGuideCounter,
    `${sibiGuideIndex + 1} / ${signs.length}`
  );
}

if (sibiAlphabetTab) {
  sibiAlphabetTab.addEventListener("click", () => {
    sibiGuideMode = "alphabet";
    sibiGuideIndex = 0;

    sibiAlphabetTab.classList.add("active");

    if (sibiNumberTab) {
      sibiNumberTab.classList.remove("active");
    }
    if (sibiGestureTab) {
      sibiGestureTab.classList.remove("active");
    }

    updateSibiGuide();
  });
}

if (sibiNumberTab) {
  sibiNumberTab.addEventListener("click", () => {
    sibiGuideMode = "numbers";
    sibiGuideIndex = 0;

    sibiNumberTab.classList.add("active");

    if (sibiAlphabetTab) {
      sibiAlphabetTab.classList.remove("active");
    }
    if (sibiGestureTab) {
      sibiGestureTab.classList.remove("active");
    }

    updateSibiGuide();
  });
}

if (sibiGestureTab) {
  sibiGestureTab.addEventListener("click", () => {
    sibiGuideMode = "gestures";
    sibiGuideIndex = 0;

    sibiGestureTab.classList.add("active");

    if (sibiAlphabetTab) {
      sibiAlphabetTab.classList.remove("active");
    }
    if (sibiNumberTab) {
      sibiNumberTab.classList.remove("active");
    }

    updateSibiGuide();
  });
}

if (sibiPrevious) {
  sibiPrevious.addEventListener("click", () => {
    const signs =
      sibiGuideMode === "alphabet"
        ? sibiAlphabet
        : (sibiGuideMode === "numbers" ? sibiNumbers : sibiGestures.map(g => g.name));

    sibiGuideIndex =
      (sibiGuideIndex - 1 + signs.length) %
      signs.length;

    updateSibiGuide();
  });
}

if (sibiNext) {
  sibiNext.addEventListener("click", () => {
    const signs =
      sibiGuideMode === "alphabet"
        ? sibiAlphabet
        : (sibiGuideMode === "numbers" ? sibiNumbers : sibiGestures.map(g => g.name));

    sibiGuideIndex =
      (sibiGuideIndex + 1) %
      signs.length;

    updateSibiGuide();
  });
}

// Clean up camera hardware when navigating away or closing tab
window.addEventListener("beforeunload", () => {
  if (state.localStream) {
    state.localStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (e) {}
    });
  }
});

// Show A when the page loads
updateSibiGuide();

// Automatically initialize camera and media on page load so user sees their camera immediately
getLocalMedia()
  .then(() => console.log("[Sign Connect AI] Camera feed and AI recognition active on startup."))
  .catch((err) => console.log("[Sign Connect AI] Initial camera auto-request:", err));
})();

