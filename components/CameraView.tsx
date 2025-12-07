
import React, { useRef, useState, useEffect } from 'react';
import { BoundingBox } from '../types';

interface VideoPlayerProps {
  onAnalyze: (imageData: string, query: string, audioData?: string | null) => void;
  onIdentify: (imageData: string) => void;
  isAnalyzing: boolean;
  annotations: BoundingBox[] | null;
  onCloseAnnotations: () => void;
  onMediaLoaded: (title: string | null) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
}

// Helper to encode Float32Array to WAV
const encodeWAV = (samples: Float32Array, sampleRate: number) => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // file length
  view.setUint32(4, 36 + samples.length * 2, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // format chunk identifier
  writeString(view, 12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (raw)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, sampleRate * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeString(view, 36, 'data');
  // data chunk length
  view.setUint32(40, samples.length * 2, true);

  floatTo16BitPCM(view, 44, samples);

  return buffer;
};

const floatTo16BitPCM = (output: DataView, offset: number, input: Float32Array) => {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
};

const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ 
  onAnalyze, 
  onIdentify, 
  isAnalyzing, 
  annotations,
  onCloseAnnotations,
  onMediaLoaded,
  onPlayStateChange
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  
  // Audio Context Refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioBufferRef = useRef<Float32Array[]>([]); // Rolling buffer chunks
  
  const [mediaSrc, setMediaSrc] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'video' | 'image' | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [query, setQuery] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Local processing state to prevent double clicks instantly
  const [localProcessing, setLocalProcessing] = useState(false);
  
  // Drawer & Swipe State
  const [isQueryDrawerOpen, setIsQueryDrawerOpen] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  // Setup Audio Recording when video loads
  useEffect(() => {
    if (mediaType === 'video' && videoRef.current) {
      // Small delay to ensure video element is ready in DOM
      const timer = setTimeout(() => {
        try {
          if (!videoRef.current) return;
          
          const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
          const ctx = new AudioContextClass();
          audioCtxRef.current = ctx;

          // Note: createMediaElementSource requires CORS if using a remote URL. 
          // Since we use createObjectURL from a local file OR a CORS-enabled demo URL, it should be safe.
          const source = ctx.createMediaElementSource(videoRef.current);
          sourceNodeRef.current = source;

          // Use ScriptProcessor for capturing audio (approx 10 sec buffer)
          // 4096 buffer size, 1 input channel, 1 output channel
          const processor = ctx.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;

          // CRITICAL FIX: Connect source to destination (speakers) so user can hear it
          source.connect(ctx.destination);
          
          // Also connect source to processor to capture it
          source.connect(processor);
          
          // Connect processor to destination to keep it alive (but it outputs silence as we don't copy buffer)
          processor.connect(ctx.destination);

          processor.onaudioprocess = (e) => {
            if (!videoRef.current?.paused) {
               const inputData = e.inputBuffer.getChannelData(0);
               // Clone data to avoid reference issues
               const chunk = new Float32Array(inputData);
               
               // Add to rolling buffer
               audioBufferRef.current.push(chunk);

               // Maintain approx 10 seconds of history
               // 44100 Hz * 10 sec = 441,000 samples. 
               // 4096 per chunk => ~108 chunks
               const maxChunks = 110; 
               if (audioBufferRef.current.length > maxChunks) {
                  audioBufferRef.current = audioBufferRef.current.slice(audioBufferRef.current.length - maxChunks);
               }
            }
          };
        } catch (e) {
          console.warn("Audio Context setup failed (likely due to CORS or browser policy)", e);
        }
      }, 100);

      return () => clearTimeout(timer);
    }

    return () => {
      // Cleanup
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
      audioBufferRef.current = [];
    };
  }, [mediaSrc, mediaType]);

  // Sync local processing state with prop
  useEffect(() => {
    if (!isAnalyzing) {
        setLocalProcessing(false);
    }
  }, [isAnalyzing]);

  // Async helper for blob to base64
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Helper to get image data from current media
  const getSnapshot = (): string | null => {
    if (!canvasRef.current) return null;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    let width = 0;
    let height = 0;

    if (mediaType === 'video' && videoRef.current) {
      width = videoRef.current.videoWidth;
      height = videoRef.current.videoHeight;
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(videoRef.current, 0, 0, width, height);
    } else if (mediaType === 'image' && imgRef.current) {
      width = imgRef.current.naturalWidth;
      height = imgRef.current.naturalHeight;
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(imgRef.current, 0, 0, width, height);
    } else {
      return null;
    }
    
    return canvas.toDataURL('image/jpeg', 0.8);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setMediaSrc(url);
      setQuery(""); // Reset query
      setIsQueryDrawerOpen(false);
      onCloseAnnotations(); // Clear old annotations
      onMediaLoaded(file.name.replace(/\.[^/.]+$/, "")); // Pass clean filename

      // Clear audio buffer
      audioBufferRef.current = [];
      
      if (file.type.startsWith('image/')) {
        setMediaType('image');
        setIsPaused(true); 
        onPlayStateChange?.(false);
      } else {
        setMediaType('video');
        setIsPaused(false);
        onPlayStateChange?.(true);
      }
    }
  };

  const handleLoadDemo = () => {
    // "Tears of Steel" - Blender Foundation Open Source Live Action Movie (CORS enabled)
    // Characters: Thom, Celia - Real humans, good for testing identification
    setMediaSrc("https://storage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4");
    setMediaType('video');
    setQuery("");
    setIsQueryDrawerOpen(false);
    onCloseAnnotations();
    onMediaLoaded("Tears of Steel (Demo)");
    audioBufferRef.current = [];
    setIsPaused(false);
    onPlayStateChange?.(true);
  };

  const handleReset = () => {
    setMediaSrc(null);
    setQuery("");
    setMediaType(null);
    onCloseAnnotations();
    setIsQueryDrawerOpen(false);
    onMediaLoaded(null);
    onPlayStateChange?.(false);
  };

  const handleVideoPause = () => {
    if (!videoRef.current?.seeking) {
      setIsPaused(true);
      onPlayStateChange?.(false);
      // We assume processor stops via the `if (!paused)` check in loop
    }
  };

  const handleVideoPlay = () => {
    setIsPaused(false);
    onPlayStateChange?.(true);
    onCloseAnnotations();
    setIsQueryDrawerOpen(false);
    // Resume audio context if suspended
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  };

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (query.trim()) {
      setLocalProcessing(true); // Lock UI immediately
      const dataUrl = getSnapshot();
      let audioBase64: string | null = null;
      
      // Capture audio if available and it's video
      if (mediaType === 'video' && audioBufferRef.current.length > 0 && audioCtxRef.current) {
         const totalLength = audioBufferRef.current.reduce((acc, chunk) => acc + chunk.length, 0);
         const result = new Float32Array(totalLength);
         let offset = 0;
         for (const chunk of audioBufferRef.current) {
            result.set(chunk, offset);
            offset += chunk.length;
         }
         const wavBuffer = encodeWAV(result, audioCtxRef.current.sampleRate);
         const blob = new Blob([wavBuffer], { type: 'audio/wav' });
         try {
            audioBase64 = await blobToBase64(blob);
         } catch (err) {
            console.error("Audio encoding failed", err);
         }
      }

      if (dataUrl) {
        onAnalyze(dataUrl, query, audioBase64);
      } else {
        setLocalProcessing(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      handleSubmit(e);
    }
  };

  const handleIdentifyClick = () => {
    if (localProcessing || isAnalyzing) return; // Prevent double click
    setLocalProcessing(true); // Lock immediately
    
    const dataUrl = getSnapshot();
    if (dataUrl) {
      onIdentify(dataUrl);
    } else {
      setLocalProcessing(false);
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.getElementById('root')?.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const startListening = () => {
    // Toggle behavior: stop if already listening
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      setIsListening(true);

      recognition.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        setQuery(text);
        // setIsListening(false) is handled by onend
      };

      recognition.onerror = (event: any) => {
        // Suppress expected errors (no-speech = silence, aborted = user clicked stop)
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
            console.error("Speech recognition error", event.error);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
      };

      try {
        recognition.start();
      } catch (err) {
        console.error("Failed to start recognition", err);
        setIsListening(false);
      }
    } else {
      alert("Speech recognition is not supported in this browser.");
    }
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  // Close drawer when analysis finishes (so ResultCard can take focus)
  useEffect(() => {
    if (!isAnalyzing && isQueryDrawerOpen) {
       setIsQueryDrawerOpen(false);
    }
  }, [isAnalyzing]);

  // Handle Fullscreen change events (ESC key)
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Clean up object URL (only if created by createObjectURL)
  useEffect(() => {
    return () => {
      if (mediaSrc && mediaSrc.startsWith('blob:')) {
        URL.revokeObjectURL(mediaSrc);
      }
    };
  }, [mediaSrc]);

  // Swipe logic for Query Drawer
  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };
  const onTouchMove = (e: React.TouchEvent) => setTouchEnd(e.targetTouches[0].clientX);
  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    if (touchStart - touchEnd > 50) setIsQueryDrawerOpen(false);
  };

  // Handle drawing annotations
  useEffect(() => {
    if (annotations && annotations.length > 0 && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
         let width = canvasRef.current.width;
         let height = canvasRef.current.height;

         // Redraw base image
         if (mediaType === 'video' && videoRef.current) {
             width = videoRef.current.videoWidth;
             height = videoRef.current.videoHeight;
             ctx.drawImage(videoRef.current, 0, 0, width, height);
         } else if (mediaType === 'image' && imgRef.current) {
             width = imgRef.current.naturalWidth;
             height = imgRef.current.naturalHeight;
             ctx.drawImage(imgRef.current, 0, 0, width, height);
         }

         annotations.forEach(box => {
            const x = (box.xmin / 1000) * width;
            const y = (box.ymin / 1000) * height;
            const w = ((box.xmax - box.xmin) / 1000) * width;

            const text = box.name;
            ctx.font = 'bold 16px "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
            const textMetrics = ctx.measureText(text);
            const textWidth = textMetrics.width;
            
            const paddingX = 12;
            const contentWidth = textWidth + (paddingX * 2);
            const contentHeight = 32;
            
            const centerX = x + (w / 2);
            
            // Calculate label position (floating above head)
            let labelX = centerX - (contentWidth / 2);
            let labelY = y - contentHeight - 15;

            // Boundary checks
            if (labelX < 10) labelX = 10;
            if (labelX + contentWidth > width - 10) labelX = width - contentWidth - 10;
            
            // Flip if too close to top
            const isFlipped = labelY < 10;
            if (isFlipped) {
               labelY = y + 15;
            }

            // --- Draw Label Background (Pill Shape) ---
            ctx.save();
            ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
            ctx.shadowBlur = 6;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 3;

            ctx.fillStyle = 'rgba(17, 24, 39, 0.9)'; // Dark background
            ctx.strokeStyle = '#3b82f6'; // Blue-500 border
            ctx.lineWidth = 1.5;

            // Draw rounded rectangle
            ctx.beginPath();
            const radius = 8;
            ctx.moveTo(labelX + radius, labelY);
            ctx.lineTo(labelX + contentWidth - radius, labelY);
            ctx.quadraticCurveTo(labelX + contentWidth, labelY, labelX + contentWidth, labelY + radius);
            ctx.lineTo(labelX + contentWidth, labelY + contentHeight - radius);
            ctx.quadraticCurveTo(labelX + contentWidth, labelY + contentHeight, labelX + contentWidth - radius, labelY + contentHeight);
            ctx.lineTo(labelX + radius, labelY + contentHeight);
            ctx.quadraticCurveTo(labelX, labelY + contentHeight, labelX, labelY + contentHeight - radius);
            ctx.lineTo(labelX, labelY + radius);
            ctx.quadraticCurveTo(labelX, labelY, labelX + radius, labelY);
            ctx.closePath();
            
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // --- Draw Pointer (Triangle) ---
            if (!isFlipped) {
              ctx.beginPath();
              ctx.fillStyle = '#3b82f6';
              const pointerY = labelY + contentHeight;
              const pointerX = centerX;
              const clampedPointerX = Math.max(labelX + radius, Math.min(pointerX, labelX + contentWidth - radius));
              
              ctx.moveTo(clampedPointerX, pointerY);
              ctx.lineTo(clampedPointerX - 6, pointerY);
              ctx.lineTo(clampedPointerX + 6, pointerY);
              ctx.fill();
            }

            // --- Draw Text ---
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, labelX + (contentWidth / 2), labelY + (contentHeight / 2) + 1);
            
            ctx.textAlign = 'start'; 
            ctx.textBaseline = 'alphabetic';
         });
      }
    }
  }, [annotations, mediaType]);

  if (!mediaSrc) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-900 p-6 text-center">
        <input 
          type="file" 
          accept="video/*,image/*" 
          onChange={handleFileUpload} 
          className="hidden" 
          ref={fileInputRef}
        />
        
        <div 
          onClick={triggerFileUpload}
          className="w-72 h-48 border-2 border-dashed border-gray-600 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-gray-800/50 transition-all group relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-blue-500/5 group-hover:bg-blue-500/10 transition-colors"></div>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-gray-400 group-hover:text-blue-400 mb-4 z-10 transition-colors">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <span className="text-gray-300 group-hover:text-white font-medium z-10">Upload Your Clip</span>
          <span className="text-gray-500 text-xs mt-2 z-10">MP4, WebM (e.g. Netflix Screen Record)</span>
        </div>

        <div className="flex items-center gap-4 my-8 w-72">
           <div className="h-px bg-gray-700 flex-1"></div>
           <span className="text-gray-500 text-xs uppercase font-bold tracking-wider">OR</span>
           <div className="h-px bg-gray-700 flex-1"></div>
        </div>

        {/* Demo Card */}
        <div 
          onClick={handleLoadDemo}
          className="relative w-72 h-40 rounded-2xl overflow-hidden cursor-pointer group shadow-xl border border-gray-700 hover:border-blue-500 transition-all ring-1 ring-white/5 bg-gray-800"
        >
            <img 
              src="https://storage.googleapis.com/gtv-videos-bucket/sample/images/TearsOfSteel.jpg" 
              alt="Tears of Steel Demo" 
              className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-700 brightness-50 group-hover:brightness-75"
            />
            {/* Fallback bg if image fails */}
            <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 -z-10"></div>
            
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-lg border border-white/20">
                   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-white ml-0.5">
                     <path fillRule="evenodd" d="M4.5 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" clipRule="evenodd" />
                   </svg>
                </div>
                <div className="text-center">
                  <span className="text-white font-bold text-lg drop-shadow-md block">Try Demo: Tears of Steel</span>
                  <span className="text-gray-300 text-xs font-medium bg-black/40 px-2 py-0.5 rounded mt-1 inline-block">Sci-Fi Live Action</span>
                </div>
            </div>
        </div>

        <div className="mt-8 bg-blue-900/10 border border-blue-500/20 rounded-xl p-3 max-w-xs text-left">
           <p className="text-xs text-blue-200/80 leading-relaxed">
             <strong className="text-blue-400 block mb-1">💡 For Best Demo Results:</strong>
             Use your own screen recording of a famous show (e.g. Stranger Things). The AI knows celebrities much better than demo actors!
           </p>
        </div>
      </div>
    );
  }

  const showAnnotations = annotations && annotations.length > 0;
  // Determine if we are busy (either parent is analyzing, or local lock is active)
  const isBusy = isAnalyzing || localProcessing;

  return (
    <div className="relative w-full h-full bg-black flex flex-col justify-center overflow-hidden">
      
      {/* Top Right Controls Group */}
      <div className="absolute top-4 right-4 z-20 flex gap-3">
        {/* Fullscreen Toggle */}
        <button 
          onClick={toggleFullscreen}
          className="bg-black/60 hover:bg-black/80 text-white p-2 rounded-full backdrop-blur-md transition-all"
          title="Toggle Fullscreen"
        >
          {isFullscreen ? (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            </svg>
          )}
        </button>

        {/* Change Media Button */}
        <button 
          onClick={handleReset}
          className="bg-black/60 hover:bg-black/80 text-white p-2 rounded-full backdrop-blur-md transition-all"
          title="Upload different file"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      
      {/* Scanner Overlay - WOW Effect (No Grid) */}
      {isBusy && (
        <div className="absolute inset-0 z-30 pointer-events-none overflow-hidden">
           {/* The moving line */}
           <div className="absolute left-0 right-0 h-0.5 bg-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.8)] scanner-line"></div>
           {/* Subtle tint */}
           <div className="absolute inset-0 bg-blue-900/10"></div>
        </div>
      )}
      
      {/* Video Element */}
      {mediaType === 'video' && (
        <video
          ref={videoRef}
          src={mediaSrc}
          crossOrigin="anonymous" 
          controls={!showAnnotations && !isQueryDrawerOpen}
          playsInline
          className={`w-full max-h-full object-contain transition-all duration-300 ${
            (isPaused && !isBusy && !showAnnotations && !isQueryDrawerOpen) ? 'brightness-75 blur-[2px]' : ''
          } ${showAnnotations ? 'hidden' : 'block'}`}
          onPause={handleVideoPause}
          onPlay={handleVideoPlay}
        />
      )}

      {/* Image Element */}
      {mediaType === 'image' && (
        <img
          ref={imgRef}
          src={mediaSrc}
          alt="Scene to analyze"
          className={`w-full max-h-full object-contain transition-all duration-300 ${
            (!isBusy && !showAnnotations && !isQueryDrawerOpen) ? 'brightness-75 blur-[2px]' : ''
          } ${showAnnotations ? 'hidden' : 'block'}`}
        />
      )}

      {/* Annotated Canvas */}
      <canvas 
        ref={canvasRef} 
        className={`w-full max-h-full object-contain ${showAnnotations ? 'block' : 'hidden'}`} 
      />

      {/* Close Annotations Button - Moved to BOTTOM to avoid header overlap */}
      {showAnnotations && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50">
           <button 
             onClick={onCloseAnnotations}
             className="bg-black/80 hover:bg-black text-white px-6 py-2 rounded-full border border-teal-400 flex items-center gap-2 shadow-lg shadow-teal-500/20 transition-all"
           >
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-teal-400">
               <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
             </svg>
             <span className="font-semibold tracking-wide">Close Annotations</span>
           </button>
        </div>
      )}

      {/* Play/Pause Overlay - Center Screen */}
      {isPaused && !isBusy && !showAnnotations && !isQueryDrawerOpen && (
        <div 
          className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer group"
          onClick={() => {
             if (mediaType === 'video' && videoRef.current) {
                videoRef.current.play();
             }
          }}
        >
             <div className="w-24 h-24 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center group-hover:scale-110 group-hover:bg-white/20 transition-all border border-white/20 shadow-2xl">
                 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-12 h-12 text-white drop-shadow-lg ml-1">
                   <path fillRule="evenodd" d="M4.5 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" clipRule="evenodd" />
                 </svg>
             </div>
        </div>
      )}

      {/* Action Buttons - Moved to be just below the center play button */}
      {isPaused && !isBusy && !showAnnotations && !isQueryDrawerOpen && (
        <div className="absolute top-1/2 left-0 right-0 mt-20 z-50 flex items-center justify-center gap-6 pointer-events-none">
            
            {/* Identify Cast Button */}
            <button 
              onClick={handleIdentifyClick}
              className="pointer-events-auto group bg-gray-900/90 hover:bg-gray-800 text-white px-6 py-4 rounded-2xl border border-white/10 flex items-center gap-3 transition-all hover:scale-105 shadow-xl hover:shadow-teal-500/20"
            >
              <div className="p-2 bg-teal-600 rounded-lg group-hover:rotate-12 transition-transform">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                   <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="text-left">
                 <span className="block text-sm font-bold">Identify Cast</span>
                 <span className="block text-[10px] text-gray-400">Scan Scene</span>
              </div>
            </button>

            {/* Ask AI Button */}
            <button 
              onClick={() => setIsQueryDrawerOpen(true)}
              className="pointer-events-auto bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-2xl font-bold text-lg shadow-xl shadow-blue-600/30 hover:shadow-blue-500/50 transition-all hover:-translate-y-1 flex items-center gap-2"
            >
               <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                 <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
               </svg>
               Ask AI
            </button>

        </div>
      )}

      {/* Query Drawer (Slide-in Left) */}
      {isQueryDrawerOpen && (
        <div 
          className="absolute top-0 bottom-0 left-0 w-[90%] sm:w-[400px] z-50 bg-gray-900/95 backdrop-blur-xl border-r border-white/10 shadow-2xl flex flex-col slide-in-left"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-white/10 bg-gray-900/50">
            <h2 className="text-lg font-bold text-white">Ask Scene Detective</h2>
            <button 
              onClick={() => setIsQueryDrawerOpen(false)}
              className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Content */}
          <div className="p-6 flex-1 flex flex-col">
            <label className="text-xs text-blue-400 uppercase font-bold tracking-widest mb-3 block">
               Question
            </label>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4 flex-1">
              <div className="relative">
                <textarea 
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="E.g. Where can I buy this jacket? or What song is playing?"
                  className="w-full h-32 bg-black/40 border border-white/10 rounded-xl p-4 text-gray-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all resize-none text-base"
                />
                
                {/* Mic Button */}
                <button
                   type="button"
                   onClick={startListening}
                   className={`absolute bottom-3 right-3 p-2 rounded-lg transition-colors ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-white/10 text-gray-400 hover:text-white'}`}
                >
                   <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                   </svg>
                </button>
              </div>

              <div className="flex-1"></div>

              <button 
                type="submit"
                disabled={!query.trim()}
                className="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold rounded-xl shadow-lg shadow-blue-900/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                 <span>Analyze Scene</span>
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                 </svg>
              </button>
            </form>
          </div>
          
           {/* Hint */}
          <div className="p-4 bg-gray-900/50 text-center border-t border-white/5">
             <p className="text-xs text-gray-500">Swipe left to close</p>
          </div>
        </div>
      )}
    </div>
  );
};
