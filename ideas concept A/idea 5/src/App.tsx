/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';

export default function App() {
  const [accountType, setAccountType] = useState<'REAL' | 'DEMO'>('DEMO');
  const [isEntering, setIsEntering] = useState(false);

  const handleEnter = () => {
    setIsEntering(true);
    // Simulate transition to the terminal
    setTimeout(() => {
      setIsEntering(false);
    }, 3000);
  };

  return (
    <div className="relative min-h-screen w-full bg-[#04060A] overflow-hidden font-sans text-white flex items-center justify-center">
      {/* Deep Space Vacuum Background */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(10,14,20,0)_0%,rgba(4,6,10,1)_100%)] z-0 pointer-events-none" />
      
      {/* Starfield */}
      <Starfield isEntering={isEntering} />

      {/* CIPHER Wordmark */}
      <motion.h1 
        className="absolute top-10 md:top-16 left-1/2 -translate-x-1/2 text-[70px] md:text-[120px] font-light tracking-[0.2em] uppercase shimmer-text select-none z-20 ml-[0.2em]"
        animate={isEntering ? { opacity: 0, y: -50, filter: 'blur(10px)' } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 1.5, ease: "easeInOut" }}
      >
        Cipher
      </motion.h1>

      {/* The Void Gate */}
      <VoidGate isEntering={isEntering} />

      {/* Floating Controls */}
      <motion.div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-[60px] md:translate-y-[100px] z-30 flex flex-col items-center gap-10 w-full px-4"
        animate={isEntering ? { opacity: 0, scale: 0.8, filter: 'blur(10px)' } : { opacity: 1, scale: 1, filter: 'blur(0px)' }}
        transition={{ duration: 1.2, ease: "easeInOut" }}
      >
        {/* Account Toggle */}
        <div className="flex items-center gap-4 md:gap-6">
          <button
            onClick={() => setAccountType('REAL')}
            className={`relative px-8 md:px-12 py-3.5 rounded-full text-xs font-semibold tracking-[0.15em] transition-all duration-500 overflow-hidden ${
              accountType === 'REAL' 
                ? 'text-white shadow-[0_0_40px_rgba(124,92,252,0.5)] border border-transparent' 
                : 'text-[#6B7A8D] border border-red-900/40 hover:border-red-500/60 bg-[#060A10]/60 backdrop-blur-md'
            }`}
          >
            {accountType === 'REAL' && (
              <div className="absolute inset-0 bg-gradient-to-r from-[#4EA8F6] to-[#7C5CFC] opacity-90" />
            )}
            <span className="relative z-10">REAL</span>
          </button>

          <button
            onClick={() => setAccountType('DEMO')}
            className={`relative px-8 md:px-12 py-3.5 rounded-full text-xs font-semibold tracking-[0.15em] transition-all duration-500 overflow-hidden ${
              accountType === 'DEMO' 
                ? 'text-white shadow-[0_0_40px_rgba(78,168,246,0.5)] border border-transparent' 
                : 'text-[#6B7A8D] border border-[#4EA8F6]/30 hover:border-[#4EA8F6]/60 bg-[#060A10]/60 backdrop-blur-md'
            }`}
          >
            {accountType === 'DEMO' && (
              <div className="absolute inset-0 bg-gradient-to-r from-[#7C5CFC] to-[#4EA8F6] opacity-90" />
            )}
            <span className="relative z-10">DEMO</span>
          </button>
        </div>

        {/* Action Button */}
        <button
          onClick={handleEnter}
          className="group relative px-16 py-4 rounded-full overflow-hidden bg-[#060A10]/60 border border-[#7C5CFC]/40 hover:border-[#4EA8F6] transition-all duration-500 backdrop-blur-xl shadow-[0_15px_40px_-10px_rgba(124,92,252,0.5)] hover:shadow-[0_0_60px_rgba(78,168,246,0.6)]"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-[#4EA8F6]/0 via-[#4EA8F6]/20 to-[#7C5CFC]/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out" />
          <span className="relative z-10 text-white/90 text-xs font-medium tracking-[0.15em] group-hover:text-white transition-colors duration-300">
            ENTER TERMINAL
          </span>
        </button>
      </motion.div>
    </div>
  );
}

function VoidGate({ isEntering }: { isEntering: boolean }) {
  return (
    <motion.div 
      className="absolute z-10 flex items-center justify-center w-[350px] h-[350px] md:w-[600px] md:h-[600px]"
      animate={isEntering ? { scale: 12, opacity: 0 } : { scale: 1, opacity: 1 }}
      transition={{ duration: 2.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Outer Plasma Aura */}
      <motion.div 
        className="absolute inset-[-60px] rounded-full bg-[conic-gradient(from_0deg,transparent_0%,rgba(78,168,246,0.5)_20%,transparent_40%,rgba(124,92,252,0.5)_70%,transparent_100%)] blur-[50px]"
        animate={{ rotate: 360 }}
        transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
      />
      
      {/* Inner Plasma Core */}
      <motion.div 
        className="absolute inset-[-20px] rounded-full bg-[conic-gradient(from_180deg,transparent_0%,rgba(124,92,252,0.7)_30%,transparent_50%,rgba(78,168,246,0.7)_80%,transparent_100%)] blur-[30px]"
        animate={{ rotate: -360 }}
        transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
      />

      {/* The Physical Ring / Torus Edge */}
      <div className="absolute inset-[10px] rounded-full border-[2px] border-white/20 shadow-[0_0_80px_rgba(78,168,246,0.6),inset_0_0_80px_rgba(124,92,252,0.6)]" />
      <div className="absolute inset-[14px] rounded-full border border-[#4EA8F6]/40" />

      {/* Gold Orbital Element */}
      <motion.div 
        className="absolute inset-[-100px] rounded-full border border-[#E5A820]/30 border-dashed"
        style={{ rotateX: 75, rotateY: -15 }}
        animate={{ rotateZ: 360 }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
      />

      {/* Refractive Glass Center (The Void) */}
      <motion.div 
        className="absolute inset-[16px] rounded-full bg-[#04060A]/20 shadow-[inset_0_0_120px_rgba(4,6,10,1)]"
        style={{ backdropFilter: 'blur(20px) brightness(1.1)' }}
        animate={isEntering ? { backdropFilter: 'blur(0px) brightness(1)' } : { backdropFilter: 'blur(20px) brightness(1.1)' }}
        transition={{ duration: 1 }}
      />
    </motion.div>
  );
}

function Starfield({ isEntering }: { isEntering: boolean }) {
  const [stars, setStars] = useState<Array<{ id: number; x: number; y: number; size: number; duration: number; delay: number }>>([]);

  useEffect(() => {
    // Generate stars on client to avoid hydration mismatch
    const newStars = Array.from({ length: 150 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2.5 + 0.5,
      duration: Math.random() * 30 + 15,
      delay: Math.random() * -30, // Start at different points in animation
    }));
    setStars(newStars);
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 z-0"
      animate={isEntering ? { scale: 2, opacity: 0 } : { scale: 1, opacity: 1 }}
      transition={{ duration: 2.5, ease: "easeIn" }}
    >
      {stars.map((star) => (
        <motion.div
          key={star.id}
          className="absolute rounded-full bg-white"
          style={{
            width: star.size,
            height: star.size,
            left: `${star.x}%`,
            top: `${star.y}%`,
            opacity: star.size > 1.5 ? 0.8 : 0.3,
          }}
          animate={{
            y: [0, -300],
            opacity: [0, star.size > 1.5 ? 0.8 : 0.3, 0],
          }}
          transition={{
            duration: star.duration,
            delay: star.delay,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      ))}
    </motion.div>
  );
}

