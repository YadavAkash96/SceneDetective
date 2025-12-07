
import React, { useState, useCallback } from 'react';
import { VideoPlayer } from './components/CameraView';
import { ResultCard } from './components/ResultCard';
import { analyzeFrameWithQuery, detectCharactersInFrame } from './services/geminiService';
import { AppState, AnalysisResult, BoundingBox } from './types';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.UPLOAD);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [boundingBoxes, setBoundingBoxes] = useState<BoundingBox[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mediaTitle, setMediaTitle] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const getFriendlyErrorMessage = (err: any) => {
    const msg = err?.message || JSON.stringify(err);
    if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
      return "High Traffic: AI Server is busy. Please wait a moment and try again.";
    }
    return "Failed to analyze the scene. Please try again.";
  };

  // Handle Text/Voice Query with optional Audio Context
  const handleAnalyze = useCallback(async (imageData: string, query: string, audioData?: string | null) => {
    setAppState(AppState.ANALYZING);
    setErrorMsg(null);
    setBoundingBoxes(null); // Clear previous boxes if any

    try {
      const result = await analyzeFrameWithQuery(imageData, query, audioData);
      setAnalysisResult(result);
      setAppState(AppState.RESULT);
    } catch (err) {
      console.error(err);
      setErrorMsg(getFriendlyErrorMessage(err));
      setAppState(AppState.ERROR);
    }
  }, []);

  // Handle Character Identification
  const handleIdentify = useCallback(async (imageData: string) => {
    setAppState(AppState.ANALYZING);
    setErrorMsg(null);
    setAnalysisResult(null);
    setBoundingBoxes(null); // Ensure clear start

    try {
      const boxes = await detectCharactersInFrame(imageData);
      if (boxes.length === 0) {
          setErrorMsg("No main characters identified in this frame.");
          setBoundingBoxes(null); // Explicit clear on empty
          setAppState(AppState.ERROR);
      } else {
          setBoundingBoxes(boxes);
          setAppState(AppState.PLAYING); // Go back to player to show annotations
      }
    } catch (err) {
      console.error(err);
      setBoundingBoxes(null); // Explicit clear on error
      setErrorMsg(getFriendlyErrorMessage(err));
      setAppState(AppState.ERROR);
    }
  }, []);

  const closeResult = () => {
    setAppState(AppState.PLAYING);
    setAnalysisResult(null);
    setErrorMsg(null);
  };

  const closeAnnotations = () => {
    setBoundingBoxes(null);
    setAppState(AppState.PLAYING);
  };

  const handleMediaLoaded = useCallback((title: string | null) => {
    setMediaTitle(title);
  }, []);

  return (
    <div className="h-full w-full relative flex flex-col bg-gray-950 text-white overflow-hidden font-sans">
      
      {/* Header - Hides when playing */}
      <div className={`absolute top-0 left-0 right-0 p-4 z-40 pointer-events-none flex justify-center transition-opacity duration-300 ${isPlaying ? 'opacity-0' : 'opacity-100'}`}>
        <h1 className="text-xl font-bold tracking-tight bg-black/40 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/10 shadow-lg flex items-center gap-2">
          <span>Scene<span className="text-blue-500">Detective</span></span>
          {mediaTitle && (
            <span className="text-gray-400 text-sm font-normal border-l border-white/20 pl-2 max-w-[150px] truncate">
              {mediaTitle}
            </span>
          )}
        </h1>
      </div>

      {/* Main Content Area */}
      <div className="flex-grow relative z-0 h-full">
        <VideoPlayer 
          onAnalyze={handleAnalyze}
          onIdentify={handleIdentify}
          isAnalyzing={appState === AppState.ANALYZING}
          annotations={boundingBoxes}
          onCloseAnnotations={closeAnnotations}
          onMediaLoaded={handleMediaLoaded}
          onPlayStateChange={setIsPlaying}
        />
      </div>

      {/* Text Result Overlay */}
      {appState === AppState.RESULT && analysisResult && (
        <ResultCard result={analysisResult} onClose={closeResult} />
      )}

      {/* Error Toast */}
      {appState === AppState.ERROR && (
        <div className="absolute bottom-10 left-4 right-4 z-50 flex justify-center animate-fade-in-up">
           <div className="bg-red-600 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-4 max-w-md w-full border border-red-400">
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
             <div className="flex-1">
               <p className="font-bold">Error</p>
               <p className="text-sm text-red-100 leading-snug">{errorMsg}</p>
             </div>
             <button onClick={() => setAppState(AppState.PLAYING)} className="p-2 hover:bg-red-700 rounded-lg transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
             </button>
           </div>
        </div>
      )}

    </div>
  );
};

export default App;
