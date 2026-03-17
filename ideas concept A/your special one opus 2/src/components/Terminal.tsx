import { useState, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Loader2, Image as ImageIcon, Wand2, Download, AlertCircle, Terminal as TerminalIcon, ShieldAlert } from 'lucide-react';
import { motion } from 'motion/react';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export default function Terminal() {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio && window.aistudio.hasSelectedApiKey) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasKey(selected);
      } else {
        setHasKey(!!process.env.GEMINI_API_KEY);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio && window.aistudio.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasKey(true);
    }
  };

  const generateImage = async () => {
    if (!prompt.trim()) return;
    
    setIsGenerating(true);
    setError(null);
    
    try {
      const ai = new GoogleGenAI({ 
        apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY 
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: {
          parts: [{ text: prompt }]
        },
        config: {
          imageConfig: {
            aspectRatio: "16:9",
            imageSize: "1K"
          }
        }
      });

      let foundImage = false;
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const base64EncodeString = part.inlineData.data;
          setGeneratedImage(`data:${part.inlineData.mimeType || 'image/png'};base64,${base64EncodeString}`);
          foundImage = true;
          break;
        }
      }
      
      if (!foundImage) {
        throw new Error("No image was returned by the model.");
      }
    } catch (err: any) {
      console.error(err);
      if (err.message?.includes("Requested entity was not found")) {
        setHasKey(false);
        setError("API Key invalid or not found. Please select a valid key.");
      } else {
        setError(err.message || "Failed to generate image.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  if (!hasKey) {
    return (
      <div className="min-h-screen bg-[#050810] flex flex-col items-center justify-center p-6 text-center font-sans">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-[#0A0E14] border border-[#4EA8F6]/20 rounded-xl p-8 shadow-[0_0_30px_rgba(78,168,246,0.1)] relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#4EA8F6] to-[#7C5CFC]" />
          <ShieldAlert className="w-12 h-12 text-[#E5A820] mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2 tracking-[0.2em]">AUTHORIZATION REQUIRED</h2>
          <p className="text-[#5A6577] mb-8 text-sm leading-relaxed">
            Access to the Cipher image generation terminal requires a valid Google Cloud API key with billing enabled.
          </p>
          <button
            onClick={handleSelectKey}
            className="w-full py-4 bg-[#4EA8F6]/10 text-[#4EA8F6] border border-[#4EA8F6]/30 hover:bg-[#4EA8F6]/20 hover:border-[#4EA8F6] rounded-sm font-bold tracking-[0.2em] transition-all duration-300 shadow-[0_0_15px_rgba(78,168,246,0.2)_inset]"
          >
            AUTHENTICATE SYSTEM
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1 }}
      className="min-h-screen bg-[#050810] text-white flex flex-col font-sans selection:bg-[#4EA8F6]/30"
    >
      {/* Header */}
      <header className="border-b border-white/5 bg-[#0A0E14]/90 backdrop-blur-md p-4 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <svg width="28" height="28" viewBox="0 0 100 100">
            <polygon points="50,5 90,27.5 90,72.5 50,95 10,72.5 10,27.5" fill="none" stroke="#4EA8F6" strokeWidth="4" />
            <circle cx="50" cy="50" r="15" fill="#4EA8F6" opacity="0.5" />
          </svg>
          <span className="font-black tracking-[0.3em] text-transparent bg-clip-text bg-gradient-to-r from-[#4EA8F6] to-[#7C5CFC]">CIPHER</span>
          <span className="text-[10px] text-[#5A6577] border border-white/10 px-2 py-1 rounded-sm ml-2 tracking-widest bg-white/5">v3.1.0</span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono text-[#5A6577]">
          <span className="flex items-center gap-2 bg-[#4EA8F6]/10 text-[#4EA8F6] px-3 py-1.5 rounded-full border border-[#4EA8F6]/20">
            <span className="w-2 h-2 rounded-full bg-[#4EA8F6] animate-pulse shadow-[0_0_8px_#4EA8F6]"></span>
            LINK ESTABLISHED
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col lg:flex-row p-6 gap-6 max-w-[1920px] mx-auto w-full">
        
        {/* Left Panel - Controls */}
        <div className="w-full lg:w-[400px] flex flex-col gap-6 shrink-0">
          <div className="bg-[#0A0E14] border border-white/5 rounded-xl p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#4EA8F6] to-[#7C5CFC] opacity-50" />
            
            <h2 className="text-xs font-bold tracking-[0.2em] text-white/80 mb-6 flex items-center gap-2">
              <TerminalIcon className="w-4 h-4 text-[#4EA8F6]" />
              SYNTHESIS PARAMETERS
            </h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-mono text-[#5A6577] mb-3 uppercase tracking-widest">Input Directive</label>
                <div className="relative">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Enter visual parameters for synthesis..."
                    className="w-full h-40 bg-[#050810] border border-white/10 rounded-lg p-4 text-sm text-white/90 font-mono focus:outline-none focus:border-[#4EA8F6]/50 focus:ring-1 focus:ring-[#4EA8F6]/50 resize-none transition-all placeholder:text-[#5A6577]/50"
                  />
                  <div className="absolute bottom-3 right-3 text-[10px] font-mono text-[#5A6577]">
                    {prompt.length} CHARS
                  </div>
                </div>
              </div>

              <button
                onClick={generateImage}
                disabled={isGenerating || !prompt.trim()}
                className="group relative w-full py-4 bg-transparent overflow-hidden rounded-sm border border-[#4EA8F6]/30 hover:border-[#4EA8F6] disabled:border-white/10 disabled:hover:border-white/10 transition-all duration-300"
              >
                {!isGenerating && prompt.trim() && (
                  <div className="absolute inset-0 bg-[#4EA8F6]/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                )}
                <div className="relative flex items-center justify-center gap-3">
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-[#4EA8F6]" />
                      <span className="text-[#4EA8F6] text-sm font-bold tracking-[0.2em]">PROCESSING...</span>
                    </>
                  ) : (
                    <>
                      <Wand2 className={`w-4 h-4 ${prompt.trim() ? 'text-[#4EA8F6]' : 'text-[#5A6577]'}`} />
                      <span className={`text-sm font-bold tracking-[0.2em] transition-colors ${prompt.trim() ? 'text-[#4EA8F6] group-hover:text-white' : 'text-[#5A6577]'}`}>
                        EXECUTE SYNTHESIS
                      </span>
                    </>
                  )}
                </div>
              </button>

              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs flex items-start gap-3 font-mono"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">{error}</p>
                </motion.div>
              )}
            </div>
          </div>

          {/* Info Panel */}
          <div className="bg-[#0A0E14] border border-white/5 rounded-xl p-6">
            <h3 className="text-[10px] font-bold tracking-[0.2em] text-white/50 mb-4">SYSTEM DIAGNOSTICS</h3>
            <ul className="space-y-3 text-xs font-mono text-[#5A6577]">
              <li className="flex justify-between items-center border-b border-white/5 pb-2">
                <span>CORE</span>
                <span className="text-[#4EA8F6] bg-[#4EA8F6]/10 px-2 py-1 rounded">gemini-3.1-flash-image</span>
              </li>
              <li className="flex justify-between items-center border-b border-white/5 pb-2">
                <span>RESOLUTION</span>
                <span className="text-white/80">1K (1920x1080)</span>
              </li>
              <li className="flex justify-between items-center">
                <span>ASPECT RATIO</span>
                <span className="text-white/80">16:9</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Right Panel - Output */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 bg-[#0A0E14] border border-white/5 rounded-xl overflow-hidden relative flex items-center justify-center min-h-[500px] shadow-2xl">
            {/* Grid background */}
            <div className="absolute inset-0 opacity-5" style={{
              backgroundImage: 'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)',
              backgroundSize: '40px 40px'
            }}></div>

            {isGenerating ? (
              <div className="relative z-10 flex flex-col items-center gap-6">
                <div className="relative w-24 h-24 flex items-center justify-center">
                  <div className="absolute inset-0 border-2 border-[#4EA8F6]/20 border-t-[#4EA8F6] rounded-full animate-spin"></div>
                  <div className="absolute inset-2 border-2 border-[#7C5CFC]/20 border-b-[#7C5CFC] rounded-full animate-spin-reverse"></div>
                  <div className="w-2 h-2 bg-[#4EA8F6] rounded-full animate-pulse shadow-[0_0_15px_#4EA8F6]"></div>
                </div>
                <div className="text-[#4EA8F6] font-mono text-xs tracking-[0.3em] animate-pulse">SYNTHESIZING VISUAL DATA...</div>
              </div>
            ) : generatedImage ? (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative z-10 w-full h-full p-6 flex flex-col"
              >
                <div className="flex-1 relative rounded-lg overflow-hidden group border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
                  <img 
                    src={generatedImage} 
                    alt="Generated" 
                    className="w-full h-full object-contain bg-[#050810]"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-sm">
                    <a 
                      href={generatedImage} 
                      download="cipher-export.png"
                      className="flex items-center gap-3 px-8 py-4 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-white font-bold tracking-[0.2em] text-sm transition-all transform hover:scale-105"
                    >
                      <Download className="w-5 h-5" />
                      EXPORT ASSET
                    </a>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="relative z-10 flex flex-col items-center gap-6 text-[#5A6577]">
                <ImageIcon className="w-16 h-16 opacity-30" />
                <p className="font-mono text-xs tracking-[0.3em] uppercase">Awaiting Input Directive</p>
              </div>
            )}
          </div>
        </div>

      </main>
    </motion.div>
  );
}
