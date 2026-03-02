/**
 * ── Assessment Report UI ────────────────────────────────────────────────────
 *
 * Displays the final multimodal assessment in a user-friendly format.
 * Shows overall performance, strengths, areas to improve, behavioral summary,
 * and per-stage breakdowns.
 *
 * NOTE: Uses ethical language throughout — "performance", "observed patterns",
 *    "behavioral indicators", never "diagnosis" or "disease prediction".
 */

import React, { useMemo, useCallback } from 'react';

const AssessmentReport = ({ assessment, language = 'en' }) => {
  const t = useCallback((en, ta) => (language === 'ta' ? ta : en), [language]);

  if (!assessment) return null;

  const {
    overall_performance = 'Unknown',
    overall_score = 0,
    strengths = [],
    areas_to_improve = [],
    behavioral_summary = '',
    confidence_score = 0,
    stage_results = {},
    modality_scores = {},
  } = assessment;

  // ── Color helpers ─────────────────────────────────────────────────────
  const performanceColor = useMemo(() => {
    const p = overall_performance.toLowerCase();
    if (p === 'strong' || p === 'excellent') return 'green';
    if (p === 'moderate' || p === 'good') return 'yellow';
    if (p === 'needs attention') return 'orange';
    return 'red';
  }, [overall_performance]);

  const colorClasses = {
    green: { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700', bar: 'bg-green-500' },
    yellow: { bg: 'bg-yellow-50', border: 'border-yellow-300', text: 'text-yellow-700', bar: 'bg-yellow-500' },
    orange: { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-700', bar: 'bg-orange-500' },
    red: { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', bar: 'bg-red-500' },
  };

  const c = colorClasses[performanceColor] || colorClasses.green;

  const scoreColor = (score) => {
    if (score >= 0.75) return 'text-green-700';
    if (score >= 0.5) return 'text-yellow-700';
    if (score >= 0.25) return 'text-orange-700';
    return 'text-red-700';
  };

  const barColor = (score) => {
    if (score >= 0.75) return 'bg-green-500';
    if (score >= 0.5) return 'bg-yellow-500';
    if (score >= 0.25) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <div className="space-y-6">
      {/* ── Overall Performance Card ───────────────────────────────────── */}
      <div className={`${c.bg} border ${c.border} rounded-lg p-6`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {t('Assessment Results', 'மதிப்பீட்டு முடிவுகள்')}
            </h2>
            <p className="text-gray-500 text-sm mt-1">
              {t('Multimodal behavioral screening assessment', 'பன்முக நடத்தை திரையிடல் மதிப்பீடு')}
            </p>
          </div>
          <div className="text-right">
            <div className={`text-4xl font-bold ${c.text}`}>
              {(overall_score * 100).toFixed(0)}%
            </div>
            <div className={`text-sm font-medium ${c.text}`}>
              {overall_performance}
            </div>
          </div>
        </div>

        {/* Overall score bar */}
        <div className="w-full bg-gray-200 rounded-full h-4 mb-2">
          <div
            className={`h-4 rounded-full ${c.bar} transition-all duration-1000`}
            style={{ width: `${overall_score * 100}%` }}
          />
        </div>

        {/* Confidence */}
        <p className="text-xs text-gray-400 text-right">
          {t('Confidence', 'நம்பகத்தன்மை')}: {(confidence_score * 100).toFixed(0)}%
        </p>
      </div>

      {/* ── Behavioral Summary ─────────────────────────────────────────── */}
      {behavioral_summary && (
        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
          <h3 className="text-lg font-semibold mb-3 text-gray-900">
            {t('Behavioral Summary', 'நடத்தை சுருக்கம்')}
          </h3>
          <p className="text-gray-600 leading-relaxed">{behavioral_summary}</p>
        </div>
      )}

      {/* ── Strengths & Areas to Improve ───────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Strengths */}
        <div className="bg-white rounded-lg p-6 border-l-4 border-green-500 shadow-sm">
          <h3 className="text-lg font-semibold mb-3 text-green-700">
            {t('Strengths', 'பலங்கள்')}
          </h3>
          {strengths.length > 0 ? (
            <ul className="space-y-2">
              {strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="text-green-600 mt-0.5">-</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">
              {t('No significant strengths identified', 'குறிப்பிடத்தக்க பலங்கள் கண்டறியப்படவில்லை')}
            </p>
          )}
        </div>

        {/* Areas to Improve */}
        <div className="bg-white rounded-lg p-6 border-l-4 border-amber-500 shadow-sm">
          <h3 className="text-lg font-semibold mb-3 text-amber-700">
            {t('Areas to Improve', 'மேம்படுத்த வேண்டிய பகுதிகள்')}
          </h3>
          {areas_to_improve.length > 0 ? (
            <ul className="space-y-2">
              {areas_to_improve.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="text-amber-600 mt-0.5">-</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">
              {t('No significant areas flagged', 'குறிப்பிடத்தக்க பகுதிகள் கண்டறியப்படவில்லை')}
            </p>
          )}
        </div>
      </div>

      {/* ── Modality Scores ────────────────────────────────────────────── */}
      {modality_scores && Object.keys(modality_scores).length > 0 && (
        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
          <h3 className="text-lg font-semibold mb-4 text-gray-900">
            {t('Modality Scores', 'வகை மதிப்பெண்கள்')}
          </h3>
          <div className="space-y-4">
            {Object.entries(modality_scores).map(([key, score]) => (
              <div key={key}>
                <div className="flex justify-between mb-1 text-sm">
                  <span className="text-gray-500 capitalize">
                    {key === 'face' ? t('Face Analysis', 'முக பகுப்பாய்வு') :
                     key === 'voice' ? t('Voice Analysis', 'குரல் பகுப்பாய்வு') :
                     key === 'body' ? t('Body & Motor', 'உடல் & இயக்கம்') :
                     key === 'yolo' ? t('Redundant Detection (YOLO)', 'YOLO கண்டறிதல்') :
                     key}
                  </span>
                  <span className={scoreColor(score)}>{(score * 100).toFixed(0)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full ${barColor(score)} transition-all duration-700`}
                    style={{ width: `${score * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Per-Stage Breakdown ────────────────────────────────────────── */}
      {stage_results && Object.keys(stage_results).length > 0 && (
        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
          <h3 className="text-lg font-semibold mb-4 text-gray-900">
            {t('Per-Stage Results', 'நிலை வாரியான முடிவுகள்')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Stage 1 */}
            {stage_results.stage1 && (
              <StageCard
                title={t('Stage 1: Guided Speech', 'நிலை 1: வழிகாட்டப்பட்ட பேச்சு')}
                data={stage_results.stage1}
                t={t}
                labels={{
                  speech_clarity_score: t('Speech Clarity', 'பேச்சு தெளிவு'),
                  speech_accuracy_score: t('Speech Accuracy', 'பேச்சு துல்லியம்'),
                  facial_stability_score: t('Facial Stability', 'முக நிலைத்தன்மை'),
                  micro_tremor_indicator: t('Micro-Tremor', 'நுண் நடுக்கம்'),
                  confidence: t('Confidence', 'நம்பகத்தன்மை'),
                }}
              />
            )}
            {/* Stage 2 */}
            {stage_results.stage2 && (
              <StageCard
                title={t('Stage 2: Temporal', 'நிலை 2: நேரம்')}
                data={stage_results.stage2}
                t={t}
                labels={{
                  speech_temporal_score: t('Speech Over Time', 'பேச்சு நேர போக்கு'),
                  facial_temporal_score: t('Face Over Time', 'முக நேர போக்கு'),
                  attention_stability: t('Attention', 'கவனம்'),
                  fatigue_indicator: t('Fatigue', 'சோர்வு'),
                }}
              />
            )}
            {/* Stage 3 */}
            {stage_results.stage3 && (
              <StageCard
                title={t('Stage 3: Motor Tasks', 'நிலை 3: இயக்கம்')}
                data={stage_results.stage3}
                t={t}
                labels={{
                  hand_tremor_score: t('Hand Tremor', 'கை நடுக்கம்'),
                  gesture_accuracy: t('Gesture Accuracy', 'சைகை துல்லியம்'),
                  posture_stability: t('Posture', 'தோற்றம்'),
                  motor_control_indicator: t('Motor Control', 'இயக்க கட்டுப்பாடு'),
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Ethical Disclaimer ─────────────────────────────────────────── */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-500">
        <strong className="text-gray-700">{t('Important Notice', 'முக்கிய அறிவிப்பு')}:</strong>{' '}
        {t(
          'This assessment reports observed behavioral patterns only. It is NOT a medical diagnosis. These results are intended for screening support and should be reviewed by a qualified healthcare professional before any clinical decisions are made. No single indicator should be interpreted in isolation.',
          'இந்த மதிப்பீடு கவனிக்கப்பட்ட நடத்தை முறைகளை மட்டுமே அறிவிக்கிறது. இது மருத்துவ நோய் கண்டறிதல் அல்ல. முடிவுகள் தகுதி வாய்ந்த மருத்துவ நிபுணரால் மதிப்பாய்வு செய்யப்பட வேண்டும்.'
        )}
      </div>
    </div>
  );
};

// ── Stage Card sub-component ────────────────────────────────────────────────
const StageCard = ({ title, data, labels }) => {
  if (!data) return null;

  const scoreColor = (val) => {
    if (typeof val === 'string') return 'text-gray-600';
    if (val >= 0.75) return 'text-green-700';
    if (val >= 0.5) return 'text-yellow-700';
    if (val >= 0.25) return 'text-orange-700';
    return 'text-red-700';
  };

  const formatValue = (val) => {
    if (typeof val === 'number') return `${(val * 100).toFixed(0)}%`;
    if (typeof val === 'string') return val;
    return String(val);
  };

  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
      <div className="flex items-center gap-2 mb-3">
        <h4 className="font-semibold text-sm text-gray-900">{title}</h4>
      </div>
      <div className="space-y-2">
        {Object.entries(data).map(([key, val]) => {
          const label = labels[key] || key;
          return (
            <div key={key} className="flex justify-between text-sm">
              <span className="text-gray-500">{label}</span>
              <span className={`font-medium ${scoreColor(val)}`}>
                {formatValue(val)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AssessmentReport;
