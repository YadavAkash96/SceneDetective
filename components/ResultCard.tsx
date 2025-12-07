
import React, { useState, useEffect } from 'react';
import { AnalysisResult } from '../types';

interface ResultCardProps {
  result: AnalysisResult;
  onClose: () => void;
}

// Simple Markdown Renderer component
const FormattedText: React.FC<{ text: string }> = ({ text }) => {
  // Split by newlines to handle paragraphs
  const paragraphs = text.split('\n');

  return (
    <div className="space-y-4">
      {paragraphs.map((para, i) => {
        if (!para.trim()) return null;

        // Basic list handling
        if (para.trim().startsWith('- ') || para.trim().startsWith('* ')) {
             return (
                 <div key={i} className="flex gap-2 ml-2">
                     <span className="text-blue-400 mt-1.5">•</span>
                     <p 
                        className="text-gray-200 leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: parseBold(para.replace(/^[-*]\s/, '')) }} 
                     />
                 </div>
             )
        }

        return (
          <p 
            key={i} 
            className="text-gray-200 leading-relaxed text-lg font-light tracking-wide"
            dangerouslySetInnerHTML={{ __html: parseBold(para) }} 
          />
        );
      })}
    </div>
  );
};

// Helper to convert **text** to <strong>text</strong>
const parseBold = (text: string) => {
  // Escape HTML characters first to prevent XSS
  let safeText = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  // Replace **bold** with strong tags
  return safeText.replace(/\*\*(.*?)\*\*/g, '<strong class="text-blue-100 font-bold">$1</strong>');
};

const RecommendationTile: React.FC<{ source: any }> = ({ source }) => {
  const [meta, setMeta] = useState<{ 
    image?: string; 
    title?: string; 
    publisher?: string; 
    logo?: string 
  }>({});
  const [loading, setLoading] = useState(true);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const fetchMetadata = async () => {
      try {
        setLoading(true);
        // Use Microlink API to fetch Open Graph metadata (Free tier)
        const response = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(source.uri)}`);
        const data = await response.json();
        
        if (isMounted && data.status === 'success' && data.data) {
          setMeta({
            image: data.data.image?.url,
            title: data.data.title,
            publisher: data.data.publisher,
            logo: data.data.logo?.url
          });
        }
      } catch (error) {
        console.warn("Failed to fetch metadata for", source.uri);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchMetadata();
    return () => { isMounted = false; };
  }, [source.uri]);

  // Fallback Logic
  const displayTitle = meta.title || source.title || "Product Link";
  const displayPublisher = meta.publisher || (source.uri ? new URL(source.uri).hostname.replace('www.', '') : "Web");
  
  // Strategy: 
  // 1. Try OG Image (Best)
  // 2. Try Screenshot Service (Context)
  // 3. Fallback to Brand Logo (Clean)
  const displayImage = meta.image || `https://image.thum.io/get/width/400/crop/600/noanimate/${source.uri}`;

  return (
    <a 
      href={source.uri}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col h-56 rounded-xl bg-gray-800/50 border border-white/10 hover:border-blue-500/50 hover:bg-gray-800 transition-all group overflow-hidden relative shadow-lg"
    >
        {/* Image Section */}
        <div className="h-32 w-full bg-gray-900 relative overflow-hidden flex items-center justify-center">
            {!imgError ? (
                <div className={`w-full h-full transition-opacity duration-500 ${loading ? 'opacity-0' : 'opacity-100'}`}>
                    <img 
                        src={displayImage} 
                        alt={displayTitle} 
                        className={`w-full h-full ${meta.image ? 'object-cover' : 'object-cover object-top'} group-hover:scale-105 transition-transform duration-700`}
                        onError={() => setImgError(true)}
                    />
                </div>
            ) : (
                // BRAND CARD FALLBACK
                // Shows a large logo on a subtle gradient background
                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900 group-hover:from-gray-700 group-hover:to-gray-800 transition-colors p-6">
                    <img 
                      src={`https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(source.uri)}&size=128`} 
                      alt="Logo" 
                      className="w-12 h-12 object-contain opacity-80 group-hover:scale-110 transition-transform duration-300 drop-shadow-lg"
                      onError={(e) => {
                         // If even the favicon fails, show generic bag
                         e.currentTarget.style.display = 'none';
                         e.currentTarget.parentElement?.classList.add('fallback-icon-visible');
                      }}
                    />
                    {/* Ultimate Fallback Icon (Hidden unless favicon fails) */}
                    <div className="hidden fallback-icon-visible">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10 text-gray-600">
                           <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                        </svg>
                    </div>
                </div>
            )}
            
            {/* Loading Skeleton */}
            {loading && (
               <div className="absolute inset-0 bg-gray-700 animate-pulse z-20" />
            )}
            
            {/* Corner Logo Overlay (Only show if we have a main image, otherwise the Brand Card IS the logo) */}
            {(!imgError && !loading) && (
             <div className="absolute top-2 right-2 bg-white/90 p-0.5 rounded-full z-10 shadow-sm">
                <img 
                  src={`https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(source.uri)}&size=32`} 
                  alt="" 
                  className="w-4 h-4 rounded-full" 
                  onError={(e) => e.currentTarget.style.display = 'none'}
                />
             </div>
            )}
        </div>

        {/* Text Section */}
        <div className="p-3 flex-1 flex flex-col justify-between border-t border-white/5 bg-gray-900/90">
             <p className="text-[10px] text-blue-400 font-mono uppercase tracking-wider truncate mb-1">
                {displayPublisher}
            </p>
            <p className="text-xs font-medium text-gray-200 leading-snug line-clamp-2 group-hover:text-blue-100 transition-colors">
                {displayTitle}
            </p>
        </div>
    </a>
  );
};

export const ResultCard: React.FC<ResultCardProps> = ({ result, onClose }) => {
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  // Minimum distance (px) to be considered a swipe
  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    
    if (isLeftSwipe) {
      onClose();
    }
  };

  // Extract grounding chunks for "Tiles"
  const sources = result.groundingMetadata?.groundingChunks
    ?.filter((chunk: any) => chunk.web?.uri && chunk.web?.title)
    .map((chunk: any) => chunk.web)
    .slice(0, 4);

  return (
    <div 
      className="absolute top-0 bottom-0 left-0 z-50 w-[90%] sm:w-[450px] flex flex-col bg-gray-900/95 backdrop-blur-xl border-r border-white/10 shadow-2xl slide-in-left"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-white/10 bg-gray-900/50 flex-shrink-0">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <span className="text-2xl">✨</span> AI Insight
        </h2>
        <button 
          onClick={onClose}
          className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors"
          title="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="p-6">
          <FormattedText text={result.answer} />
        </div>
        
        {/* Recommendation / Source Tiles */}
        {sources && sources.length > 0 && (
          <div className="p-6 pt-0 mt-4">
            <h3 className="text-xs font-bold text-blue-300 uppercase tracking-widest mb-4 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              Top Recommendations
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {sources.map((source: any, idx: number) => (
                  <RecommendationTile key={idx} source={source} />
              ))}
            </div>
          </div>
        )}

        <div className="p-6 pt-2">
           <div className="p-4 bg-blue-900/20 border border-blue-500/20 rounded-xl flex items-start gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-blue-400 shrink-0 mt-0.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <p className="text-xs text-blue-200/70">
                AI can make mistakes. Swipe left to close.
              </p>
            </div>
        </div>
      </div>
      
      {/* Visual Pull Handle for Mobile Hint */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 w-1 h-16 bg-white/10 rounded-full sm:hidden"></div>
    </div>
  );
};
