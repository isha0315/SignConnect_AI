import React, { useRef, useState } from 'react';
import { motion, useMotionValue, useTransform, useSpring, AnimatePresence } from 'framer-motion';
import './AppleDock.css';

/**
 * 21st.dev inspired Apple Magnification Dock component
 * Icons scale dynamically using mouse proximity and spring physics.
 */
export default function AppleDock({
  items = [],
  onSelect,
  baseSize = 48,
  magnifySize = 78,
  distanceSpread = 130,
}) {
  const mouseX = useMotionValue(Infinity);

  return (
    <motion.div
      className="apple-dock-wrapper"
      onMouseMove={(e) => mouseX.set(e.pageX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
    >
      {items.map((item) => (
        <DockItem
          key={item.id}
          item={item}
          mouseX={mouseX}
          onSelect={onSelect}
          baseSize={baseSize}
          magnifySize={magnifySize}
          distanceSpread={distanceSpread}
        />
      ))}
    </motion.div>
  );
}

function DockItem({ item, mouseX, onSelect, baseSize, magnifySize, distanceSpread }) {
  const ref = useRef(null);
  const [isHovered, setIsHovered] = useState(false);

  // Measure distance from cursor to center of this icon
  const distance = useTransform(mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    const iconCenter = bounds.x + bounds.width / 2;
    return val - iconCenter;
  });

  // Calculate target size
  const targetWidth = useTransform(
    distance,
    [-distanceSpread, 0, distanceSpread],
    [baseSize, magnifySize, baseSize]
  );

  // Apply fluid spring physics
  const width = useSpring(targetWidth, {
    mass: 0.1,
    stiffness: 170,
    damping: 14,
  });

  return (
    <motion.div
      ref={ref}
      style={{ width, height: width }}
      className="apple-dock-item"
      onClick={() => onSelect && onSelect(item.id)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      whileTap={{ scale: 0.9 }}
    >
      {/* Tooltip */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            className="dock-item-tooltip"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
          >
            {item.label}
          </motion.div>
        )}
      </AnimatePresence>

      <img
        src={item.src}
        alt={item.label}
        className="dock-item-img"
        loading="lazy"
      />
    </motion.div>
  );
}
