import React, { useRef, useState, useCallback, useEffect } from 'react';
import { FaceMesh } from '@mediapipe/face_mesh';
import { Camera } from '@mediapipe/camera_utils';

const FaceAnalysis = ({ onRiskScore, onMetrics, startSignal, initialSource = 'live', language = 'en' } = {}) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisSource, setAnalysisSource] = useState(initialSource);
  const [sampleVideoUrl, setSampleVideoUrl] = useState('');
  const [sampleError, setSampleError] = useState('');
  const [metrics, setMetrics] = useState({
    blinkRate: 0,
    gazeDeviation: 0,
    facialAsymmetry: 0,
    expressivity: 0,
    tremorIndicators: 0
  });
  const [landmarks, setLandmarks] = useState([]);
  const [riskScore, setRiskScore] = useState(0);
  const [blinkRateBpm, setBlinkRateBpm] = useState(0);
  const faceMeshRef = useRef(null);
  const cameraRef = useRef(null);
  const animationRef = useRef(null);
  const sampleUrlRef = useRef(null);
  const eyeClosedRef = useRef(false);
  const lastBlinkTsRef = useRef(0);
  const blinkTimestampsRef = useRef([]);
  const prevKeypointsRef = useRef(null);

  // Calculate blink rate with improved accuracy
  const updateBlinkAndGetBpm = useCallback((faceLandmarks) => {
    if (!faceLandmarks || faceLandmarks.length === 0) return 0;
 
    const leftEyeIndices = [33, 160, 158, 133, 153, 144];
    const rightEyeIndices = [362, 385, 387, 263, 373, 380];
 
    const dist2d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
 
    const earFor = (idx) => {
      const p1 = faceLandmarks[idx[0]];
      const p2 = faceLandmarks[idx[1]];
      const p3 = faceLandmarks[idx[2]];
      const p4 = faceLandmarks[idx[3]];
      const p5 = faceLandmarks[idx[4]];
      const p6 = faceLandmarks[idx[5]];
      if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return 0;
      const vert1 = dist2d(p2, p6);
      const vert2 = dist2d(p3, p5);
      const horz = dist2d(p1, p4);
      return horz > 0 ? (vert1 + vert2) / (2 * horz) : 0;
    };
 
    const ear = (earFor(leftEyeIndices) + earFor(rightEyeIndices)) / 2;
 
    const closeThresh = 0.23;
    const openThresh = 0.27;
    const now = Date.now();
 
    if (!eyeClosedRef.current && ear > 0 && ear < closeThresh) {
      eyeClosedRef.current = true;
    }
 
    if (eyeClosedRef.current && ear > openThresh) {
      eyeClosedRef.current = false;
      if (now - lastBlinkTsRef.current > 180) {
        lastBlinkTsRef.current = now;
        blinkTimestampsRef.current = [...blinkTimestampsRef.current, now].slice(-120);
      }
    }
 
    const windowMs = 60000;
    blinkTimestampsRef.current = blinkTimestampsRef.current.filter((t) => now - t <= windowMs);
    return blinkTimestampsRef.current.length;
  }, []);

  // Calculate gaze deviation
  const calculateGazeDeviation = useCallback((landmarks) => {
    if (!landmarks || landmarks.length === 0) return 0;
    
    // Eye center points
    const leftEyeCenter = landmarks[33];
    const rightEyeCenter = landmarks[362];
    const noseTip = landmarks[1];
    
    if (!leftEyeCenter || !rightEyeCenter || !noseTip) return 0;
    
    // Calculate deviation from center
    const eyeCenter = {
      x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
      y: (leftEyeCenter.y + rightEyeCenter.y) / 2
    };
    
    const deviation = Math.sqrt(
      Math.pow(eyeCenter.x - noseTip.x, 2) + 
      Math.pow(eyeCenter.y - noseTip.y, 2)
    );
    
    return Math.min(deviation * 100, 100); // Convert to percentage
  }, []);

  // Calculate facial asymmetry
  const calculateFacialAsymmetry = useCallback((landmarks) => {
    if (!landmarks || landmarks.length === 0) return 0;
    
    // Symmetric landmark pairs
    const pairs = [
      [127, 356], // Left and right cheek
      [234, 454], // Left and right jaw
      [10, 152],  // Top and bottom chin
      [55, 285],  // Left and right mouth corners
    ];
    
    let totalAsymmetry = 0;
    pairs.forEach(([left, right]) => {
      if (landmarks[left] && landmarks[right]) {
        const leftPoint = landmarks[left];
        const rightPoint = landmarks[right];
        const centerX = 0.5;
        
        const leftDist = Math.abs(leftPoint.x - centerX);
        const rightDist = Math.abs(rightPoint.x - centerX);
        
        totalAsymmetry += Math.abs(leftDist - rightDist);
      }
    });
    
    return Math.min((totalAsymmetry / pairs.length) * 200, 100);
  }, []);

  // Calculate expressivity
  const calculateExpressivity = useCallback((landmarks) => {
    if (!landmarks || landmarks.length === 0) return 0;
    
    // Key facial expression points
    const mouthIndices = [13, 14, 78, 80, 81, 82, 87, 88, 95];
    const eyebrowIndices = [70, 63, 105, 66, 107, 55, 65, 52, 53];
    
    // Calculate mouth openness
    const mouthTop = landmarks[13];
    const mouthBottom = landmarks[14];
    const mouthOpenness = mouthTop && mouthBottom ? 
      Math.abs(mouthTop.y - mouthBottom.y) * 100 : 0;
    
    // Calculate eyebrow height variation
    let eyebrowVariation = 0;
    eyebrowIndices.forEach((index, i) => {
      if (landmarks[index] && i > 0 && landmarks[eyebrowIndices[i-1]]) {
        eyebrowVariation += Math.abs(
          landmarks[index].y - landmarks[eyebrowIndices[i-1]].y
        );
      }
    });
    
    const expressivity = (mouthOpenness + eyebrowVariation * 50) / 2;
    return Math.min(expressivity, 100);
  }, []);

  // Calculate tremor indicators
  const calculateTremorIndicators = useCallback((faceLandmarks) => {
    if (!faceLandmarks || faceLandmarks.length === 0) return 0;
 
    const keyIdx = [1, 33, 263, 61, 291];
    const cur = keyIdx.map((i) => faceLandmarks[i]).filter(Boolean);
    if (cur.length !== keyIdx.length) return 0;
 
    if (!prevKeypointsRef.current) {
      prevKeypointsRef.current = cur.map((p) => ({ x: p.x, y: p.y }));
      return 0;
    }
 
    const prev = prevKeypointsRef.current;
    let sum = 0;
    for (let i = 0; i < cur.length; i++) {
      sum += Math.hypot(cur[i].x - prev[i].x, cur[i].y - prev[i].y);
    }
    prevKeypointsRef.current = cur.map((p) => ({ x: p.x, y: p.y }));
 
    const avg = sum / cur.length;
    return Math.min((avg * 10000), 100);
  }, []);

  // Calculate overall risk score
  const calculateRiskScore = useCallback((metrics) => {
    const weights = {
      blinkRate: 0.2,
      gazeDeviation: 0.25,
      facialAsymmetry: 0.25,
      expressivity: 0.15,
      tremorIndicators: 0.15
    };
    
    let score = 0;
    Object.keys(weights).forEach(key => {
      score += metrics[key] * weights[key];
    });
    
    return Math.min(score, 100);
  }, []);

  useEffect(() => {
    if (!isAnalyzing) return;
    if (!videoRef.current || !canvasRef.current) return;

    const faceMesh = new FaceMesh({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`;
      },
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    faceMesh.onResults((results) => {
      if (!canvasRef.current) return;
      
      const canvasCtx = canvasRef.current.getContext('2d');
      canvasCtx.save();
      canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      
      if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const faceLandmarks = results.multiFaceLandmarks[0];
        setLandmarks(faceLandmarks);
        
        // Draw face mesh
        for (const landmark of faceLandmarks) {
          const x = landmark.x * canvasRef.current.width;
          const y = landmark.y * canvasRef.current.height;
          
          canvasCtx.beginPath();
          canvasCtx.arc(x, y, 1, 0, 2 * Math.PI);
          canvasCtx.fillStyle = '#00FF00';
          canvasCtx.fill();
        }
        
        const bpm = updateBlinkAndGetBpm(faceLandmarks);
        setBlinkRateBpm(bpm);

        const blinkPct = Math.min((bpm / 40) * 100, 100);
        const newMetrics = {
          blinkRate: blinkPct,
          gazeDeviation: calculateGazeDeviation(faceLandmarks),
          facialAsymmetry: calculateFacialAsymmetry(faceLandmarks),
          expressivity: calculateExpressivity(faceLandmarks),
          tremorIndicators: calculateTremorIndicators(faceLandmarks)
        };

        setMetrics(newMetrics);
        const newRisk = calculateRiskScore(newMetrics);
        setRiskScore(newRisk);
        if (typeof onRiskScore === 'function') onRiskScore(newRisk);
        if (typeof onMetrics === 'function') onMetrics(newMetrics);
      }
      
      canvasCtx.restore();
    });

    const startVideoProcessing = () => {
      if (analysisSource === 'live') {
        const camera = new Camera(videoRef.current, {
          onFrame: async () => {
            if (videoRef.current && isAnalyzing) {
              await faceMesh.send({ image: videoRef.current });
            }
          },
          width: 640,
          height: 480
        });

        cameraRef.current = camera;
        camera.start();
      } else {
        const processFrame = async () => {
          if (!videoRef.current || !faceMeshRef.current || !isAnalyzing) return;
          if (videoRef.current.readyState >= 2) {
            await faceMeshRef.current.send({ image: videoRef.current });
          }
          animationRef.current = requestAnimationFrame(processFrame);
        };

        animationRef.current = requestAnimationFrame(processFrame);
      }
    };

    faceMeshRef.current = faceMesh;
    startVideoProcessing();

    return () => {
      if (cameraRef.current) {
        cameraRef.current.stop();
        cameraRef.current = null;
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      faceMesh.close();
      faceMeshRef.current = null;
      prevKeypointsRef.current = null;
      eyeClosedRef.current = false;
      lastBlinkTsRef.current = 0;
      blinkTimestampsRef.current = [];
      setLandmarks([]);
      setBlinkRateBpm(0);
    };
  }, [isAnalyzing, analysisSource, updateBlinkAndGetBpm, calculateGazeDeviation, calculateFacialAsymmetry, calculateExpressivity, calculateTremorIndicators, calculateRiskScore, onRiskScore, onMetrics]);

  const t = (en, ta) => (language === 'ta' ? ta : en);

  const startAnalysis = useCallback(() => {
    if (isAnalyzing) return;
    if (analysisSource === 'sample' && !sampleVideoUrl) {
      setSampleError(t('Please upload a sample video first.', 'முதலில் மாதிரி வீடியோவை பதிவேற்றவும்.'));
      return;
    }
    setSampleError('');
    setIsAnalyzing(true);
    if (analysisSource === 'sample' && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, [analysisSource, isAnalyzing, sampleVideoUrl, language]);

  const stopAnalysis = useCallback(() => {
    setIsAnalyzing(false);
    if (cameraRef.current) {
      cameraRef.current.stop();
      cameraRef.current = null;
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (videoRef.current) {
      if (analysisSource === 'sample') {
        videoRef.current.pause();
      }
      const stream = videoRef.current.srcObject;
      if (stream && typeof stream.getTracks === 'function') {
        stream.getTracks().forEach((track) => track.stop());
      }
      videoRef.current.srcObject = null;
    }
  }, [analysisSource]);

  useEffect(() => {
    if (startSignal == null) return;
    if (!isAnalyzing) {
      startAnalysis();
    }
  }, [startSignal, isAnalyzing, startAnalysis]);

  useEffect(() => {
    return () => {
      if (sampleUrlRef.current) {
        URL.revokeObjectURL(sampleUrlRef.current);
        sampleUrlRef.current = null;
      }
    };
  }, []);

  const handleSourceChange = (nextSource) => {
    if (nextSource === analysisSource) return;
    setAnalysisSource(nextSource);
    setSampleError('');
    if (isAnalyzing) {
      setIsAnalyzing(false);
    }
  };

  const handleSampleFileChange = (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (sampleUrlRef.current) {
      URL.revokeObjectURL(sampleUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    sampleUrlRef.current = url;
    setSampleVideoUrl(url);
    setSampleError('');
  };

  const getRiskLevel = (score) => {
    if (score < 20) return { level: 'Low', color: 'text-green-600' };
    if (score < 40) return { level: 'Moderate', color: 'text-yellow-600' };
    if (score < 60) return { level: 'Elevated', color: 'text-orange-600' };
    return { level: 'High', color: 'text-red-600' };
  };

  const riskInfo = getRiskLevel(riskScore);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold mb-8 text-center">
          {t('Preventive AI - Face Analysis System', 'Preventive AI - முக பகுப்பாய்வு அமைப்பு')}
        </h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Video and Canvas */}
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex flex-col gap-3 mb-4">
                <h2 className="text-xl font-semibold">
                  {analysisSource === 'live'
                    ? t('Camera Feed', 'கேமரா நேரடி காட்சி')
                    : t('Sample Video Preview', 'மாதிரி வீடியோ முன்னோட்டம்')}
                </h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleSourceChange('live')}
                    className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                      analysisSource === 'live'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                    }`}
                  >
                    {t('Live Tracking', 'நேரடி கண்காணிப்பு')}
                  </button>
                  <button
                    onClick={() => handleSourceChange('sample')}
                    className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                      analysisSource === 'sample'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                    }`}
                  >
                    {t('Sample Video', 'மாதிரி வீடியோ')}
                  </button>
                </div>
                {analysisSource === 'sample' && (
                  <div>
                    <label className="block text-sm text-gray-300 mb-2">
                      {t('Upload video', 'வீடியோ பதிவேற்று')}
                    </label>
                    <input
                      type="file"
                      accept="video/*"
                      onChange={handleSampleFileChange}
                      className="block w-full text-sm text-gray-300 file:mr-4 file:rounded-full file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-white hover:file:bg-blue-700"
                    />
                    {sampleError && (
                      <p className="text-sm text-red-400 mt-2">{sampleError}</p>
                    )}
                  </div>
                )}
              </div>
              <video
                ref={videoRef}
                src={analysisSource === 'sample' ? sampleVideoUrl : undefined}
                className="w-full rounded-lg"
                style={{ transform: 'scaleX(-1)' }}
                autoPlay
                playsInline
                loop={analysisSource === 'sample'}
                controls={analysisSource === 'sample'}
                muted
              />
              <canvas
                ref={canvasRef}
                width={640}
                height={480}
                className="w-full rounded-lg mt-4"
                style={{ transform: 'scaleX(-1)' }}
              />
            </div>
            
            <div className="flex gap-4">
              <button
                onClick={startAnalysis}
                disabled={isAnalyzing}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                {isAnalyzing ? t('Analyzing...', 'பகுப்பாய்வு நடக்கிறது') : t('Start Analysis', 'பகுப்பாய்வு தொடங்கு')}
              </button>
              <button
                onClick={stopAnalysis}
                disabled={!isAnalyzing}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                {t('Stop Analysis', 'நிறுத்து')}
              </button>
            </div>
          </div>
          
          {/* Metrics Display */}
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('Real-time Metrics', 'நேரடி அளவுகள்')}</h2>
              
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Blink Rate</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${metrics.blinkRate}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right">{metrics.blinkRate.toFixed(0)}%</span>
                  </div>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Gaze Deviation</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${metrics.gazeDeviation}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right">{metrics.gazeDeviation.toFixed(0)}%</span>
                  </div>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Facial Asymmetry</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${metrics.facialAsymmetry}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right">{metrics.facialAsymmetry.toFixed(0)}%</span>
                  </div>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Expressivity</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-green-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${metrics.expressivity}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right">{metrics.expressivity.toFixed(0)}%</span>
                  </div>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Tremor Indicators</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-red-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${metrics.tremorIndicators}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right">{metrics.tremorIndicators.toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Risk Score */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('Risk Assessment', 'அபாய மதிப்பீடு')}</h2>
              <div className="text-center">
                <div className="text-6xl font-bold mb-2">{riskScore.toFixed(1)}</div>
                <div className={`text-2xl font-semibold ${riskInfo.color}`}>
                  {riskInfo.level} Risk
                </div>
                <div className="text-gray-400 mt-2">
                  {landmarks.length > 0 ? `${landmarks.length} landmarks detected` : 'No face detected'}
                </div>
                <div className="text-gray-400 mt-1">
                  Blinks/min: {blinkRateBpm.toFixed(1)}
                </div>
              </div>
            </div>
            
            {/* Disease Indicators */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('Disease Pattern Analysis', 'நோய் வித பகுப்பாய்வு')}</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-300">Parkinson's Indicators:</span>
                  <span className="text-blue-400">
                    {(metrics.facialAsymmetry * 0.6 + metrics.tremorIndicators * 0.4).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Alzheimer's Indicators:</span>
                  <span className="text-purple-400">
                    {(metrics.gazeDeviation * 0.5 + metrics.expressivity * 0.5).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Depression Indicators:</span>
                  <span className="text-green-400">
                    {(metrics.expressivity * 0.7 + metrics.blinkRate * 0.3).toFixed(1)}%
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

export default FaceAnalysis;
