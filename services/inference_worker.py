"""
services/inference_worker.py — Background AI inference worker (#2/#6).

Moves AI inference out of the socket handler thread into a single
background worker with a per-connection latest-frame buffer.

Architecture:
  Socket Handler → drops frame into per-sid buffer → returns immediately
  Worker Thread  → pops latest frame per sid → runs recognizer → emits result

Benefits:
  - No global lock bottleneck in the socket handler
  - Stale frames are dropped (only latest per-connection is processed)
  - Socket handler returns instantly → no blocking
"""
import logging
import threading
import time

logger = logging.getLogger("signconnect.services")


class InferenceWorker:
    """
    Single background thread that processes recognition frames.

    Instead of blocking the socket handler with a lock, callers
    submit frames to a per-connection buffer. The worker drains
    all buffers each cycle, processing only the LATEST frame
    per connection (dropping stale frames).
    """

    def __init__(self, recognizer, process_result_callback, interval=0.05):
        """
        Args:
            recognizer: SignRecognitionService instance
            process_result_callback: fn(sid, username, mode, result) called
                                     with the AI result (in worker thread)
            interval: seconds between worker cycles (50ms default = ~20 FPS max)
        """
        self.recognizer = recognizer
        self.process_result = process_result_callback
        self.interval = interval

        # Per-connection latest-frame buffer
        # { sid: { "frame": np.ndarray, "mode": str, "username": str } }
        self._buffers = {}
        self._lock = threading.Lock()

        self._running = False
        self._thread = None

    def start(self):
        """Start the background worker thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._worker_loop,
            name="InferenceWorker",
            daemon=True
        )
        self._thread.start()
        logger.info("Inference worker started")

    def stop(self):
        """Stop the background worker thread."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=2.0)
        logger.info("Inference worker stopped")

    def submit_frame(self, sid, frame, mode, username):
        """
        Submit a frame for processing. Non-blocking.
        Only the LATEST frame per sid is kept (stale frames dropped).
        """
        with self._lock:
            self._buffers[sid] = {
                "frame": frame,
                "mode": mode,
                "username": username
            }

    def remove_client(self, sid):
        """Remove a client's buffer on disconnect."""
        with self._lock:
            self._buffers.pop(sid, None)
        self.recognizer.clear_client(sid)

    def _worker_loop(self):
        """Main worker loop. Drains all buffers each cycle."""
        while self._running:
            # Snapshot and clear all buffers atomically
            with self._lock:
                work = dict(self._buffers)
                self._buffers.clear()

            if not work:
                time.sleep(self.interval)
                continue

            for sid, data in work.items():
                try:
                    result = self.recognizer.recognize(
                        data["frame"],
                        mode=data["mode"],
                        sid=sid
                    )
                    self.process_result(
                        sid,
                        data["username"],
                        data["mode"],
                        result
                    )
                except Exception as e:
                    logger.error(
                        "Inference error for %s: %s",
                        sid, e, exc_info=True
                    )

            time.sleep(self.interval)
