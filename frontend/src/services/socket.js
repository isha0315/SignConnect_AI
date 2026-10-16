import { io } from 'socket.io-client';

class SocketService {
  constructor() {
    this.socket = null;
    this.sessionToken = localStorage.getItem('signconnect_session_token') || null;
    this.listeners = new Map();
  }

  connect() {
    if (this.socket && this.socket.connected) {
      return this.socket;
    }

    const queryParams = {};
    if (this.sessionToken) {
      queryParams.session_token = this.sessionToken;
    }

    // Connect via Vite proxy (relative URL)
    this.socket = io({
      query: queryParams,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('[Socket] Connected, ID:', this.socket.id);
      this._emitLocal('connection_status', { connected: true, id: this.socket.id });
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      this._emitLocal('connection_status', { connected: false, reason });
    });

    this.socket.on('session_init', (data) => {
      if (data && data.session_token) {
        this.sessionToken = data.session_token;
        localStorage.setItem('signconnect_session_token', data.session_token);
        console.log('[Socket] Session initialized/restored:', data);
        this._emitLocal('session_init', data);
      }
    });

    this.socket.on('recognition_update', (data) => {
      this._emitLocal('recognition_update', data);
    });

    this.socket.on('recognition_control', (data) => {
      this._emitLocal('recognition_control', data);
    });

    this.socket.on('receive_message', (data) => {
      this._emitLocal('receive_message', data);
    });

    this.socket.on('sticker_gesture', (data) => {
      this._emitLocal('sticker_gesture', data);
    });

    this.socket.on('webrtc_signal', (data) => {
      this._emitLocal('webrtc_signal', data);
    });

    this.socket.on('room_joined', (data) => {
      this._emitLocal('room_joined', data);
    });

    this.socket.on('room_left', (data) => {
      this._emitLocal('room_left', data);
    });

    this.socket.on('system_message', (msg) => {
      this._emitLocal('system_message', msg);
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // Local event bus for React components
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  _emitLocal(event, data) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(data);
        } catch (e) {
          console.error(`[Socket] Listener error on ${event}:`, e);
        }
      }
    }
  }

  // Socket emitter wrappers
  joinRoom(roomId, username) {
    if (!this.socket) return;
    this.socket.emit('join_room', { room_id: roomId, username });
  }

  leaveRoom(roomId) {
    if (!this.socket) return;
    this.socket.emit('leave_room', { room_id: roomId });
  }

  sendMessage(message, username, messageType = 'typed') {
    if (!this.socket) return;
    this.socket.emit('send_message', {
      message,
      username,
      message_type: messageType,
    });
  }

  sendSticker(gesture, username) {
    if (!this.socket) return;
    this.socket.emit('send_sticker', {
      gesture,
      username,
    });
  }

  sendRecognitionFrame(base64Image, mode, username) {
    if (!this.socket || !this.socket.connected) return;
    this.socket.emit('recognition_frame', {
      image: base64Image,
      mode,
      username,
    });
  }

  sendRecognitionControl(action, username, extra = {}) {
    if (!this.socket) return;
    this.socket.emit('recognition_control', {
      action,
      command: action,
      username,
      ...extra,
    });
  }

  sendWebRtcSignal(type, data, username) {
    if (!this.socket) return;
    this.socket.emit('webrtc_signal', {
      type,
      username,
      ...data,
    });
  }
}

export const socketService = new SocketService();
