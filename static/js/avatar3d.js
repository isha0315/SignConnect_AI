/**
 * ============================================================
 * SIGNCONNECT — 3D AVATAR SIGN LANGUAGE VISUALIZER
 * ============================================================
 *
 * A procedural 3D humanoid avatar built with Three.js that
 * plays sign-language gesture animations when recognized
 * words/phrases are detected.
 *
 * Supported phrases:
 *   hello, thank you, yes, no, goodbye, i love you, welcome, please
 *
 * The avatar appears in a floating glass panel overlaid on the
 * video feed for maximum visibility.
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
  ];

  const ANIMATION_DURATION = 2500; // ms per gesture animation
  const IDLE_SWAY_SPEED = 0.003;

  // ========== STATE ==========
  let scene, camera, renderer, clock;
  let avatar = {};      // body part meshes
  let container = null;  // DOM container
  let labelEl = null;    // label showing current sign
  let isPlaying = false;
  let currentAnimation = null;
  let animationStart = 0;
  let animationQueue = [];
  let initialized = false;
  let panelVisible = true;

  // ========== COLORS ==========
  const SKIN = 0xf4c8a0;
  const SHIRT = 0x4f8cff;
  const PANTS = 0x2d3a55;
  const HAIR = 0x3b2314;
  const SHOE = 0x1a1a2e;
  const EYE_WHITE = 0xffffff;
  const EYE_IRIS = 0x2d5016;

  // ========== MATERIALS ==========
  function makeMat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness !== undefined ? opts.roughness : 0.6,
      metalness: opts.metalness !== undefined ? opts.metalness : 0.05,
      ...opts,
    });
  }

  // ========== BUILD AVATAR ==========
  function buildAvatar() {
    const root = new THREE.Group();
    root.position.set(0, -1.2, 0);

    // ── BODY (torso) ──
    const torsoGeo = new THREE.CylinderGeometry(0.38, 0.32, 0.9, 16);
    const torso = new THREE.Mesh(torsoGeo, makeMat(SHIRT));
    torso.position.y = 1.3;
    root.add(torso);
    avatar.torso = torso;

    // ── NECK ──
    const neckGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.15, 12);
    const neck = new THREE.Mesh(neckGeo, makeMat(SKIN));
    neck.position.y = 1.82;
    root.add(neck);
    avatar.neck = neck;

    // ── HEAD ──
    const headGroup = new THREE.Group();
    headGroup.position.y = 2.12;
    root.add(headGroup);
    avatar.headGroup = headGroup;

    const headGeo = new THREE.SphereGeometry(0.28, 20, 16);
    const head = new THREE.Mesh(headGeo, makeMat(SKIN));
    headGroup.add(head);
    avatar.head = head;

    // Hair
    const hairGeo = new THREE.SphereGeometry(0.30, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const hair = new THREE.Mesh(hairGeo, makeMat(HAIR));
    hair.position.y = 0.04;
    headGroup.add(hair);

    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.045, 10, 10);
    const irisGeo = new THREE.SphereGeometry(0.025, 10, 10);

    [-1, 1].forEach((side) => {
      const eyeWhite = new THREE.Mesh(eyeGeo, makeMat(EYE_WHITE));
      eyeWhite.position.set(side * 0.1, 0.03, 0.24);
      headGroup.add(eyeWhite);

      const iris = new THREE.Mesh(irisGeo, makeMat(EYE_IRIS));
      iris.position.set(side * 0.1, 0.03, 0.27);
      headGroup.add(iris);
    });

    // Mouth (small torus for smile)
    const mouthGeo = new THREE.TorusGeometry(0.06, 0.015, 8, 16, Math.PI);
    const mouth = new THREE.Mesh(mouthGeo, makeMat(0xd4756b));
    mouth.position.set(0, -0.08, 0.23);
    mouth.rotation.x = Math.PI;
    headGroup.add(mouth);
    avatar.mouth = mouth;

    // ── ARMS ──
    const armGeo = new THREE.CylinderGeometry(0.07, 0.06, 0.55, 10);
    const forearmGeo = new THREE.CylinderGeometry(0.06, 0.055, 0.5, 10);

    ["left", "right"].forEach((side) => {
      const sign = side === "left" ? -1 : 1;

      // Upper arm pivot
      const shoulderPivot = new THREE.Group();
      shoulderPivot.position.set(sign * 0.44, 1.7, 0);
      root.add(shoulderPivot);

      const upperArm = new THREE.Mesh(armGeo, makeMat(SHIRT));
      upperArm.position.y = -0.28;
      shoulderPivot.add(upperArm);

      // Elbow pivot
      const elbowPivot = new THREE.Group();
      elbowPivot.position.y = -0.55;
      shoulderPivot.add(elbowPivot);

      const forearm = new THREE.Mesh(forearmGeo, makeMat(SKIN));
      forearm.position.y = -0.25;
      elbowPivot.add(forearm);

      // Hand
      const handGeo = new THREE.SphereGeometry(0.08, 10, 10);
      const hand = new THREE.Mesh(handGeo, makeMat(SKIN));
      hand.position.y = -0.52;
      hand.scale.set(1, 0.7, 0.9);
      elbowPivot.add(hand);

      // Fingers (5 small cylinders)
      const fingerGroup = new THREE.Group();
      fingerGroup.position.y = -0.58;
      elbowPivot.add(fingerGroup);

      for (let f = -2; f <= 2; f++) {
        const fingerLen = f === 0 ? 0.12 : f === -2 || f === 2 ? 0.07 : 0.1;
        const fingerGeo = new THREE.CylinderGeometry(0.015, 0.012, fingerLen, 6);
        const finger = new THREE.Mesh(fingerGeo, makeMat(SKIN));
        finger.position.set(f * 0.02, -fingerLen / 2, 0);
        fingerGroup.add(finger);
      }

      avatar[side + "Shoulder"] = shoulderPivot;
      avatar[side + "Elbow"] = elbowPivot;
      avatar[side + "Hand"] = hand;
      avatar[side + "Fingers"] = fingerGroup;
    });

    // ── LEGS ──
    const legGeo = new THREE.CylinderGeometry(0.1, 0.08, 0.65, 10);

    ["left", "right"].forEach((side) => {
      const sign = side === "left" ? -1 : 1;

      const hipPivot = new THREE.Group();
      hipPivot.position.set(sign * 0.15, 0.85, 0);
      root.add(hipPivot);

      const leg = new THREE.Mesh(legGeo, makeMat(PANTS));
      leg.position.y = -0.33;
      hipPivot.add(leg);

      // Foot
      const footGeo = new THREE.BoxGeometry(0.12, 0.06, 0.2);
      const foot = new THREE.Mesh(footGeo, makeMat(SHOE));
      foot.position.set(0, -0.68, 0.04);
      hipPivot.add(foot);

      avatar[side + "Hip"] = hipPivot;
    });

    scene.add(root);
    avatar.root = root;
    return root;
  }

  // ========== ANIMATION KEYFRAME SYSTEM ==========
  // Each animation is a function(t) where t is 0→1 progress
  // It sets joint rotations/positions each frame.

  function resetPose() {
    avatar.leftShoulder.rotation.set(0, 0, 0);
    avatar.rightShoulder.rotation.set(0, 0, 0);
    avatar.leftElbow.rotation.set(0, 0, 0);
    avatar.rightElbow.rotation.set(0, 0, 0);
    avatar.headGroup.rotation.set(0, 0, 0);
    avatar.leftFingers.rotation.set(0, 0, 0);
    avatar.rightFingers.rotation.set(0, 0, 0);
    avatar.leftHip.rotation.set(0, 0, 0);
    avatar.rightHip.rotation.set(0, 0, 0);
    avatar.torso.rotation.set(0, 0, 0);
  }

  function ease(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function pingpong(t) {
    return t < 0.5 ? t * 2 : 2 - t * 2;
  }

  // ── HELLO: wave right hand ──
  function animHello(t) {
    const wave = pingpong(t);
    const waveOscillate = Math.sin(t * Math.PI * 6) * 0.35;

    // Raise right arm
    avatar.rightShoulder.rotation.z = -Math.PI * 0.75 * ease(wave);
    avatar.rightShoulder.rotation.x = -0.2 * ease(wave);
    avatar.rightElbow.rotation.z = waveOscillate * ease(wave);
    avatar.rightElbow.rotation.x = -0.5 * ease(wave);

    // Slight head tilt
    avatar.headGroup.rotation.z = Math.sin(t * Math.PI * 4) * 0.08;

    // Friendly smile — slight mouth scale
    avatar.mouth.scale.x = 1 + 0.3 * ease(wave);
  }

  // ── THANK YOU: hand from chin forward ──
  function animThankYou(t) {
    const lift = ease(pingpong(t));
    const forward = t < 0.4 ? ease(t / 0.4) : t < 0.7 ? 1 : ease((1 - t) / 0.3);

    // Right arm lifts to chin then moves forward
    avatar.rightShoulder.rotation.x = -1.2 * lift;
    avatar.rightShoulder.rotation.z = -0.3 * lift;
    avatar.rightElbow.rotation.x = -1.0 * lift + 0.6 * forward;

    // Head nod
    avatar.headGroup.rotation.x = -0.15 * forward;

    // Left arm slightly
    avatar.leftShoulder.rotation.x = -0.3 * lift;
    avatar.leftElbow.rotation.x = -0.4 * lift + 0.3 * forward;
  }

  // ── YES: head nod with thumbs up ──
  function animYes(t) {
    const nod = Math.sin(t * Math.PI * 5) * 0.22;
    const armUp = ease(pingpong(t));

    avatar.headGroup.rotation.x = nod;

    // Thumbs up — right arm
    avatar.rightShoulder.rotation.x = -0.6 * armUp;
    avatar.rightShoulder.rotation.z = -0.3 * armUp;
    avatar.rightElbow.rotation.x = -1.2 * armUp;
    avatar.rightFingers.rotation.x = 0.5 * armUp; // fist-like curl
  }

  // ── NO: head shake with finger wag ──
  function animNo(t) {
    const shake = Math.sin(t * Math.PI * 6) * 0.2;
    const armUp = ease(pingpong(t));
    const wag = Math.sin(t * Math.PI * 8) * 0.4;

    avatar.headGroup.rotation.y = shake;

    // Right arm up, wagging finger
    avatar.rightShoulder.rotation.x = -0.8 * armUp;
    avatar.rightShoulder.rotation.z = -0.35 * armUp;
    avatar.rightElbow.rotation.x = -0.9 * armUp;
    avatar.rightElbow.rotation.z = wag * armUp;
  }

  // ── GOODBYE: waving (both sides slightly) ──
  function animGoodbye(t) {
    const wave = pingpong(t);
    const osc = Math.sin(t * Math.PI * 5) * 0.4;

    // Right arm waves
    avatar.rightShoulder.rotation.z = -Math.PI * 0.65 * ease(wave);
    avatar.rightShoulder.rotation.x = -0.15 * ease(wave);
    avatar.rightElbow.rotation.z = osc * ease(wave);

    // Left arm slight raise
    avatar.leftShoulder.rotation.z = Math.PI * 0.2 * ease(wave);

    // Body slight sway
    avatar.torso.rotation.z = Math.sin(t * Math.PI * 3) * 0.04;
    avatar.headGroup.rotation.z = Math.sin(t * Math.PI * 5) * 0.06;
  }

  // ── I LOVE YOU: ILY hand sign (index + pinky + thumb extended) ──
  function animILoveYou(t) {
    const raise = ease(pingpong(t));
    const pulse = Math.sin(t * Math.PI * 3) * 0.06;

    // Right arm raised, showing ILY sign
    avatar.rightShoulder.rotation.x = -1.0 * raise;
    avatar.rightShoulder.rotation.z = -0.5 * raise;
    avatar.rightElbow.rotation.x = -0.6 * raise;

    // Left hand to chest (heart)
    avatar.leftShoulder.rotation.x = -0.5 * raise;
    avatar.leftShoulder.rotation.z = 0.5 * raise;
    avatar.leftElbow.rotation.x = -1.2 * raise;

    // Gentle head tilt
    avatar.headGroup.rotation.z = -0.1 * raise + pulse;
    avatar.headGroup.rotation.x = -0.05 * raise;
  }

  // ── WELCOME: open arms wide ──
  function animWelcome(t) {
    const open = ease(pingpong(t));
    const inviting = Math.sin(t * Math.PI * 2) * 0.1;

    // Both arms open wide
    avatar.rightShoulder.rotation.z = -Math.PI * 0.55 * open;
    avatar.rightShoulder.rotation.x = -0.3 * open + inviting;
    avatar.rightElbow.rotation.x = -0.3 * open;

    avatar.leftShoulder.rotation.z = Math.PI * 0.55 * open;
    avatar.leftShoulder.rotation.x = -0.3 * open + inviting;
    avatar.leftElbow.rotation.x = -0.3 * open;

    // Slight forward lean (welcoming)
    avatar.torso.rotation.x = -0.08 * open;
    avatar.headGroup.rotation.x = -0.1 * open;
  }

  // ── PLEASE: circular motion on chest ──
  function animPlease(t) {
    const raise = ease(pingpong(t));
    const circular = t * Math.PI * 4;

    // Right arm to chest, circular rub
    avatar.rightShoulder.rotation.x = -0.7 * raise;
    avatar.rightShoulder.rotation.z = 0.3 * raise + Math.sin(circular) * 0.15 * raise;
    avatar.rightElbow.rotation.x = -1.0 * raise + Math.cos(circular) * 0.2 * raise;

    // Head slight nod
    avatar.headGroup.rotation.x = -0.1 * raise;

    // Gentle expression
    avatar.mouth.scale.x = 1 + 0.15 * raise;
  }

  const ANIMATIONS = {
    hello: animHello,
    "thank you": animThankYou,
    yes: animYes,
    no: animNo,
    goodbye: animGoodbye,
    "i love you": animILoveYou,
    welcome: animWelcome,
    please: animPlease,
  };

  // ========== IDLE ANIMATION ==========
  function idleAnimation(time) {
    const sway = Math.sin(time * IDLE_SWAY_SPEED) * 0.03;
    const breathe = Math.sin(time * IDLE_SWAY_SPEED * 1.6) * 0.015;

    if (avatar.torso) {
      avatar.torso.rotation.z = sway;
    }
    if (avatar.headGroup) {
      avatar.headGroup.rotation.z = sway * 0.5;
      avatar.headGroup.rotation.x = breathe;
    }
    // Arms hang naturally
    if (avatar.leftShoulder) {
      avatar.leftShoulder.rotation.x = breathe * 2;
    }
    if (avatar.rightShoulder) {
      avatar.rightShoulder.rotation.x = breathe * 2;
    }
  }

  // ========== PLAY ANIMATION ==========
  function playAnimation(signName) {
    const key = signName.toLowerCase().trim();
    if (!ANIMATIONS[key]) return false;

    if (isPlaying) {
      // Queue it
      animationQueue.push(key);
      return true;
    }

    isPlaying = true;
    currentAnimation = key;
    animationStart = performance.now();

    // Update label
    if (labelEl) {
      labelEl.textContent = key.charAt(0).toUpperCase() + key.slice(1);
      labelEl.classList.add("active");
    }

    // Show container if hidden
    showPanel();

    return true;
  }

  // ========== PHRASE DETECTION ==========
  function detectAndPlay(text) {
    if (!text || !initialized) return;
    const lower = text.toLowerCase().trim();

    // Check each supported sign
    for (const sign of SUPPORTED_SIGNS) {
      if (lower === sign || lower.includes(sign)) {
        playAnimation(sign);
        return;
      }
    }
  }

  // ========== RENDER LOOP ==========
  function animate() {
    requestAnimationFrame(animate);
    if (!initialized) return;

    const now = performance.now();

    if (isPlaying && currentAnimation) {
      const elapsed = now - animationStart;
      const t = Math.min(elapsed / ANIMATION_DURATION, 1);

      resetPose();
      ANIMATIONS[currentAnimation](t);

      if (t >= 1) {
        // Animation complete
        resetPose();
        isPlaying = false;
        currentAnimation = null;

        if (labelEl) {
          labelEl.classList.remove("active");
          labelEl.textContent = "Idle";
        }

        // Play next in queue
        if (animationQueue.length > 0) {
          const next = animationQueue.shift();
          setTimeout(() => playAnimation(next), 300);
        }
      }
    } else {
      // Idle
      resetPose();
      idleAnimation(now);
    }

    renderer.render(scene, camera);
  }

  // ========== CREATE DOM ==========
  function createPanel() {
    // Main floating container
    container = document.createElement("div");
    container.id = "avatar3dPanel";
    container.innerHTML = `
      <div class="avatar3d-header">
        <div class="avatar3d-title">
          <span class="avatar3d-dot"></span>
          <span>3D Sign Avatar</span>
        </div>
        <div class="avatar3d-controls">
          <button id="avatar3dToggle" class="avatar3d-btn" title="Minimize">—</button>
        </div>
      </div>
      <div class="avatar3d-canvas-wrap" id="avatar3dCanvasWrap"></div>
      <div class="avatar3d-footer">
        <span class="avatar3d-label" id="avatar3dLabel">Idle</span>
        <div class="avatar3d-chips" id="avatar3dChips"></div>
      </div>
    `;

    // Insert after video grid for visibility
    const videoGrid = document.querySelector(".video-grid");
    if (videoGrid && videoGrid.parentElement) {
      videoGrid.parentElement.insertBefore(container, videoGrid.nextSibling);
    } else {
      document.body.appendChild(container);
    }

    labelEl = document.getElementById("avatar3dLabel");

    // Build quick-trigger chips
    const chipsEl = document.getElementById("avatar3dChips");
    SUPPORTED_SIGNS.forEach((sign) => {
      const chip = document.createElement("button");
      chip.className = "avatar3d-chip";
      chip.textContent = sign.charAt(0).toUpperCase() + sign.slice(1);
      chip.type = "button";
      chip.addEventListener("click", () => playAnimation(sign));
      chipsEl.appendChild(chip);
    });

    // Toggle
    const toggleBtn = document.getElementById("avatar3dToggle");
    toggleBtn.addEventListener("click", () => {
      panelVisible = !panelVisible;
      const wrap = document.getElementById("avatar3dCanvasWrap");
      const footer = container.querySelector(".avatar3d-footer");
      wrap.style.display = panelVisible ? "block" : "none";
      footer.style.display = panelVisible ? "flex" : "none";
      toggleBtn.textContent = panelVisible ? "—" : "+";
      toggleBtn.title = panelVisible ? "Minimize" : "Expand";
    });

    return document.getElementById("avatar3dCanvasWrap");
  }

  function showPanel() {
    if (container) container.style.display = "block";
  }

  // ========== INJECT STYLES ==========
  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #avatar3dPanel {
        width: 100%;
        margin-top: 18px;
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(255, 255, 255, 0.9);
        border-radius: 24px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.08),
                    0 0 30px rgba(79, 140, 255, 0.08);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        overflow: hidden;
        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        animation: avatar3d-slideIn 0.6s ease-out;
      }

      @keyframes avatar3d-slideIn {
        from {
          opacity: 0;
          transform: translateY(20px) scale(0.95);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      .avatar3d-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 18px 8px;
      }

      .avatar3d-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font: 600 13px 'Outfit', 'DM Sans', sans-serif;
        color: #0f172a;
        letter-spacing: 0.02em;
      }

      .avatar3d-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #4f8cff;
        display: inline-block;
        animation: avatar3d-pulse 2s ease-in-out infinite;
      }

      @keyframes avatar3d-pulse {
        0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(79, 140, 255, 0.4); }
        50% { opacity: 0.7; box-shadow: 0 0 0 6px rgba(79, 140, 255, 0); }
      }

      .avatar3d-btn {
        width: 28px;
        height: 28px;
        border: none;
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.06);
        color: #64748b;
        cursor: pointer;
        font-size: 16px;
        display: grid;
        place-items: center;
        transition: all 0.2s;
      }
      .avatar3d-btn:hover {
        background: rgba(0, 0, 0, 0.1);
        color: #0f172a;
      }

      .avatar3d-canvas-wrap {
        width: 100%;
        height: 320px;
        position: relative;
        background: linear-gradient(135deg, #e8f0fe 0%, #f0fdf4 50%, #ede9fe 100%);
        border-top: 1px solid rgba(0, 0, 0, 0.04);
        border-bottom: 1px solid rgba(0, 0, 0, 0.04);
      }

      .avatar3d-canvas-wrap canvas {
        width: 100% !important;
        height: 100% !important;
        display: block;
      }

      .avatar3d-footer {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px 18px 14px;
      }

      .avatar3d-label {
        font: 600 12px 'DM Sans', sans-serif;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: color 0.3s;
      }
      .avatar3d-label::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #94a3b8;
        transition: background 0.3s;
      }
      .avatar3d-label.active {
        color: #10b981;
      }
      .avatar3d-label.active::before {
        background: #10b981;
        box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
      }

      .avatar3d-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .avatar3d-chip {
        padding: 5px 12px;
        border: 1px solid rgba(79, 140, 255, 0.2);
        border-radius: 99px;
        background: rgba(79, 140, 255, 0.08);
        color: #3b6dd9;
        font: 600 11px 'DM Sans', sans-serif;
        cursor: pointer;
        transition: all 0.25s;
        letter-spacing: 0.01em;
      }
      .avatar3d-chip:hover {
        background: rgba(79, 140, 255, 0.18);
        border-color: rgba(79, 140, 255, 0.35);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(79, 140, 255, 0.15);
      }
      .avatar3d-chip:active {
        transform: scale(0.96);
      }

      /* Responsive */
      @media (max-width: 700px) {
        .avatar3d-canvas-wrap {
          height: 240px;
        }
        .avatar3d-chips {
          gap: 4px;
        }
        .avatar3d-chip {
          padding: 4px 9px;
          font-size: 10px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ========== INIT THREE.JS ==========
  function initScene(canvasWrap) {
    scene = new THREE.Scene();

    // Soft gradient background
    scene.background = null; // transparent to show CSS gradient

    // Camera
    camera = new THREE.PerspectiveCamera(
      35,
      canvasWrap.clientWidth / canvasWrap.clientHeight,
      0.1,
      100
    );
    camera.position.set(0, 1.0, 4.5);
    camera.lookAt(0, 1.0, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setSize(canvasWrap.clientWidth, canvasWrap.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    canvasWrap.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e6, 1.2);
    keyLight.position.set(3, 5, 4);
    keyLight.castShadow = false;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xd4e5ff, 0.5);
    fillLight.position.set(-3, 2, 2);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffe0f0, 0.3);
    rimLight.position.set(0, 3, -3);
    scene.add(rimLight);

    // Ground plane (subtle)
    const groundGeo = new THREE.CircleGeometry(1.5, 32);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xdee8f1,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.4,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.35;
    scene.add(ground);

    // Build avatar
    buildAvatar();

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      const w = canvasWrap.clientWidth;
      const h = canvasWrap.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(canvasWrap);

    clock = new THREE.Clock();
    initialized = true;
  }

  // ========== LOAD THREE.JS CDN ==========
  function loadThreeJS() {
    return new Promise((resolve, reject) => {
      if (window.THREE) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
      script.crossOrigin = "anonymous";
      script.onload = () => resolve();
      script.onerror = () =>
        reject(new Error("Failed to load Three.js"));
      document.head.appendChild(script);
    });
  }

  // ========== PUBLIC INIT ==========
  async function init() {
    try {
      injectStyles();
      await loadThreeJS();

      const canvasWrap = createPanel();
      initScene(canvasWrap);
      animate();

      console.log("[3D AVATAR] Initialized with", SUPPORTED_SIGNS.length, "signs");
    } catch (err) {
      console.error("[3D AVATAR] Init failed:", err);
    }
  }

  // ========== PUBLIC API ==========
  return {
    init,
    playAnimation,
    detectAndPlay,
    SUPPORTED_SIGNS,
  };
})();

// ========== AUTO-INITIALIZE ON DOM READY ==========
document.addEventListener("DOMContentLoaded", () => {
  SignAvatar.init();
});
