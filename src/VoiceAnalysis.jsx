import React, { useRef, useState, useEffect, useCallback } from 'react';

const VoiceAnalysis = ({ onRiskScore, onMetrics, startSignal, language = 'en' } = {}) => {
  const [isRecording, setIsRecording] = useState(false);
    const t = (en, ta) => (language === 'ta' ? ta : en);
  const [audioData, setAudioData] = useState([]);
  const [voiceMetrics, setVoiceMetrics] = useState({
    pitchVariation: 0,
    speechRate: 0,
    pauseDuration: 0,
    monotonicity: 0,
    emotionalValence: 0
  });
  const [voiceRiskScore, setVoiceRiskScore] = useState(0);
  
  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);

  // Initialize audio context
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048;
    }
  }, []);

  // Calculate pitch from frequency data using improved algorithm
  const calculatePitch = useCallback((freqDataArray) => {
    if (!freqDataArray || freqDataArray.length === 0) return 0;
    
    const sampleRate = audioContextRef.current?.sampleRate || 44100;
    const nyquist = sampleRate / 2;
    const binFreq = nyquist / freqDataArray.length;
    
    // Find the dominant frequency
    let maxValue = 0;
    let maxIndex = 0;
    
    for (let i = 1; i < freqDataArray.length / 2; i++) {
      if (freqDataArray[i] > maxValue) {
        maxValue = freqDataArray[i];
        maxIndex = i;
      }
    }
    
    // Convert bin index to frequency
    const dominantFreq = maxIndex * binFreq;
    
    // Filter for voice frequency range (80-800 Hz)
    if (dominantFreq >= 80 && dominantFreq <= 800 && maxValue > 30) {
      return dominantFreq;
    }
    
    return 0;
  }, []);

  // Calculate speech rate
  const calculateSpeechRate = useCallback((pitchHistory) => {
    if (!pitchHistory || pitchHistory.length < 10) return 0;
    
    // Count pitch variations (simulating syllables/words)
    let variations = 0;
    for (let i = 1; i < pitchHistory.length; i++) {
      if (Math.abs(pitchHistory[i] - pitchHistory[i-1]) > 10) {
        variations++;
      }
    }
    
    return Math.min((variations / pitchHistory.length) * 100, 100);
  }, []);

  // Calculate pause duration
  const calculatePauseDuration = useCallback((pitchHistory) => {
    if (!pitchHistory || pitchHistory.length < 10) return 0;
    
    // Count periods of no pitch (silence/pauses)
    let pauseCount = 0;
    for (let i = 0; i < pitchHistory.length; i++) {
      if (pitchHistory[i] < 50) { // Threshold for silence
        pauseCount++;
      }
    }
    
    return Math.min((pauseCount / pitchHistory.length) * 100, 100);
  }, []);

  // Calculate monotonicity
  const calculateMonotonicity = useCallback((pitchHistory) => {
    if (!pitchHistory || pitchHistory.length < 10) return 0;
    
    // Calculate standard deviation of pitch
    const mean = pitchHistory.reduce((a, b) => a + b, 0) / pitchHistory.length;
    const variance = pitchHistory.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / pitchHistory.length;
    const stdDev = Math.sqrt(variance);
    
    // Lower standard deviation = more monotonic
    const monotonicity = Math.max(0, 100 - stdDev);
    return Math.min(monotonicity, 100);
  }, []);

  // Calculate emotional valence
  const calculateEmotionalValence = useCallback((pitchHistory, intensityHistory) => {
    if (!pitchHistory || !intensityHistory || pitchHistory.length < 10) return 0;
    
    // Emotional valence based on pitch variation and intensity
    const pitchVariation = calculateMonotonicity(pitchHistory);
    const avgIntensity = intensityHistory.reduce((a, b) => a + b, 0) / intensityHistory.length;
    
    // Higher pitch variation and intensity = more emotional expression
    const emotionalExpression = (100 - pitchVariation) * 0.6 + avgIntensity * 0.4;
    return Math.min(emotionalExpression, 100);
  }, [calculateMonotonicity]);

  // Calculate voice risk score
  const calculateVoiceRiskScore = useCallback((metrics) => {
    const weights = {
      pitchVariation: 0.25,
      speechRate: 0.2,
      pauseDuration: 0.2,
      monotonicity: 0.2,
      emotionalValence: 0.15
    };
    
    let score = 0;
    Object.keys(weights).forEach(key => {
      // Inverse some metrics where lower values indicate risk
      let value = metrics[key];
      if (key === 'pitchVariation' || key === 'speechRate' || key === 'emotionalValence') {
        value = 100 - value; // Lower values are riskier
      }
      score += value * weights[key];
    });
    
    return Math.min(score, 100);
  }, []);

  // Start recording
  const startRecording = useCallback(async () => {
    if (isRecording) return;
    try {
      initAudioContext();
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        } 
      });
      
      mediaRecorderRef.current = new MediaRecorder(stream);
      
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      
      const pitchHistory = [];
      const intensityHistory = [];
      let frameCount = 0;
      
      const analyzeAudio = () => {
        if (!isRecording) return;
        
        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const freqDataArray = new Uint8Array(bufferLength);
        
        analyserRef.current.getByteTimeDomainData(dataArray);
        analyserRef.current.getByteFrequencyData(freqDataArray);
        
        frameCount++;
        
        // Calculate pitch using frequency data
        const pitch = calculatePitch(freqDataArray);
        pitchHistory.push(pitch);
        
        // Calculate intensity (volume) from frequency data
        let sum = 0;
        for (let i = 0; i < freqDataArray.length; i++) {
          sum += freqDataArray[i];
        }
        const intensity = (sum / freqDataArray.length) / 255;
        intensityHistory.push(intensity);
        
        // Keep only recent history
        if (pitchHistory.length > 100) pitchHistory.shift();
        if (intensityHistory.length > 100) intensityHistory.shift();
        
        // Update metrics only every 10 frames to reduce noise
        if (frameCount % 10 === 0 && pitchHistory.length >= 10) {
          const newMetrics = {
            pitchVariation: calculateMonotonicity(pitchHistory),
            speechRate: calculateSpeechRate(pitchHistory),
            pauseDuration: calculatePauseDuration(pitchHistory),
            monotonicity: calculateMonotonicity(pitchHistory),
            emotionalValence: calculateEmotionalValence(pitchHistory, intensityHistory)
          };
          
          setVoiceMetrics(newMetrics);
          const newRisk = calculateVoiceRiskScore(newMetrics);
          setVoiceRiskScore(newRisk);
          if (typeof onMetrics === 'function') onMetrics(newMetrics);
          if (typeof onRiskScore === 'function') onRiskScore(newRisk);
        }
        
        // Update visualization data
        setAudioData(Array.from(dataArray));
        
        animationRef.current = requestAnimationFrame(analyzeAudio);
      };
      
      mediaRecorderRef.current.start();
      setIsRecording(true);
      analyzeAudio();
      
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Please allow microphone access to use voice analysis');
    }
  }, [
    isRecording,
    initAudioContext,
    calculatePitch,
    calculateMonotonicity,
    calculateSpeechRate,
    calculatePauseDuration,
    calculateEmotionalValence,
    calculateVoiceRiskScore,
    onMetrics,
    onRiskScore
  ]);

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    }
  };

  // Cleanup
  useEffect(() => {
    return () => {
      stopRecording();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (startSignal == null) return;
    if (!isRecording) {
      startRecording();
    }
  }, [startSignal, isRecording, startRecording]);

  const getVoiceRiskLevel = (score) => {
    if (score < 20) return { level: 'Low', color: 'text-green-400' };
    if (score < 40) return { level: 'Moderate', color: 'text-yellow-400' };
    if (score < 60) return { level: 'Elevated', color: 'text-orange-400' };
    return { level: 'High', color: 'text-red-400' };
  };

  const voiceRiskInfo = getVoiceRiskLevel(voiceRiskScore);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold mb-8 text-center">
          {t('Preventive AI - Voice Analysis System', 'Preventive AI - குரல் பகுப்பாய்வு அமைப்பு')}
        </h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Audio Visualization */}
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('Audio Waveform', 'ஒலி அலைவடிவம்')}</h2>
              <div className="h-64 bg-gray-900 rounded-lg flex items-center justify-center">
                {isRecording ? (
                  <svg width="100%" height="100%" viewBox="0 0 400 256">
                    {audioData.map((value, index) => {
                      const x = (index / audioData.length) * 400;
                      const y = 128 + (value - 128) * 2;
                      return (
                        <line
                          key={index}
                          x1={x}
                          y1={128}
                          x2={x}
                          y2={y}
                          stroke="#00ff00"
                          strokeWidth="1"
                        />
                      );
                    })}
                  </svg>
                ) : (
                  <div className="text-gray-500 text-center">
                    <div className="text-6xl mb-4">🎤</div>
                    <p>{t('Click "Start Recording" to begin voice analysis', 'குரல் பகுப்பாய்வை தொடங்க "Start Recording" ஐ அழுத்தவும்')}</p>
                  </div>
                )}
              </div>
              
              <div className="flex items-center justify-center mt-4">
                {isRecording && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                    <span className="text-red-500">Recording...</span>
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex gap-4">
              <button
                onClick={startRecording}
                disabled={isRecording}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                {isRecording ? t('Recording...', 'பதிவு நடக்கிறது') : t('Start Recording', 'பதிவை தொடங்கு')}
              </button>
              <button
                onClick={stopRecording}
                disabled={!isRecording}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                {t('Stop Recording', 'நிறுத்து')}
              </button>
            </div>
          </div>
          
          {/* Voice Metrics */}
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('Voice Metrics', 'குரல் அளவுகள்')}</h2>
              
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Pitch Variation</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${voiceMetrics.pitchVariation}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right">{voiceMetrics.pitchVariation.toFixed(0)}%</span>
                  </div>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Speech Rate</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${voiceMetrics.speechRate}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right">{voiceMetrics.speechRate.toFixed(0)}%</span>
                  </div>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Pause Duration</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${voiceMetrics.pauseDuration}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right">{voiceMetrics.pauseDuration.toFixed(0)}%</span>
                  </div>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Monotonicity</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-green-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${voiceMetrics.monotonicity}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right">{voiceMetrics.monotonicity.toFixed(0)}%</span>
                  </div>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Emotional Valence</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-red-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${voiceMetrics.emotionalValence}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right">{voiceMetrics.emotionalValence.toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Voice Risk Score */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('Voice Risk Assessment', 'குரல் அபாய மதிப்பீடு')}</h2>
              <div className="text-center">
                <div className="text-6xl font-bold mb-2">{voiceRiskScore.toFixed(1)}</div>
                <div className={`text-2xl font-semibold ${voiceRiskInfo.color}`}>
                  {voiceRiskInfo.level} Risk
                </div>
                <div className="text-gray-400 mt-2">
                  {isRecording ? 'Analyzing voice patterns...' : 'Start recording to analyze'}
                </div>
              </div>
            </div>
            
            {/* Voice Disease Indicators */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('Voice Disease Patterns', 'குரல் நோய் விதங்கள்')}</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-300">Parkinson's Voice:</span>
                  <span className="text-blue-400">
                    {(voiceMetrics.monotonicity * 0.7 + voiceMetrics.pitchVariation * 0.3).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Alzheimer's Speech:</span>
                  <span className="text-purple-400">
                    {(voiceMetrics.pauseDuration * 0.6 + voiceMetrics.speechRate * 0.4).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Depression Voice:</span>
                  <span className="text-green-400">
                    {(voiceMetrics.monotonicity * 0.5 + voiceMetrics.emotionalValence * 0.5).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VoiceAnalysis;
