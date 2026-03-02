/**
 * ── Multimodal Fusion Engine ───────────────────────────────────────────────
 *
 * Confidence-weighted aggregation of outputs from:
 *   • Stage 1: Face + Voice (guided sentence)
 *   • Stage 2: Face + Voice (30s temporal analysis)
 *   • Stage 3: Body + Hand (task-based motor assessment)
 *   • YOLO redundant detection layer
 *
 * ⚠️ ETHICAL NOTICE:
 *   This is a BEHAVIORAL SCREENING tool, NOT a medical diagnostic.
 *   All language uses "performance", "behavioral indicators",
 *   "observed patterns", and "screening support".
 *
 * ── Architecture ───────────────────────────────────────────────────────────
 *   1. Each stage produces a normalized output object (scores 0-1)
 *   2. YOLO layer provides redundant confirmation + motion consistency
 *   3. Fusion applies confidence-weighted combination
 *   4. Temporal aggregation prevents single-frame decisions
 *   5. Final assessment is human-readable natural language
 */

// ── Clamp utility ──────────────────────────────────────────────────────────
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

// ── Indicator level from a 0-1 score ──────────────────────────────────────
const levelFromScore = (s) => {
  if (s < 0.3) return 'low';
  if (s < 0.6) return 'medium';
  return 'high';
};

// ── Performance label from a 0-1 overall score ────────────────────────────
const performanceLabel = (s) => {
  if (s >= 0.8) return 'excellent';
  if (s >= 0.6) return 'good';
  if (s >= 0.4) return 'moderate';
  return 'needs attention';
};

class MultimodalFusion {
  constructor() {
    // Weight configuration for each modality
    // These can be adjusted based on which signals are more reliable
    this._weights = {
      stage1_speech: 0.20,
      stage1_face:   0.15,
      stage2_speech: 0.15,
      stage2_face:   0.15,
      stage3_body:   0.20,
      yolo_redundancy: 0.15,
    };

    // Stage results storage
    this._stage1 = null;
    this._stage2 = null;
    this._stage3 = null;
    this._yoloFeatures = null;

    // Temporal buffers
    this._faceSampleBuffer = [];
    this._voiceSampleBuffer = [];
    this._TEMPORAL_WINDOW = 90; // frames
  }

  // ── Stage 1: Face + Voice (guided sentence) ────────────────────────────

  /**
   * Compute Stage 1 output from existing face and voice metrics.
   *
   * @param {Object} faceMetrics    – From FaceAnalysis component
   * @param {Object} voiceMetrics   – From VoiceAnalysis component
   * @param {number} faceRiskScore  – 0-100 risk score from FaceAnalysis
   * @param {number} voiceRiskScore – 0-100 risk score from VoiceAnalysis
   * @param {Object|null} yoloFrame – Current YOLO inference output
   * @param {number} speechAccuracy – 0-1, how closely speech matched target
   * @returns {Object} stage_1 output
   */
  computeStage1(faceMetrics, voiceMetrics, faceRiskScore, voiceRiskScore, yoloFrame, speechAccuracy = 0.5) {
    // ── Speech clarity & accuracy ──────────────────────────────────────
    const pitchVar = (voiceMetrics?.pitchVariation ?? 50) / 100;
    const speechRate = (voiceMetrics?.speechRate ?? 50) / 100;
    const monotonicity = (voiceMetrics?.monotonicity ?? 50) / 100;
    const pauseDuration = (voiceMetrics?.pauseDuration ?? 50) / 100;
    const emotionalValence = (voiceMetrics?.emotionalValence ?? 50) / 100;

    // Clarity: good pitch variation + good speech rate + low pauses
    const speechClarityScore = clamp(
      pitchVar * 0.3 + speechRate * 0.3 + (1 - pauseDuration) * 0.2 + (1 - monotonicity) * 0.2
    );

    // Accuracy: from transcription match (if available)
    const speechAccuracyScore = clamp(speechAccuracy);

    // ── Facial stability ───────────────────────────────────────────────
    const tremorRaw = (faceMetrics?.tremorIndicators ?? 0) / 100;
    const asymmetry = (faceMetrics?.facialAsymmetry ?? 0) / 100;
    const gazeOsc = (faceMetrics?.gazeOscillation ?? 0) / 100;
    const headAbn = (faceMetrics?.headAbnormal ?? 0) / 100;

    const facialStabilityScore = clamp(
      1 - (tremorRaw * 0.35 + asymmetry * 0.25 + gazeOsc * 0.2 + headAbn * 0.2)
    );

    // ── Micro-tremor indicator ─────────────────────────────────────────
    const microTremorIndicator = levelFromScore(tremorRaw);

    // ── Confidence (YOLO-boosted) ──────────────────────────────────────
    let confidence = 0.6; // base confidence
    if (yoloFrame) {
      const yoloConf = yoloFrame.confidence || 0;
      // If YOLO agrees with MediaPipe detection, boost confidence
      confidence = clamp(0.6 + yoloConf * 0.4);
    }
    // More data = higher confidence
    if (faceMetrics && voiceMetrics) confidence = clamp(confidence + 0.1);

    this._stage1 = {
      speech_clarity_score: Math.round(speechClarityScore * 1000) / 1000,
      speech_accuracy_score: Math.round(speechAccuracyScore * 1000) / 1000,
      facial_stability_score: Math.round(facialStabilityScore * 1000) / 1000,
      micro_tremor_indicator: microTremorIndicator,
      confidence: Math.round(confidence * 1000) / 1000,
    };

    return this._stage1;
  }

  // ── Stage 2: Face + Voice (30s temporal analysis) ──────────────────────

  /**
   * Add a temporal sample (called every frame or every few frames during the 30s window).
   */
  addTemporalSample(faceMetrics, voiceMetrics) {
    if (faceMetrics) {
      this._faceSampleBuffer.push({
        ts: Date.now(),
        blinkRate: faceMetrics.blinkRate ?? 0,
        gazeDeviation: faceMetrics.gazeDeviation ?? 0,
        expressivity: faceMetrics.expressivity ?? 0,
        tremorIndicators: faceMetrics.tremorIndicators ?? 0,
        headAbnormal: faceMetrics.headAbnormal ?? 0,
      });
      if (this._faceSampleBuffer.length > this._TEMPORAL_WINDOW) {
        this._faceSampleBuffer.shift();
      }
    }

    if (voiceMetrics) {
      this._voiceSampleBuffer.push({
        ts: Date.now(),
        pitchVariation: voiceMetrics.pitchVariation ?? 0,
        speechRate: voiceMetrics.speechRate ?? 0,
        pauseDuration: voiceMetrics.pauseDuration ?? 0,
        monotonicity: voiceMetrics.monotonicity ?? 0,
        emotionalValence: voiceMetrics.emotionalValence ?? 0,
      });
      if (this._voiceSampleBuffer.length > this._TEMPORAL_WINDOW) {
        this._voiceSampleBuffer.shift();
      }
    }
  }

  /**
   * Compute Stage 2 output from accumulated temporal samples.
   */
  computeStage2(yoloTemporal = null) {
    const faceBuf = this._faceSampleBuffer;
    const voiceBuf = this._voiceSampleBuffer;

    // ── Voice temporal analysis ────────────────────────────────────────
    let speechTemporalScore = 0.5;
    let fatigueIndicator = 'low';

    if (voiceBuf.length >= 5) {
      const halfIdx = Math.floor(voiceBuf.length / 2);
      const firstHalf = voiceBuf.slice(0, halfIdx);
      const secondHalf = voiceBuf.slice(halfIdx);

      const avg = (arr, key) => arr.reduce((s, v) => s + v[key], 0) / arr.length;

      // Speech rate drift: compare first vs second half
      const rateFirst = avg(firstHalf, 'speechRate');
      const rateSecond = avg(secondHalf, 'speechRate');
      const rateDrift = Math.abs(rateSecond - rateFirst) / 100;

      // Pause accumulation: does pausing increase?
      const pauseFirst = avg(firstHalf, 'pauseDuration');
      const pauseSecond = avg(secondHalf, 'pauseDuration');
      const pauseIncrease = Math.max(0, (pauseSecond - pauseFirst)) / 100;

      // Prosody flattening: does pitch variation decline?
      const pitchFirst = avg(firstHalf, 'pitchVariation');
      const pitchSecond = avg(secondHalf, 'pitchVariation');
      const prosodyDecay = Math.max(0, (pitchFirst - pitchSecond)) / 100;

      // Monotonicity increase
      const monoFirst = avg(firstHalf, 'monotonicity');
      const monoSecond = avg(secondHalf, 'monotonicity');
      const monoIncrease = Math.max(0, (monoSecond - monoFirst)) / 100;

      speechTemporalScore = clamp(
        1 - (rateDrift * 0.25 + pauseIncrease * 0.25 + prosodyDecay * 0.25 + monoIncrease * 0.25)
      );

      // Vocal fatigue: combination of rate decline + prosody decay + pause growth
      const fatigueScore = clamp(rateDrift + pauseIncrease + prosodyDecay);
      fatigueIndicator = levelFromScore(fatigueScore);
    }

    // ── Face temporal analysis ─────────────────────────────────────────
    let facialTemporalScore = 0.5;
    let attentionStability = 0.5;

    if (faceBuf.length >= 5) {
      const halfIdx = Math.floor(faceBuf.length / 2);
      const firstHalf = faceBuf.slice(0, halfIdx);
      const secondHalf = faceBuf.slice(halfIdx);

      const avg = (arr, key) => arr.reduce((s, v) => s + v[key], 0) / arr.length;

      // Blink rate trend
      const blinkFirst = avg(firstHalf, 'blinkRate');
      const blinkSecond = avg(secondHalf, 'blinkRate');
      const blinkDrift = Math.abs(blinkSecond - blinkFirst) / 100;

      // Expressiveness decay
      const exprFirst = avg(firstHalf, 'expressivity');
      const exprSecond = avg(secondHalf, 'expressivity');
      const exprDecay = Math.max(0, (exprFirst - exprSecond)) / 100;

      // Involuntary micro-movements (tremor increase)
      const tremorFirst = avg(firstHalf, 'tremorIndicators');
      const tremorSecond = avg(secondHalf, 'tremorIndicators');
      const tremorIncrease = Math.max(0, (tremorSecond - tremorFirst)) / 100;

      // Gaze consistency
      const gazeFirst = avg(firstHalf, 'gazeDeviation');
      const gazeSecond = avg(secondHalf, 'gazeDeviation');
      const gazeInconsistency = Math.abs(gazeSecond - gazeFirst) / 100;

      facialTemporalScore = clamp(
        1 - (blinkDrift * 0.2 + exprDecay * 0.3 + tremorIncrease * 0.3 + gazeInconsistency * 0.2)
      );

      // Attention stability: low gaze deviation + stable blink = high attention
      const avgGaze = avg(faceBuf, 'gazeDeviation') / 100;
      const avgHead = avg(faceBuf, 'headAbnormal') / 100;
      attentionStability = clamp(1 - (avgGaze * 0.5 + avgHead * 0.3 + blinkDrift * 0.2));
    }

    // YOLO redundancy check
    if (yoloTemporal) {
      // Boost or reduce based on YOLO motion consistency
      const yoloMotion = yoloTemporal.motionConsistency || 0.5;
      facialTemporalScore = clamp(facialTemporalScore * 0.8 + yoloMotion * 0.2);
    }

    this._stage2 = {
      speech_temporal_score: Math.round(speechTemporalScore * 1000) / 1000,
      facial_temporal_score: Math.round(facialTemporalScore * 1000) / 1000,
      attention_stability: Math.round(attentionStability * 1000) / 1000,
      fatigue_indicator: fatigueIndicator,
    };

    return this._stage2;
  }

  // ── Stage 3: Body + Hand tasks ─────────────────────────────────────────

  /**
   * Compute Stage 3 output from existing BodyAnalysis metrics + task results.
   *
   * @param {Object} bodyMetrics – From BodyAnalysis component
   * @param {Object|null} taskResult – From BodyAnalysis guided task
   * @param {Object|null} yoloFrame – Current YOLO inference output (pose)
   * @param {Array|null} gestureResults – Results from gesture tasks
   * @returns {Object} stage_3 output
   */
  computeStage3(bodyMetrics, taskResult = null, yoloFrame = null, gestureResults = null) {
    // ── Hand tremor ────────────────────────────────────────────────────
    const leftTremor = (bodyMetrics?.leftHandTremor ?? 0) / 100;
    const rightTremor = (bodyMetrics?.rightHandTremor ?? 0) / 100;
    const avgTremor = (leftTremor + rightTremor) / 2;

    // Combine with task result if available
    let handTremorScore = clamp(1 - avgTremor);
    if (taskResult) {
      const taskTremor = (taskResult.tremorScore ?? 0) / 100;
      handTremorScore = clamp(1 - (avgTremor * 0.5 + taskTremor * 0.5));
    }

    // ── Gesture accuracy ───────────────────────────────────────────────
    let gestureAccuracy = 0.5;
    if (gestureResults && gestureResults.length > 0) {
      const totalAcc = gestureResults.reduce((s, g) => s + (g.accuracy || 0), 0);
      gestureAccuracy = clamp(totalAcc / gestureResults.length);
    } else if (taskResult) {
      // Fall back to coordination score from body task
      gestureAccuracy = clamp((taskResult.coordination ?? 50) / 100);
    }

    // ── Posture stability ──────────────────────────────────────────────
    const postureScore = (bodyMetrics?.postureScore ?? 50) / 100;
    const bodySway = (bodyMetrics?.bodySway ?? 0) / 100;
    const shoulderTilt = (bodyMetrics?.shoulderTilt ?? 0) / 100;
    const slouch = (bodyMetrics?.slouch ?? 0) / 100;

    const postureStability = clamp(
      postureScore * 0.4 + (1 - bodySway) * 0.3 + (1 - shoulderTilt) * 0.15 + (1 - slouch) * 0.15
    );

    // ── Motor control indicator ────────────────────────────────────────
    const motorScore = (handTremorScore + gestureAccuracy + postureStability) / 3;
    let motorControlIndicator = 'stable';
    if (motorScore < 0.4) motorControlIndicator = 'unstable';
    else if (motorScore < 0.7) motorControlIndicator = 'variable';

    // ── YOLO redundancy ────────────────────────────────────────────────
    if (yoloFrame?.pose) {
      // Cross-validate posture with YOLO
      const yoloPosture = yoloFrame.pose.postureQuality || 0.5;
      // Weighted average: existing posture 70%, YOLO 30%
      const fusedPosture = postureStability * 0.7 + yoloPosture * 0.3;
      // Only update if YOLO has reasonable confidence
      if (yoloFrame.pose.confidence > 0.3) {
        this._stage3 = {
          hand_tremor_score: Math.round(handTremorScore * 1000) / 1000,
          gesture_accuracy: Math.round(gestureAccuracy * 1000) / 1000,
          posture_stability: Math.round(clamp(fusedPosture) * 1000) / 1000,
          motor_control_indicator: motorControlIndicator,
        };
        return this._stage3;
      }
    }

    this._stage3 = {
      hand_tremor_score: Math.round(handTremorScore * 1000) / 1000,
      gesture_accuracy: Math.round(gestureAccuracy * 1000) / 1000,
      posture_stability: Math.round(postureStability * 1000) / 1000,
      motor_control_indicator: motorControlIndicator,
    };

    return this._stage3;
  }

  // ── Final Combined Assessment ──────────────────────────────────────────

  /**
   * Produce the final user-friendly assessment by fusing all three stages.
   * Requires all stages to have been computed.
   *
   * @returns {Object|null} Final assessment or null if stages incomplete
   */
  computeFinalAssessment() {
    if (!this._stage1 || !this._stage2 || !this._stage3) {
      return null;
    }

    const s1 = this._stage1;
    const s2 = this._stage2;
    const s3 = this._stage3;

    // ── Weighted fusion ────────────────────────────────────────────────
    const w = this._weights;

    // Speech composite (Stage 1 + Stage 2)
    const speechScore = clamp(
      (s1.speech_clarity_score * 0.4 + s1.speech_accuracy_score * 0.3 + s2.speech_temporal_score * 0.3)
    );

    // Face composite (Stage 1 + Stage 2)
    const faceScore = clamp(
      (s1.facial_stability_score * 0.4 + s2.facial_temporal_score * 0.35 + s2.attention_stability * 0.25)
    );

    // Body composite (Stage 3)
    const bodyScore = clamp(
      (s3.hand_tremor_score * 0.35 + s3.gesture_accuracy * 0.30 + s3.posture_stability * 0.35)
    );

    // Overall weighted score
    const overallScore = clamp(
      speechScore * (w.stage1_speech + w.stage2_speech) +
      faceScore * (w.stage1_face + w.stage2_face) +
      bodyScore * w.stage3_body +
      (s1.confidence * w.yolo_redundancy) // YOLO confidence factor
    );

    // ── Strengths & areas to improve ───────────────────────────────────
    // NOTE: These are "performance" and "behavioral" terms, NOT medical.
    const allMetrics = [
      { name: 'speech clarity', score: speechScore },
      { name: 'facial stability', score: faceScore },
      { name: 'postural control', score: bodyScore },
      { name: 'attention consistency', score: s2.attention_stability },
      { name: 'hand steadiness', score: s3.hand_tremor_score },
      { name: 'gesture accuracy', score: s3.gesture_accuracy },
      { name: 'speech pacing', score: s2.speech_temporal_score },
    ];

    const strengths = allMetrics
      .filter(m => m.score >= 0.7)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(m => m.name);

    const areasToImprove = allMetrics
      .filter(m => m.score < 0.5)
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map(m => m.name);

    // ── Behavioral summary ─────────────────────────────────────────────
    // NOTE: This is screening support language only, NOT diagnosis.
    const perf = performanceLabel(overallScore);
    let summary = '';

    if (perf === 'excellent') {
      summary = 'All assessed behavioral indicators are within expected ranges. ' +
        'Speech, facial expression, and motor control patterns show consistent performance. ' +
        'No areas of concern were observed during this screening session.';
    } else if (perf === 'good') {
      summary = 'Most behavioral indicators show good performance. ' +
        (areasToImprove.length > 0
          ? `Minor variability was noted in ${areasToImprove.join(' and ')}. `
          : '') +
        'Overall patterns are within typical ranges for this screening.';
    } else if (perf === 'moderate') {
      summary = 'Some behavioral indicators show moderate variability. ' +
        (areasToImprove.length > 0
          ? `Observed patterns in ${areasToImprove.join(', ')} may benefit from further evaluation. `
          : '') +
        'These observations are screening indicators and should be reviewed by a professional.';
    } else {
      summary = 'Several behavioral indicators show notable variability that may warrant attention. ' +
        (areasToImprove.length > 0
          ? `Particular patterns were observed in ${areasToImprove.join(', ')}. `
          : '') +
        'This screening suggests a follow-up evaluation may be beneficial. ' +
        'These are observed patterns only and do not constitute a diagnosis.';
    }

    // ── Confidence ─────────────────────────────────────────────────────
    const avgConfidence = clamp(
      s1.confidence * 0.4 + // Stage 1 has YOLO factor
      (this._faceSampleBuffer.length > 20 ? 0.3 : 0.15) + // temporal depth
      (this._stage3 ? 0.3 : 0.1) // body stage completed
    );

    return {
      overall_performance: perf,
      overall_score: Math.round(overallScore * 1000) / 1000,
      strengths: strengths.length > 0 ? strengths : ['no strong indicators identified'],
      areas_to_improve: areasToImprove.length > 0 ? areasToImprove : ['none identified'],
      behavioral_summary: summary,
      confidence_score: Math.round(avgConfidence * 1000) / 1000,
      stage_results: {
        stage1: s1,
        stage2: s2,
        stage3: s3,
      },
      // Detailed modality scores for display (0-1 floats)
      modality_scores: {
        speech: Math.round(speechScore * 1000) / 1000,
        face: Math.round(faceScore * 1000) / 1000,
        body: Math.round(bodyScore * 1000) / 1000,
      },
    };
  }

  /**
   * Reset all internal state for a new assessment session.
   */
  reset() {
    this._stage1 = null;
    this._stage2 = null;
    this._stage3 = null;
    this._yoloFeatures = null;
    this._faceSampleBuffer = [];
    this._voiceSampleBuffer = [];
  }

  /**
   * Get the current state of all stages (for progress display).
   */
  getProgress() {
    return {
      stage1Complete: this._stage1 !== null,
      stage2Complete: this._stage2 !== null,
      stage3Complete: this._stage3 !== null,
      faceSamples: this._faceSampleBuffer.length,
      voiceSamples: this._voiceSampleBuffer.length,
    };
  }
}

export default MultimodalFusion;
