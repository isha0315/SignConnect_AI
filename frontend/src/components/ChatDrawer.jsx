import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare,
  Smile,
  Send,
  Volume2,
  Sparkles,
  Check,
  Clock,
  User,
} from 'lucide-react';
import AppleDock from './21st/AppleDock';
import './ChatDrawer.css';

const STICKERS = [
  { id: 'hello', label: 'Hello', category: 'greetings', file: 'hello.jpg' },
  { id: 'good_morning', label: 'Good Morning', category: 'greetings', file: 'good_morning.jpg' },
  { id: 'nice_to_meet_you', label: 'Nice to Meet You', category: 'greetings', file: 'nice_to_meet_you.jpg' },
  { id: 'how_are_you', label: 'How are You?', category: 'greetings', file: 'how_are_you.jpg' },
  { id: 'thank_you', label: 'Thank You', category: 'courtesy', file: 'thank_you.jpg' },
  { id: 'welcome', label: 'Welcome', category: 'courtesy', file: 'welcome.jpg' },
  { id: 'please', label: 'Please', category: 'courtesy', file: 'please.jpg' },
  { id: 'sorry', label: 'Sorry', category: 'courtesy', file: 'sorry.jpg' },
  { id: 'yes', label: 'Yes', category: 'responses', file: 'yes.jpg' },
  { id: 'no', label: 'No', category: 'responses', file: 'no.jpg' },
  { id: 'i_love_you', label: 'I Love You', category: 'expressions', file: 'i_love_you.jpg' },
  { id: 'help', label: 'Help!', category: 'needs', file: 'help.jpg' },
  { id: 'water', label: 'Water', category: 'needs', file: 'water.jpg' },
  { id: 'stop', label: 'Stop', category: 'action', file: 'stop.jpg' },
  { id: 'goodbye', label: 'Goodbye', category: 'greetings', file: 'goodbye.jpg' },
];

export default function ChatDrawer({
  messages = [],
  currentUsername = 'User',
  onSendText,
  onSendSticker,
  onSpeak,
}) {
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'stickers'
  const [inputText, setInputText] = useState('');
  const [stickerFilter, setStickerFilter] = useState('all');
  const messagesEndRef = useRef(null);

  // Auto scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTab]);

  const handleSendText = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendText(inputText.trim());
    setInputText('');
  };

  const filteredStickers =
    stickerFilter === 'all'
      ? STICKERS
      : STICKERS.filter((s) => s.category === stickerFilter);

  return (
    <div className="chat-drawer-container">
      {/* Drawer Tabs Header */}
      <div className="drawer-tabs-header">
        <button
          className={`drawer-tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => setActiveTab('chat')}
          type="button"
        >
          {activeTab === 'chat' && (
            <motion.div
              className="tab-active-indicator"
              layoutId="drawerTabIndicator"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
          <span className="tab-btn-content">
            <MessageSquare size={15} />
            Messages
            {messages.length > 0 && <span className="tab-counter">{messages.length}</span>}
          </span>
        </button>

        <button
          className={`drawer-tab-btn ${activeTab === 'stickers' ? 'active' : ''}`}
          onClick={() => setActiveTab('stickers')}
          type="button"
        >
          {activeTab === 'stickers' && (
            <motion.div
              className="tab-active-indicator"
              layoutId="drawerTabIndicator"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
          <span className="tab-btn-content">
            <Smile size={15} />
            Daily Stickers
            <span className="tab-counter">15</span>
          </span>
        </button>
      </div>

      {/* Body */}
      <div className="drawer-content-body">
        {/* Tab 1: Chat Stream */}
        {activeTab === 'chat' && (
          <>
            <div className="messages-scroll-area">
              {messages.length === 0 ? (
                <div className="empty-chat-state">
                  <MessageSquare size={32} strokeWidth={1.5} />
                  <p style={{ fontWeight: 600 }}>No messages yet</p>
                  <span style={{ fontSize: '0.78rem' }}>
                    Type a message below or form sentences via camera sign recognition!
                  </span>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {messages.map((msg, index) => {
                    const isMine = msg.username === currentUsername;
                    const isSticker = msg.message_type === 'sticker';
                    const isSign = msg.message_type === 'sign';

                    // Find sticker if it's a sticker message (robust matching for slug, label, or filename)
                    const normalizedMsg = String(msg.message || '').toLowerCase().trim();
                    const slugMsg = normalizedMsg.replace(/ /g, '_');
                    const spaceMsg = normalizedMsg.replace(/_/g, ' ');
                    const stickerObj = isSticker
                      ? STICKERS.find(
                          (s) =>
                            s.id === normalizedMsg ||
                            s.id === slugMsg ||
                            s.label.toLowerCase() === spaceMsg ||
                            s.file.toLowerCase().startsWith(slugMsg)
                        )
                      : null;

                    return (
                      <motion.div
                        key={msg.id || index}
                        className={`chat-message-row ${isMine ? 'mine' : 'theirs'}`}
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 450, damping: 30 }}
                      >
                        <div className="message-meta-row">
                          <User size={12} />
                          <span>{msg.username}</span>
                          {isSign && (
                            <span className="ai-sign-tag">
                              <Sparkles size={9} />
                              AI Sign
                            </span>
                          )}
                          <span>•</span>
                          <span>{msg.time || 'Now'}</span>
                        </div>

                        {/* Content */}
                        {isSticker && stickerObj ? (
                          <div className="sticker-message-bubble">
                            <img
                              src={`/static/img/stickers/${stickerObj.file}`}
                              alt={stickerObj.label}
                              className="sticker-bubble-img"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <div className="message-bubble">
                            {msg.message}
                            <button
                              className="speak-bubble-btn"
                              onClick={() => onSpeak(msg.message)}
                              title="Pronounce message aloud"
                            >
                              <Volume2 size={12} />
                            </button>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Input */}
            <form className="chat-input-bar" onSubmit={handleSendText}>
              <input
                type="text"
                className="chat-text-field"
                placeholder="Type a message or press enter..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
              <motion.button
                type="submit"
                className="chat-send-btn"
                disabled={!inputText.trim()}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title="Send message"
              >
                <Send size={15} />
              </motion.button>
            </form>
          </>
        )}

        {/* Tab 2: Stickers Dock */}
        {activeTab === 'stickers' && (
          <div className="sticker-dock-container">
            {/* 21st.dev Apple Magnification Quick Dock */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'center' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Quick Dock (Hover to Magnify)
              </div>
              <AppleDock
                items={STICKERS.slice(0, 8).map((s) => ({
                  id: s.id,
                  label: s.label,
                  src: `/static/img/stickers/${s.file}`,
                }))}
                onSelect={(id) => onSendSticker(id)}
                baseSize={40}
                magnifySize={68}
              />
            </div>

            {/* Filter buttons */}
            <div className="sticker-filters-row">
              {['all', 'greetings', 'courtesy', 'responses', 'needs'].map((cat) => (
                <button
                  key={cat}
                  className={`sticker-filter-btn ${stickerFilter === cat ? 'active' : ''}`}
                  onClick={() => setStickerFilter(cat)}
                  type="button"
                >
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </button>
              ))}
            </div>

            {/* Grid */}
            <div className="stickers-grid">
              {filteredStickers.map((sticker) => (
                <motion.div
                  key={sticker.id}
                  className="sticker-card"
                  onClick={() => onSendSticker(sticker.id)}
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.94 }}
                  title={`Click to send "${sticker.label}"`}
                >
                  <div className="sticker-img-wrap">
                    <img
                      src={`/static/img/stickers/${sticker.file}`}
                      alt={sticker.label}
                      className="sticker-img"
                      loading="lazy"
                    />
                  </div>
                  <div className="sticker-caption">{sticker.label}</div>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
