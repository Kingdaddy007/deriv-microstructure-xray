/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';

export default function App() {
  const [accountMode, setAccountMode] = useState<'DEMO' | 'REAL'>('REAL');
  const [isInitiating, setIsInitiating] = useState(false);

  const handleInitiate = () => {
    setIsInitiating(true);
    setTimeout(() => {
      setIsInitiating(false);
    }, 3000);
  };

  return (
    <div className="relative min-h-screen w-full bg-[#0b101a] overflow-hidden font-sans text-white flex items-center justify-center">
      {/* Background: Ambient Volumetric Fog */}
      <VolumetricFog isInitiating={isInitiating} />

      {/* Central 3D Element: Torus Matrix */}
      <TorusMatrix isInitiating={isInitiating} />

      {/* Foreground Interface: Glassmorphism Panel */}
      <motion.div 
        className="relative z-20 glass-panel w-[90%] max-w-[420px] rounded-3xl p-10 flex flex-col items-center"
        initial={{ opacity: 0, y: 20 }}
        animate={isInitiating ? { opacity: 0, scale: 1.1, filter: 'blur(10px)' } : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        transition={{ duration: isInitiating ? 1.5 : 1, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-12">
          <h1 className="font-serif text-4xl md:text-5xl tracking-[0.2em] font-medium text-white/95 ml-[0.2em]">
            CIPHER
          </h1>
          <div className="w-12 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent mt-6" />
        </div>

        {/* Mechanical Slider */}
        <div className="w-full mb-12">
          <div className="mechanical-track rounded-full p-1.5 relative flex w-full h-14 cursor-pointer" onClick={() => setAccountMode(accountMode === 'DEMO' ? 'REAL' : 'DEMO')}>
            {/* Sliding Thumb */}
            <motion.div 
              className={`absolute top-1.5 bottom-1.5 w-[calc(50%-6px)] rounded-full mechanical-thumb ${accountMode === 'REAL' ? 'bg-[#10B981] emerald-glow' : 'bg-[#1e293b]'}`}
              animate={{ 
                left: accountMode === 'REAL' ? 'calc(50% + 3px)' : '6px',
              }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            />
            
            {/* Labels */}
            <div className="relative z-10 flex-1 flex items-center justify-center">
              <span className={`text-xs font-semibold tracking-[0.15em] transition-colors duration-300 ${accountMode === 'DEMO' ? 'text-white' : 'text-white/40'}`}>
                DEMO
              </span>
            </div>
            <div className="relative z-10 flex-1 flex items-center justify-center">
              <span className={`text-xs font-semibold tracking-[0.15em] transition-colors duration-300 ${accountMode === 'REAL' ? 'text-white drop-shadow-md' : 'text-white/40'}`}>
                REAL
              </span>
            </div>
          </div>
        </div>

        {/* Initiate Session Button */}
        <button 
          onClick={handleInitiate}
          className="premium-button w-full py-4 rounded-xl relative overflow-hidden group"
        >
          <div className="absolute inset-0 bg-white/5 translate-y-[100%] group-hover:translate-y-0 transition-transform duration-300 ease-out" />
          <span className="relative z-10 text-xs font-semibold tracking-[0.2em] text-white/90 group-hover:text-white transition-colors">
            INITIATE SESSION
          </span>
        </button>

        {/* Integrated Typography */}
        <div className="mt-10 opacity-60 mix-blend-overlay">
          <p className="font-serif italic text-[15px] tracking-wide text-center">
            "Discipline is the Edge."
          </p>
        </div>
      </motion.div>
    </div>
  );
}

function VolumetricFog({ isInitiating }: { isInitiating: boolean }) {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
      {/* Base ambient gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_#162032_0%,_#0b101a_100%)]" />
      
      {/* Animated fog layers */}
      <motion.div 
        className="absolute -inset-[50%] bg-[radial-gradient(ellipse_at_center,_rgba(30,41,59,0.4)_0%,_transparent_50%)] blur-[80px]"
        animate={isInitiating ? { scale: 1.5, opacity: 0 } : { 
          x: ['-5%', '5%', '-5%'],
          y: ['-2%', '2%', '-2%'],
        }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
      />
      
      <motion.div 
        className="absolute -inset-[50%] bg-[radial-gradient(ellipse_at_center,_rgba(16,185,129,0.05)_0%,_transparent_40%)] blur-[100px]"
        animate={isInitiating ? { scale: 2, opacity: 0 } : { 
          x: ['5%', '-5%', '5%'],
          y: ['2%', '-2%', '2%'],
        }}
        transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

function TorusMatrix({ isInitiating }: { isInitiating: boolean }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center perspective-scene pointer-events-none">
      <motion.div 
        className="relative w-[600px] h-[600px] preserve-3d"
        animate={isInitiating ? { scale: 3, rotateZ: 90, opacity: 0 } : { rotateZ: 360 }}
        transition={isInitiating ? { duration: 2, ease: "easeInOut" } : { duration: 120, repeat: Infinity, ease: "linear" }}
      >
        {/* Outer Frosted Ring */}
        <motion.div 
          className="absolute inset-0 rounded-full frosted-ring"
          style={{ transformOrigin: 'center' }}
          animate={{ rotateX: 360, rotateY: 180 }}
          transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
        />
        
        {/* Inner Gold Thread Ring 1 */}
        <motion.div 
          className="absolute inset-[10%] rounded-full gold-thread"
          style={{ transformOrigin: 'center' }}
          animate={{ rotateY: -360, rotateX: -180 }}
          transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
        />

        {/* Inner Gold Thread Ring 2 (Offset) */}
        <motion.div 
          className="absolute inset-[15%] rounded-full gold-thread-bright"
          style={{ transformOrigin: 'center' }}
          animate={{ rotateX: 360, rotateZ: 360 }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
        />

        {/* Core Frosted Sphere/Ring */}
        <motion.div 
          className="absolute inset-[30%] rounded-full frosted-ring"
          style={{ transformOrigin: 'center' }}
          animate={{ rotateY: 360, rotateZ: -360 }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        />

        {/* Mathematical Waveforms (Simulated with stretched ellipses) */}
        <motion.div 
          className="absolute top-1/2 left-[-20%] right-[-20%] h-[2px] bg-gradient-to-r from-transparent via-[rgba(212,175,55,0.3)] to-transparent"
          style={{ transformOrigin: 'center' }}
          animate={{ rotateZ: 360, scaleY: [1, 50, 1] }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div 
          className="absolute top-1/2 left-[-20%] right-[-20%] h-[2px] bg-gradient-to-r from-transparent via-[rgba(255,255,255,0.2)] to-transparent"
          style={{ transformOrigin: 'center' }}
          animate={{ rotateZ: -360, scaleY: [50, 1, 50] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>
    </div>
  );
}
