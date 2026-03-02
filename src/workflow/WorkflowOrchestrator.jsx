/**
 * ── Full Assessment Workflow Orchestrator ───────────────────────────────────
 *
 * Drives a 3-stage multimodal behavioral assessment using existing analysis
 * components. Does NOT modify any existing UI or analysis logic.
 *
 * WORKFLOW (sequential, mandatory order):
 *   STAGE 1 → Face + Voice (guided sentence read-aloud)       ~15 s
 *   STAGE 2 → Face + Voice (30 s free-speech temporal window) ~30 s
 *   STAGE 3 → Body + Hand  (guided motor tasks)               ~45 s
 *   FUSION  → Combine all stages → final assessment report
 *
 * ARCHITECTURE NOTES:
 *   • All metric state is stored in refs so timer callbacks always see
 *     the latest values (no stale closures).
 *   • Stage transitions are driven by a single `useEffect` that watches
 *     a `pendingTransition` flag set from within the countdown interval.
 *   • Temporal sampling in Stage 2 runs in its own interval that reads
 *     from refs, not state.
 *   • BodyAnalysis receives signal props (`startSignal`/`stopSignal`,
 *     `onMetrics`, `onRiskScore`, `embedded`) added in the same commit.
 *
 * ETHICAL NOTICE:
 *   This is a behavioral screening tool, NOT a medical diagnostic.
 *   All outputs use "observed patterns" / "screening support" language.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import FaceAnalysis from '../FaceAnalysis';
import VoiceAnalysis from '../VoiceAnalysis';
import BodyAnalysis from '../BodyAnalysis';
import YoloInference from '../engine/YoloInference';
import MultimodalFusion from '../engine/MultimodalFusion';
import AssessmentReport from './AssessmentReport';

// ── Stage durations (seconds) ──────────────────────────────────────────────
const STAGE1_DURATION = 15;
const STAGE2_DURATION = 30;
const STAGE3_DURATION = 45;

// ── Guided sentence for Stage 1 ────────────────────────────────────────────
const GUIDED_SENTENCES = {
  en: 'The quick brown fox jumps over the lazy dog.',
  ta: 'விரைவான பழுப்பு நரி சோம்பேறி நாய் மீது குதிக்கிறது.',
};

// ── Stage 3 motor tasks ────────────────────────────────────────────────────
const BODY_TASKS = [
  { id: 'raise_hand', durationSec: 10,
    en: 'Please raise your right hand and hold it steady at shoulder height.',
    ta: 'தயவுசெய்து உங்கள் வலது கையை தோள்பட்டை உயரத்தில் உயர்த்தி நிலையாக வைத்திருங்கள்.' },
  { id: 'thumbs_up', durationSec: 8,
    en: 'Now show a thumbs-up gesture with the same hand.',
    ta: 'இப்போது அதே கையால் ஒரு "thumbs-up" சைகையைக் காட்டுங்கள்.' },
  { id: 'finger_count', durationSec: 10,
    en: 'Show one finger… then slowly two fingers… then three.',
    ta: 'ஒரு விரலைக் காட்டுங்கள்… பின் இரண்டு… பின் மூன்று.' },
];

// ──────────────────────────────────────────────────────────────────────────
const WorkflowOrchestrator = ({ language = 'en' }) => {
  const t = useCallback((en, ta) => (language === 'ta' ? ta : en), [language]);

  // ── Workflow phase ────────────────────────────────────────────────────
  // 'idle' | 'stage1' | 'stage2' | 'stage3' | 'computing' | 'complete'
  const [phase, setPhase] = useState('idle');
  const [stageTimer, setStageTimer] = useState(0);
  const [currentTaskIdx, setCurrentTaskIdx] = useState(0);

  // ── Pending transition flag ───────────────────────────────────────────
  const [pendingTransition, setPendingTransition] = useState(null);

  // ── Signal props for child components ─────────────────────────────────
  const [faceStart, setFaceStart] = useState(0);
  const [faceStop, setFaceStop]   = useState(0);
  const [voiceStart, setVoiceStart] = useState(0);
  const [voiceStop, setVoiceStop]   = useState(0);
  const [bodyStart, setBodyStart] = useState(0);
  const [bodyStop, setBodyStop]   = useState(0);

  // ── Metrics from children (stored in refs to avoid stale closures) ────
  const faceMetricsRef  = useRef(null);
  const voiceMetricsRef = useRef(null);
  const faceRiskRef     = useRef(null);
  const voiceRiskRef    = useRef(null);
  const bodyMetricsRef  = useRef(null);
  const bodyRiskRef     = useRef(null);

  // Display copies (for rendering live metrics)
  const [faceMetrics, setFaceMetrics]   = useState(null);
  const [voiceMetrics, setVoiceMetrics] = useState(null);
  const [bodyMetrics, setBodyMetrics]   = useState(null);
  const [faceRiskDisplay, setFaceRiskDisplay]   = useState(0);
  const [voiceRiskDisplay, setVoiceRiskDisplay] = useState(0);
  const [bodyRiskDisplay, setBodyRiskDisplay]   = useState(0);

  // ── Metric callbacks ──────────────────────────────────────────────────
  const onFaceMetrics = useCallback((m) => { faceMetricsRef.current = m; setFaceMetrics(m); }, []);
  const onVoiceMetrics = useCallback((m) => { voiceMetricsRef.current = m; setVoiceMetrics(m); }, []);
  const onBodyMetrics = useCallback((m) => { bodyMetricsRef.current = m; setBodyMetrics(m); }, []);
  const onFaceRisk = useCallback((r) => { faceRiskRef.current = r; setFaceRiskDisplay(r); }, []);
  const onVoiceRisk = useCallback((r) => { voiceRiskRef.current = r; setVoiceRiskDisplay(r); }, []);
  const onBodyRisk = useCallback((r) => { bodyRiskRef.current = r; setBodyRiskDisplay(r); }, []);

  // ── Stage results ─────────────────────────────────────────────────────
  const [stage1Result, setStage1Result] = useState(null);
  const [stage2Result, setStage2Result] = useState(null);
  const [stage3Result, setStage3Result] = useState(null);
  const [finalAssessment, setFinalAssessment] = useState(null);

  // ── Engine refs ───────────────────────────────────────────────────────
  const yoloRef   = useRef(null);
  const fusionRef = useRef(null);
  const timerRef  = useRef(null);
  const temporalRef = useRef(null);

  // ── Init engines ──────────────────────────────────────────────────────
  useEffect(() => {
    yoloRef.current = new YoloInference();
    fusionRef.current = new MultimodalFusion();
    yoloRef.current.init();
    return () => {
      if (yoloRef.current) yoloRef.current.destroy();
      clearInterval(timerRef.current);
      clearInterval(temporalRef.current);
    };
  }, []);

  // ── Countdown helper (writes to refs only — no stale closures) ────────
  const startCountdown = useCallback((seconds, transitionKey) => {
    setStageTimer(seconds);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setStageTimer(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setPendingTransition(transitionKey);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // Stage transition logic — driven by `pendingTransition` state changes.
  // All metric reads come from refs so they are ALWAYS fresh.
  // ═══════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!pendingTransition) return;

    const fusion = fusionRef.current;
    const yolo   = yoloRef.current;

    // ── Stage 1 done → compute S1 + start Stage 2 ─────────────────────
    if (pendingTransition === 'stage1Done') {
      const yoloTemporal = yolo?.getTemporalFeatures?.() || null;
      const s1 = fusion?.computeStage1(
        faceMetricsRef.current,
        voiceMetricsRef.current,
        faceRiskRef.current,
        voiceRiskRef.current,
        yoloTemporal,
        0.6
      );
      setStage1Result(s1);

      // Start Stage 2 — temporal sampling + new countdown
      setPhase('stage2');

      // Begin temporal sampling (reads from refs)
      clearInterval(temporalRef.current);
      temporalRef.current = setInterval(() => {
        fusion?.addTemporalSample(faceMetricsRef.current, voiceMetricsRef.current);
      }, 500);

      startCountdown(STAGE2_DURATION, 'stage2Done');
    }

    // ── Stage 2 done → compute S2 + stop face/voice + start Stage 3 ───
    if (pendingTransition === 'stage2Done') {
      clearInterval(temporalRef.current);

      const yoloTemporal = yolo?.getTemporalFeatures?.() || null;
      const s2 = fusion?.computeStage2(yoloTemporal);
      setStage2Result(s2);

      // Stop face + voice
      setFaceStop(p => p + 1);
      setVoiceStop(p => p + 1);

      // Start Stage 3 — body
      setPhase('stage3');
      setCurrentTaskIdx(0);
      setBodyStart(p => p + 1);
      startCountdown(STAGE3_DURATION, 'stage3Done');
    }

    // ── Stage 3 done → compute S3 + fusion → report ───────────────────
    if (pendingTransition === 'stage3Done') {
      setBodyStop(p => p + 1);

      const yoloFrame = yolo?.processFrame({
        poseLandmarks: null,
        leftHandLandmarks: null,
        rightHandLandmarks: null,
        faceLandmarks: null,
      }) || null;

      const bm = bodyMetricsRef.current || {};
      const s3 = fusion?.computeStage3(bm, null, yoloFrame, null);
      setStage3Result(s3);

      // Enter computing phase briefly for UX polish
      setPhase('computing');
      setTimeout(() => {
        const assessment = fusion?.computeFinalAssessment();
        setFinalAssessment(assessment);
        setPhase('complete');
      }, 1800);
    }

    // Consume the transition
    setPendingTransition(null);
  }, [pendingTransition, startCountdown]);

  // ── Auto-advance body tasks during Stage 3 ────────────────────────────
  useEffect(() => {
    if (phase !== 'stage3') return;
    if (currentTaskIdx >= BODY_TASKS.length) return;

    const dur = BODY_TASKS[currentTaskIdx].durationSec;
    const id = setTimeout(() => setCurrentTaskIdx(p => p + 1), dur * 1000);
    return () => clearTimeout(id);
  }, [phase, currentTaskIdx]);

  // ── YOLO feed (non-invasive, reads from metric refs) ──────────────────
  useEffect(() => {
    if (phase === 'idle' || phase === 'complete' || phase === 'computing') return;
    if (!yoloRef.current?.isReady) return;
    yoloRef.current.processFrame({
      poseLandmarks: null,
      leftHandLandmarks: null,
      rightHandLandmarks: null,
      faceLandmarks: faceMetricsRef.current ? [faceMetricsRef.current] : null,
    });
  }, [faceMetrics, bodyMetrics, phase]);

  // ═══════════════════════════════════════════════════════════════════════
  // Controls
  // ═══════════════════════════════════════════════════════════════════════
  const startWorkflow = useCallback(() => {
    // Reset engines
    fusionRef.current?.reset();
    yoloRef.current?.reset();

    // Reset state
    setStage1Result(null);
    setStage2Result(null);
    setStage3Result(null);
    setFinalAssessment(null);
    setFaceMetrics(null);
    setVoiceMetrics(null);
    setBodyMetrics(null);
    setFaceRiskDisplay(0);
    setVoiceRiskDisplay(0);
    setBodyRiskDisplay(0);
    faceMetricsRef.current = null;
    voiceMetricsRef.current = null;
    bodyMetricsRef.current = null;
    faceRiskRef.current = null;
    voiceRiskRef.current = null;
    bodyRiskRef.current = null;
    setCurrentTaskIdx(0);
    setPendingTransition(null);

    // Start Stage 1
    setPhase('stage1');
    setFaceStart(p => p + 1);
    setVoiceStart(p => p + 1);
    startCountdown(STAGE1_DURATION, 'stage1Done');
  }, [startCountdown]);

  const abortWorkflow = useCallback(() => {
    clearInterval(timerRef.current);
    clearInterval(temporalRef.current);
    setFaceStop(p => p + 1);
    setVoiceStop(p => p + 1);
    setBodyStop(p => p + 1);
    setPhase('idle');
    setStageTimer(0);
    setPendingTransition(null);
  }, []);

  const restartWorkflow = useCallback(() => {
    setPhase('idle');
    setFinalAssessment(null);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // Derived values
  // ═══════════════════════════════════════════════════════════════════════
  const progressPct = useMemo(() => {
    if (phase === 'idle') return 0;
    if (phase === 'complete') return 100;
    if (phase === 'computing') return 95;
    const total = STAGE1_DURATION + STAGE2_DURATION + STAGE3_DURATION;
    let elapsed = 0;
    if (phase === 'stage1') elapsed = STAGE1_DURATION - stageTimer;
    else if (phase === 'stage2') elapsed = STAGE1_DURATION + (STAGE2_DURATION - stageTimer);
    else if (phase === 'stage3') elapsed = STAGE1_DURATION + STAGE2_DURATION + (STAGE3_DURATION - stageTimer);
    return Math.min(Math.round((elapsed / total) * 95), 95);
  }, [phase, stageTimer]);

  const phaseLabels = useMemo(() => ({
    idle: t('Ready to begin', 'தொடங்க தயாராக உள்ளது'),
    stage1: t('Stage 1: Guided Speech + Face Analysis', 'நிலை 1: வழிகாட்டப்பட்ட பேச்சு + முக பகுப்பாய்வு'),
    stage2: t('Stage 2: Temporal Analysis (30 s)', 'நிலை 2: தற்காலிக பகுப்பாய்வு (30 வி.)'),
    stage3: t('Stage 3: Body & Motor Tasks', 'நிலை 3: உடல் & இயக்க பணிகள்'),
    computing: t('Computing assessment…', 'மதிப்பீடு கணக்கிடப்படுகிறது…'),
    complete: t('Assessment Complete', 'மதிப்பீடு முடிந்தது'),
  }), [t]);

  // ── Risk color helper ─────────────────────────────────────────────────
  const getRiskStyle = useCallback((score) => {
    if (score < 20) return { text: 'text-green-700', bg: 'bg-green-500', border: 'border-green-300', label: 'Low' };
    if (score < 40) return { text: 'text-yellow-700', bg: 'bg-yellow-500', border: 'border-yellow-300', label: 'Moderate' };
    if (score < 60) return { text: 'text-orange-700', bg: 'bg-orange-500', border: 'border-orange-300', label: 'Elevated' };
    return { text: 'text-red-700', bg: 'bg-red-500', border: 'border-red-300', label: 'High' };
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════

  // ── Risk Gauge Card ───────────────────────────────────────────────────
  const RiskGauge = ({ label, score, active, done }) => {
    const rs = getRiskStyle(score);
    return (
      <div className={`bg-white rounded-lg p-4 border shadow-sm ${active ? rs.border : done ? 'border-green-300' : 'border-gray-200'} transition-colors`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-600">{label}</span>
          {active && <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full animate-pulse">LIVE</span>}
          {!active && done && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">DONE</span>}
          {!active && !done && <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">WAITING</span>}
        </div>
        <div className={`text-3xl font-bold ${active ? rs.text : done ? 'text-green-700' : 'text-gray-300'}`}>
          {active || done ? score.toFixed(0) : '—'}
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
          <div className={`${active || done ? rs.bg : 'bg-gray-300'} h-2 rounded-full transition-all duration-500`}
            style={{ width: `${active || done ? Math.min(score, 100) : 0}%` }} />
        </div>
        {(active || done) && <span className={`text-xs mt-1 block ${rs.text}`}>{rs.label}</span>}
      </div>
    );
  };

  return (
    <div className="space-y-6">

      {/* ── Header + Progress ──────────────────────────────────────────── */}
      <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
        <h2 className="text-2xl font-bold mb-1 text-gray-900">
          {t('Full Multimodal Assessment', 'முழு பன்முக மதிப்பீடு')}
        </h2>
        <p className="text-gray-500 text-sm mb-4">
          {t(
            'Guided 3-stage behavioral screening — Face + Voice + Body — with YOLO + MediaPipe fusion.',
            'YOLO + MediaPipe இணைப்புடன் முகம் + குரல் + உடல் 3-நிலை நடத்தை திரையிடல்.'
          )}
        </p>

        {/* Progress bar */}
        <div className="mb-3">
          <div className="flex justify-between text-sm text-gray-500 mb-1">
            <span>{phaseLabels[phase]}</span>
            <span>{progressPct}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all duration-500 ${
                phase === 'complete' ? 'bg-green-500' :
                phase === 'computing' ? 'bg-purple-500 animate-pulse' : 'bg-blue-500'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Stage pills */}
        <div className="flex gap-2 mb-4">
          {[
            { key: 'stage1', label: t('Face + Voice', 'முக + குரல்'), done: !!stage1Result },
            { key: 'stage2', label: t('Temporal', 'நேரம்'), done: !!stage2Result },
            { key: 'stage3', label: t('Body', 'உடல்'), done: !!stage3Result },
          ].map(s => (
            <div
              key={s.key}
              className={`flex-1 text-center py-2 rounded-lg text-sm font-medium transition-colors ${
                phase === s.key ? 'bg-blue-600 text-white ring-2 ring-blue-400' :
                s.done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
              }`}
            >
              {s.done ? 'Done - ' : ''}{s.label}
            </div>
          ))}
        </div>

        {/* Timer */}
        {phase !== 'idle' && phase !== 'complete' && phase !== 'computing' && (
          <div className="text-center text-4xl font-mono font-bold text-gray-900 mb-4">
            {stageTimer}<span className="text-lg text-gray-500">s</span>
          </div>
        )}

        {/* Controls */}
        <div className="flex gap-3 justify-center">
          {phase === 'idle' && (
            <button
              onClick={startWorkflow}
              className="bg-green-600 hover:bg-green-700 px-8 py-3 rounded-lg font-semibold transition-colors"
            >
              {t('Begin Full Assessment', 'முழு மதிப்பீடை தொடங்கு')}
            </button>
          )}
          {phase !== 'idle' && phase !== 'complete' && phase !== 'computing' && (
            <button
              onClick={abortWorkflow}
              className="bg-red-600 hover:bg-red-700 px-6 py-3 rounded-lg font-semibold transition-colors"
            >
              {t('Abort', 'நிறுத்து')}
            </button>
          )}
          {phase === 'complete' && (
            <button
              onClick={restartWorkflow}
              className="bg-indigo-600 hover:bg-indigo-700 px-8 py-3 rounded-lg font-semibold transition-colors"
            >
              {t('New Assessment', 'புதிய மதிப்பீடு')}
            </button>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* STAGE 1 & 2 — Face + Voice (full-width panels)                  */}
      {/* ════════════════════════════════════════════════════════════════ */}
      {(phase === 'stage1' || phase === 'stage2') && (
        <div className="space-y-6">

          {/* Instruction banner */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6 text-center">
            {phase === 'stage1' ? (
              <>
                <p className="text-lg text-indigo-700 mb-3">
                  {t(
                    'Please look at the camera and read the following sentence aloud clearly:',
                    'தயவுசெய்து கேமராவைப் பாருங்கள், கீழே உள்ள வாக்கியத்தை சத்தமாக, தெளிவாக படிக்கவும்:'
                  )}
                </p>
                <p className="text-2xl font-bold text-gray-900 italic">
                  &quot;{GUIDED_SENTENCES[language] || GUIDED_SENTENCES.en}&quot;
                </p>
              </>
            ) : (
              <>
                <p className="text-lg text-indigo-700 mb-2">
                  {t(
                    'Keep looking at the camera and speak naturally for the next 30 seconds.',
                    'தயவுசெய்து கேமராவைப் பார்த்துக்கொண்டு 30 விநாடிகளுக்கு இயல்பாக பேசவும்.'
                  )}
                </p>
                <p className="text-sm text-indigo-500">
                  {t(
                    'Talk about anything — your day, a hobby, or describe what you see around you.',
                    'எதைப் பற்றியும் பேசுங்கள் — உங்கள் நாள், பொழுதுபோக்கு, அல்லது உங்களைச் சுற்றி என்ன பார்க்கிறீர்கள்.'
                  )}
                </p>
              </>
            )}
          </div>

          {/* ── Real-time Risk Dashboard ─────────────────────────────── */}
          <div className="grid grid-cols-3 gap-4">
            <RiskGauge label={t('Face Risk', 'முக ஆபத்து')} score={faceRiskDisplay} active={true} done={false} />
            <RiskGauge label={t('Voice Risk', 'குரல் ஆபத்து')} score={voiceRiskDisplay} active={true} done={false} />
            <RiskGauge label={t('Body Risk', 'உடல் ஆபத்து')} score={bodyRiskDisplay} active={false} done={false} />
          </div>

          {/* ── Face Analysis — full width, camera + all metrics ──────── */}
          <div className="bg-white rounded-lg p-5 shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold flex items-center gap-2 text-gray-900">
                {t('Face Analysis', 'முக பகுப்பாய்வு')}
              </h3>
              <span className="text-xs bg-green-600 text-white px-3 py-1 rounded-full animate-pulse font-medium">LIVE</span>
            </div>
            <FaceAnalysis
              onRiskScore={onFaceRisk}
              onMetrics={onFaceMetrics}
              startSignal={faceStart}
              stopSignal={faceStop}
              language={language}
              hideControls
              embedded
            />
          </div>

          {/* ── Voice Analysis — full width, waveform + all metrics ───── */}
          <div className="bg-white rounded-lg p-5 shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold flex items-center gap-2 text-gray-900">
                {t('Voice Analysis', 'குரல் பகுப்பாய்வு')}
              </h3>
              <span className="text-xs bg-green-600 text-white px-3 py-1 rounded-full animate-pulse font-medium">LIVE</span>
            </div>
            <VoiceAnalysis
              onRiskScore={onVoiceRisk}
              onMetrics={onVoiceMetrics}
              startSignal={voiceStart}
              stopSignal={voiceStop}
              language={language}
              hideControls
              embedded
            />
          </div>

          {/* Stage 1 result badge (shown while Stage 2 runs) */}
          {stage1Result && phase === 'stage2' && (
            <div className="bg-white rounded-lg p-5 border border-green-200 shadow-sm">
              <h4 className="text-sm font-semibold text-green-700 mb-3">
                {t('Stage 1 Complete — Results', 'நிலை 1 முடிந்தது — முடிவுகள்')}
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                {[
                  { label: t('Speech Clarity', 'பேச்சு தெளிவு'), val: stage1Result.speech_clarity_score, color: 'text-blue-600' },
                  { label: t('Speech Accuracy', 'பேச்சு துல்லியம்'), val: stage1Result.speech_accuracy_score, color: 'text-purple-600' },
                  { label: t('Facial Stability', 'முக நிலைத்தன்மை'), val: stage1Result.facial_stability_score, color: 'text-cyan-600' },
                  { label: t('Confidence', 'நம்பகத்தன்மை'), val: stage1Result.confidence, color: 'text-green-600' },
                ].map(m => (
                  <div key={m.label} className="bg-gray-50 rounded-lg p-3 text-center border border-gray-200">
                    <span className="text-gray-500 text-xs block mb-1">{m.label}</span>
                    <div className={`text-2xl font-bold ${m.color}`}>{(m.val * 100).toFixed(0)}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* STAGE 3 — Body + Motor Tasks (full-width)                       */}
      {/* ════════════════════════════════════════════════════════════════ */}
      {phase === 'stage3' && (
        <div className="space-y-6">

          {/* Task instructions */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">
            {currentTaskIdx < BODY_TASKS.length ? (
              <>
                <p className="text-sm text-amber-700 mb-2">
                  {t('Motor Task', 'இயக்க பணி')} {currentTaskIdx + 1}/{BODY_TASKS.length}
                </p>
                <p className="text-xl font-bold text-gray-900">
                  {BODY_TASKS[currentTaskIdx][language] || BODY_TASKS[currentTaskIdx].en}
                </p>
                <p className="text-sm text-amber-600 mt-2">
                  {t(
                    `Hold for ~${BODY_TASKS[currentTaskIdx].durationSec} seconds`,
                    `~${BODY_TASKS[currentTaskIdx].durationSec} விநாடிகள் வைத்திருங்கள்`
                  )}
                </p>
              </>
            ) : (
              <p className="text-lg text-green-700 font-semibold">
                {t('All motor tasks completed!', 'அனைத்து இயக்க பணிகளும் முடிந்தன!')}
              </p>
            )}
          </div>

          {/* ── Real-time Risk Dashboard (all 3 modalities) ──────────── */}
          <div className="grid grid-cols-3 gap-4">
            <RiskGauge label={t('Face Risk', 'முக ஆபத்து')} score={faceRiskDisplay} active={false} done={!!stage1Result} />
            <RiskGauge label={t('Voice Risk', 'குரல் ஆபத்து')} score={voiceRiskDisplay} active={false} done={!!stage2Result} />
            <RiskGauge label={t('Body Risk', 'உடல் ஆபத்து')} score={bodyRiskDisplay} active={true} done={false} />
          </div>

          {/* Previous-stage result summaries */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {stage1Result && (
              <div className="bg-white rounded-lg p-4 border border-green-200 shadow-sm">
                <h4 className="text-xs font-semibold text-green-700 mb-2">{t('Stage 1', 'நிலை 1')}</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-gray-500">{t('Clarity', 'தெளிவு')}</span><div className="text-blue-600 font-bold">{(stage1Result.speech_clarity_score * 100).toFixed(0)}%</div></div>
                  <div><span className="text-gray-500">{t('Stability', 'நிலை')}</span><div className="text-cyan-600 font-bold">{(stage1Result.facial_stability_score * 100).toFixed(0)}%</div></div>
                </div>
              </div>
            )}
            {stage2Result && (
              <div className="bg-white rounded-lg p-4 border border-green-200 shadow-sm">
                <h4 className="text-xs font-semibold text-green-700 mb-2">{t('Stage 2', 'நிலை 2')}</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-gray-500">{t('Attention', 'கவனம்')}</span><div className="text-purple-600 font-bold">{(stage2Result.attention_stability * 100).toFixed(0)}%</div></div>
                  <div><span className="text-gray-500">{t('Fatigue', 'சோர்வு')}</span><div className="text-amber-600 font-bold">{stage2Result.fatigue_indicator}</div></div>
                </div>
              </div>
            )}
          </div>

          {/* ── Body & Motor Analysis — full width with detailed output ── */}
          <div className="bg-white rounded-lg p-5 shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold flex items-center gap-2 text-gray-900">
                {t('Body & Motor Analysis', 'உடல் & இயக்க பகுப்பாய்வு')}
              </h3>
              <span className="text-xs bg-green-600 text-white px-3 py-1 rounded-full animate-pulse font-medium">LIVE</span>
            </div>
            <BodyAnalysis
              onMetrics={onBodyMetrics}
              onRiskScore={onBodyRisk}
              startSignal={bodyStart}
              stopSignal={bodyStop}
              language={language}
              hideControls
              embedded
            />
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* COMPUTING spinner                                               */}
      {/* ════════════════════════════════════════════════════════════════ */}
      {phase === 'computing' && (
        <div className="bg-white rounded-lg p-12 text-center shadow-sm border border-gray-200">
          <div className="text-4xl mb-4 animate-spin inline-block">...</div>
          <p className="text-xl text-purple-600 font-semibold">
            {t('Computing multimodal fusion…', 'பன்முக இணைப்பு கணக்கிடப்படுகிறது…')}
          </p>
          <p className="text-sm text-gray-500 mt-2">
            {t(
              'Aggregating face, voice, body, and YOLO outputs with confidence weighting.',
              'முகம், குரல், உடல் மற்றும் YOLO வெளியீடுகளை நம்பகத்தன்மை எடையுடன் ஒருங்கிணைக்கிறது.'
            )}
          </p>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* COMPLETE — Assessment Report                                    */}
      {/* ════════════════════════════════════════════════════════════════ */}
      {phase === 'complete' && finalAssessment && (
        <AssessmentReport assessment={finalAssessment} language={language} />
      )}

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* IDLE — "How It Works" explainer                                  */}
      {/* ════════════════════════════════════════════════════════════════ */}
      {phase === 'idle' && (
        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
          <h3 className="text-xl font-semibold mb-4 text-gray-900">
            {t('How the Full Assessment Works', 'முழு மதிப்பீடு எவ்வாறு செயல்படுகிறது')}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gray-50 rounded-lg p-5 border border-gray-200">
              <h4 className="font-semibold mb-2 text-blue-600">
                {t('Stage 1: Guided Speech', 'நிலை 1: வழிகாட்டப்பட்ட பேச்சு')}
              </h4>
              <p className="text-sm text-gray-500">
                {t(
                  'Read a sentence aloud while face analysis runs simultaneously. Measures speech clarity, pronunciation accuracy, and facial stability.',
                  'முக பகுப்பாய்வு ஒரே நேரத்தில் இயங்கும்போது ஒரு வாக்கியத்தை சத்தமாக படிக்கவும்.'
                )}
              </p>
              <div className="text-xs text-gray-400 mt-2">~{STAGE1_DURATION}s</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-5 border border-gray-200">
              <h4 className="font-semibold mb-2 text-purple-600">
                {t('Stage 2: Temporal Analysis', 'நிலை 2: தற்காலிக பகுப்பாய்வு')}
              </h4>
              <p className="text-sm text-gray-500">
                {t(
                  'Speak naturally for 30 s. The system tracks trends in speech rate, pitch variation, facial expressiveness, and attention over time.',
                  '30 விநாடிகளுக்கு இயல்பாக பேசுங்கள். காலப்போக்கில் போக்குகளை கண்காணிக்கும்.'
                )}
              </p>
              <div className="text-xs text-gray-400 mt-2">~{STAGE2_DURATION}s</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-5 border border-gray-200">
              <h4 className="font-semibold mb-2 text-orange-600">
                {t('Stage 3: Motor Tasks', 'நிலை 3: இயக்க பணிகள்')}
              </h4>
              <p className="text-sm text-gray-500">
                {t(
                  'Follow guided motor tasks: raise hand, thumbs up, finger counting. Measures hand tremor, posture, and motor coordination.',
                  'வழிகாட்டப்பட்ட பணிகளைப் பின்பற்றுங்கள்: கை உயர்த்துதல், விரல் எண்ணுதல்.'
                )}
              </p>
              <div className="text-xs text-gray-400 mt-2">~{STAGE3_DURATION}s</div>
            </div>
          </div>

          {/* Fusion info */}
          <div className="mt-6 bg-gray-50 rounded-lg p-4 text-sm text-gray-500 border border-gray-200">
            <strong className="text-gray-700">{t('Fusion Engine:', 'இணைப்பு இயந்திரம்:')}</strong>{' '}
            {t(
              'All three stages are combined using confidence-weighted multimodal fusion (YOLO + MediaPipe + Speech). No single-frame decisions — only temporally aggregated patterns are reported.',
              'அனைத்து மூன்று நிலைகளும் நம்பகத்தன்மை எடையுடன் இணைக்கப்படுகின்றன. ஒரே பிரேம் முடிவுகள் இல்லை.'
            )}
          </div>

          {/* Disclaimer */}
          <div className="mt-4 bg-gray-800 border border-gray-700 rounded-lg p-4 text-xs text-gray-500">
            <strong className="text-gray-400">{t('Disclaimer', 'மறுப்புரை')}:</strong>{' '}
            {t(
              'This is a behavioral screening tool for performance assessment. It does NOT provide medical diagnosis. Results should be reviewed by a qualified healthcare professional.',
              'இது நடத்தை திரையிடல் கருவி. மருத்துவ நோய் கண்டறிதலை வழங்காது. முடிவுகள் மருத்துவ நிபுணரால் மதிப்பாய்வு செய்யப்பட வேண்டும்.'
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowOrchestrator;
