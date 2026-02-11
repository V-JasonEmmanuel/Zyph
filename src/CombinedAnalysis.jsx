import React, { useMemo, useState, useRef, useEffect } from 'react';
import FaceAnalysis from './FaceAnalysis';
import VoiceAnalysis from './VoiceAnalysis';
import DemoSection from './DemoSection';

const CombinedAnalysis = () => {
  const [activeTab, setActiveTab] = useState('face');
  const [language, setLanguage] = useState('en');
  const [faceRisk, setFaceRisk] = useState(null);
  const [voiceRisk, setVoiceRisk] = useState(null);
  const [faceMetrics, setFaceMetrics] = useState(null);
  const [voiceMetrics, setVoiceMetrics] = useState(null);
  const [faceStartSignal, setFaceStartSignal] = useState(0);
  const [voiceStartSignal, setVoiceStartSignal] = useState(0);
  const [sequenceStatus, setSequenceStatus] = useState('idle');
  const sequenceTimerRef = useRef(null);
  const [intake, setIntake] = useState({
    age: '',
    diagnosis: '',
    sleepQuality: '',
    memoryChanges: '',
    speechChanges: '',
    medications: ''
  });

  const combinedRisk = useMemo(() => {
    const face = typeof faceRisk === 'number' ? faceRisk : null;
    const voice = typeof voiceRisk === 'number' ? voiceRisk : null;
    const overall = face != null && voice != null ? (face + voice) / 2 : null;
    return { face, voice, overall };
  }, [faceRisk, voiceRisk]);

  const t = (en, ta) => (language === 'ta' ? ta : en);

  const tabs = [
    { id: 'face', label: t('Face Analysis', 'முக பகுப்பாய்வு'), icon: '👤' },
    { id: 'voice', label: t('Voice Analysis', 'குரல் பகுப்பாய்வு'), icon: '🎤' },
    { id: 'demo', label: t('Demo Mode', 'டெமோ'), icon: '🎭' },
    { id: 'combined', label: t('Combined Assessment', 'ஒருங்கிணைந்த மதிப்பீடு'), icon: '📊' },
    { id: 'about', label: t('About', 'பற்றி'), icon: 'ℹ️' }
  ];

  const aboutDiseases = [
    {
      id: 'parkinsons',
      titleEn: "Parkinson's Disease",
      titleTa: 'பார்கின்சன் நோய்',
      summaryEn: 'A brain condition that affects movement, causing tremor, stiffness, and slow motion.',
      summaryTa: 'இது இயக்கத்தை பாதிக்கும் மூளை நிலை; குலுக்கல், கடினம், மந்தமான இயக்கம் ஏற்படும்.'
    },
    {
      id: 'alzheimers',
      titleEn: "Alzheimer's Disease",
      titleTa: 'அல்சைமர்ஸ் நோய்',
      summaryEn: 'A progressive memory and thinking disorder that impacts daily life.',
      summaryTa: 'நினைவாற்றல் மற்றும் சிந்தனை திறன் மெதுவாக குறையும் நிலை; தினசரி செயல்களில் பாதிப்பு.'
    },
    {
      id: 'depression',
      titleEn: 'Depression',
      titleTa: 'மனஅழுத்தம்',
      summaryEn: 'A mental health condition with low mood, reduced energy, and changes in speech or expression.',
      summaryTa: 'மனநிலை குறைவு, சக்தி குறைவு, பேச்சு/முகபாவ மாற்றங்கள் போன்றவை காணப்படும் நிலை.'
    },
    {
      id: 'mci',
      titleEn: 'Mild Cognitive Impairment (MCI)',
      titleTa: 'லேசான அறிவாற்றல் குறைவு',
      summaryEn: 'Noticeable memory or thinking changes that are more than normal aging.',
      summaryTa: 'சாதாரண வயதானதைக் காட்டிலும் அதிகமான நினைவு அல்லது சிந்தனை மாற்றங்கள்.'
    }
  ];

  const updateIntake = (field) => (event) => {
    const value = event.target.value;
    setIntake((prev) => ({ ...prev, [field]: value }));
  };

  const startCombinedAnalysis = () => {
    setSequenceStatus('face');
    setActiveTab('face');
    setFaceStartSignal((prev) => prev + 1);

    if (sequenceTimerRef.current) {
      clearTimeout(sequenceTimerRef.current);
    }

    sequenceTimerRef.current = setTimeout(() => {
      setSequenceStatus('voice');
      setActiveTab('voice');
      setVoiceStartSignal((prev) => prev + 1);
    }, 6000);
  };

  const skipToVoice = () => {
    if (sequenceTimerRef.current) {
      clearTimeout(sequenceTimerRef.current);
    }
    setSequenceStatus('voice');
    setActiveTab('voice');
    setVoiceStartSignal((prev) => prev + 1);
  };

  useEffect(() => {
    return () => {
      if (sequenceTimerRef.current) {
        clearTimeout(sequenceTimerRef.current);
      }
    };
  }, []);

  const getOverallRiskLevel = (score) => {
    if (score < 20) return { level: 'Low', color: 'text-green-400', bg: 'bg-green-900' };
    if (score < 40) return { level: 'Moderate', color: 'text-yellow-400', bg: 'bg-yellow-900' };
    if (score < 60) return { level: 'Elevated', color: 'text-orange-400', bg: 'bg-orange-900' };
    return { level: 'High', color: 'text-red-400', bg: 'bg-red-900' };
  };

  const overallRiskInfo = getOverallRiskLevel(combinedRisk.overall ?? 0);

  const fmt = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : 'N/A');

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-center md:text-left">
              <h1 className="text-3xl font-bold">
                {t('Preventive AI - Behavioral Analysis System', 'Preventive AI - நடத்தை பகுப்பாய்வு அமைப்பு')}
              </h1>
              <p className="text-gray-400 mt-2">
                {t(
                  'Real-time face and voice analysis for early disease detection',
                  'ஆரம்ப கட்ட கண்டறிதலுக்கான முக மற்றும் குரல் பகுப்பாய்வு'
                )}
              </p>
            </div>
            <button
              onClick={() => setLanguage((prev) => (prev === 'en' ? 'ta' : 'en'))}
              className="mx-auto md:mx-0 px-4 py-2 rounded-full bg-gray-700 hover:bg-gray-600 text-sm font-semibold"
            >
              {language === 'en' ? 'தமிழ்' : 'English'}
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex space-x-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-6 py-3 font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className={activeTab === 'face' ? 'block' : 'hidden'}>
          <FaceAnalysis
            onRiskScore={setFaceRisk}
            onMetrics={setFaceMetrics}
            startSignal={faceStartSignal}
            language={language}
          />
        </div>
        <div className={activeTab === 'voice' ? 'block' : 'hidden'}>
          <VoiceAnalysis
            onRiskScore={setVoiceRisk}
            onMetrics={setVoiceMetrics}
            startSignal={voiceStartSignal}
            language={language}
          />
        </div>
        {activeTab === 'demo' && <DemoSection />}
        
        {activeTab === 'combined' && (
          <div className="space-y-8">
            {/* Start Analyze + Intake */}
            <div className="bg-gray-800 rounded-lg p-8">
              <h2 className="text-2xl font-bold mb-4 text-center">
                {t('Start Analyze', 'பகுப்பாய்வு தொடங்கு')}
              </h2>
              <p className="text-center text-gray-400 mb-6">
                {t(
                  'Face analysis starts first, then voice analysis begins after a short baseline capture.',
                  'முதலில் முக பகுப்பாய்வு தொடங்கும்; சிறிய அடிப்படை நேரத்திற்குப் பிறகு குரல் பகுப்பாய்வு தொடங்கும்.'
                )}
              </p>
              <div className="flex flex-col md:flex-row gap-4 justify-center">
                <button
                  onClick={startCombinedAnalysis}
                  className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-semibold transition-colors"
                >
                  {t('Start Analyze', 'பகுப்பாய்வு தொடங்கு')}
                </button>
                <button
                  onClick={skipToVoice}
                  className="bg-purple-600 hover:bg-purple-700 px-6 py-3 rounded-lg font-semibold transition-colors"
                >
                  {t('Skip to Voice', 'குரலுக்கு செல்லவும்')}
                </button>
              </div>
              <div className="mt-3 text-center text-xs text-gray-500">
                {t(
                  'We will open the camera view when analysis starts.',
                  'பகுப்பாய்வு தொடங்கும் போது கேமரா பார்வை திறக்கப்படும்.'
                )}
              </div>
              <div className="mt-4 text-center text-sm text-gray-400">
                {sequenceStatus === 'face' && t('Capturing face baseline...', 'முக அடிப்படை தரவு பதிவு செய்கிறது...')}
                {sequenceStatus === 'voice' && t('Voice analysis started.', 'குரல் பகுப்பாய்வு தொடங்கியது.')}
                {sequenceStatus === 'idle' && t('Ready to start.', 'தொடங்க தயாராக உள்ளது.')}
              </div>

              <div className="mt-8 border-t border-gray-700 pt-6">
                <h3 className="text-xl font-semibold mb-2">
                  {t('Health Questions', 'ஆரோக்கிய கேள்விகள்')}
                </h3>
                <p className="text-gray-400 mb-6">
                  {t(
                    'These details help personalize face and voice analysis.',
                    'இந்த தகவல்கள் முக மற்றும் குரல் பகுப்பாய்வை மேம்படுத்த உதவும்.'
                  )}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm text-gray-300 mb-2">{t('Age', 'வயது')}</label>
                    <input
                      type="number"
                      value={intake.age}
                      onChange={updateIntake('age')}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
                      placeholder={t('e.g., 45', 'உதா., 45')}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-2">{t('Known diagnosis', 'தெரிந்த நோய்')}</label>
                    <input
                      type="text"
                      value={intake.diagnosis}
                      onChange={updateIntake('diagnosis')}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
                      placeholder={t('e.g., None', 'உதா., இல்லை')}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-2">{t('Sleep quality', 'உறக்க தரம்')}</label>
                    <select
                      value={intake.sleepQuality}
                      onChange={updateIntake('sleepQuality')}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
                    >
                      <option value="">{t('Select', 'தேர்வு')}</option>
                      <option value="good">{t('Good', 'நல்லது')}</option>
                      <option value="ok">{t('Okay', 'சராசரி')}</option>
                      <option value="poor">{t('Poor', 'குறைவு')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-2">{t('Memory changes?', 'நினைவில் மாற்றம்?')}</label>
                    <select
                      value={intake.memoryChanges}
                      onChange={updateIntake('memoryChanges')}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
                    >
                      <option value="">{t('Select', 'தேர்வு')}</option>
                      <option value="no">{t('No', 'இல்லை')}</option>
                      <option value="some">{t('Some', 'சிறிது')}</option>
                      <option value="yes">{t('Yes', 'ஆம்')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-2">{t('Speech changes?', 'பேச்சில் மாற்றம்?')}</label>
                    <select
                      value={intake.speechChanges}
                      onChange={updateIntake('speechChanges')}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
                    >
                      <option value="">{t('Select', 'தேர்வு')}</option>
                      <option value="no">{t('No', 'இல்லை')}</option>
                      <option value="slower">{t('Slower', 'மெதுவாக')}</option>
                      <option value="softer">{t('Softer', 'மெல்லிய')}</option>
                      <option value="both">{t('Both', 'இரண்டும்')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-2">{t('Current medications', 'தற்போதைய மருந்துகள்')}</label>
                    <input
                      type="text"
                      value={intake.medications}
                      onChange={updateIntake('medications')}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white"
                      placeholder={t('e.g., None', 'உதா., இல்லை')}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Combined Risk Dashboard */}
            <div className="bg-gray-800 rounded-lg p-8">
              <h2 className="text-2xl font-bold mb-6 text-center">
                {t('Combined Risk Assessment', 'ஒருங்கிணைந்த அபாய மதிப்பீடு')}
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                {/* Face Risk */}
                <div className="bg-gray-700 rounded-lg p-6 text-center">
                  <div className="text-4xl mb-2">👤</div>
                  <h3 className="text-lg font-semibold mb-2">Face Analysis</h3>
                  <div className="text-3xl font-bold text-blue-400 mb-1">
                    {fmt(combinedRisk.face)}
                  </div>
                  <div className="text-sm text-gray-400">Risk Score</div>
                </div>
                
                {/* Voice Risk */}
                <div className="bg-gray-700 rounded-lg p-6 text-center">
                  <div className="text-4xl mb-2">🎤</div>
                  <h3 className="text-lg font-semibold mb-2">Voice Analysis</h3>
                  <div className="text-3xl font-bold text-purple-400 mb-1">
                    {fmt(combinedRisk.voice)}
                  </div>
                  <div className="text-sm text-gray-400">Risk Score</div>
                </div>
                
                {/* Overall Risk */}
                <div className={`${overallRiskInfo.bg} rounded-lg p-6 text-center border-2 border-opacity-50 ${overallRiskInfo.color.replace('text-', 'border-')}`}>
                  <div className="text-4xl mb-2">📊</div>
                  <h3 className="text-lg font-semibold mb-2">Overall Risk</h3>
                  <div className={`text-3xl font-bold ${overallRiskInfo.color} mb-1`}>
                    {fmt(combinedRisk.overall)}
                  </div>
                  <div className={`text-sm font-medium ${overallRiskInfo.color}`}>
                    {combinedRisk.overall == null ? 'N/A' : `${overallRiskInfo.level} Risk`}
                  </div>
                </div>
              </div>

              {/* Risk Progress Bar */}
              <div className="mb-6">
                <div className="flex justify-between text-sm mb-2">
                  <span>Overall Risk Level</span>
                  <span className={overallRiskInfo.color}>{overallRiskInfo.level}</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-4">
                  <div 
                    className={`h-4 rounded-full transition-all duration-500 ${
                      combinedRisk.overall == null ? 'bg-gray-500' :
                      combinedRisk.overall < 20 ? 'bg-green-500' :
                      combinedRisk.overall < 40 ? 'bg-yellow-500' :
                      combinedRisk.overall < 60 ? 'bg-orange-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${combinedRisk.overall ?? 0}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Disease Risk Breakdown */}
            <div className="bg-gray-800 rounded-lg p-8">
              <h2 className="text-2xl font-bold mb-6">
                {t('Disease Risk Analysis', 'நோய் அபாய பகுப்பாய்வு')}
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Parkinson's */}
                <div className="bg-gray-700 rounded-lg p-6">
                  <div className="flex items-center mb-4">
                    <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center mr-3">
                      🧠
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold">Parkinson's Disease</h3>
                      <p className="text-sm text-gray-400">Neurodegenerative disorder</p>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-300">Facial Indicators:</span>
                      <span className="text-blue-400 font-medium">
                        {combinedRisk.face == null ? 'N/A' : `${(combinedRisk.face * 0.6).toFixed(1)}%`}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-300">Voice Indicators:</span>
                      <span className="text-purple-400 font-medium">
                        {combinedRisk.voice == null ? 'N/A' : `${(combinedRisk.voice * 0.4).toFixed(1)}%`}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-300">Combined Risk:</span>
                      <span className="text-blue-400 font-bold">
                        {combinedRisk.face == null || combinedRisk.voice == null ? 'N/A' : `${((combinedRisk.face * 0.6 + combinedRisk.voice * 0.4)).toFixed(1)}%`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Alzheimer's */}
                <div className="bg-gray-700 rounded-lg p-6">
                  <div className="flex items-center mb-4">
                    <div className="w-12 h-12 bg-purple-600 rounded-lg flex items-center justify-center mr-3">
                      🧠
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold">Alzheimer's Disease</h3>
                      <p className="text-sm text-gray-400">Cognitive decline</p>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-300">Facial Indicators:</span>
                      <span className="text-blue-400 font-medium">
                        {combinedRisk.face == null ? 'N/A' : `${(combinedRisk.face * 0.5).toFixed(1)}%`}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-300">Voice Indicators:</span>
                      <span className="text-purple-400 font-medium">
                        {combinedRisk.voice == null ? 'N/A' : `${(combinedRisk.voice * 0.5).toFixed(1)}%`}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-300">Combined Risk:</span>
                      <span className="text-purple-400 font-bold">
                        {combinedRisk.face == null || combinedRisk.voice == null ? 'N/A' : `${((combinedRisk.face * 0.5 + combinedRisk.voice * 0.5)).toFixed(1)}%`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Depression */}
                <div className="bg-gray-700 rounded-lg p-6">
                  <div className="flex items-center mb-4">
                    <div className="w-12 h-12 bg-green-600 rounded-lg flex items-center justify-center mr-3">
                      🧠
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold">Depression</h3>
                      <p className="text-sm text-gray-400">Mental health disorder</p>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-300">Facial Indicators:</span>
                      <span className="text-blue-400 font-medium">
                        {combinedRisk.face == null ? 'N/A' : `${(combinedRisk.face * 0.7).toFixed(1)}%`}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-300">Voice Indicators:</span>
                      <span className="text-purple-400 font-medium">
                        {combinedRisk.voice == null ? 'N/A' : `${(combinedRisk.voice * 0.3).toFixed(1)}%`}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-300">Combined Risk:</span>
                      <span className="text-green-400 font-bold">
                        {combinedRisk.face == null || combinedRisk.voice == null ? 'N/A' : `${((combinedRisk.face * 0.7 + combinedRisk.voice * 0.3)).toFixed(1)}%`}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Recommendations */}
            <div className="bg-gray-800 rounded-lg p-8">
              <h2 className="text-2xl font-bold mb-6">
                {t('Clinical Recommendations', 'மருத்துவ பரிந்துரைகள்')}
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-gray-700 rounded-lg p-6">
                  <h3 className="text-lg font-semibold mb-4 text-blue-400">
                    {t('Immediate Actions', 'உடனடி நடவடிக்கைகள்')}
                  </h3>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-start">
                      <span className="text-green-400 mr-2">✓</span>
                      Schedule comprehensive neurological evaluation
                    </li>
                    <li className="flex items-start">
                      <span className="text-green-400 mr-2">✓</span>
                      Begin baseline cognitive and motor function testing
                    </li>
                    <li className="flex items-start">
                      <span className="text-green-400 mr-2">✓</span>
                      Consider referral to movement disorder specialist
                    </li>
                  </ul>
                </div>
                
                <div className="bg-gray-700 rounded-lg p-6">
                  <h3 className="text-lg font-semibold mb-4 text-purple-400">
                    {t('Monitoring Plan', 'கண்காணிப்பு திட்டம்')}
                  </h3>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-start">
                      <span className="text-yellow-400 mr-2">•</span>
                      Weekly behavioral analysis tracking
                    </li>
                    <li className="flex items-start">
                      <span className="text-yellow-400 mr-2">•</span>
                      Monthly clinical assessment updates
                    </li>
                    <li className="flex items-start">
                      <span className="text-yellow-400 mr-2">•</span>
                      Quarterly comprehensive evaluation
                    </li>
                  </ul>
                </div>
              </div>
            </div>

          </div>
        )}

        {activeTab === 'about' && (
          <div className="space-y-8">
            <div className="bg-gray-800 rounded-lg p-8">
              <h2 className="text-3xl font-bold mb-4 text-center">
                {t('About the System', 'அமைப்பு பற்றி')}
              </h2>
              <p className="text-gray-300 text-center max-w-3xl mx-auto">
                {t(
                  'This system looks for early behavioral drift using face and voice signals to support preventive care.',
                  'இந்த அமைப்பு முகம் மற்றும் குரல் சிக்னல்களை பயன்படுத்தி ஆரம்ப மாற்றங்களை கண்டறிந்து முன்னெச்சரிக்கை பராமரிப்பை ஆதரிக்கிறது.'
                )}
              </p>
            </div>

            <div className="bg-gray-800 rounded-lg p-8">
              <h3 className="text-2xl font-semibold mb-6">
                {t('Diseases We Track', 'நாங்கள் கண்காணிக்கும் நோய்கள்')}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {aboutDiseases.map((disease) => (
                  <div key={disease.id} className="bg-gray-900 border border-gray-700 rounded-xl p-6">
                    <h4 className="text-xl font-semibold mb-2">
                      {language === 'ta' ? disease.titleTa : disease.titleEn}
                    </h4>
                    <p className="text-gray-400">
                      {language === 'ta' ? disease.summaryTa : disease.summaryEn}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg p-8">
              <h3 className="text-2xl font-semibold mb-4">
                {t('How It Helps', 'இது எவ்வாறு உதவுகிறது')}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-gray-300">
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
                  <h4 className="font-semibold mb-2">{t('Early Signals', 'ஆரம்ப அறிகுறிகள்')}</h4>
                  <p>{t('Finds subtle changes before strong symptoms appear.', 'தெளிவான அறிகுறிகளுக்கு முன்பு சிறிய மாற்றங்களை கண்டறியும்.')}</p>
                </div>
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
                  <h4 className="font-semibold mb-2">{t('Non-Invasive', 'எளிமையானது')}</h4>
                  <p>{t('Uses camera and microphone without medical procedures.', 'மருத்துவ செயல்முறைகள் இல்லாமல் கேமரா, மைக்ரோஃபோன் பயன்படுத்துகிறது.')}</p>
                </div>
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
                  <h4 className="font-semibold mb-2">{t('Continuous Tracking', 'தொடர்ந்த கண்காணிப்பு')}</h4>
                  <p>{t('Tracks trends over time for better insights.', 'காலப்போக்கில் மாற்றங்களை கண்காணித்து தெளிவு அளிக்கும்.')}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CombinedAnalysis;
