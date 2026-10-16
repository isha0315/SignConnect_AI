import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Settings, Keyboard, User, Check } from 'lucide-react';
import './SettingsModal.css';

export default function SettingsModal({
  isOpen,
  onClose,
  username,
  onUpdateUsername,
}) {
  const [nameVal, setNameVal] = useState(username);

  const handleSave = (e) => {
    e.preventDefault();
    if (nameVal.trim()) {
      onUpdateUsername(nameVal.trim());
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="modal-backdrop" onClick={onClose}>
        <motion.div
          className="modal-card"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', stiffness: 450, damping: 30 }}
        >
          {/* Header */}
          <div className="modal-header">
            <div className="modal-title">
              <Settings size={18} color="var(--primary)" />
              Preferences & Shortcuts
            </div>
            <button className="modal-close-btn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <form onSubmit={handleSave}>
            <div className="modal-body">
              {/* Profile Username */}
              <div className="form-group">
                <label className="form-label">Display Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={nameVal}
                  onChange={(e) => setNameVal(e.target.value)}
                  placeholder="Enter your name"
                />
              </div>

              {/* Shortcuts Cheat Sheet */}
              <div className="form-group">
                <label className="form-label">Keyboard Shortcuts</label>
                <div className="shortcuts-table">
                  <div className="shortcut-row">
                    <span>Add Space to Sentence</span>
                    <span className="shortcut-key">Space</span>
                  </div>
                  <div className="shortcut-row">
                    <span>Undo Last Character / Word</span>
                    <span className="shortcut-key">Backspace</span>
                  </div>
                  <div className="shortcut-row">
                    <span>Send Formed Sentence</span>
                    <span className="shortcut-key">Enter</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="modal-footer">
              <button type="submit" className="modal-save-btn">
                Save & Close
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
