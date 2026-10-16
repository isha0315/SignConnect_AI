(() => {
  "use strict";

  // ==========================================================
  // SIGNCONNECT
  // VIDEO CALL + SIGN LANGUAGE AI RECOGNITION
  // ==========================================================

  const $ = (id) => document.getElementById(id);

  // ==========================================================
  // SOCKET.IO
  // ==========================================================

  const socket = window.io
    ? window.io({
        transports: ["polling"],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
      })
    : null;

  if (!socket) {
    console.error("[SignConnect] Socket.IO is not available.");
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

    remotePeerId: null,
  };

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
    recognized: $("recognizedText"),
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

  function speakText(text) {
    if (!text || !("speechSynthesis" in window)) {
      return;
    }

    if (state.lastSpoken === text) {
      return;
    }

    state.lastSpoken = text;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    utterance.rate = 0.95;

    utterance.pitch = 1;

    utterance.volume = 1;

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

    safeText(els.character, detectedCharacter);

    safeText(els.overlayCharacter, detectedCharacter);
  }

  // ==========================================================
  // CURRENT PHRASE
  // ==========================================================

  function updateRecognizedPhrase(phrase) {
    const value = typeof phrase === "string" ? phrase : "";

    state.recognizedPhrase = value;

    if (els.recognized) {
      els.recognized.textContent = value || "—";
    }

    console.log("[AI PHRASE]", value || "—");
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

    if (data.mode === "number" || data.mode === "alphabet") {
      state.recognitionMode = data.mode;

      state.mode = data.mode;

      updateModeUI();
    }

    if (typeof data.current_phrase === "string") {
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
  }

  if (socket) {
    socket.on("recognition_update", recognition);
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

      if (data.mode === "alphabet" || data.mode === "number") {
        state.recognitionMode = data.mode;

        state.mode = data.mode;

        updateModeUI();
      }

      if (typeof data.current_phrase === "string") {
        updateRecognizedPhrase(data.current_phrase);
      }

      if (data.command === "send") {
        updateRecognizedPhrase("");
      }
    });
  }

  // ==========================================================
  // MODE UI
  // ==========================================================

  function updateModeUI() {
    safeText(
      els.mode,
      state.recognitionMode === "number" ? "Numbers" : "Alphabet",
    );

    if (els.alphabetMode) {
      els.alphabetMode.classList.toggle(
        "active",
        state.recognitionMode === "alphabet",
      );
    }

    if (els.numberMode) {
      els.numberMode.classList.toggle(
        "active",
        state.recognitionMode === "number",
      );
    }
  }

  function sendRecognitionControl(command) {
    if (!socket) return;

    socket.emit("recognition_control", {
      username: name(),

      command: command,

      action: command,
    });
  }

  function setRecognitionMode(mode) {
    if (mode !== "alphabet" && mode !== "number") {
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

    state.recognitionHistory = [];

    state.lastAcceptedCharacter = "";
  }

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

    if (state.voiceEnabled) {
      state.lastSpoken = "";

      speakText(phrase);
    }

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

  if (undoElement) {
    undoElement.addEventListener("click", undoSign);
  }

  if (spaceElement) {
    spaceElement.addEventListener("click", addSpaceToSign);
  }

  if (sendSignElement) {
    sendSignElement.addEventListener("click", sendSignPhrase);
  }
  // ==========================================================
  // BROWSER CAMERA → AI
  // ==========================================================

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

    const targetWidth = 640;

    const targetHeight = Math.round(height * (targetWidth / width));

    state.recognitionCanvas.width = targetWidth;

    state.recognitionCanvas.height = targetHeight;

    // --------------------------------------------------------
    // Draw current camera frame
    // --------------------------------------------------------

    state.recognitionContext.drawImage(video, 0, 0, targetWidth, targetHeight);

    state.recognitionBusy = true;

    try {
      const image = state.recognitionCanvas.toDataURL("image/jpeg", 0.6);

      socket.emit("recognition_frame", {
        image: image,

        username: name(),

        mode: state.recognitionMode,
      });

      // ------------------------------------------------------
      // Prevent flooding the server
      // ------------------------------------------------------

      window.setTimeout(() => {
        state.recognitionBusy = false;
      }, 150);
    } catch (error) {
      console.error("[AI] Could not capture frame:", error);

      state.recognitionBusy = false;
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

    const interval = Math.round(1000 / state.recognitionFPS);

    state.recognitionInterval = window.setInterval(
      sendRecognitionFrame,
      interval,
    );

    console.log("[AI] Browser recognition started.");
  }

  // ==========================================================
  // STOP RECOGNITION
  // ==========================================================

  function stopRecognitionStream() {
    if (state.recognitionInterval) {
      window.clearInterval(state.recognitionInterval);

      state.recognitionInterval = null;
    }

    state.recognitionBusy = false;

    console.log("[AI] Browser recognition stopped.");
  }

  // ==========================================================
  // CAMERA / MICROPHONE
  // ==========================================================

  async function getLocalMedia() {
    if (state.localStream) {
      return state.localStream;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: {
            ideal: 1280,
          },

          height: {
            ideal: 720,
          },

          facingMode: "user",
        },

        audio: true,
      });

      state.localStream = stream;

      state.cameraEnabled = stream
        .getVideoTracks()
        .some((track) => track.enabled);

      state.microphoneEnabled = stream
        .getAudioTracks()
        .some((track) => track.enabled);

      // ------------------------------------------------------
      // Local video
      // ------------------------------------------------------

      if (els.localVideo) {
        els.localVideo.srcObject = stream;

        els.localVideo.muted = true;

        els.localVideo.playsInline = true;

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

      startRecognitionStream();

      console.log("[Media] Camera and microphone ready.");

      return stream;
    } catch (error) {
      console.error("[Media] getUserMedia failed:", error);

      setConnectionStatus("Camera/microphone permission required");

      throw error;
    }
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

    safeText(els.cameraLabel, state.cameraEnabled ? "Camera On" : "Camera Off");

    safeText(
      els.microphoneLabel,
      state.microphoneEnabled ? "Mic On" : "Mic Off",
    );

    if (els.localPlaceholder) {
      els.localPlaceholder.style.display = state.cameraEnabled ? "none" : "";
    }

    if (els.localLiveIndicator) {
      els.localLiveIndicator.style.display = state.cameraEnabled ? "" : "none";
    }
  }

  // ==========================================================
  // CAMERA TOGGLE
  // ==========================================================

  async function toggleCamera() {
    try {
      if (!state.localStream) {
        await getLocalMedia();

        return;
      }

      const tracks = state.localStream.getVideoTracks();

      if (!tracks.length) {
        await getLocalMedia();

        return;
      }

      state.cameraEnabled = !state.cameraEnabled;

      tracks.forEach((track) => {
        track.enabled = state.cameraEnabled;
      });

      updateLocalMediaUI();

      if (state.cameraEnabled) {
        startRecognitionStream();
      } else {
        stopRecognitionStream();

        updateRecognitionCharacter("—");

        updateConfidence(0);

        updateHandStatus(false);
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

  const rtcConfiguration = {
    iceServers: [
      {
        urls: ["stun:stun.l.google.com:19302"],
      },
    ],
  };

  // ==========================================================
  // CREATE PEER CONNECTION
  // ==========================================================

  function createPeerConnection() {
    if (state.peerConnection) {
      return state.peerConnection;
    }

    const pc = new RTCPeerConnection(rtcConfiguration);

    state.peerConnection = pc;

    // --------------------------------------------------------
    // Local tracks
    // --------------------------------------------------------

    if (state.localStream) {
      state.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, state.localStream);
      });
    }

    // --------------------------------------------------------
    // Remote stream
    // --------------------------------------------------------

    pc.ontrack = (event) => {
      console.log("[WebRTC] Remote track received.");

      let stream = event.streams && event.streams[0];

      if (!stream) {
        stream = new MediaStream();

        stream.addTrack(event.track);
      }

      if (els.remoteVideo) {
        els.remoteVideo.srcObject = stream;

        els.remoteVideo.autoplay = true;

        els.remoteVideo.playsInline = true;

        els.remoteVideo.play().catch(() => {});
      }

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
    // ICE
    // --------------------------------------------------------

    pc.onicecandidate = (event) => {
      if (!event.candidate || !socket) {
        return;
      }

      socket.emit("webrtc_signal", {
        type: "candidate",

        candidate: event.candidate,

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

          break;

        case "connecting":
          setCallBadge("Connecting...");

          updateCallButtonState("Connecting...");

          break;

        case "disconnected":
          setCallBadge("Disconnected");

          updateCallButtonState("Disconnected");

          break;

        case "failed":
          setCallBadge("Connection failed");

          updateCallButtonState("Failed");

          /*
           * Do not stop local camera.
           * It is still required for sign recognition.
           */
          break;

        case "closed":
          setCallBadge("Call ended");

          updateCallButtonState("Closed");

          break;
      }
    };

    // --------------------------------------------------------
    // ICE state
    // --------------------------------------------------------

    pc.oniceconnectionstatechange = () => {
      console.log("[WebRTC] ICE state:", pc.iceConnectionState);
    };

    return pc;
  }

  // ==========================================================
  // START CALL
  // ==========================================================

  async function startCall() {
    if (!socket) {
      console.error("[WebRTC] Socket unavailable.");

      return;
    }

    /*
     * Prevent creating a second connection
     * while another call is active.
     */
    if (state.peerConnection && state.inCall) {
      console.warn("[WebRTC] Call already active.");

      return;
    }

    try {
      await getLocalMedia();

      state.pendingIceCandidates = [];

      state.callStartedByMe = true;

      state.inCall = true;

      const pc = createPeerConnection();

      setCallBadge("Calling...");

      updateCallButtonState("Calling...");

      const offer = await pc.createOffer();

      await pc.setLocalDescription(offer);

      socket.emit("webrtc_signal", {
        type: "offer",

        sdp: offer,

        username: name(),
      });

      console.log("[WebRTC] Offer sent.");
    } catch (error) {
      console.error("[WebRTC] Start call failed:", error);

      state.inCall = false;

      state.callStartedByMe = false;

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

    state.remotePeerId = null;

    // --------------------------------------------------------
    // Clear remote video
    // --------------------------------------------------------

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
 * Stop local camera and microphone when the call ends.
 */
if (state.localStream) {
  stopRecognitionStream();

  state.localStream.getTracks().forEach((track) => {
    track.stop();
  });

  state.localStream = null;
}

state.cameraEnabled = false;
state.microphoneEnabled = false;

if (els.localVideo) {
  els.localVideo.srcObject = null;
}

updateLocalMediaUI();

updateRecognitionCharacter("—");
updateConfidence(0);
updateHandStatus(false);
    console.log("[WebRTC] Call ended.");
  }

  // ==========================================================
  // CALL BUTTONS
  // ==========================================================

  if (els.startCallButton) {
    els.startCallButton.addEventListener("click", startCall);
  }

  if (els.endCallButton) {
    els.endCallButton.addEventListener("click", () => {
      if (state.peerConnection || state.inCall) {
        endCall(true);
      }
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
          await getLocalMedia();

          /*
           * If an old connection somehow exists,
           * close it before accepting the new offer.
           */
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

            sdp: answer,

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
          const pc = state.peerConnection;

          if (!pc) {
            console.warn("[WebRTC] No peer connection for answer.");

            return;
          }

          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

          await applyPendingIceCandidates();

          setRemoteName(data.username || "");

          setCallBadge("Connecting...");

          updateCallButtonState("Connecting...");

          console.log("[WebRTC] Answer applied.");

          return;
        }

        // --------------------------------------------------
        // ICE CANDIDATE
        // --------------------------------------------------

        if (data.type === "candidate") {
          const candidate = data.candidate;

          if (!candidate) {
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
    // Don't intercept normal typing.
    if (
      event.target &&
      (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA")
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

  console.log("%cSignConnect initialized.", "font-weight:bold;");

  console.log("[AI] Recognition mode:", state.recognitionMode);
// ============================================================
// SIBI HAND GESTURE GUIDE
// ============================================================

const sibiAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const sibiNumbers = "123456789".split("");

let sibiGuideMode = "alphabet";
let sibiGuideIndex = 0;

const sibiAlphabetTab = $("sibiAlphabetTab");
const sibiNumberTab = $("sibiNumberTab");
const sibiPrevious = $("sibiPrevious");
const sibiNext = $("sibiNext");
const sibiCurrentSign = $("sibiCurrentSign");
const sibiGuideCounter = $("sibiGuideCounter");
const sibiSignInstruction = $("sibiSignInstruction");
const sibiReferenceLetter = $("sibiReferenceLetter");
const sibiReferenceText = $("sibiReferenceText");
const sibiReferenceLink = $("sibiReferenceLink");

function updateSibiGuide() {
  const signs =
    sibiGuideMode === "alphabet"
      ? sibiAlphabet
      : sibiNumbers;

  const currentSign = signs[sibiGuideIndex];

  safeText(sibiCurrentSign, currentSign);
  safeText(sibiReferenceLetter, currentSign);

  safeText(
    sibiReferenceText,
    `Official SIBI reference for ${currentSign}`
  );

  safeText(
    sibiSignInstruction,
    `Make the SIBI hand gesture for ${currentSign}`
  );

  safeText(
    sibiGuideCounter,
    `${sibiGuideIndex + 1} / ${signs.length}`
  );

  if (sibiReferenceLink) {
    if (sibiGuideMode === "alphabet") {
      const letterNumber =
        sibiGuideIndex + 1;

      sibiReferenceLink.href =
        `https://pkplk.kemendikdasmen.go.id/sibi/kosakata/katadasar/${letterNumber}`;

      sibiReferenceLink.textContent =
        `View SIBI ${currentSign} Gesture`;
    } else {
      sibiReferenceLink.href =
        "https://pkplk.kemendikdasmen.go.id/sibi/kosakata/angka";

      sibiReferenceLink.textContent =
        `View SIBI ${currentSign} Reference`;
    }
  }
}

if (sibiAlphabetTab) {
  sibiAlphabetTab.addEventListener("click", () => {
    sibiGuideMode = "alphabet";
    sibiGuideIndex = 0;

    sibiAlphabetTab.classList.add("active");

    if (sibiNumberTab) {
      sibiNumberTab.classList.remove("active");
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

    updateSibiGuide();
  });
}

if (sibiPrevious) {
  sibiPrevious.addEventListener("click", () => {
    const signs =
      sibiGuideMode === "alphabet"
        ? sibiAlphabet
        : sibiNumbers;

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
        : sibiNumbers;

    sibiGuideIndex =
      (sibiGuideIndex + 1) %
      signs.length;

    updateSibiGuide();
  });
}

// Show A when the page loads
updateSibiGuide();
})();
