import React, { useRef, useState, useCallback, useEffect } from 'react';

// ── MediaPipe Holistic-based Body Language & Tremor Analyser ──────────────
// Uses pose (33 landmarks) + hand (21×2 landmarks) to detect:
//  • Posture quality  (shoulder alignment, slouch angle)
//  • Hand tremor intensity  (jitter of palm centre over time)
//  • Coordination score  (response to guided tasks)
//  • Body sway / stability  (hip-centre drift)

const HISTORY_LENGTH   = 90;   // ≈ 3 s at 30 fps
const TREMOR_WINDOW    = 30;   // last 30 samples for tremor FFT-like calc
const TASK_HOLD_SEC    = 5;    // how long user must hold palm up
const LANDMARKS_POSE   = 33;

// ── Helper: standard-deviation of a number[] ──────────────────────────────
const stdDev = (arr) => {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
};

// ── Helper: detect high-frequency jitter (simplified tremor metric) ───────
const computeTremorScore = (positions) => {
  if (positions.length < 6) return 0;
  // Compute frame-to-frame deltas
  const deltas = [];
  for (let i = 1; i < positions.length; i++) {
    const dx = positions[i].x - positions[i - 1].x;
    const dy = positions[i].y - positions[i - 1].y;
    deltas.push(Math.sqrt(dx * dx + dy * dy));
  }
  // Filter out camera noise — ignore deltas below noise floor
  const noiseFloor = 0.003;
  const meaningful = deltas.filter(d => d > noiseFloor);
  if (meaningful.length < 3) return 0;

  // Count direction reversals (high → tremor)
  let reversals = 0;
  for (let i = 2; i < positions.length; i++) {
    const dx1 = positions[i - 1].x - positions[i - 2].x;
    const dx2 = positions[i].x - positions[i - 1].x;
    const dy1 = positions[i - 1].y - positions[i - 2].y;
    const dy2 = positions[i].y - positions[i - 1].y;
    // Only count reversals above noise floor
    if (Math.abs(dx1) > noiseFloor && Math.abs(dx2) > noiseFloor && dx1 * dx2 < 0) reversals++;
    if (Math.abs(dy1) > noiseFloor && Math.abs(dy2) > noiseFloor && dy1 * dy2 < 0) reversals++;
  }
  const avgDelta = meaningful.reduce((a, b) => a + b, 0) / meaningful.length;
  const reversalRate = reversals / (positions.length - 2);
  // Combine magnitude + reversal-rate into 0-100 score (reduced sensitivity)
  return Math.min((avgDelta * 2000 + reversalRate * 25), 100);
};

const BodyAnalysis = ({ onMetrics, onRiskScore, startSignal, stopSignal, language = 'en', hideControls = false, embedded = false } = {}) => {
  const videoRef     = useRef(null);
  const canvasRef    = useRef(null);
  const holisticRef  = useRef(null);
  const cameraRef    = useRef(null);
  const animFrameRef = useRef(null);
  const lastStartSignalRef = useRef(startSignal);
  const lastStopSignalRef  = useRef(stopSignal);

  // Position history for tremor / sway calculations
  const leftWristHistory  = useRef([]);
  const rightWristHistory = useRef([]);
  const hipCenterHistory  = useRef([]);
  const leftPalmHistory   = useRef([]);
  const rightPalmHistory  = useRef([]);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [taskPhase, setTaskPhase]     = useState('idle');
  // idle → instruct → hold → analysing → result
  const [taskTimer, setTaskTimer]     = useState(0);
  const taskTimerRef = useRef(null);

  const [metrics, setMetrics] = useState({
    postureScore:       0,
    shoulderTilt:       0,
    slouch:             0,
    leftHandTremor:     0,
    rightHandTremor:    0,
    bodySway:           0,
    coordinationScore:  0,
    palmElevationAngle: 0,
    handSteadiness:     0,
  });

  const [riskScore, setRiskScore]       = useState(0);
  const [detectedParts, setDetectedParts] = useState({ pose: false, leftHand: false, rightHand: false });
  const [palmDetected, setPalmDetected] = useState(false);
  const [taskResult, setTaskResult]     = useState(null);

  // ── Load MediaPipe Holistic via CDN ──────────────────────────────────────
  const loadMediaPipe = useCallback(async () => {
    try {
      const { Holistic } = await import('@mediapipe/holistic');
      const { Camera }   = await import('@mediapipe/camera_utils');

      const holistic = new Holistic({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`,
      });

      holistic.setOptions({
        modelComplexity:         1,
        smoothLandmarks:         true,
        enableSegmentation:      false,
        smoothSegmentation:      false,
        refineFaceLandmarks:     false,
        minDetectionConfidence:  0.5,
        minTrackingConfidence:   0.5,
      });

      holistic.onResults(onResults);
      holisticRef.current = holistic;

      if (videoRef.current) {
        const camera = new Camera(videoRef.current, {
          onFrame: async () => {
            if (videoRef.current && holisticRef.current) {
              await holisticRef.current.send({ image: videoRef.current });
            }
          },
          width: 640,
          height: 480,
        });
        cameraRef.current = camera;
        camera.start();
      }
    } catch (err) {
      console.error('Error loading MediaPipe Holistic:', err);
    }
  }, []);

  // ── Process each frame from Holistic ─────────────────────────────────────
  const onResults = useCallback((results) => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const W   = canvasRef.current.width;
    const H   = canvasRef.current.height;
    ctx.save();
    ctx.clearRect(0, 0, W, H);

    // Mirror the image for natural UX
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    if (results.image) ctx.drawImage(results.image, 0, 0, W, H);
    ctx.restore();

    const hasPose  = results.poseLandmarks && results.poseLandmarks.length >= LANDMARKS_POSE;
    const hasLeft  = results.leftHandLandmarks && results.leftHandLandmarks.length > 0;
    const hasRight = results.rightHandLandmarks && results.rightHandLandmarks.length > 0;

    setDetectedParts({ pose: hasPose, leftHand: hasLeft, rightHand: hasRight });

    // ─── Draw pose skeleton ────────────────────────────────────────────
    if (hasPose) {
      drawPoseSkeleton(ctx, results.poseLandmarks, W, H);
    }

    // ─── Draw hands ────────────────────────────────────────────────────
    if (hasLeft)  drawHandLandmarks(ctx, results.leftHandLandmarks,  W, H, '#00FF88');
    if (hasRight) drawHandLandmarks(ctx, results.rightHandLandmarks, W, H, '#FF8800');

    // ─── Compute metrics ───────────────────────────────────────────────
    if (hasPose) {
      analysePosture(results.poseLandmarks);
      analyseBodySway(results.poseLandmarks);
    }
    if (hasLeft)  analyseHandTremor(results.leftHandLandmarks,  'left');
    if (hasRight) analyseHandTremor(results.rightHandLandmarks, 'right');

    // Palm-up detection for task
    const palmUp = detectPalmElevated(results.poseLandmarks, results.leftHandLandmarks, results.rightHandLandmarks);
    setPalmDetected(palmUp);

    ctx.restore();
  }, []);

  // ── Drawing helpers ──────────────────────────────────────────────────────
  const drawPoseSkeleton = (ctx, lm, W, H) => {
    const connections = [
      [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],  // arms
      [11, 23], [12, 24], [23, 24], [23, 25], [24, 26],  // torso + legs
      [25, 27], [26, 28],
    ];
    ctx.strokeStyle = '#00BFFF';
    ctx.lineWidth   = 2;
    connections.forEach(([a, b]) => {
      if (!lm[a] || !lm[b]) return;
      ctx.beginPath();
      ctx.moveTo((1 - lm[a].x) * W, lm[a].y * H);
      ctx.lineTo((1 - lm[b].x) * W, lm[b].y * H);
      ctx.stroke();
    });
    // Draw key landmarks as dots
    [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].forEach((i) => {
      if (!lm[i]) return;
      ctx.beginPath();
      ctx.arc((1 - lm[i].x) * W, lm[i].y * H, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#00FFFF';
      ctx.fill();
    });
  };

  const drawHandLandmarks = (ctx, lm, W, H, color) => {
    const connections = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [5,9],[9,10],[10,11],[11,12],
      [9,13],[13,14],[14,15],[15,16],
      [13,17],[17,18],[18,19],[19,20],[0,17],
    ];
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
    connections.forEach(([a, b]) => {
      if (!lm[a] || !lm[b]) return;
      ctx.beginPath();
      ctx.moveTo((1 - lm[a].x) * W, lm[a].y * H);
      ctx.lineTo((1 - lm[b].x) * W, lm[b].y * H);
      ctx.stroke();
    });
    lm.forEach((p) => {
      ctx.beginPath();
      ctx.arc((1 - p.x) * W, p.y * H, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
  };

  // ── Posture analysis ─────────────────────────────────────────────────────
  const analysePosture = useCallback((poseLandmarks) => {
    const lShoulder = poseLandmarks[11];
    const rShoulder = poseLandmarks[12];
    const lHip      = poseLandmarks[23];
    const rHip      = poseLandmarks[24];
    const nose      = poseLandmarks[0];

    if (!lShoulder || !rShoulder || !lHip || !rHip || !nose) return;

    // Shoulder tilt (left-right height difference → 0-100)
    const shoulderTilt = Math.abs(lShoulder.y - rShoulder.y) * 500;

    // Slouch: angle between shoulder-mid → hip-mid vs vertical
    const shoulderMid = { x: (lShoulder.x + rShoulder.x) / 2, y: (lShoulder.y + rShoulder.y) / 2 };
    const hipMid      = { x: (lHip.x + rHip.x) / 2,           y: (lHip.y + rHip.y) / 2 };
    const dx = shoulderMid.x - hipMid.x;
    const dy = shoulderMid.y - hipMid.y;
    const angleDeg = Math.abs(Math.atan2(dx, -dy) * (180 / Math.PI));
    const slouchScore = Math.min(angleDeg * 5, 100);

    // Head-forward: nose ahead of shoulder-mid horizontally
    const headForward = Math.abs(nose.x - shoulderMid.x) * 400;

    const postureScore = Math.max(0, 100 - (shoulderTilt + slouchScore + headForward) / 3);

    setMetrics((prev) => ({
      ...prev,
      postureScore: Math.round(postureScore * 10) / 10,
      shoulderTilt: Math.round(Math.min(shoulderTilt, 100) * 10) / 10,
      slouch: Math.round(slouchScore * 10) / 10,
    }));
  }, []);

  // ── Body sway (hip-centre drift) ────────────────────────────────────────
  const analyseBodySway = useCallback((poseLandmarks) => {
    const lHip = poseLandmarks[23];
    const rHip = poseLandmarks[24];
    if (!lHip || !rHip) return;

    const center = { x: (lHip.x + rHip.x) / 2, y: (lHip.y + rHip.y) / 2 };
    hipCenterHistory.current.push(center);
    if (hipCenterHistory.current.length > HISTORY_LENGTH)
      hipCenterHistory.current.shift();

    const xVals = hipCenterHistory.current.map((p) => p.x);
    const yVals = hipCenterHistory.current.map((p) => p.y);
    const sway  = (stdDev(xVals) + stdDev(yVals)) * 2000;

    setMetrics((prev) => ({ ...prev, bodySway: Math.round(Math.min(sway, 100) * 10) / 10 }));
  }, []);

  // ── Hand tremor analysis ─────────────────────────────────────────────────
  const analyseHandTremor = useCallback((handLandmarks, side) => {
    // Palm centre = landmark 9 (middle-finger MCP)
    const palmCenter = handLandmarks[9];
    if (!palmCenter) return;

    const hist = side === 'left' ? leftPalmHistory : rightPalmHistory;
    hist.current.push({ x: palmCenter.x, y: palmCenter.y });
    if (hist.current.length > TREMOR_WINDOW) hist.current.shift();

    const tremorScore = computeTremorScore(hist.current);
    const key = side === 'left' ? 'leftHandTremor' : 'rightHandTremor';

    setMetrics((prev) => ({ ...prev, [key]: Math.round(tremorScore * 10) / 10 }));
  }, []);

  // ── Palm-elevated detection (for guided task) ───────────────────────────
  const detectPalmElevated = useCallback((poseLm, leftHandLm, rightHandLm) => {
    if (!poseLm) return false;
    const lShoulder = poseLm[11];
    const rShoulder = poseLm[12];
    if (!lShoulder || !rShoulder) return false;
    const shoulderY = (lShoulder.y + rShoulder.y) / 2;

    let detected = false;

    // Check if wrist is above shoulder level AND hand landmarks exist
    const checkHand = (handLm, wristPose) => {
      if (!handLm || !wristPose) return false;
      // Wrist above shoulders
      if (wristPose.y > shoulderY) return false; // y is inverted (0 = top)
      // Check palm is roughly facing camera: fingertip y < wrist y
      const wrist = handLm[0];
      const middleTip = handLm[12];
      if (!wrist || !middleTip) return false;
      return middleTip.y < wrist.y; // fingers pointing up
    };

    if (checkHand(leftHandLm,  poseLm[15])) detected = true;
    if (checkHand(rightHandLm, poseLm[16])) detected = true;

    // Compute palm elevation angle for display
    if (detected) {
      const wrist = poseLm[15] || poseLm[16];
      if (wrist) {
        const angle = Math.abs((shoulderY - wrist.y) / shoulderY) * 90;
        setMetrics(prev => ({ ...prev, palmElevationAngle: Math.round(angle * 10) / 10 }));
      }
    }

    return detected;
  }, []);

  // ── Calculate overall risk score ─────────────────────────────────────────
  useEffect(() => {
    const weights = {
      postureScore:    -0.15,  // higher posture = lower risk → negative weight
      leftHandTremor:   0.25,
      rightHandTremor:  0.25,
      bodySway:         0.20,
      shoulderTilt:     0.08,
      slouch:           0.07,
    };

    let score = 0;
    score += Math.max(0, 100 - metrics.postureScore) * Math.abs(weights.postureScore);
    score += metrics.leftHandTremor  * weights.leftHandTremor;
    score += metrics.rightHandTremor * weights.rightHandTremor;
    score += metrics.bodySway        * weights.bodySway;
    score += metrics.shoulderTilt    * weights.shoulderTilt;
    score += metrics.slouch          * weights.slouch;

    const finalRisk = Math.round(Math.min(score, 100) * 10) / 10;
    setRiskScore(finalRisk);
    if (onRiskScore) onRiskScore(finalRisk);
    if (onMetrics) onMetrics(metrics);
  }, [metrics, onRiskScore, onMetrics]);

  // ── Guided task flow ─────────────────────────────────────────────────────
  const startTask = useCallback(() => {
    setTaskPhase('instruct');
    setTaskResult(null);
    leftPalmHistory.current  = [];
    rightPalmHistory.current = [];
    setMetrics(prev => ({ ...prev, handSteadiness: 0, coordinationScore: 0 }));
  }, []);

  // Move instruct → hold when palm detected
  useEffect(() => {
    if (taskPhase === 'instruct' && palmDetected) {
      setTaskPhase('hold');
      setTaskTimer(TASK_HOLD_SEC);
    }
  }, [taskPhase, palmDetected]);

  // Countdown during hold
  useEffect(() => {
    if (taskPhase !== 'hold') return;
    taskTimerRef.current = setInterval(() => {
      setTaskTimer((t) => {
        if (t <= 1) {
          clearInterval(taskTimerRef.current);
          setTaskPhase('analysing');
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(taskTimerRef.current);
  }, [taskPhase]);

  // Compute final task result
  useEffect(() => {
    if (taskPhase !== 'analysing') return;
    // Use last TREMOR_WINDOW samples of both hands
    const lTremor = computeTremorScore(leftPalmHistory.current);
    const rTremor = computeTremorScore(rightPalmHistory.current);
    const avgTremor = (lTremor + rTremor) / 2;

    // Steadiness = inverse of sway in hip centre during hold
    const recentSway = hipCenterHistory.current.slice(-TREMOR_WINDOW);
    const swayX = stdDev(recentSway.map(p => p.x));
    const swayY = stdDev(recentSway.map(p => p.y));
    const steadiness = Math.max(0, 100 - (swayX + swayY) * 3000);

    const coordination = Math.max(0, 100 - avgTremor * 0.6 - (100 - steadiness) * 0.4);

    setMetrics(prev => ({
      ...prev,
      handSteadiness: Math.round(steadiness * 10) / 10,
      coordinationScore: Math.round(coordination * 10) / 10,
    }));

    setTaskResult({
      tremorScore: Math.round(avgTremor * 10) / 10,
      steadiness: Math.round(steadiness * 10) / 10,
      coordination: Math.round(coordination * 10) / 10,
      risk: avgTremor > 40 ? 'Elevated' : avgTremor > 20 ? 'Moderate' : 'Low',
    });

    setTaskPhase('result');
  }, [taskPhase]);

  // ── Start / stop ────────────────────────────────────────────────────────
  const startAnalysis = useCallback(async () => {
    setIsAnalyzing(true);
    leftWristHistory.current  = [];
    rightWristHistory.current = [];
    hipCenterHistory.current  = [];
    leftPalmHistory.current   = [];
    rightPalmHistory.current  = [];
    setTaskPhase('idle');
    setTaskResult(null);
    await loadMediaPipe();
  }, [loadMediaPipe]);

  const stopAnalysis = useCallback(() => {
    setIsAnalyzing(false);
    setTaskPhase('idle');
    if (cameraRef.current) cameraRef.current.stop();
    if (holisticRef.current) holisticRef.current.close();
    clearInterval(taskTimerRef.current);
  }, []);

  useEffect(() => () => stopAnalysis(), [stopAnalysis]);

  // ── Watch signal props for orchestrator control ──────────────────────────
  useEffect(() => {
    if (startSignal !== undefined && startSignal !== lastStartSignalRef.current) {
      lastStartSignalRef.current = startSignal;
      if (!isAnalyzing) startAnalysis();
    }
  }, [startSignal, isAnalyzing, startAnalysis]);

  useEffect(() => {
    if (stopSignal !== undefined && stopSignal !== lastStopSignalRef.current) {
      lastStopSignalRef.current = stopSignal;
      if (isAnalyzing) stopAnalysis();
    }
  }, [stopSignal, isAnalyzing, stopAnalysis]);

  // ── Risk helpers ────────────────────────────────────────────────────────
  const getRiskLevel = (score) => {
    if (score < 15) return { level: 'Low',      color: 'text-green-700',  bg: 'bg-green-50' };
    if (score < 35) return { level: 'Moderate',  color: 'text-yellow-700', bg: 'bg-yellow-50' };
    if (score < 55) return { level: 'Elevated',  color: 'text-orange-700', bg: 'bg-orange-50' };
    return             { level: 'High',     color: 'text-red-700',    bg: 'bg-red-50' };
  };
  const riskInfo = getRiskLevel(riskScore);

  const barColor = (val, invert = false) => {
    const v = invert ? 100 - val : val;
    if (v < 25) return 'bg-green-500';
    if (v < 50) return 'bg-yellow-500';
    if (v < 75) return 'bg-orange-500';
    return 'bg-red-500';
  };

  // ── JSX ──────────────────────────────────────────────────────────────────
  // When embedded in the orchestrator, show full detailed output layout
  if (embedded) {
    return (
      <div className="text-gray-900">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* ─── Left: Camera + Disease Patterns ─────────────────── */}
          <div className="space-y-4">
            <div className="bg-gray-100 rounded-lg p-4 relative">
              <div className="relative">
                <video ref={videoRef} className="w-full rounded-lg" autoPlay playsInline style={{ display: isAnalyzing ? 'none' : 'block' }} />
                <canvas ref={canvasRef} width={640} height={480} className="w-full rounded-lg" style={{ display: isAnalyzing ? 'block' : 'none' }} />
                {isAnalyzing && (
                  <div className="absolute top-2 left-2 flex gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-1 rounded ${detectedParts.pose ? 'bg-green-600' : 'bg-gray-600'}`}>
                      {detectedParts.pose ? 'Y' : 'N'} Pose
                    </span>
                    <span className={`text-xs px-2 py-1 rounded ${detectedParts.leftHand ? 'bg-green-600' : 'bg-gray-600'}`}>
                      {detectedParts.leftHand ? 'Y' : 'N'} L-Hand
                    </span>
                    <span className={`text-xs px-2 py-1 rounded ${detectedParts.rightHand ? 'bg-green-600' : 'bg-gray-600'}`}>
                      {detectedParts.rightHand ? 'Y' : 'N'} R-Hand
                    </span>
                  </div>
                )}
              </div>
              {!hideControls && (
                <div className="flex gap-4 mt-4">
                  <button onClick={startAnalysis} disabled={isAnalyzing} className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 px-6 py-3 rounded-lg font-semibold transition-colors">
                    {isAnalyzing ? 'Analyzing…' : 'Start Analysis'}
                  </button>
                  <button onClick={stopAnalysis} disabled={!isAnalyzing} className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 px-6 py-3 rounded-lg font-semibold transition-colors">
                    Stop
                  </button>
                </div>
              )}
            </div>

            {/* Disease Pattern Analysis */}
            <div className="bg-gray-100 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-3 text-gray-900">Body-Based Disease Patterns</h3>
              <div className="space-y-3 text-sm">
                {[
                  { label: "Parkinson's Indicators", value: (metrics.leftHandTremor * 0.3 + metrics.rightHandTremor * 0.3 + metrics.bodySway * 0.2 + (100 - metrics.postureScore) * 0.2), textCls: 'text-blue-600', barCls: 'bg-blue-500' },
                  { label: 'Essential Tremor', value: (metrics.leftHandTremor * 0.4 + metrics.rightHandTremor * 0.4 + metrics.bodySway * 0.2), textCls: 'text-purple-600', barCls: 'bg-purple-500' },
                  { label: 'Motor Neuron Concerns', value: ((100 - metrics.coordinationScore) * 0.4 + metrics.bodySway * 0.3 + (100 - metrics.postureScore) * 0.3), textCls: 'text-orange-600', barCls: 'bg-orange-500' },
                  { label: 'Cerebellar Dysfunction', value: (metrics.bodySway * 0.4 + (100 - metrics.coordinationScore) * 0.35 + metrics.shoulderTilt * 0.25), textCls: 'text-yellow-600', barCls: 'bg-yellow-500' },
                ].map(({ label, value, textCls, barCls }) => (
                  <div key={label}>
                    <div className="flex justify-between mb-1">
                      <span className="text-gray-900">{label}</span>
                      <span className={`${textCls} font-medium`}>{Math.min(value, 100).toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div className={`${barCls} h-1.5 rounded-full transition-all duration-300`} style={{ width: `${Math.min(value, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ─── Right: Metrics + Risk ──────────────────────────── */}
          <div className="space-y-4">
            {/* Real-time metrics with progress bars */}
            <div className="bg-gray-100 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-3 text-gray-900">Real-time Body Metrics</h3>
              <div className="space-y-3">
                {[
                  { label: 'Posture Score', value: metrics.postureScore, invert: true, suffix: '%' },
                  { label: 'Shoulder Tilt', value: metrics.shoulderTilt, invert: false, suffix: '%' },
                  { label: 'Slouch', value: metrics.slouch, invert: false, suffix: '%' },
                  { label: 'Left Hand Tremor', value: metrics.leftHandTremor, invert: false, suffix: '%' },
                  { label: 'Right Hand Tremor', value: metrics.rightHandTremor, invert: false, suffix: '%' },
                  { label: 'Body Sway', value: metrics.bodySway, invert: false, suffix: '%' },
                  { label: 'Hand Steadiness', value: metrics.handSteadiness, invert: true, suffix: '%' },
                  { label: 'Coordination', value: metrics.coordinationScore, invert: true, suffix: '%' },
                  { label: 'Palm Elevation', value: metrics.palmElevationAngle, invert: false, suffix: '°' },
                ].map(({ label, value, invert, suffix }) => (
                  <div key={label} className="flex justify-between items-center">
                    <span className="text-gray-900 text-sm">{label}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-28 bg-gray-200 rounded-full h-2">
                        <div
                          className={`${barColor(value, invert)} h-2 rounded-full transition-all duration-300`}
                          style={{ width: `${Math.min(value, 100)}%` }}
                        />
                      </div>
                      <span className="text-sm w-14 text-right">{value.toFixed(1)}{suffix}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Risk Score */}
            <div className={`${riskInfo.bg} rounded-lg p-4 border border-opacity-30 ${riskInfo.color.replace('text-', 'border-')}`}>
              <h3 className="text-lg font-semibold mb-2 text-gray-900">Motor &amp; Postural Risk</h3>
              <div className="text-center">
                <div className="text-5xl font-bold mb-1">{riskScore}</div>
                <div className={`text-xl font-semibold ${riskInfo.color}`}>{riskInfo.level} Risk</div>
                <div className="w-full bg-gray-200 rounded-full h-3 mt-3">
                  <div
                    className={`${barColor(riskScore)} h-3 rounded-full transition-all duration-500`}
                    style={{ width: `${riskScore}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-gray-900 p-4 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-2 text-center">
          Body Language &amp; Tremor Analysis
        </h1>
        <p className="text-center text-gray-500 mb-8">
          Posture, hand tremors, body sway &amp; coordination — powered by MediaPipe Holistic
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* ─── Left: Camera + Task ──────────────────────────────────── */}
          <div className="space-y-4">
            {/* Camera */}
            <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-4 relative">
              <h2 className="text-xl font-semibold mb-3">Camera Feed</h2>
              <div className="relative">
                <video ref={videoRef} className="w-full rounded-lg" autoPlay playsInline style={{ display: isAnalyzing ? 'none' : 'block' }} />
                <canvas ref={canvasRef} width={640} height={480} className="w-full rounded-lg" style={{ display: isAnalyzing ? 'block' : 'none' }} />

                {/* Detection badges */}
                {isAnalyzing && (
                  <div className="absolute top-2 left-2 flex gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-1 rounded ${detectedParts.pose ? 'bg-green-600' : 'bg-gray-600'}`}>
                      {detectedParts.pose ? 'Y' : 'N'} Pose
                    </span>
                    <span className={`text-xs px-2 py-1 rounded ${detectedParts.leftHand ? 'bg-green-600' : 'bg-gray-600'}`}>
                      {detectedParts.leftHand ? 'Y' : 'N'} L-Hand
                    </span>
                    <span className={`text-xs px-2 py-1 rounded ${detectedParts.rightHand ? 'bg-green-600' : 'bg-gray-600'}`}>
                      {detectedParts.rightHand ? 'Y' : 'N'} R-Hand
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-4 mt-4">
                <button
                  onClick={startAnalysis}
                  disabled={isAnalyzing}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 px-6 py-3 rounded-lg font-semibold transition-colors"
                >
                  {isAnalyzing ? 'Analyzing…' : 'Start Analysis'}
                </button>
                <button
                  onClick={stopAnalysis}
                  disabled={!isAnalyzing}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 px-6 py-3 rounded-lg font-semibold transition-colors"
                >
                  Stop
                </button>
              </div>
            </div>

            {/* ─── Guided Task Card ─────────────────────────────────── */}
            <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                Guided Motor Task
              </h2>

              {taskPhase === 'idle' && (
                <div className="text-center space-y-4">
                  <p className="text-gray-600">
                    This task measures hand steadiness, tremor intensity, and overall coordination.
                    You will be asked to raise your palm in front of the camera and hold it still.
                  </p>
                  <button
                    onClick={startTask}
                    disabled={!isAnalyzing}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 px-8 py-3 rounded-lg font-semibold transition-colors"
                  >
                    Begin Task
                  </button>
                  {!isAnalyzing && (
                    <p className="text-sm text-gray-500">Start the camera analysis first.</p>
                  )}
                </div>
              )}

              {taskPhase === 'instruct' && (
                <div className="text-center space-y-4 animate-pulse">
                  <p className="text-xl text-yellow-700 font-semibold">
                    Raise one hand with palm facing the camera
                  </p>
                  <p className="text-gray-600">
                    Hold your arm elevated at roughly shoulder height, fingers spread.
                    The system will start recording once your palm is detected.
                  </p>
                  <div className={`inline-block px-4 py-2 rounded-full text-sm ${palmDetected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {palmDetected ? 'Palm detected!' : 'Waiting for palm…'}
                  </div>
                </div>
              )}

              {taskPhase === 'hold' && (
                <div className="text-center space-y-4">
                  <p className="text-xl text-cyan-700 font-semibold">
                    Hold still — recording movement
                  </p>
                  <div className="text-5xl font-mono font-bold text-gray-900">{taskTimer}s</div>
                  <p className="text-gray-600">Keep your hand as steady as possible.</p>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className="bg-cyan-500 h-3 rounded-full transition-all duration-1000"
                      style={{ width: `${((TASK_HOLD_SEC - taskTimer) / TASK_HOLD_SEC) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {taskPhase === 'analysing' && (
                <div className="text-center space-y-4 animate-pulse">
                  <p className="text-lg text-purple-600">Analysing movement data…</p>
                </div>
              )}

              {taskPhase === 'result' && taskResult && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-center mb-4">Task Results</h3>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-gray-100 rounded-lg p-4 text-center">
                      <p className="text-sm text-gray-600 mb-1">Tremor Score</p>
                      <p className={`text-2xl font-bold ${taskResult.tremorScore > 40 ? 'text-red-600' : taskResult.tremorScore > 20 ? 'text-yellow-600' : 'text-green-600'}`}>
                        {taskResult.tremorScore}
                      </p>
                    </div>
                    <div className="bg-gray-100 rounded-lg p-4 text-center">
                      <p className="text-sm text-gray-600 mb-1">Steadiness</p>
                      <p className={`text-2xl font-bold ${taskResult.steadiness > 70 ? 'text-green-600' : taskResult.steadiness > 40 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {taskResult.steadiness}
                      </p>
                    </div>
                    <div className="bg-gray-100 rounded-lg p-4 text-center">
                      <p className="text-sm text-gray-600 mb-1">Coordination</p>
                      <p className={`text-2xl font-bold ${taskResult.coordination > 70 ? 'text-green-600' : taskResult.coordination > 40 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {taskResult.coordination}
                      </p>
                    </div>
                  </div>

                  <div className={`text-center p-3 rounded-lg ${
                    taskResult.risk === 'Low' ? 'bg-green-50 text-green-700' :
                    taskResult.risk === 'Moderate' ? 'bg-yellow-50 text-yellow-700' :
                    'bg-red-50 text-red-700'
                  }`}>
                    Motor Risk: <span className="font-bold">{taskResult.risk}</span>
                  </div>

                  <button
                    onClick={startTask}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 px-6 py-3 rounded-lg font-semibold transition-colors"
                  >
                    Repeat Task
                  </button>
                </div>
              )}
            </div>

            {/* ─── Disease Indicators ───────────────────────────────── */}
            <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Body-Based Disease Pattern Analysis</h2>
              <div className="space-y-3 text-sm">
                {[
                  { label: "Parkinson's Indicators", value: (metrics.leftHandTremor * 0.3 + metrics.rightHandTremor * 0.3 + metrics.bodySway * 0.2 + (100 - metrics.postureScore) * 0.2), color: 'text-blue-600' },
                  { label: 'Essential Tremor',       value: (metrics.leftHandTremor * 0.4 + metrics.rightHandTremor * 0.4 + metrics.bodySway * 0.2), color: 'text-purple-600' },
                  { label: 'Motor Neuron Concerns',   value: ((100 - metrics.coordinationScore) * 0.4 + metrics.bodySway * 0.3 + (100 - metrics.postureScore) * 0.3), color: 'text-orange-600' },
                  { label: 'Cerebellar Dysfunction',  value: (metrics.bodySway * 0.4 + (100 - metrics.coordinationScore) * 0.35 + metrics.shoulderTilt * 0.25), color: 'text-yellow-600' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-gray-900">{label}:</span>
                    <span className={`${color} font-medium`}>{Math.min(value, 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ─── Right: Metrics + Risk ───────────────────────────────── */}
          <div className="space-y-4">
            {/* Real-time metrics */}
            <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Real-time Body Metrics</h2>
              <div className="space-y-4">
                {[
                  { label: 'Posture Score',       value: metrics.postureScore,    invert: true, suffix: '%' },
                  { label: 'Shoulder Tilt',       value: metrics.shoulderTilt,    invert: false, suffix: '%' },
                  { label: 'Slouch',              value: metrics.slouch,          invert: false, suffix: '%' },
                  { label: 'Left Hand Tremor',    value: metrics.leftHandTremor,  invert: false, suffix: '%' },
                  { label: 'Right Hand Tremor',   value: metrics.rightHandTremor, invert: false, suffix: '%' },
                  { label: 'Body Sway',           value: metrics.bodySway,        invert: false, suffix: '%' },
                  { label: 'Hand Steadiness',     value: metrics.handSteadiness,  invert: true, suffix: '%' },
                  { label: 'Coordination',        value: metrics.coordinationScore, invert: true, suffix: '%' },
                  { label: 'Palm Elevation',      value: metrics.palmElevationAngle, invert: false, suffix: '°' },
                ].map(({ label, value, invert, suffix }) => (
                  <div key={label} className="flex justify-between items-center">
                    <span className="text-gray-900 text-sm">{label}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-32 bg-gray-200 rounded-full h-2">
                        <div
                          className={`${barColor(value, invert)} h-2 rounded-full transition-all duration-300`}
                          style={{ width: `${Math.min(value, 100)}%` }}
                        />
                      </div>
                      <span className="text-sm w-14 text-right">{value.toFixed(1)}{suffix}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Risk Score */}
            <div className={`${riskInfo.bg} rounded-lg p-6 border border-opacity-30 ${riskInfo.color.replace('text-', 'border-')}`}>
              <h2 className="text-xl font-semibold mb-4">Motor &amp; Postural Risk</h2>
              <div className="text-center">
                <div className="text-6xl font-bold mb-2">{riskScore}</div>
                <div className={`text-2xl font-semibold ${riskInfo.color}`}>{riskInfo.level} Risk</div>
                <div className="w-full bg-gray-200 rounded-full h-3 mt-4">
                  <div
                    className={`${barColor(riskScore)} h-3 rounded-full transition-all duration-500`}
                    style={{ width: `${riskScore}%` }}
                  />
                </div>
              </div>
            </div>

            {/* How it works */}
            <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">How It Works</h2>
              <div className="space-y-3 text-sm text-gray-600">
                <div className="flex gap-3">
                  <span className="text-cyan-400 font-bold">1.</span>
                  <p><strong>Pose Detection</strong> — MediaPipe Holistic tracks 33 body landmarks to measure posture alignment, shoulder tilt, and slouch angle.</p>
                </div>
                <div className="flex gap-3">
                  <span className="text-cyan-400 font-bold">2.</span>
                  <p><strong>Hand Tracking</strong> — 21 landmarks per hand track micro-movements. Frame-to-frame jitter &amp; direction reversals quantify tremor intensity.</p>
                </div>
                <div className="flex gap-3">
                  <span className="text-cyan-400 font-bold">3.</span>
                  <p><strong>Body Sway</strong> — Hip-centre drift over time measures postural stability, a key biomarker for neurodegenerative conditions.</p>
                </div>
                <div className="flex gap-3">
                  <span className="text-cyan-400 font-bold">4.</span>
                  <p><strong>Guided Task</strong> — Raising &amp; holding the palm lets the system capture involuntary movement under sustained effort, revealing tremors invisible at rest.</p>
                </div>
              </div>
            </div>

            {/* Clinical note */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-500">
              <strong className="text-gray-600">Disclaimer:</strong> This tool is for screening purposes only and does not constitute a medical diagnosis.
              Results should be reviewed by a qualified healthcare professional.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BodyAnalysis;
