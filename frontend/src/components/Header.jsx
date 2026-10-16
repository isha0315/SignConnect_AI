import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Hand,
  Copy,
  Check,
  Volume2,
  VolumeX,
  Sun,
  Moon,
  Settings,
  Send,
  Hash,
  Type,
  Sparkles,
} from 'lucide-react';
import './Header.css';

export default function Header({
  room,
  mode,
  onModeChange,
  isConnected,
  theme,
  onThemeToggle,
  ttsEnabled,
  onTtsToggle,
  onOpenSettings,
  hasSentenceToSend,
  onSendSentence,
}) {
  const [copied, setCopied] = useState(false);

  const handleCopyRoom = () => {
    if (!room) return;
    navigator.clipboard.writeText(room);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="header-container">
      {/* Brand Section */}
      <div className="brand-section">
        <motion.div
          className="brand-logo-badge"
          whileHover={{ scale: 1.06, rotate: 3 }}
          whileTap={{ scale: 0.95 }}
        >
          <Hand size={22} strokeWidth={2.2} />
        </motion.div>
        <div className="brand-title-wrap">
          <h1 className="brand-title">
            SignConnect <span>AI</span>
          </h1>
          <div className="brand-tag">
            <span className="live-dot"></span>
            Real-Time Vision Core
          </div>
        </div>
      </div>

      {/* Center Controls */}
      <div className="header-center">
        {/* Room Badge */}
        <motion.button
          className="room-badge"
          onClick={handleCopyRoom}
          title="Click to copy Room Code"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Hash size={14} color="var(--primary)" />
          <span>Room:</span>
          <span className="room-code-text">{room || 'General'}</span>
          {copied ? <Check size={14} color="var(--success)" /> : <Copy size={13} />}
        </motion.button>

        {/* Mode Switcher */}
        <div className="mode-toggle-group">
          <button
            className={`mode-btn ${mode === 'alphabet' ? 'active' : ''}`}
            onClick={() => onModeChange('alphabet')}
            type="button"
          >
            {mode === 'alphabet' && (
              <motion.div
                className="mode-btn-bg"
                layoutId="activeModeIndicator"
                transition={{ type: 'spring', stiffness: 450, damping: 30 }}
              />
            )}
            <Type size={14} />
            Letters (A-Z)
          </button>

          <button
            className={`mode-btn ${mode === 'number' ? 'active' : ''}`}
            onClick={() => onModeChange('number')}
            type="button"
          >
            {mode === 'number' && (
              <motion.div
                className="mode-btn-bg"
                layoutId="activeModeIndicator"
                transition={{ type: 'spring', stiffness: 450, damping: 30 }}
              />
            )}
            <Hash size={14} />
            Numbers (1-9)
          </button>

          <button
            className={`mode-btn ${mode === 'gesture' ? 'active' : ''}`}
            onClick={() => onModeChange('gesture')}
            type="button"
          >
            {mode === 'gesture' && (
              <motion.div
                className="mode-btn-bg"
                layoutId="activeModeIndicator"
                transition={{ type: 'spring', stiffness: 450, damping: 30 }}
              />
            )}
            <Sparkles size={14} />
            Gestures (✨)
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="header-actions">
        {/* Connection status */}
        <div className="status-indicator">
          <span className={`status-dot ${isConnected ? 'online' : 'offline'}`} />
          <span>{isConnected ? 'Online' : 'Reconnecting'}</span>
        </div>

        {/* Quick Send Header Button */}
        <motion.button
          className="header-send-btn"
          disabled={!hasSentenceToSend}
          onClick={onSendSentence}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.95 }}
          title="Send formed sentence to chat room"
        >
          <Send size={14} />
          Send Sentence
        </motion.button>

        {/* TTS Toggle */}
        <motion.button
          className="header-action-btn"
          onClick={onTtsToggle}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          title={ttsEnabled ? 'Mute Speech Readouts' : 'Enable Speech Readouts'}
        >
          {ttsEnabled ? <Volume2 size={18} color="var(--primary-light)" /> : <VolumeX size={18} />}
        </motion.button>

        {/* Theme Toggle */}
        <motion.button
          className="header-action-btn"
          onClick={onThemeToggle}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </motion.button>

        {/* Settings */}
        <motion.button
          className="header-action-btn"
          onClick={onOpenSettings}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          title="Preferences & Shortcuts"
        >
          <Settings size={18} />
        </motion.button>
      </div>
    </header>
  );
}
