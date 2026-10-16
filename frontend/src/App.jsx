import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Header from './components/Header';
import VideoStage from './components/VideoStage';
import RecognitionDeck from './components/RecognitionDeck';
import ChatDrawer from './components/ChatDrawer';
import SettingsModal from './components/SettingsModal';
import { socketService } from './services/socket';
import { webrtcManager } from './services/webrtc';
import { speechService } from './services/speech';
import { fireConfettiCannons } from './components/21st/ConfettiTrigger';
import './styles/theme.css';
import './App.css';

export default function App() {
  // Room and User State
  const [room, setRoom] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || 'auz94rc';
  });

  const [username, setUsername] = useState(() => {
    return localStorage.getItem('signconnect_username') || 'Signer';
  });

  // UI Theme & Preferences
  const [theme, setTheme] = useState('dark');
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Connection & Media States
  const [isConnected, setIsConnected] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [callState, setCallState] = useState('idle'); // 'idle' | 'calling' | 'connected' | 'failed'

  // Recognition AI State
  const [mode, setMode] = useState('alphabet'); // 'alphabet' | 'number' | 'gesture'
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
    if (mode !== 'gesture') {
      setActiveSticker(null);
    }
  }, [mode]);
  const [recognitionData, setRecognitionData] = useState({
    character: '—',
    confidence: 0,
    hand_detected: false,
    landmarks: null,
  });
  const [currentWord, setCurrentWord] = useState('');
  const [sentence, setSentence] = useState([]);
  const [suggestion, setSuggestion] = useState('');
  const [sentenceSuggestions, setSentenceSuggestions] = useState([]);

  // Chat Messages
  const [messages, setMessages] = useState([]);
  const [activeSticker, setActiveSticker] = useState(null);

  // Toast Helper
  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  }, []);

  // Set Theme attribute on body
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Request Local Media on Mount
  useEffect(() => {
    let activeStream = null;

    async function initMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 } },
          audio: true,
        });
        activeStream = stream;
        setLocalStream(stream);
        webrtcManager.setLocalStream(stream);
      } catch (err) {
        console.warn('[App] Camera/Mic access prompt:', err);
        showToast('Camera permission required for sign recognition');
      }
    }

    initMedia();

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [showToast]);

  // Connect WebRTC Manager Callbacks
  useEffect(() => {
    webrtcManager.setCallbacks({
      onRemoteStream: (stream) => {
        setRemoteStream(stream);
      },
      onCallStateChange: (state) => {
        setCallState(state);
        if (state === 'connected') {
          showToast('Video call connected with remote partner');
        } else if (state === 'idle') {
          showToast('Call ended');
        }
      },
    });
  }, [showToast]);

  // Connect Socket.IO
  useEffect(() => {
    const socket = socketService.connect();

    // Listen to connection
    const unsubConn = socketService.on('connection_status', ({ connected }) => {
      setIsConnected(connected);
      if (connected) {
        socketService.joinRoom(room, username);
      }
    });

    // Session Init
    const unsubSession = socketService.on('session_init', (data) => {
      if (data) {
        if (data.mode) setMode(data.mode);
        if (data.current_word) setCurrentWord(data.current_word);
        if (data.sentence) setSentence(data.sentence);
        if (data.suggestion) setSuggestion(data.suggestion);
      }
    });

    // Room Joined
    const unsubRoom = socketService.on('room_joined', (data) => {
      if (data && data.username !== username) {
        showToast(`${data.username} joined room #${data.room_id}`);
      }
    });

    // Recognition Updates from AI Backend
    const unsubRecog = socketService.on('recognition_update', (data) => {
      if (!data) return;
      setRecognitionData({
        character: data.character || '—',
        confidence: data.confidence || 0,
        hand_detected: Boolean(data.hand_detected),
        landmarks: data.landmarks || null,
      });

      if (data.current_word !== undefined) setCurrentWord(data.current_word);
      if (data.sentence !== undefined) {
        setSentence(Array.isArray(data.sentence) ? data.sentence : [data.sentence]);
      }
      if (data.suggestion !== undefined) setSuggestion(data.suggestion);
      if (data.sentence_suggestions !== undefined) {
        setSentenceSuggestions(data.sentence_suggestions);
      }
    });

    // Control Sync
    const unsubControl = socketService.on('recognition_control', (data) => {
      if (!data) return;
      if (data.mode) setMode(data.mode);
    });

    // Chat Messages
    const unsubMsg = socketService.on('receive_message', (data) => {
      if (!data) return;
      const newMsg = {
        id: Date.now() + Math.random(),
        username: data.username || 'User',
        message: data.message || '',
        message_type: data.message_type || 'typed',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, newMsg]);

      // Speak aloud if enabled and message is text
      if (ttsEnabled && data.message_type !== 'sticker') {
        speechService.speak(data.message);
      }
    });

    // WebRTC Signaling
    const unsubSignal = socketService.on('webrtc_signal', (signal) => {
      webrtcManager.handleSignal(signal, username);
    });

    // Sticker Gesture Popups (strictly in Special Gestures mode!)
    const unsubSticker = socketService.on('sticker_gesture', (data) => {
      if (modeRef.current === 'gesture' && data && (data.gesture || data.message)) {
        const key = String(data.gesture || data.message).toLowerCase().trim().replace(/_/g, ' ');
        const file = key.replace(/ /g, '_') + '.jpg';
        setActiveSticker({ key, file, user: data.username || 'Peer' });
        setTimeout(() => setActiveSticker(null), 2800);
      }
    });

    return () => {
      unsubConn();
      unsubSession();
      unsubRoom();
      unsubRecog();
      unsubControl();
      unsubMsg();
      unsubSignal();
      unsubSticker();
    };
  }, [room, username, ttsEnabled, showToast]);

  // Toggle Camera
  const handleToggleCamera = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setCameraEnabled(videoTrack.enabled);
      }
    }
  };

  // Toggle Microphone
  const handleToggleMicrophone = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMicrophoneEnabled(audioTrack.enabled);
      }
    }
  };

  // WebRTC Start Call
  const handleStartCall = () => {
    webrtcManager.startCall(username);
  };

  // WebRTC End Call
  const handleEndCall = () => {
    webrtcManager.endCall(true, username);
  };

  // Send Frame to Server
  const handleCaptureFrame = useCallback(
    (base64Image) => {
      socketService.sendRecognitionFrame(base64Image, mode, username);
    },
    [mode, username]
  );

  // Recognition Controls
  const handleModeChange = (newMode) => {
    setMode(newMode);
    socketService.sendRecognitionControl(newMode, username);
  };

  const handleSpace = () => {
    socketService.sendRecognitionControl('space', username);
  };

  const handleUndo = () => {
    socketService.sendRecognitionControl('undo', username);
  };

  const handleClear = () => {
    socketService.sendRecognitionControl('clear', username);
    setCurrentWord('');
    setSentence([]);
    setSuggestion('');
  };

  const handleAcceptWord = () => {
    socketService.sendRecognitionControl('accept_word', username);
  };

  const handleAcceptSentence = (phrase) => {
    socketService.sendRecognitionControl('accept_sentence', username, { word: phrase });
  };

  // Send Formed Sentence to Chat Room
  const handleSendSentence = () => {
    let full = sentence.join(' ');
    if (currentWord) {
      full = (full + ' ' + currentWord).trim();
    }
    if (!full) return;

    // Trigger 21st.dev celebratory confetti cannons!
    fireConfettiCannons();

    // Send to Chat
    socketService.sendMessage(full, username, 'sign');
    // Clear in AI Recognition State
    socketService.sendRecognitionControl('send', username);
    setCurrentWord('');
    setSentence([]);
    setSuggestion('');
    showToast(`Sent sign sentence: "${full}"`);
  };

  // Chat Actions
  const handleSendText = (text) => {
    socketService.sendMessage(text, username, 'typed');
  };

  const handleSendSticker = (stickerId) => {
    socketService.sendSticker(stickerId, username);
    socketService.sendMessage(stickerId, username, 'sticker');
    showToast(`Sent sticker: ${stickerId}`);
  };

  const handleSpeak = (text) => {
    speechService.speak(text);
  };

  const handleUpdateUsername = (newName) => {
    setUsername(newName);
    localStorage.setItem('signconnect_username', newName);
    showToast(`Name updated to "${newName}"`);
  };

  // Keyboard Shortcuts (Space, Undo, Enter)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        handleSpace();
      } else if (e.code === 'Backspace') {
        e.preventDefault();
        handleUndo();
      } else if (e.code === 'Enter') {
        e.preventDefault();
        handleSendSentence();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const hasSentenceToSend = sentence.length > 0 || Boolean(currentWord);

  return (
    <div className="app-container">
      {/* Background ambient lighting */}
      <div className="ambient-glow-1" />
      <div className="ambient-glow-2" />

      {/* Top Header */}
      <Header
        room={room}
        mode={mode}
        onModeChange={handleModeChange}
        isConnected={isConnected}
        theme={theme}
        onThemeToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        ttsEnabled={ttsEnabled}
        onTtsToggle={() => {
          setTtsEnabled(!ttsEnabled);
          speechService.toggle(!ttsEnabled);
        }}
        onOpenSettings={() => setIsSettingsOpen(true)}
        hasSentenceToSend={hasSentenceToSend}
        onSendSentence={handleSendSentence}
      />

      {/* Main Grid Workspace */}
      <main className="app-main-workspace">
        {/* Left Column: Video Stage + Sentence Deck */}
        <div className="left-stage-column">
          <VideoStage
            localStream={localStream}
            remoteStream={remoteStream}
            cameraEnabled={cameraEnabled}
            microphoneEnabled={microphoneEnabled}
            callState={callState}
            recognitionData={recognitionData}
            onToggleCamera={handleToggleCamera}
            onToggleMicrophone={handleToggleMicrophone}
            onStartCall={handleStartCall}
            onEndCall={handleEndCall}
            onCaptureFrame={handleCaptureFrame}
            username={username}
            room={room}
          />

          <RecognitionDeck
            sentence={sentence}
            currentWord={currentWord}
            suggestion={suggestion}
            sentenceSuggestions={sentenceSuggestions}
            onSpace={handleSpace}
            onUndo={handleUndo}
            onClear={handleClear}
            onAcceptWord={handleAcceptWord}
            onAcceptSentence={handleAcceptSentence}
            onSendSentence={handleSendSentence}
          />
        </div>

        {/* Right Column: Chat Stream & Stickers Dock */}
        <div className="right-drawer-column">
          <ChatDrawer
            messages={messages}
            currentUsername={username}
            onSendText={handleSendText}
            onSendSticker={handleSendSticker}
            onSpeak={handleSpeak}
          />
        </div>
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        username={username}
        onUpdateUsername={handleUpdateUsername}
      />

      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            className="toast-notification"
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          >
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2D Animated Sticker Overlay */}
      <AnimatePresence>
        {activeSticker && (
          <motion.div
            className="sticker-popup-overlay"
            initial={{ opacity: 0, scale: 0.3, rotate: -10 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.5, y: -20 }}
            transition={{ type: 'spring', stiffness: 450, damping: 25 }}
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 9999,
              pointerEvents: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.9)',
                backdropFilter: 'blur(16px)',
                padding: '0.75rem',
                borderRadius: '24px',
                border: '3px solid var(--primary, #06b6d4)',
                boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
              }}
            >
              <img
                src={`/static/img/stickers/${activeSticker.file}`}
                alt={activeSticker.key}
                style={{
                  width: '200px',
                  height: '200px',
                  objectFit: 'cover',
                  borderRadius: '16px',
                  display: 'block',
                }}
              />
              <div
                style={{
                  textAlign: 'center',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  color: '#fff',
                  marginTop: '0.4rem',
                  textTransform: 'capitalize',
                }}
              >
                {activeSticker.user}: {activeSticker.key}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
