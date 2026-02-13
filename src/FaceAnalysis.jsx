import React, { useRef, useState, useCallback, useEffect } from 'react';
import { FaceMesh } from '@mediapipe/face_mesh';
import { Camera } from '@mediapipe/camera_utils';

const FaceAnalysis = ({ onRiskScore, onMetrics, startSignal, stopSignal, initialSource = 'live', language = 'en', hideControls = false, embedded = false } = {}) => {
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
    tremorIndicators: 0,
    headPoseAngle: 0,
    headAbnormal: 0,
    gazeOscillation: 0,
    eyeMovement: 0
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
  const gazeSequenceRef = useRef([]);
  const eyeOffsetHistoryRef = useRef([]);
  const lastStartSignalRef = useRef(startSignal);
  const lastStopSignalRef = useRef(stopSignal);
  const eyeMoveCounterRef = useRef(0);

  const HEAD_YAW_ALERT_DEG = 10;
  const GAZE_OSC_THRESHOLD = 0.12;
  const GAZE_SEQ_LEN = 8;
  const EYE_OFFSET_THRESHOLD = 0.12;
  const EYE_OFFSET_WINDOW = 12;

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

  const calculateHeadPoseApprox = useCallback((landmarks) => {
    if (!landmarks || landmarks.length === 0) return { yawDeg: 0, abnormal: 0 };

    const leftFace = landmarks[234];
    const rightFace = landmarks[454];
    const noseTip = landmarks[1];

    if (!leftFace || !rightFace || !noseTip) {
      return { yawDeg: 0, abnormal: 0 };
    }

    const leftDist = Math.abs(noseTip.x - leftFace.x);
    const rightDist = Math.abs(rightFace.x - noseTip.x);
    const avgDist = (leftDist + rightDist) / 2;
    if (avgDist === 0) return { yawDeg: 0, abnormal: 0 };

    const ratio = (rightDist - leftDist) / avgDist;
    const yawDeg = Math.max(-45, Math.min(45, ratio * 45));
    const abnormal = Math.abs(yawDeg) > HEAD_YAW_ALERT_DEG ? 1 : 0;

    return { yawDeg, abnormal };
  }, []);

  const detectGazeOscillation = useCallback((landmarks) => {
    if (!landmarks || landmarks.length === 0) return { oscillation: 0, avgOffset: 0 };

    const leftIris = landmarks[468];
    const rightIris = landmarks[473];
    const leftEyeLeft = landmarks[33];
    const leftEyeRight = landmarks[133];
    const rightEyeLeft = landmarks[362];
    const rightEyeRight = landmarks[263];

    if (!leftIris || !rightIris || !leftEyeLeft || !leftEyeRight || !rightEyeLeft || !rightEyeRight) {
      return { oscillation: 0, avgOffset: 0 };
    }

    const leftEyeCenterX = (leftEyeLeft.x + leftEyeRight.x) / 2;
    const rightEyeCenterX = (rightEyeLeft.x + rightEyeRight.x) / 2;
    const leftEyeWidth = Math.abs(leftEyeRight.x - leftEyeLeft.x);
    const rightEyeWidth = Math.abs(rightEyeRight.x - rightEyeLeft.x);
    const leftOffset = leftEyeWidth > 0 ? (leftIris.x - leftEyeCenterX) / leftEyeWidth : 0;
    const rightOffset = rightEyeWidth > 0 ? (rightIris.x - rightEyeCenterX) / rightEyeWidth : 0;
    const avgOffset = (leftOffset + rightOffset) / 2;

    const sequence = gazeSequenceRef.current.concat(avgOffset).slice(-GAZE_SEQ_LEN);
    gazeSequenceRef.current = sequence;

    if (sequence.length < 3) {
      return { oscillation: 0, avgOffset };
    }

    const maxVal = Math.max(...sequence);
    const minVal = Math.min(...sequence);
    const amplitude = Math.abs(maxVal - minVal);
    const oscillationPct = Math.min((amplitude / (GAZE_OSC_THRESHOLD * 2)) * 100, 100);

    return { oscillation: oscillationPct, avgOffset };
  }, []);

  const detectEyeMovement = useCallback((landmarks) => {
    if (!landmarks || landmarks.length === 0) return 0;

    const leftIris = landmarks[468];
    const leftEyeLeft = landmarks[33];
    const leftEyeRight = landmarks[133];

    if (!leftIris || !leftEyeLeft || !leftEyeRight) return 0;

    const leftEyeCenterX = (leftEyeLeft.x + leftEyeRight.x) / 2;
    const leftEyeWidth = Math.abs(leftEyeRight.x - leftEyeLeft.x);
    const irisOffset = leftEyeWidth > 0 ? Math.abs(leftIris.x - leftEyeCenterX) / leftEyeWidth : 0;
    const history = eyeOffsetHistoryRef.current.concat(irisOffset).slice(-EYE_OFFSET_WINDOW);
    eyeOffsetHistoryRef.current = history;

    if (history.length === 0) return 0;
    const avgOffset = history.reduce((sum, value) => sum + value, 0) / history.length;
    const movementPct = Math.min((avgOffset / EYE_OFFSET_THRESHOLD) * 100, 100);

    return movementPct;
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
      tremorIndicators: 0.15,
      headAbnormal: 0.08,
      gazeOscillation: 0.07,
      eyeMovement: 0.05
    };
    
    let score = 0;
    Object.keys(weights).forEach(key => {
      score += (metrics[key] || 0) * weights[key];
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

        const leftIris = faceLandmarks[468];
        const rightIris = faceLandmarks[473];
        const leftEyeLeft = faceLandmarks[33];
        const leftEyeRight = faceLandmarks[133];
        const rightEyeLeft = faceLandmarks[362];
        const rightEyeRight = faceLandmarks[263];

        if (leftIris && rightIris && leftEyeLeft && leftEyeRight && rightEyeLeft && rightEyeRight) {
          const toPx = (p) => ({
            x: p.x * canvasRef.current.width,
            y: p.y * canvasRef.current.height
          });

          const leftCenter = toPx({
            x: (leftEyeLeft.x + leftEyeRight.x) / 2,
            y: (leftEyeLeft.y + leftEyeRight.y) / 2
          });
          const rightCenter = toPx({
            x: (rightEyeLeft.x + rightEyeRight.x) / 2,
            y: (rightEyeLeft.y + rightEyeRight.y) / 2
          });
          const leftIrisPx = toPx(leftIris);
          const rightIrisPx = toPx(rightIris);

          canvasCtx.strokeStyle = '#FFFF00';
          canvasCtx.lineWidth = 2;
          canvasCtx.beginPath();
          canvasCtx.moveTo(leftCenter.x, leftCenter.y);
          canvasCtx.lineTo(leftIrisPx.x, leftIrisPx.y);
          canvasCtx.stroke();

          canvasCtx.beginPath();
          canvasCtx.moveTo(rightCenter.x, rightCenter.y);
          canvasCtx.lineTo(rightIrisPx.x, rightIrisPx.y);
          canvasCtx.stroke();

          canvasCtx.fillStyle = '#0000FF';
          canvasCtx.beginPath();
          canvasCtx.arc(leftCenter.x, leftCenter.y, 3, 0, 2 * Math.PI);
          canvasCtx.fill();
          canvasCtx.beginPath();
          canvasCtx.arc(rightCenter.x, rightCenter.y, 3, 0, 2 * Math.PI);
          canvasCtx.fill();

          canvasCtx.fillStyle = '#00FF00';
          canvasCtx.beginPath();
          canvasCtx.arc(leftIrisPx.x, leftIrisPx.y, 3, 0, 2 * Math.PI);
          canvasCtx.fill();
          canvasCtx.beginPath();
          canvasCtx.arc(rightIrisPx.x, rightIrisPx.y, 3, 0, 2 * Math.PI);
          canvasCtx.fill();
        }
        
        const bpm = updateBlinkAndGetBpm(faceLandmarks);
        setBlinkRateBpm(bpm);

        const blinkPct = Math.min((bpm / 40) * 100, 100);
        const { yawDeg, abnormal } = calculateHeadPoseApprox(faceLandmarks);
        const { oscillation } = detectGazeOscillation(faceLandmarks);
        const eyeMoving = detectEyeMovement(faceLandmarks);
        const newMetrics = {
          blinkRate: blinkPct,
          gazeDeviation: calculateGazeDeviation(faceLandmarks),
          facialAsymmetry: calculateFacialAsymmetry(faceLandmarks),
          expressivity: calculateExpressivity(faceLandmarks),
          tremorIndicators: calculateTremorIndicators(faceLandmarks),
          headPoseAngle: yawDeg,
          headAbnormal: abnormal ? 100 : 0,
          gazeOscillation: oscillation,
          eyeMovement: eyeMoving
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
      eyeOffsetHistoryRef.current = [];
      eyeMoveCounterRef.current = 0;
      setLandmarks([]);
      setBlinkRateBpm(0);
    };
  }, [isAnalyzing, analysisSource, updateBlinkAndGetBpm, calculateGazeDeviation, calculateHeadPoseApprox, detectGazeOscillation, detectEyeMovement, calculateFacialAsymmetry, calculateExpressivity, calculateTremorIndicators, calculateRiskScore, onRiskScore, onMetrics]);

  const t = (en, ta) => (language === 'ta' ? ta : en);

  const startAnalysis = useCallback(() => {
    if (isAnalyzing) return;
    if (analysisSource === 'sample' && !sampleVideoUrl) {
      setSampleError(t('Please upload a sample video first.', 'முதலில் மாதிரி வீடியோவை பதிவேற்றவும்.'));
      return;
    }
    setSampleError('');
    gazeSequenceRef.current = [];
    eyeOffsetHistoryRef.current = [];
    eyeMoveCounterRef.current = 0;
    setIsAnalyzing(true);
    if (analysisSource === 'sample' && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, [analysisSource, isAnalyzing, sampleVideoUrl, language]);

  const stopAnalysis = useCallback(() => {
    setIsAnalyzing(false);
    gazeSequenceRef.current = [];
    eyeOffsetHistoryRef.current = [];
    eyeMoveCounterRef.current = 0;
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
    if (lastStartSignalRef.current === startSignal) return;
    lastStartSignalRef.current = startSignal;
    startAnalysis();
  }, [startSignal, startAnalysis]);

  useEffect(() => {
    if (stopSignal == null) return;
    if (lastStopSignalRef.current === stopSignal) return;
    lastStopSignalRef.current = stopSignal;
    stopAnalysis();
  }, [stopSignal, stopAnalysis]);

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
    <div className={embedded ? 'text-white' : 'min-h-screen bg-gray-900 text-white p-8'}>
      <div className="max-w-6xl mx-auto">
        {!embedded && (
          <h1 className="text-4xl font-bold mb-8 text-center">
            {t('Preventive AI - Face Analysis System', 'Preventive AI - முக பகுப்பாய்வு அமைப்பு')}
          </h1>
        )}
        
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
              />
            </div>
            
            {!hideControls && (
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
            )}
          </div>
          
          {/* Metrics Display */}
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-lg p-6 min-h-[220px]">
              <h2 className="text-xl font-semibold mb-4">{t('Real-time Metrics', 'நேரடி அளவுகள்')}</h2>
              
              <div className="space-y-4">
                <div className="flex justify-between items-center pr-2">
                  <span className="text-gray-300 w-28 shrink-0">{t('Blink Rate', 'கண் இமைப்பு விகிதம்')}</span>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-700 rounded-full h-2 min-w-[4rem]">
                      <div 
                        className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${metrics.blinkRate}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right shrink-0 tabular-nums">{metrics.blinkRate.toFixed(0)}%</span>
                  </div>
                </div>
                
                <div className="flex justify-between items-center pr-2">
                  <span className="text-gray-300 w-28 shrink-0">{t('Gaze Deviation', 'நோக்கு விலக்கம்')}</span>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-700 rounded-full h-2 min-w-[4rem]">
                      <div 
                        className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${metrics.gazeDeviation}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right shrink-0 tabular-nums">{metrics.gazeDeviation.toFixed(0)}%</span>
                  </div>
                </div>
                
                <div className="flex justify-between items-center pr-2">
                  <span className="text-gray-300 w-28 shrink-0">{t('Facial Asymmetry', 'முக அசமச்சீர்மை')}</span>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-700 rounded-full h-2 min-w-[4rem]">
                      <div 
                        className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${metrics.facialAsymmetry}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right shrink-0 tabular-nums">{metrics.facialAsymmetry.toFixed(0)}%</span>
                  </div>
                </div>
                
                <div className="flex justify-between items-center pr-2">
                  <span className="text-gray-300 w-28 shrink-0">{t('Expressivity', 'உணர்ச்சி வெளிப்பாடு')}</span>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-700 rounded-full h-2 min-w-[4rem]">
                      <div 
                        className="bg-green-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${metrics.expressivity}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right shrink-0 tabular-nums">{metrics.expressivity.toFixed(0)}%</span>
                  </div>
                </div>
                
                <div className="flex justify-between items-center pr-2">
                  <span className="text-gray-300 w-28 shrink-0">{t('Tremor Indicators', 'குலுக்கல் குறிகள்')}</span>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-700 rounded-full h-2 min-w-[4rem]">
                      <div 
                        className="bg-red-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${metrics.tremorIndicators}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right shrink-0 tabular-nums">{metrics.tremorIndicators.toFixed(0)}%</span>
                  </div>
                </div>

                <div className="flex justify-between items-center pr-2">
                  <span className="text-gray-300 w-28 shrink-0">{t('Head Pose (Yaw)', 'தலை நிலை (Yaw)')}</span>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-700 rounded-full h-2 min-w-[4rem]">
                      <div 
                        className="bg-cyan-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(Math.abs(metrics.headPoseAngle) / 30 * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right shrink-0 tabular-nums">{metrics.headPoseAngle.toFixed(0)}°</span>
                  </div>
                </div>

                <div className="flex justify-between items-center pr-2">
                  <span className="text-gray-300 w-28 shrink-0">{t('Gaze Oscillation', 'கண் அசைவு அதிர்வு')}</span>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-700 rounded-full h-2 min-w-[4rem]">
                      <div 
                        className="bg-pink-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${metrics.gazeOscillation}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right shrink-0 tabular-nums">{metrics.gazeOscillation.toFixed(0)}%</span>
                  </div>
                </div>

                <div className="flex justify-between items-center pr-2">
                  <span className="text-gray-300 w-28 shrink-0">{t('Eye Movement', 'கண் இயக்கம்')}</span>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-700 rounded-full h-2 min-w-[4rem]">
                      <div 
                        className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${metrics.eyeMovement}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right shrink-0 tabular-nums">{metrics.eyeMovement.toFixed(0)}%</span>
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
                  {landmarks.length > 0
                    ? t(`${landmarks.length} landmarks detected`, `${landmarks.length} அடையாளங்கள் கண்டறியப்பட்டது`)
                    : t('No face detected', 'முகம் கண்டறியப்படவில்லை')}
                </div>
                <div className="text-gray-400 mt-1">
                  {t('Blinks/min', 'இமைப்பு/நிமிடம்')}: {blinkRateBpm.toFixed(1)}
                </div>
                <div className="text-gray-400 mt-1">
                  {t('Head pose', 'தலை நிலை')}: {metrics.headAbnormal ? t('Abnormal', 'அசாதாரணம்') : t('Normal', 'சாதாரணம்')}
                </div>
                <div className="text-gray-400 mt-1">
                  {t('Gaze oscillation', 'கண் அசைவு அதிர்வு')}: {metrics.gazeOscillation ? t('Detected', 'கண்டறியப்பட்டது') : t('Stable', 'நிலையானது')}
                </div>
              </div>
            </div>
            
            {/* Disease Indicators */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('Disease Pattern Analysis', 'நோய் வித பகுப்பாய்வு')}</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-300">{t("Parkinson's Indicators", 'பார்கின்சன் குறிகள்')}:</span>
                  <span className="text-blue-400">
                    {(metrics.facialAsymmetry * 0.6 + metrics.tremorIndicators * 0.4).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">{t("Alzheimer's Indicators", 'அல்சைமர்ஸ் குறிகள்')}:</span>
                  <span className="text-purple-400">
                    {(metrics.gazeDeviation * 0.5 + metrics.expressivity * 0.5).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">{t('Depression Indicators', 'மனஅழுத்த குறிகள்')}:</span>
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
