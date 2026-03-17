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
    }, 2500);
  };

  return (
    <div className="relative min-h-screen w-full flex flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[#060A10] to-[#0A0E14] font-sans">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <Particles />
        <EventHorizon isEntering={isEntering} />
      </div>

      {/* Main Content */}
      <motion.div 
        className="relative z-10 flex flex-col items-center"
        animate={isEntering ? { scale: 1.5, opacity: 0, filter: 'blur(10px)' } : { scale: 1, opacity: 1, filter: 'blur(0px)' }}
        transition={{ duration: 2, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Logo / Wordmark */}
        <motion.h1 
          className="text-[80px] md:text-[140px] font-light tracking-[0.2em] uppercase mb-2 shimmer-text select-none ml-[0.2em]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.5, delay: 0.2, ease: "easeOut" }}
        >
          Cipher
        </motion.h1>

        {/* Mindset Anchor */}
        <motion.p 
          className="text-[#6B7A8D] italic text-sm md:text-base tracking-[0.3em] mb-16 select-none uppercase"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.5, delay: 1 }}
        >
          Discipline is the Edge
        </motion.p>

        {/* Account Toggle */}
        <motion.div 
          className="flex items-center gap-6 mb-16"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.5, delay: 1.2 }}
        >
          <button
            onClick={() => setAccountType('REAL')}
            className={`relative px-10 py-3 rounded-full text-xs font-semibold tracking-[0.15em] transition-all duration-500 overflow-hidden ${
              accountType === 'REAL' 
                ? 'text-white shadow-[0_0_30px_rgba(124,92,252,0.3)] border border-transparent' 
                : 'text-[#6B7A8D] border border-red-900/30 hover:border-red-500/50 bg-[#0A0E14]/50 backdrop-blur-sm'
            }`}
          >
            {accountType === 'REAL' && (
              <div className="absolute inset-0 bg-gradient-to-r from-[#4EA8F6] to-[#7C5CFC] opacity-90" />
            )}
            <span className="relative z-10">REAL</span>
          </button>

          <button
            onClick={() => setAccountType('DEMO')}
            className={`relative px-10 py-3 rounded-full text-xs font-semibold tracking-[0.15em] transition-all duration-500 overflow-hidden ${
              accountType === 'DEMO' 
                ? 'text-white shadow-[0_0_30px_rgba(78,168,246,0.3)] border border-transparent' 
                : 'text-[#6B7A8D] border border-[#4EA8F6]/20 hover:border-[#4EA8F6]/50 bg-[#0A0E14]/50 backdrop-blur-sm'
            }`}
          >
            {accountType === 'DEMO' && (
              <div className="absolute inset-0 bg-gradient-to-r from-[#7C5CFC] to-[#4EA8F6] opacity-90" />
            )}
            <span className="relative z-10">DEMO</span>
          </button>
        </motion.div>

        {/* Action Button */}
        <motion.button
          onClick={handleEnter}
          className="group relative px-14 py-5 rounded-sm overflow-hidden bg-[#0A0E14]/40 border border-[#4EA8F6]/30 hover:border-[#4EA8F6] transition-all duration-500 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.5, delay: 1.5 }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-[#4EA8F6]/0 via-[#4EA8F6]/10 to-[#7C5CFC]/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out" />
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 shadow-[inset_0_0_20px_rgba(78,168,246,0.3)]" />
          <span className="relative z-10 text-[#E5A820] text-xs font-medium tracking-[0.2em] group-hover:text-white transition-colors duration-300 group-hover:drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]">
            ENTER TERMINAL
          </span>
        </motion.button>
      </motion.div>
    </div>
  );
}

function EventHorizon({ isEntering }: { isEntering: boolean }) {
  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] flex items-center justify-center perspective-[1200px]">
      {/* Core Glow */}
      <motion.div 
        className="absolute w-[300px] h-[300px] rounded-full bg-[#4EA8F6]/10 blur-[80px]"
        animate={isEntering ? { scale: 5, opacity: 0 } : { scale: [1, 1.1, 1], opacity: [0.4, 0.6, 0.4] }}
        transition={isEntering ? { duration: 2, ease: "easeIn" } : { duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />
      
      {/* Outer Ring 1 - Purple */}
      <motion.div 
        className="absolute w-[700px] h-[700px] rounded-full border border-[#7C5CFC]/20"
        style={{ rotateX: 75, rotateY: 15 }}
        animate={isEntering ? { scale: 4, opacity: 0 } : { rotateZ: 360 }}
        transition={isEntering ? { duration: 2, ease: "easeIn" } : { duration: 30, repeat: Infinity, ease: "linear" }}
      />

      {/* Outer Ring 2 - Blue */}
      <motion.div 
        className="absolute w-[550px] h-[550px] rounded-full border border-[#4EA8F6]/30 shadow-[0_0_40px_rgba(78,168,246,0.1)]"
        style={{ rotateX: 65, rotateY: -25 }}
        animate={isEntering ? { scale: 4, opacity: 0 } : { rotateZ: -360 }}
        transition={isEntering ? { duration: 2, ease: "easeIn" } : { duration: 20, repeat: Infinity, ease: "linear" }}
      />

      {/* Inner Event Horizon */}
      <motion.div 
        className="absolute w-[400px] h-[400px] rounded-full border-[2px] border-[#7C5CFC]/30 shadow-[0_0_60px_rgba(124,92,252,0.3),inset_0_0_60px_rgba(124,92,252,0.3)]"
        style={{ rotateX: 55, rotateY: 5 }}
        animate={isEntering ? { scale: 5, opacity: 0, borderWidth: 0 } : { rotateZ: 360, scale: [1, 1.02, 1] }}
        transition={isEntering ? { duration: 2, ease: "easeIn" } : { duration: 15, repeat: Infinity, ease: "linear" }}
      />

      {/* Gold Orbital Element */}
      <motion.div 
        className="absolute w-[850px] h-[850px] rounded-full border border-[#E5A820]/15 border-dashed"
        style={{ rotateX: 82, rotateY: 0 }}
        animate={isEntering ? { scale: 3, opacity: 0 } : { rotateZ: 360 }}
        transition={isEntering ? { duration: 2, ease: "easeIn" } : { duration: 40, repeat: Infinity, ease: "linear" }}
      />
    </div>
  );
}

function Particles() {
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number; size: number; duration: number; delay: number }>>([]);

  useEffect(() => {
    // Generate particles only on the client to avoid hydration mismatches
    const newParticles = Array.from({ length: 60 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 0.5,
      duration: Math.random() * 20 + 15,
      delay: Math.random() * 5,
    }));
    setParticles(newParticles);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-white/40 shadow-[0_0_10px_rgba(255,255,255,0.8)]"
          style={{
            width: p.size,
            height: p.size,
            left: `${p.x}%`,
            top: `${p.y}%`,
          }}
          animate={{
            y: [0, -150, 0],
            x: [0, Math.random() * 100 - 50, 0],
            opacity: [0, Math.random() * 0.5 + 0.2, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      ))}
    </div>
  );
}
