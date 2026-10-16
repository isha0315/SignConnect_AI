import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  User,
  Users,
  FlipHorizontal,
  Maximize2,
  Sparkles,
  Activity,
} from 'lucide-react';
import ShineBorder from './21st/ShineBorder';
import AudioVisualizer from './21st/AudioVisualizer';
import './VideoStage.css';

// MediaPipe 21 Hand Landmarks Connection Pairs
const HAND_CONNECTIONS = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [0, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [0, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Palm base
  [5, 9], [9, 13], [13, 17],
];

export default function VideoStage({
  localStream,
  remoteStream,
  cameraEnabled,
  microphoneEnabled,
  callState,
  recognitionData,
  onToggleCamera,
  onToggleMicrophone,
  onStartCall,
  onEndCall,
  onCaptureFrame,
  username,
  room,
}) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const [isMirrored, setIsMirrored] = useState(true);

  // Bind local stream
  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream || null;
      if (localStream) {
        localVideoRef.current.play().catch(() => {});
      }
    }
  }, [localStream]);

  // Bind remote stream
  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream || null;
      if (remoteStream) {
        remoteVideoRef.current.play().catch(() => {});
      }
    }
  }, [remoteStream]);

  // Draw Skeleton Overlay when landmarks arrive
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const landmarks = recognitionData?.landmarks;
    if (!landmarks || landmarks.length !== 21 || !recognitionData.hand_detected) {
      return;
    }

    const w = canvas.width;
    const h = canvas.height;

    // Draw Skeleton Connection Bones
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#06b6d4'; // Cyan neon
    ctx.shadowColor = 'rgba(6, 182, 212, 0.8)';
    ctx.shadowBlur = 8;

    for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
      const p1 = landmarks[startIdx];
      const p2 = landmarks[endIdx];
      if (p1 && p2) {
        ctx.beginPath();
        ctx.moveTo(p1.x * w, p1.y * h);
        ctx.lineTo(p2.x * w, p2.y * h);
        ctx.stroke();
      }
    }

    // Draw Landmark Joints
    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i];
      if (!p) continue;
      const x = p.x * w;
      const y = p.y * h;

      ctx.beginPath();
      // Fingertips (4, 8, 12, 16, 20) are purple, others are bright green/white
      if ([4, 8, 12, 16, 20].includes(i)) {
        ctx.arc(x, y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#a78bfa';
        ctx.shadowColor = '#8b5cf6';
      } else if (i === 0) {
        ctx.arc(x, y, 6, 0, 2 * Math.PI);
        ctx.fillStyle = '#10b981';
        ctx.shadowColor = '#10b981';
      } else {
        ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#06b6d4';
      }
      ctx.shadowBlur = 6;
      ctx.fill();
    }
  }, [recognitionData]);

  // Frame Capture Loop for AI Recognition
  useEffect(() => {
    let animId;
    let lastTime = 0;
    const captureInterval = 65; // ~15 FPS max to prevent CPU strain

    const captureCanvas = document.createElement('canvas');
    const captureCtx = captureCanvas.getContext('2d');

    const loop = (currentTime) => {
      animId = requestAnimationFrame(loop);

      if (currentTime - lastTime < captureInterval) return;
      lastTime = currentTime;

      const video = localVideoRef.current;
      if (!video || !cameraEnabled || video.readyState < 2) return;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;

      // Update overlay canvas dimensions to match video
      if (overlayCanvasRef.current) {
        if (overlayCanvasRef.current.width !== vw || overlayCanvasRef.current.height !== vh) {
          overlayCanvasRef.current.width = vw;
          overlayCanvasRef.current.height = vh;
        }
      }

      // Capture frame
      const targetWidth = 480;
      const targetHeight = Math.round(vh * (targetWidth / vw));
      captureCanvas.width = targetWidth;
      captureCanvas.height = targetHeight;

      captureCtx.drawImage(video, 0, 0, targetWidth, targetHeight);
      try {
        const base64Data = captureCanvas.toDataURL('image/jpeg', 0.55);
        if (onCaptureFrame) {
          onCaptureFrame(base64Data);
        }
      } catch (err) {
        // canvas tainted or stream dropped
      }
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [cameraEnabled, onCaptureFrame]);

  const char = recognitionData?.character || '—';
  const confidence = recognitionData?.confidence || 0;
  const isDetected = Boolean(recognitionData?.hand_detected && char !== '—');

  return (
    <div className="video-stage-container">
      <div className="video-grid">
        {/* Local Stream Card */}
        <div className="video-card">
          <video
            ref={localVideoRef}
            className={`video-element ${isMirrored ? 'mirrored' : ''}`}
            autoPlay
            playsInline
            muted
          />

          {/* Skeleton Overlay */}
          <canvas
            ref={overlayCanvasRef}
            className={`skeleton-overlay ${isMirrored ? 'mirrored' : ''}`}
          />

          {/* Camera Off Placeholder */}
          {!cameraEnabled && (
            <div className="video-placeholder">
              <div className="placeholder-avatar">
                <User size={32} />
              </div>
              <p>Camera is turned off</p>
            </div>
          )}

          {/* Video Badges */}
          <div className="video-top-bar">
            <div className="video-badge">
              <User size={13} color="var(--primary)" />
              <span>{username} (You)</span>
              <AudioVisualizer isActive={microphoneEnabled} />
            </div>

            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                className="video-badge"
                onClick={() => setIsMirrored(!isMirrored)}
                title="Toggle Mirror Camera"
                style={{ cursor: 'pointer' }}
              >
                <FlipHorizontal size={13} />
              </button>
              {cameraEnabled && (
                <div className="video-live-pill">
                  <Activity size={12} />
                  AI Vision
                </div>
              )}
            </div>
          </div>

          {/* Floating Recognition HUD Card with 21st.dev Shine Border */}
          <ShineBorder
            className="recognition-hud-outer"
            borderWidth={1.5}
            duration={isDetected ? 3 : 8}
            opacity={isDetected ? 0.95 : 0.35}
            colors={
              isDetected
                ? ['#10b981', '#06b6d4', '#8b5cf6']
                : ['#06b6d4', '#64748b', '#1e293b']
            }
          >
            <div className="recognition-hud-card">
              <AnimatePresence mode="popLayout">
                <motion.div
                  key={char}
                  className="detected-char-box"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                >
                  {char}
                </motion.div>
              </AnimatePresence>

              <div className="hud-details">
                <div className="hud-metric-row">
                  <span className="hud-metric-label">Confidence:</span>
                  <span className="hud-confidence-val">{confidence}%</span>
                </div>
                <div className="hud-progress-track">
                  <div
                    className="hud-progress-fill"
                    style={{ width: `${Math.min(100, Math.max(0, confidence))}%` }}
                  />
                </div>
                <div className={`hud-status-line ${isDetected ? 'detected' : 'waiting'}`}>
                  {isDetected ? '● Hand Sign Tracking' : '○ Position hand in frame'}
                </div>
              </div>
            </div>
          </ShineBorder>
        </div>

        {/* Remote Stream Card */}
        <div className="video-card">
          <video
            ref={remoteVideoRef}
            className="video-element"
            autoPlay
            playsInline
          />

          {/* Waiting or Placeholder */}
          {!remoteStream && (
            <div className="video-placeholder">
              <div className="radar-wrap">
                <div className="radar-wave" />
                <div className="radar-wave" />
                <div className="placeholder-avatar">
                  <Users size={30} />
                </div>
              </div>
              <p style={{ fontWeight: 600 }}>
                {callState === 'calling'
                  ? 'Calling remote partner...'
                  : `Waiting for peer in Room #${room || 'General'}`}
              </p>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Share your room code to start 1-to-1 sign calling
              </span>
            </div>
          )}

          {/* Remote Video Badges */}
          <div className="video-top-bar">
            <div className="video-badge">
              <Users size={13} color="var(--accent)" />
              <span>Remote Partner</span>
            </div>
            {remoteStream && (
              <div className="video-live-pill">
                <span className="live-dot" />
                Connected
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating In-Call Actions Dock */}
      <div className="call-controls-bar">
        {/* Toggle Cam */}
        <motion.button
          className={`call-control-btn ${!cameraEnabled ? 'off' : ''}`}
          onClick={onToggleCamera}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          title={cameraEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
        >
          {cameraEnabled ? <Camera size={18} /> : <CameraOff size={18} />}
        </motion.button>

        {/* Toggle Mic */}
        <motion.button
          className={`call-control-btn ${!microphoneEnabled ? 'off' : ''}`}
          onClick={onToggleMicrophone}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          title={microphoneEnabled ? 'Mute Microphone' : 'Unmute Microphone'}
        >
          {microphoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}
        </motion.button>

        {/* Call Connect / Disconnect */}
        {callState === 'idle' || callState === 'disconnected' || callState === 'failed' ? (
          <motion.button
            className="call-control-btn call-start"
            onClick={onStartCall}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Phone size={17} />
            Start Call
          </motion.button>
        ) : (
          <motion.button
            className="call-control-btn call-end"
            onClick={onEndCall}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <PhoneOff size={17} />
            End Call
          </motion.button>
        )}
      </div>
    </div>
  );
}
