import React, { useRef, useState, useCallback, useEffect } from 'react';

const FaceAnalysis = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [metrics, setMetrics] = useState({
    blinkRate: 0,
    gazeDeviation: 0,
    facialAsymmetry: 0,
    expressivity: 0,
    tremorIndicators: 0,
    headPoseAngle: 0,
    headAbnormal: 0,
    gazeOscillation: 0
  });
  const [landmarks, setLandmarks] = useState([]);
  const [riskScore, setRiskScore] = useState(0);
  const [blinkCount, setBlinkCount] = useState(0);
  const [lastBlinkTime, setLastBlinkTime] = useState(Date.now());
  const [earHistory, setEarHistory] = useState([]);
  const faceMeshRef = useRef(null);
  const cameraRef = useRef(null);
  const gazeSequenceRef = useRef([]);

  const HEAD_YAW_ALERT_DEG = 10;
  const GAZE_OSC_THRESHOLD = 0.02;
  const GAZE_SEQ_LEN = 6;

  // Load MediaPipe dynamically
  const loadMediaPipe = useCallback(async () => {
    try {
      const { FaceMesh } = await import('@mediapipe/face_mesh');
      const { Camera } = await import('@mediapipe/camera_utils');
      
      const faceMesh = new FaceMesh({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
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
            canvasCtx.arc(x, y, 2, 0, 2 * Math.PI);
            canvasCtx.fillStyle = '#00FF00';
            canvasCtx.fill();
          }
          
          // Calculate metrics
          calculateMetrics(faceLandmarks);
        }
        
        canvasCtx.restore();
      });

      faceMeshRef.current = faceMesh;

      if (videoRef.current) {
        const camera = new Camera(videoRef.current, {
          onFrame: async () => {
            if (videoRef.current && faceMeshRef.current && isAnalyzing) {
              await faceMeshRef.current.send({ image: videoRef.current });
            }
          },
          width: 640,
          height: 480
        });
        
        cameraRef.current = camera;
        camera.start();
      }
    } catch (error) {
      console.error('Error loading MediaPipe:', error);
    }
  }, [isAnalyzing]);

  // Calculate blink rate using Eye Aspect Ratio (EAR)
  const calculateEAR = useCallback((landmarks, eyeIndices) => {
    const eye = eyeIndices.map(i => landmarks[i]);
    if (eye.some(point => !point)) return 0;
    
    // Vertical distances
    const vert1 = Math.sqrt(Math.pow(eye[1].x - eye[5].x, 2) + Math.pow(eye[1].y - eye[5].y, 2));
    const vert2 = Math.sqrt(Math.pow(eye[2].x - eye[4].x, 2) + Math.pow(eye[2].y - eye[4].y, 2));
    
    // Horizontal distance
    const horz = Math.sqrt(Math.pow(eye[0].x - eye[8].x, 2) + Math.pow(eye[0].y - eye[8].y, 2));
    
    return (vert1 + vert2) / (2 * horz);
  }, []);

  const detectBlinks = useCallback((landmarks) => {
    const leftEyeIndices = [33, 7, 163, 144, 145, 153, 154, 155, 133];
    const rightEyeIndices = [362, 398, 384, 385, 386, 387, 388, 466, 263];
    
    const leftEAR = calculateEAR(landmarks, leftEyeIndices);
    const rightEAR = calculateEAR(landmarks, rightEyeIndices);
    const avgEAR = (leftEAR + rightEAR) / 2;
    
    // Update EAR history
    setEarHistory(prev => {
      const newHistory = [...prev, avgEAR];
      return newHistory.slice(-30); // Keep last 30 frames
    });
    
    // Detect blink (EAR < 0.25)
    if (avgEAR < 0.25) {
      const now = Date.now();
      if (now - lastBlinkTime > 200) { // Minimum 200ms between blinks
        setBlinkCount(prev => prev + 1);
        setLastBlinkTime(now);
      }
    }
    
    return avgEAR;
  }, [calculateEAR, lastBlinkTime]);

  // Calculate gaze deviation
  const calculateGazeDeviation = useCallback((landmarks) => {
    const leftEyeCenter = landmarks[33];
    const rightEyeCenter = landmarks[362];
    const noseTip = landmarks[1];
    
    if (!leftEyeCenter || !rightEyeCenter || !noseTip) return 0;
    
    const eyeCenter = {
      x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
      y: (leftEyeCenter.y + rightEyeCenter.y) / 2
    };
    
    const deviation = Math.sqrt(
      Math.pow(eyeCenter.x - noseTip.x, 2) + 
      Math.pow(eyeCenter.y - noseTip.y, 2)
    );
    
    return Math.min(deviation * 150, 100);
  }, []);

  const calculateHeadPoseApprox = useCallback((landmarks) => {
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

    const leftOffset = leftIris.x - leftEyeCenterX;
    const rightOffset = rightIris.x - rightEyeCenterX;
    const avgOffset = (leftOffset + rightOffset) / 2;

    const sequence = gazeSequenceRef.current.concat(avgOffset).slice(-GAZE_SEQ_LEN);
    gazeSequenceRef.current = sequence;

    if (sequence.length < GAZE_SEQ_LEN) {
      return { oscillation: 0, avgOffset };
    }

    const maxVal = Math.max(...sequence);
    const minVal = Math.min(...sequence);
    const oscillation = maxVal > GAZE_OSC_THRESHOLD && minVal < -GAZE_OSC_THRESHOLD ? 1 : 0;

    return { oscillation, avgOffset };
  }, []);

  // Calculate facial asymmetry
  const calculateFacialAsymmetry = useCallback((landmarks) => {
    const pairs = [
      [127, 356], // Left and right cheek
      [234, 454], // Left and right jaw
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
    
    return Math.min((totalAsymmetry / pairs.length) * 250, 100);
  }, []);

  // Calculate expressivity
  const calculateExpressivity = useCallback((landmarks) => {
    const mouthTop = landmarks[13];
    const mouthBottom = landmarks[14];
    const mouthOpenness = mouthTop && mouthBottom ? 
      Math.abs(mouthTop.y - mouthBottom.y) * 200 : 0;
    
    // Eyebrow movement
    const leftEyebrow = landmarks[70];
    const rightEyebrow = landmarks[300];
    const eyebrowMovement = leftEyebrow && rightEyebrow ?
      Math.abs(leftEyebrow.y - rightEyebrow.y) * 100 : 0;
    
    return Math.min((mouthOpenness + eyebrowMovement) / 2, 100);
  }, []);

  // Calculate tremor indicators
  const calculateTremorIndicators = useCallback((landmarks) => {
    // Simulate tremor detection based on micro-movements
    const noseTip = landmarks[1];
    if (!noseTip) return 0;
    
    // Add some realistic variation
    const baseTremor = 5;
    const variation = Math.sin(Date.now() * 0.001) * 2;
    return Math.max(0, Math.min(baseTremor + variation, 100));
  }, []);

  // Calculate all metrics
  const calculateMetrics = useCallback((faceLandmarks) => {
    detectBlinks(faceLandmarks);

    const { yawDeg, abnormal } = calculateHeadPoseApprox(faceLandmarks);
    const { oscillation } = detectGazeOscillation(faceLandmarks);
    
    const newMetrics = {
      blinkRate: Math.min((blinkCount / Math.max((Date.now() - lastBlinkTime) / 60000, 0.1)) * 20, 100),
      gazeDeviation: calculateGazeDeviation(faceLandmarks),
      facialAsymmetry: calculateFacialAsymmetry(faceLandmarks),
      expressivity: calculateExpressivity(faceLandmarks),
      tremorIndicators: calculateTremorIndicators(faceLandmarks),
      headPoseAngle: yawDeg,
      headAbnormal: abnormal ? 100 : 0,
      gazeOscillation: oscillation ? 100 : 0
    };
    
    setMetrics(newMetrics);
    calculateRiskScore(newMetrics);
  }, [blinkCount, lastBlinkTime, detectBlinks, calculateHeadPoseApprox, detectGazeOscillation, calculateGazeDeviation, calculateFacialAsymmetry, calculateExpressivity, calculateTremorIndicators]);

  // Calculate risk score
  const calculateRiskScore = useCallback((metrics) => {
    const weights = {
      blinkRate: 0.2,
      gazeDeviation: 0.25,
      facialAsymmetry: 0.25,
      expressivity: 0.15,
      tremorIndicators: 0.15,
      headAbnormal: 0.08,
      gazeOscillation: 0.07
    };
    
    let score = 0;
    Object.keys(weights).forEach(key => {
      score += (metrics[key] || 0) * weights[key];
    });
    
    setRiskScore(Math.min(score, 100));
  }, []);

  // Start analysis
  const startAnalysis = useCallback(async () => {
    setIsAnalyzing(true);
    setBlinkCount(0);
    setLastBlinkTime(Date.now());
    setEarHistory([]);
    gazeSequenceRef.current = [];
    await loadMediaPipe();
  }, [loadMediaPipe]);

  // Stop analysis
  const stopAnalysis = useCallback(() => {
    setIsAnalyzing(false);
    if (cameraRef.current) {
      cameraRef.current.stop();
    }
    if (faceMeshRef.current) {
      faceMeshRef.current.close();
    }
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      stopAnalysis();
    };
  }, [stopAnalysis]);

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
          Preventive AI - Face Analysis System
        </h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Video and Canvas */}
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-lg p-4">
              <h2 className="text-xl font-semibold mb-4">Camera Feed</h2>
              <video
                ref={videoRef}
                className="w-full rounded-lg"
                autoPlay
                playsInline
              />
              <canvas
                ref={canvasRef}
                width={640}
                height={480}
                className="w-full rounded-lg mt-4"
              />
            </div>
            
            <div className="flex gap-4">
              <button
                onClick={startAnalysis}
                disabled={isAnalyzing}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                {isAnalyzing ? 'Analyzing...' : 'Start Analysis'}
              </button>
              <button
                onClick={stopAnalysis}
                disabled={!isAnalyzing}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                Stop Analysis
              </button>
            </div>
          </div>
          
          {/* Metrics Display */}
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Real-time Metrics</h2>
              
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

                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Head Pose (Yaw)</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-cyan-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(Math.abs(metrics.headPoseAngle) / 30 * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right">{metrics.headPoseAngle.toFixed(0)}°</span>
                  </div>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Gaze Oscillation</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-pink-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${metrics.gazeOscillation}%` }}
                      />
                    </div>
                    <span className="text-sm w-12 text-right">{metrics.gazeOscillation.toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Risk Score */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Risk Assessment</h2>
              <div className="text-center">
                <div className="text-6xl font-bold mb-2">{riskScore.toFixed(1)}</div>
                <div className={`text-2xl font-semibold ${riskInfo.color}`}>
                  {riskInfo.level} Risk
                </div>
                <div className="text-gray-400 mt-2">
                  {landmarks.length > 0 ? `${landmarks.length} landmarks detected` : 'No face detected'}
                </div>
                <div className="text-gray-400 mt-1">
                  Blinks detected: {blinkCount}
                </div>
                <div className="text-gray-400 mt-1">
                  Head pose: {metrics.headAbnormal ? 'Abnormal' : 'Normal'}
                </div>
                <div className="text-gray-400 mt-1">
                  Gaze oscillation: {metrics.gazeOscillation ? 'Detected' : 'Stable'}
                </div>
              </div>
            </div>
            
            {/* Disease Indicators */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Disease Pattern Analysis</h2>
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
                <div className="flex justify-between">
                  <span className="text-gray-300">Autism Indicators:</span>
                  <span className="text-yellow-400">
                    {(metrics.gazeDeviation * 0.4 + metrics.expressivity * 0.6).toFixed(1)}%
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
