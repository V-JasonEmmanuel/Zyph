import React, { useState, useEffect } from 'react';

const DemoSection = ({ language = 'en' } = {}) => {
  const [demoMode, setDemoMode] = useState('parkinsons');
  const [isPlaying, setIsPlaying] = useState(false);
  const [demoData, setDemoData] = useState({
    normal: { blinkRate: 15, gazeDeviation: 5, facialAsymmetry: 10, expressivity: 80, tremorIndicators: 5 },
    parkinsons: { blinkRate: 8, gazeDeviation: 15, facialAsymmetry: 35, expressivity: 20, tremorIndicators: 45 },
    alzheimers: { blinkRate: 12, gazeDeviation: 25, facialAsymmetry: 20, expressivity: 30, tremorIndicators: 15 },
    depression: { blinkRate: 10, gazeDeviation: 20, facialAsymmetry: 15, expressivity: 25, tremorIndicators: 10 }
  });

  const t = (en, ta) => (language === 'ta' ? ta : en);

  const demoScenarios = {
    normal: {
      name: t('Healthy Individual', 'ஆரோக்கிய நபர்'),
      description: t('Normal behavioral patterns', 'சாதாரண நடத்தை வடிவங்கள்'),
      risk: 12,
      color: 'green'
    },
    parkinsons: {
      name: t("Parkinson's Disease", 'பார்கின்சன் நோய்'),
      description: t('Reduced facial expressivity, tremors, rigidity', 'முக வெளிப்பாடு குறைவு, குலுக்கல், கடினம்'),
      risk: 68,
      color: 'orange'
    },
    alzheimers: {
      name: t("Alzheimer's Disease", 'அல்சைமர்ஸ் நோய்'),
      description: t('Gaze irregularities, delayed reactions', 'நோக்கு ஒழுங்கின்மை, தாமதமான பிரதிபலிப்பு'),
      risk: 55,
      color: 'yellow'
    },
    depression: {
      name: t('Depression', 'மனஅழுத்தம்'),
      description: t('Flat affect, reduced expressivity', 'மந்தமான உணர்ச்சி வெளிப்பாடு'),
      risk: 42,
      color: 'blue'
    }
  };

  useEffect(() => {
    if (isPlaying) {
      const interval = setInterval(() => {
        setDemoData(prev => {
          const newData = { ...prev };
          const currentMode = demoMode;
          
          // Add realistic variations
          Object.keys(newData[currentMode]).forEach(key => {
            const variation = (Math.random() - 0.5) * 5; // ±2.5% variation
            newData[currentMode][key] = Math.max(0, Math.min(100, 
              newData[currentMode][key] + variation));
          });
          
          return newData;
        });
      }, 500);
      
      return () => clearInterval(interval);
    }
  }, [isPlaying, demoMode]);

  const currentData = demoData[demoMode];
  const currentScenario = demoScenarios[demoMode];

  const getRiskColor = (risk) => {
    if (risk < 20) return 'text-green-400';
    if (risk < 40) return 'text-blue-400';
    if (risk < 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getProgressBarColor = (value) => {
    if (value < 30) return 'bg-green-500';
    if (value < 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold mb-4 text-center">
          {t('AI Disease Detection Demo', 'AI நோய் கண்டறிதல் டெமோ')}
        </h1>
        <p className="text-center text-gray-400 mb-8">
          {t(
            'Simulated behavioral patterns for different neurological conditions',
            'பல்வேறு நரம்பியல் நிலைகளுக்கான உருவக நடத்தை வடிவங்கள்'
          )}
        </p>

        {/* Demo Controls */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {Object.keys(demoScenarios).map((mode) => (
              <button
                key={mode}
                onClick={() => setDemoMode(mode)}
                className={`p-4 rounded-lg border-2 transition-all ${
                  demoMode === mode
                    ? 'border-blue-500 bg-blue-500/20'
                    : 'border-gray-600 hover:border-gray-500'
                }`}
              >
                <div className="font-semibold mb-1">{demoScenarios[mode].name}</div>
                <div className="text-sm text-gray-400">{demoScenarios[mode].description}</div>
                <div className={`text-sm mt-2 font-medium ${getRiskColor(demoScenarios[mode].risk)}`}>
                  {t('Risk', 'அபாயம்')}: {demoScenarios[mode].risk}%
                </div>
              </button>
            ))}
          </div>

          <div className="flex justify-center">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`px-8 py-3 rounded-lg font-semibold transition-colors ${
                isPlaying 
                  ? 'bg-red-600 hover:bg-red-700' 
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {isPlaying ? t('Stop Simulation', 'உருவகத்தை நிறுத்து') : t('Start Simulation', 'உருவகம் தொடங்கு')}
            </button>
          </div>
        </div>

        {/* Current Scenario Display */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-2xl font-bold mb-4 text-center">
            {t('Simulation', 'உருவகம்')}: {currentScenario.name}
          </h2>
          
          {/* Risk Score */}
          <div className="text-center mb-8">
            <div className="text-6xl font-bold mb-2">
              <span className={getRiskColor(currentScenario.risk)}>
                {currentScenario.risk}
              </span>
            </div>
            <div className={`text-xl font-semibold ${getRiskColor(currentScenario.risk)}`}>
              {t('Risk Assessment', 'அபாய மதிப்பீடு')}
            </div>
            {isPlaying && (
              <div className="flex items-center justify-center mt-2">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse mr-2"></div>
                <span className="text-green-500">{t('Simulating Live Data', 'நேரடி தரவை உருவகப்படுத்துகிறது')}</span>
              </div>
            )}
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="bg-gray-700 rounded-lg p-4">
              <h3 className="font-semibold mb-3 text-blue-400">{t('Blink Rate', 'கண் இமைப்பு விகிதம்')}</h3>
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl font-bold">{currentData.blinkRate.toFixed(1)}</span>
                <span className="text-sm text-gray-400">{t('blinks/min', 'இமைப்பு/நிமிடம்')}</span>
              </div>
              <div className="w-full bg-gray-600 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full transition-all duration-500 ${getProgressBarColor(currentData.blinkRate)}`}
                  style={{ width: `${currentData.blinkRate}%` }}
                />
              </div>
              <div className="text-xs text-gray-400 mt-2">
                {t('Normal: 15-20 blinks/min', 'சாதாரணம்: 15-20 இமைப்பு/நிமிடம்')}
              </div>
            </div>

            <div className="bg-gray-700 rounded-lg p-4">
              <h3 className="font-semibold mb-3 text-purple-400">{t('Gaze Deviation', 'நோக்கு விலக்கம்')}</h3>
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl font-bold">{currentData.gazeDeviation.toFixed(1)}</span>
                <span className="text-sm text-gray-400">{t('degrees', 'டிகிரி')}</span>
              </div>
              <div className="w-full bg-gray-600 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full transition-all duration-500 ${getProgressBarColor(currentData.gazeDeviation)}`}
                  style={{ width: `${currentData.gazeDeviation}%` }}
                />
              </div>
              <div className="text-xs text-gray-400 mt-2">
                {t('Normal: <5° deviation', 'சாதாரணம்: <5° விலக்கம்')}
              </div>
            </div>

            <div className="bg-gray-700 rounded-lg p-4">
              <h3 className="font-semibold mb-3 text-orange-400">{t('Facial Asymmetry', 'முக அசமச்சீர்மை')}</h3>
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl font-bold">{currentData.facialAsymmetry.toFixed(1)}</span>
                <span className="text-sm text-gray-400">%</span>
              </div>
              <div className="w-full bg-gray-600 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full transition-all duration-500 ${getProgressBarColor(currentData.facialAsymmetry)}`}
                  style={{ width: `${currentData.facialAsymmetry}%` }}
                />
              </div>
              <div className="text-xs text-gray-400 mt-2">
                {t('Normal: <10% asymmetry', 'சாதாரணம்: <10% அசமச்சீர்மை')}
              </div>
            </div>

            <div className="bg-gray-700 rounded-lg p-4">
              <h3 className="font-semibold mb-3 text-green-400">{t('Expressivity', 'உணர்ச்சி வெளிப்பாடு')}</h3>
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl font-bold">{currentData.expressivity.toFixed(1)}</span>
                <span className="text-sm text-gray-400">%</span>
              </div>
              <div className="w-full bg-gray-600 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full transition-all duration-500 ${getProgressBarColor(100 - currentData.expressivity)}`}
                  style={{ width: `${currentData.expressivity}%` }}
                />
              </div>
              <div className="text-xs text-gray-400 mt-2">
                {t('Normal: >70% expressivity', 'சாதாரணம்: >70% வெளிப்பாடு')}
              </div>
            </div>

            <div className="bg-gray-700 rounded-lg p-4">
              <h3 className="font-semibold mb-3 text-red-400">{t('Tremor Indicators', 'குலுக்கல் குறிகள்')}</h3>
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl font-bold">{currentData.tremorIndicators.toFixed(1)}</span>
                <span className="text-sm text-gray-400">%</span>
              </div>
              <div className="w-full bg-gray-600 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full transition-all duration-500 ${getProgressBarColor(currentData.tremorIndicators)}`}
                  style={{ width: `${currentData.tremorIndicators}%` }}
                />
              </div>
              <div className="text-xs text-gray-400 mt-2">
                {t('Normal: <5% tremors', 'சாதாரணம்: <5% குலுக்கல்')}
              </div>
            </div>

            <div className="bg-gray-700 rounded-lg p-4">
              <h3 className="font-semibold mb-3 text-indigo-400">{t('ML Confidence', 'ML நம்பிக்கை')}</h3>
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl font-bold">
                  {(85 + Math.random() * 10).toFixed(1)}
                </span>
                <span className="text-sm text-gray-400">%</span>
              </div>
              <div className="w-full bg-gray-600 rounded-full h-2">
                <div 
                  className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${85 + Math.random() * 10}%` }}
                />
              </div>
              <div className="text-xs text-gray-400 mt-2">
                Model confidence score
              </div>
            </div>
          </div>
        </div>

        {/* Disease Pattern Analysis */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-2xl font-bold mb-6">{t('Pattern Analysis', 'முறைப் பகுப்பாய்வு')}</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold mb-4 text-blue-400">{t('Key Indicators', 'முக்கிய குறிகள்')}</h3>
              <div className="space-y-3">
                {demoMode === 'parkinsons' && (
                  <>
                    <div className="flex items-center text-sm">
                      <div className="w-2 h-2 bg-orange-500 rounded-full mr-3"></div>
                      <span>{t('Reduced blink rate (hypomimia)', 'இமைப்பு விகிதம் குறைவு (ஹைப்போமீமியா)')}</span>
                    </div>
                    <div className="flex items-center text-sm">
                      <div className="w-2 h-2 bg-orange-500 rounded-full mr-3"></div>
                      <span>{t('Facial rigidity and asymmetry', 'முக கடினத்தன்மை மற்றும் அசமச்சீர்மை')}</span>
                    </div>
                    <div className="flex items-center text-sm">
                      <div className="w-2 h-2 bg-orange-500 rounded-full mr-3"></div>
                      <span>{t('Tremor indicators present', 'குலுக்கல் குறிகள் காணப்படும்')}</span>
                    </div>
                  </>
                )}
                {demoMode === 'alzheimers' && (
                  <>
                    <div className="flex items-center text-sm">
                      <div className="w-2 h-2 bg-yellow-500 rounded-full mr-3"></div>
                      <span>{t('Gaze irregularities and wandering', 'நோக்கு ஒழுங்கின்மை மற்றும் அலைந்து பார்வை')}</span>
                    </div>
                    <div className="flex items-center text-sm">
                      <div className="w-2 h-2 bg-yellow-500 rounded-full mr-3"></div>
                      <span>{t('Delayed reaction times', 'தாமதமான பிரதிபலிப்பு நேரங்கள்')}</span>
                    </div>
                    <div className="flex items-center text-sm">
                      <div className="w-2 h-2 bg-yellow-500 rounded-full mr-3"></div>
                      <span>{t('Reduced facial expressivity', 'முக வெளிப்பாடு குறைவு')}</span>
                    </div>
                  </>
                )}
                {demoMode === 'depression' && (
                  <>
                    <div className="flex items-center text-sm">
                      <div className="w-2 h-2 bg-blue-500 rounded-full mr-3"></div>
                      <span>{t('Flat affect and low expressivity', 'மந்தமான உணர்ச்சி வெளிப்பாடு')}</span>
                    </div>
                    <div className="flex items-center text-sm">
                      <div className="w-2 h-2 bg-blue-500 rounded-full mr-3"></div>
                      <span>{t('Reduced eye contact', 'கண் தொடர்பு குறைவு')}</span>
                    </div>
                    <div className="flex items-center text-sm">
                      <div className="w-2 h-2 bg-blue-500 rounded-full mr-3"></div>
                      <span>{t('Slowed facial movements', 'முக இயக்கம் மந்தமாகும்')}</span>
                    </div>
                  </>
                )}
                {demoMode === 'normal' && (
                  <>
                    <div className="flex items-center text-sm">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                      <span>{t('Normal blink rate (15-20/min)', 'சாதாரண இமைப்பு விகிதம் (15-20/நிமிடம்)')}</span>
                    </div>
                    <div className="flex items-center text-sm">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                      <span>{t('Stable gaze patterns', 'நிலையான பார்வை வடிவங்கள்')}</span>
                    </div>
                    <div className="flex items-center text-sm">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                      <span>{t('Symmetrical facial expressions', 'சமச்சீரான முக வெளிப்பாடுகள்')}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-4 text-purple-400">{t('ML Model Insights', 'ML மாதிரி பார்வைகள்')}</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-300">{t('Feature Importance', 'அம்ச முக்கியத்துவம்')}:</span>
                  <span className="text-purple-400">
                    {demoMode === 'parkinsons'
                      ? t('Tremor (45%)', 'குலுக்கல் (45%)')
                      : demoMode === 'alzheimers'
                      ? t('Gaze (38%)', 'நோக்கு (38%)')
                      : demoMode === 'depression'
                      ? t('Expressivity (42%)', 'வெளிப்பாடு (42%)')
                      : t('Balanced (25% each)', 'சமநிலை (ஒவ்வொன்றும் 25%)')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">{t('Pattern Strength', 'முறையின் வலிமை')}:</span>
                  <span className="text-purple-400">
                    {(currentScenario.risk / 100 * 0.9).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">{t('Anomaly Score', 'அசாதாரண மதிப்பு')}:</span>
                  <span className="text-purple-400">
                    {(currentScenario.risk * 1.2).toFixed(1)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">{t('Classification', 'வகைப்படுத்தல்')}:</span>
                  <span className={`font-medium ${getRiskColor(currentScenario.risk)}`}>
                    {currentScenario.name}
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

export default DemoSection;
