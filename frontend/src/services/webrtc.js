import { socketService } from './socket';

const RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302'] }
  ]
};

class WebRtcManager {
  constructor() {
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.inCall = false;
    this.pendingCandidates = [];
    this.callbacks = {
      onRemoteStream: null,
      onCallStateChange: null,
    };
  }

  setCallbacks({ onRemoteStream, onCallStateChange }) {
    this.callbacks.onRemoteStream = onRemoteStream;
    this.callbacks.onCallStateChange = onCallStateChange;
  }

  setLocalStream(stream) {
    this.localStream = stream;
    // If connection exists, update audio/video tracks
    if (this.pc && stream) {
      const senders = this.pc.getSenders();
      stream.getTracks().forEach(track => {
        const sender = senders.find(s => s.track && s.track.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track);
        } else {
          this.pc.addTrack(track, stream);
        }
      });
    }
  }

  _notifyState(state) {
    if (this.callbacks.onCallStateChange) {
      this.callbacks.onCallStateChange(state);
    }
  }

  createPeerConnection(username) {
    if (this.pc) return this.pc;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    pc.ontrack = (event) => {
      console.log('[WebRTC] Remote track received:', event);
      let stream = event.streams && event.streams[0];
      if (!stream) {
        stream = new MediaStream();
        stream.addTrack(event.track);
      }
      this.remoteStream = stream;
      if (this.callbacks.onRemoteStream) {
        this.callbacks.onRemoteStream(stream);
      }
      this._notifyState('connected');
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketService.sendWebRtcSignal('candidate', { candidate: event.candidate }, username);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[WebRTC] State change:', pc.connectionState);
      switch (pc.connectionState) {
        case 'connected':
          this.inCall = true;
          this._notifyState('connected');
          break;
        case 'connecting':
          this._notifyState('connecting');
          break;
        case 'disconnected':
          this._notifyState('disconnected');
          break;
        case 'failed':
          this._notifyState('failed');
          break;
        case 'closed':
          this.inCall = false;
          this._notifyState('idle');
          break;
        default:
          break;
      }
    };

    return pc;
  }

  async startCall(username) {
    if (this.inCall) return;

    try {
      this.inCall = true;
      this._notifyState('calling');
      const pc = this.createPeerConnection(username);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socketService.sendWebRtcSignal('offer', { sdp: offer }, username);
      console.log('[WebRTC] Offer sent');
    } catch (err) {
      console.error('[WebRTC] Start call error:', err);
      this.endCall(false);
      this._notifyState('failed');
    }
  }

  async handleSignal(signal, username) {
    if (!signal || !signal.type) return;

    const type = signal.type;

    if (type === 'offer') {
      try {
        console.log('[WebRTC] Received offer');
        this.inCall = true;
        this._notifyState('connecting');
        const pc = this.createPeerConnection(username);

        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

        // Flush pending ICE
        while (this.pendingCandidates.length > 0) {
          const cand = this.pendingCandidates.shift();
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socketService.sendWebRtcSignal('answer', { sdp: answer }, username);
      } catch (e) {
        console.error('[WebRTC] Error handling offer:', e);
      }
    } else if (type === 'answer') {
      try {
        console.log('[WebRTC] Received answer');
        if (this.pc) {
          await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

          while (this.pendingCandidates.length > 0) {
            const cand = this.pendingCandidates.shift();
            await this.pc.addIceCandidate(new RTCIceCandidate(cand));
          }
        }
      } catch (e) {
        console.error('[WebRTC] Error handling answer:', e);
      }
    } else if (type === 'candidate') {
      try {
        if (signal.candidate) {
          if (this.pc && this.pc.remoteDescription && this.pc.remoteDescription.type) {
            await this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } else {
            this.pendingCandidates.push(signal.candidate);
          }
        }
      } catch (e) {
        console.warn('[WebRTC] Candidate error:', e);
      }
    } else if (type === 'end') {
      console.log('[WebRTC] Remote peer ended call');
      this.endCall(false);
    }
  }

  endCall(notifyRemote = true, username = 'User') {
    if (notifyRemote) {
      socketService.sendWebRtcSignal('end', {}, username);
    }

    if (this.pc) {
      try {
        this.pc.ontrack = null;
        this.pc.onicecandidate = null;
        this.pc.onconnectionstatechange = null;
        this.pc.close();
      } catch (e) {
        console.warn('[WebRTC] Peer close error:', e);
      }
      this.pc = null;
    }

    this.remoteStream = null;
    this.inCall = false;
    this.pendingCandidates = [];

    if (this.callbacks.onRemoteStream) {
      this.callbacks.onRemoteStream(null);
    }
    this._notifyState('idle');
  }
}

export const webrtcManager = new WebRtcManager();
