/**
 * ============================================================
 * SIGN CONNECT AI — 2D AVATAR (STICKER) SIGN LANGUAGE VISUALIZER
 * ============================================================
 *
 * Displays high-quality 2D animated stickers for recognized
 * sign language gestures. These pop up as overlays directly
 * on the video feed ONLY when the Special Gestures tab is selected.
 *
 * Supported phrases:
 *   hello, thank you, yes, no, goodbye, i love you, welcome, please,
 *   help, sorry, good morning, how are you, water, nice to meet you, stop
 * ============================================================
 */

const SignAvatar = (() => {
  "use strict";

  // ========== CONFIG ==========
  const SUPPORTED_SIGNS = [
    "hello",
    "thank you",
    "yes",
    "no",
    "goodbye",
    "i love you",
    "welcome",
    "please",
    "help",
    "sorry",
    "good morning",
    "how are you",
    "water",
    "nice to meet you",
    "stop",
  ];

  const ANIMATION_DURATION = 2000; // Display duration per sticker

  // Map signs to their image filenames
  const SIGN_IMAGES = {
    "hello": "hello.jpg",
    "thank you": "thank_you.jpg",
    "yes": "yes.jpg",
    "no": "no.jpg",
    "goodbye": "goodbye.jpg",
    "i love you": "i_love_you.jpg",
    "welcome": "welcome.jpg",
    "please": "please.jpg",
    "help": "help.jpg",
    "sorry": "sorry.jpg",
    "good morning": "good_morning.jpg",
    "how are you": "how_are_you.jpg",
    "water": "water.jpg",
    "nice to meet you": "nice_to_meet_you.jpg",
    "stop": "stop.jpg"
  };

  // ========== STATE ==========
  let controlsContainer = null;
  let overlayContainer = null;
  let stickerImg = null;
  let isPlaying = false;
  let currentAnimation = null;
  let animationQueue = [];
  let hideTimeout = null;

  // ========== MODE CHECK ==========
  function isGestureTabActive() {
    // 1. Check window.state / global state
    if (typeof window !== "undefined") {
      if (window.state && typeof window.state.recognitionMode === "string") {
        return window.state.recognitionMode === "gesture";
      }
      if (typeof window.recognitionMode === "string") {
        return window.recognitionMode === "gesture";
      }
    }
    if (typeof state !== "undefined" && state && typeof state.recognitionMode === "string") {
      return state.recognitionMode === "gesture";
    }
    // 2. Check DOM button states directly
    const gestureBtn = document.getElementById("gestureMode");
    if (gestureBtn && gestureBtn.classList.contains("active")) {
      return true;
    }
    const alphabetBtn = document.getElementById("alphabetMode");
    const numberBtn = document.getElementById("numberMode");
    if ((alphabetBtn && alphabetBtn.classList.contains("active")) || 
        (numberBtn && numberBtn.classList.contains("active"))) {
      return false;
    }
    return false;
  }

  // ========== DISMISS POPUP ==========
  function dismissPopup() {
    isPlaying = false;
    currentAnimation = null;
    animationQueue = [];
    clearTimeout(hideTimeout);
    if (overlayContainer) {
      overlayContainer.classList.remove("show");
    }
    if (stickerImg) {
      stickerImg.classList.remove("pop-in");
      stickerImg.src = "";
    }
    if (controlsContainer) {
      controlsContainer.querySelectorAll(".avatar2d-chip").forEach(chip => {
        chip.classList.remove("active-chip");
      });
    }
  }

  // ========== UPDATE VISIBILITY ==========
  function updateVisibility() {
    if (controlsContainer) {
      const active = isGestureTabActive();
      if (active) {
        controlsContainer.classList.add("active-gesture-mode");
        controlsContainer.style.setProperty("display", "flex", "important");
      } else {
        controlsContainer.classList.remove("active-gesture-mode");
        controlsContainer.style.setProperty("display", "none", "important");
        dismissPopup();
      }
    }
  }

  // ========== PLAY ANIMATION ==========
  function playAnimation(signName) {
    if (!signName) return false;
    // Strictly specific to the Special Gestures tab: do not pop up if user is on Alphabet or Number tab!
    if (!isGestureTabActive()) {
      console.log("[2D AVATAR] Suppressed animation: current mode is not 'gesture'.");
      return false;
    }
    const key = String(signName).toLowerCase().trim().replace(/_/g, " ");
    if (!SUPPORTED_SIGNS.includes(key)) return false;

    if (isPlaying) {
      // Don't spam or duplicate the currently playing animation or already queued items
      if (currentAnimation === key || animationQueue.includes(key) || animationQueue.length >= 1) {
        return false;
      }
      animationQueue.push(key);
      return true;
    }

    isPlaying = true;
    currentAnimation = key;

    // Highlight active chip
    if (controlsContainer) {
      controlsContainer.querySelectorAll(".avatar2d-chip").forEach(chip => {
        if (chip.dataset.sign === key) {
          chip.classList.add("active-chip");
        } else {
          chip.classList.remove("active-chip");
        }
      });
    }

    // Set sticker source and trigger pop animation
    if (stickerImg && overlayContainer) {
      overlayContainer.classList.add("show");
      stickerImg.src = `/static/img/stickers/${SIGN_IMAGES[key]}`;
      stickerImg.classList.remove("pop-in");
      
      // Force reflow to restart animation
      void stickerImg.offsetWidth;
      
      stickerImg.classList.add("pop-in");
    }

    // Schedule hiding/next
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      finishAnimation();
    }, ANIMATION_DURATION);

    return true;
  }

  function finishAnimation() {
    isPlaying = false;
    currentAnimation = null;

    if (stickerImg) {
      stickerImg.classList.remove("pop-in");
    }

    // Clear active chip
    if (controlsContainer) {
      controlsContainer.querySelectorAll(".avatar2d-chip").forEach(chip => {
        chip.classList.remove("active-chip");
      });
    }

    // Play next in queue
    if (animationQueue.length > 0) {
      const next = animationQueue.shift();
      setTimeout(() => playAnimation(next), 100);
    } else {
      if (overlayContainer) {
        overlayContainer.classList.remove("show");
      }
    }
  }

  // ========== PHRASE DETECTION ==========
  function detectAndPlay(text) {
    if (!isGestureTabActive()) return;
    if (!text) return;
    const lower = text.toLowerCase().trim();

    for (const sign of SUPPORTED_SIGNS) {
      if (lower === sign || lower.includes(sign)) {
        playAnimation(sign);
        return;
      }
    }
  }

  // ========== CREATE DOM ==========
  function createPanel() {
    // 1. Setup Controls (chips) below call controls (hidden by default unless Special Gestures is active)
    controlsContainer = document.createElement("div");
    controlsContainer.id = "avatar2dControls";
    controlsContainer.style.setProperty("display", isGestureTabActive() ? "flex" : "none", "important");
    
    const callControls = document.querySelector(".call-controls");
    if (callControls && callControls.parentElement) {
      callControls.parentElement.insertBefore(controlsContainer, callControls.nextSibling);
    }

    // 2. Setup Overlay on viewport (body)
    overlayContainer = document.createElement("div");
    overlayContainer.id = "avatar2dOverlay";
    overlayContainer.innerHTML = `<img id="avatar2dSticker" src="" alt="Sign Sticker" />`;

    document.body.appendChild(overlayContainer);

    stickerImg = document.getElementById("avatar2dSticker");

    // 3. Build quick-trigger chips
    SUPPORTED_SIGNS.forEach((sign) => {
      const chip = document.createElement("button");
      chip.className = "avatar2d-chip";
      chip.textContent = sign
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      chip.type = "button";
      chip.dataset.sign = sign;
      chip.addEventListener("click", () => {
        if (!isGestureTabActive()) {
          console.warn("[2D AVATAR] Cannot send sticker while not on Special Gestures tab");
          return;
        }
        playAnimation(sign);
        // Send sticker to room peers
        try {
          const socketObj = window.socket || (typeof socket !== "undefined" ? socket : null);
          if (socketObj && socketObj.connected) {
            const userName = typeof name === "function" ? name() : (window.username || "User");
            socketObj.emit("send_message", {
              username: userName,
              message: sign,
              message_type: "sticker"
            });
            socketObj.emit("send_sticker", {
              username: userName,
              gesture: sign
            });
          }
        } catch (e) {
          console.warn("[2D AVATAR] Socket emit error:", e);
        }
      });
      controlsContainer.appendChild(chip);
    });

    updateVisibility();
  }

  // ========== INJECT STYLES ==========
  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #avatar2dOverlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        display: none;
        align-items: center;
        justify-content: center;
        pointer-events: none; /* Let clicks pass through to video */
        z-index: 9999;
      }
      
      #avatar2dOverlay.show {
        display: flex;
      }
      
      #avatar2dSticker {
        max-width: 280px;
        max-height: 280px;
        transform: scale(0);
        filter: drop-shadow(0 15px 35px rgba(0, 0, 0, 0.4));
        border-radius: 20px;
        background: #ffffff;
        border: 4px solid #ffffff;
      }
      
      /* Overlay pop animation lasting the full duration */
      .pop-in {
        animation: stickerPopOverlay 2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      }
      
      @keyframes stickerPopOverlay {
        0% { transform: scale(0.3) rotate(-15deg); opacity: 0; }
        15% { transform: scale(1.1) rotate(5deg); opacity: 1; }
        25% { transform: scale(1) rotate(0deg); opacity: 1; }
        75% { transform: scale(1) translateY(-10px); opacity: 1; }
        100% { transform: scale(0.7) translateY(40px); opacity: 0; }
      }
      
      #avatar2dControls {
        display: none !important;
        flex-wrap: wrap;
        gap: 8px;
        padding: 0 0 15px 0;
        justify-content: center;
      }

      #avatar2dControls.active-gesture-mode {
        display: flex !important;
      }

      .avatar2d-chip {
        padding: 6px 14px;
        border: 1px solid rgba(16, 185, 129, 0.3);
        border-radius: 99px;
        background: rgba(255, 255, 255, 0.8);
        color: #059669;
        font: 600 12px 'DM Sans', sans-serif;
        cursor: pointer;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        backdrop-filter: blur(10px);
      }
      .avatar2d-chip:hover {
        background: #fff;
        border-color: rgba(16, 185, 129, 0.5);
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.15);
      }
      .avatar2d-chip.active-chip {
        background: #10b981;
        color: white;
        border-color: #10b981;
        transform: scale(1.05);
        box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4);
      }
      .avatar2d-chip:active { transform: scale(0.96); }
    `;
    document.head.appendChild(style);
  }

  // ========== PUBLIC INIT ==========
  function init() {
    injectStyles();
    createPanel();
    updateVisibility();
    console.log("[2D AVATAR] Initialized overlay with", SUPPORTED_SIGNS.length, "stickers. Active mode gesture:", isGestureTabActive());
  }

  // ========== PUBLIC API ==========
  return {
    init,
    playAnimation,
    detectAndPlay,
    dismissPopup,
    updateVisibility,
    isGestureTabActive,
    SUPPORTED_SIGNS,
    SIGN_IMAGES,
  };
})();

// ========== EXPOSE TO WINDOW ==========
window.SignAvatar = SignAvatar;

// ========== AUTO-INITIALIZE ON DOM READY ==========
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    SignAvatar.init();
  });
} else {
  SignAvatar.init();
}
