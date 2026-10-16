import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Space,
  RotateCcw,
  Trash2,
  CheckCircle,
  Send,
  Sparkles,
  CornerDownLeft,
} from 'lucide-react';
import './RecognitionDeck.css';

export default function RecognitionDeck({
  sentence = [],
  currentWord = '',
  suggestion = '',
  sentenceSuggestions = [],
  onSpace,
  onUndo,
  onClear,
  onAcceptWord,
  onAcceptSentence,
  onSendSentence,
}) {
  const sentenceArr = Array.isArray(sentence) ? sentence : [sentence].filter(Boolean);
  const hasContent = sentenceArr.length > 0 || Boolean(currentWord);

  return (
    <div className="recognition-deck-container">
      {/* Header */}
      <div className="deck-header">
        <div className="deck-title">
          <Sparkles size={15} color="var(--primary)" />
          Sentence Composer & AI Autocomplete
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          Shortcut: Press <kbd style={{ padding: '0.1rem 0.3rem', background: 'var(--bg-surface)', borderRadius: 4 }}>Space</kbd> or <kbd style={{ padding: '0.1rem 0.3rem', background: 'var(--bg-surface)', borderRadius: 4 }}>Enter</kbd>
        </div>
      </div>

      {/* Sentence / Words Display Box */}
      <div className="sentence-composer-box">
        {!hasContent && (
          <span className="empty-buffer-hint">
            Perform signs in front of your camera or use controls below to build a sentence...
          </span>
        )}

        {/* Formed Words */}
        <AnimatePresence>
          {sentenceArr.map((word, index) => (
            <motion.span
              key={`${word}-${index}`}
              className="word-token"
              initial={{ scale: 0.8, opacity: 0, y: 6 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            >
              {word}
            </motion.span>
          ))}
        </AnimatePresence>

        {/* Current Active Word being spelled */}
        {currentWord && (
          <motion.span
            className="active-word-token"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
          >
            <span>{currentWord}</span>
            {suggestion && <span className="ghost-suggestion-text">{suggestion}</span>}
            <span className="active-cursor" />
          </motion.span>
        )}
      </div>

      {/* Action Controls Bar */}
      <div className="action-controls-row">
        <div className="controls-left-group">
          {/* Space */}
          <motion.button
            className="deck-action-btn"
            onClick={onSpace}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.95 }}
            title="Complete word and add space"
          >
            <Space size={14} />
            Space
          </motion.button>

          {/* Undo */}
          <motion.button
            className="deck-action-btn"
            onClick={onUndo}
            disabled={!hasContent}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.95 }}
            title="Undo last character or word"
          >
            <RotateCcw size={14} />
            Undo
          </motion.button>

          {/* Clear */}
          <motion.button
            className="deck-action-btn"
            onClick={onClear}
            disabled={!hasContent}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.95 }}
            title="Clear entire sentence"
          >
            <Trash2 size={14} />
            Clear
          </motion.button>

          {/* Accept Word Suggestion */}
          {currentWord && suggestion && (
            <motion.button
              className="deck-action-btn primary-highlight"
              onClick={onAcceptWord}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.95 }}
            >
              <CheckCircle size={14} />
              Accept "{currentWord + suggestion}"
            </motion.button>
          )}
        </div>

        {/* Inline Send Action Button */}
        <motion.button
          className="deck-send-action-btn"
          disabled={!hasContent}
          onClick={onSendSentence}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.95 }}
          title="Send accumulated sentence to the chat room"
        >
          <motion.div
            whileHover={{ x: 3, y: -2 }}
            transition={{ type: 'spring', stiffness: 400 }}
          >
            <Send size={15} />
          </motion.div>
          Send to Room
        </motion.button>
      </div>

      {/* Smart Next-Word & Sentence Prediction Chips */}
      {sentenceSuggestions && sentenceSuggestions.length > 0 && (
        <div className="predictions-section">
          <span className="predictions-label">Suggestions:</span>
          {sentenceSuggestions.map((item, idx) => (
            <motion.button
              key={`${item}-${idx}`}
              className="prediction-chip"
              onClick={() => onAcceptSentence(item)}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <CornerDownLeft size={12} color="var(--primary)" />
              {item}
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
