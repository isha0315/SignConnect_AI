import React from 'react';
import './ShineBorder.css';

/**
 * 21st.dev inspired Shine Border component (Magic UI pattern)
 * Wraps any element and adds a rotating animated neon gradient beam along its border.
 */
export default function ShineBorder({
  children,
  borderWidth = 1.5,
  duration = 6,
  colors = ['#06b6d4', '#8b5cf6', '#10b981'],
  opacity = 0.75,
  className = '',
  style = {},
}) {
  return (
    <div
      className={`shine-border-container ${className}`}
      style={{
        padding: `${borderWidth}px`,
        '--shine-duration': `${duration}s`,
        '--shine-opacity': opacity,
        '--shine-c1': colors[0] || '#06b6d4',
        '--shine-c2': colors[1] || '#8b5cf6',
        '--shine-c3': colors[2] || '#10b981',
        ...style,
      }}
    >
      <div className="shine-border-track" />
      <div className="shine-border-inner">{children}</div>
    </div>
  );
}
