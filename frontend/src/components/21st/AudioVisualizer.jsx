import React from 'react';
import './AudioVisualizer.css';

/**
 * 21st.dev inspired Audio Frequency Visualizer
 * Displays animated sound waves when speaking/active.
 */
export default function AudioVisualizer({ isActive = false, className = '' }) {
  return (
    <div
      className={`audio-visualizer-wrap ${isActive ? 'active' : ''} ${className}`}
      title={isActive ? 'Audio speech active' : 'Audio idle'}
    >
      <div className="visualizer-bar" style={{ height: isActive ? undefined : '5px' }} />
      <div className="visualizer-bar" style={{ height: isActive ? undefined : '9px' }} />
      <div className="visualizer-bar" style={{ height: isActive ? undefined : '13px' }} />
      <div className="visualizer-bar" style={{ height: isActive ? undefined : '8px' }} />
      <div className="visualizer-bar" style={{ height: isActive ? undefined : '4px' }} />
    </div>
  );
}
