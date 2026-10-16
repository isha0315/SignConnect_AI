"""
services/state_manager.py — User recognition state management (#11).

Provides reconnection-safe state via session tokens.
State is preserved server-side and restored on socket reconnect.
"""
import logging
import secrets
import time
import threading

logger = logging.getLogger("signconnect.services")


class StateManager:
    """
    Manages per-user sign recognition state with session tokens.

    On connect, a session_token is issued. If the client reconnects
    with the same token, state is restored instead of lost.
    """

    # State expires after 30 minutes of inactivity
    SESSION_TTL = 1800

    def __init__(self):
        # { sid: state_dict }
        self._active = {}
        # { token: { "state": state_dict, "mode": str, "last_seen": float } }
        self._sessions = {}
        # { sid: token }
        self._sid_to_token = {}
        self._lock = threading.Lock()

    def create_state(self):
        """Create a fresh recognition state dict."""
        return {
            "current_word": "",
            "sentence": [],
            "suggestion": "",
            "candidate": "",
            "history": [],
            "last_accepted": "",
            "last_accepted_time": 0,
            "hand_was_lost": True,
        }

    def connect(self, sid, session_token=None):
        """
        Handle a new connection. If session_token matches an existing
        session, restore state. Otherwise create fresh state.

        Returns: (state_dict, token, restored: bool)
        """
        with self._lock:
            # Try to restore from session token
            if session_token and session_token in self._sessions:
                session = self._sessions[session_token]
                state = session["state"]
                mode = session.get("mode", "alphabet")
                self._active[sid] = state
                self._sid_to_token[sid] = session_token
                session["last_seen"] = time.time()
                logger.info("Session restored for %s (token=%s...)", sid, session_token[:8])
                return state, session_token, True, mode

            # Create new session
            token = secrets.token_urlsafe(16)
            state = self.create_state()
            self._active[sid] = state
            self._sid_to_token[sid] = token
            self._sessions[token] = {
                "state": state,
                "mode": "alphabet",
                "last_seen": time.time()
            }
            return state, token, False, "alphabet"

    def disconnect(self, sid):
        """
        Handle disconnect. State is preserved in _sessions for
        reconnection — NOT deleted.
        """
        with self._lock:
            token = self._sid_to_token.pop(sid, None)
            self._active.pop(sid, None)
            if token and token in self._sessions:
                self._sessions[token]["last_seen"] = time.time()
                logger.info("State preserved for reconnect (token=%s...)", token[:8])

    def get_state(self, sid):
        """Get the recognition state for a connection."""
        with self._lock:
            if sid not in self._active:
                self._active[sid] = self.create_state()
            return self._active[sid]

    def reset_state(self, sid):
        """Reset state for a connection."""
        with self._lock:
            self._active[sid] = self.create_state()
            token = self._sid_to_token.get(sid)
            if token and token in self._sessions:
                self._sessions[token]["state"] = self._active[sid]
            return self._active[sid]

    def set_mode(self, sid, mode):
        """Update the mode for a connection's session."""
        with self._lock:
            token = self._sid_to_token.get(sid)
            if token and token in self._sessions:
                self._sessions[token]["mode"] = mode

    def get_mode(self, sid, default="alphabet"):
        """Get the mode for a connection."""
        with self._lock:
            token = self._sid_to_token.get(sid)
            if token and token in self._sessions:
                return self._sessions[token].get("mode", default)
            return default

    def cleanup_expired(self):
        """Remove sessions that have been inactive for > SESSION_TTL."""
        cutoff = time.time() - self.SESSION_TTL
        with self._lock:
            expired = [
                token for token, session in self._sessions.items()
                if session["last_seen"] < cutoff
            ]
            for token in expired:
                del self._sessions[token]
            if expired:
                logger.info("Cleaned up %d expired sessions", len(expired))
