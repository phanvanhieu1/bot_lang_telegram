require('dotenv').config();

const { pinyin } = require('pinyin-pro');
const { getChineseAudio, getVietnameseAudio } = require('./web-tts');
const { translateChatImage } = require('./web-image-translate');
const vocabularyRoutes = require('./web-vocabulary/routes');
const { startVocabularyWorker } = require('./web-vocabulary/worker');
const { resolveTranslationVocabulary } = require('./web-vocabulary/resolver');
const {
  NOTICE: MAINTENANCE_NOTICE,
  effectiveRole,
  freeMaintenanceEnabled,
  updateFreeMaintenance,
  revokeActiveFreeSessions,
  destroySession
} = require('./web-maintenance');
const { translateEnglishFree, translateEnglishPro, evaluateEnglish } = require('./web-english');
const express = require('express');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const mongoose = require('mongoose');
const googleAuthRoutes = require('./modules/auth/google.routes');
const connectDatabase = require('./config/database');
const userRoutes = require('./modules/users/user.routes');
const apiMonitoringRoutes = require('./api-monitoring/router');
const telegramLinkRoutes = require('./telegram-sync/routes');
const { createV2Router } = require('./ai/v2/routes');
const glossaryRoutes=require('./ai/terminology/routes');
const {lookupUserTerms,termHighlights,validateAppliedTerms}=require('./ai/terminology/resolver');
const { startQuotaPolling } = require('./api-monitoring/quotas');
const { addUsage, getUsageStats } = require('./usage');
const { proRequestUsage,freeRequestUsage } = require('./translation-request-usage');
const {
  translateFull,
  evaluateChinese,
  generatePinyin,
  verifyTranslation
} = require('./ai');
const {
  getWebCachedText,
  setWebCachedText
} = require('./web-cache');

const {
  addHistory,
  getHistory,
  clearHistory
} = require('./history');

const { translateFree } =
  require('./freeTranslator');

  const {
  requireAuth: requireMongoAuth,
  requireRole
} = require('./modules/users/user.middleware');

const User = require('./modules/users/user.model');

// Vocabulary enrichment is optional: never fail a successful translation
// because a personal dictionary read/write is temporarily unavailable.
async function personalVocabularyCards(args) {
  try {
    return { items:await resolveTranslationVocabulary(args), error:null };
  } catch(error) {
    console.error('Vocabulary V1.1 resolution:',error.message);
    return {items:[],error:'Kho từ vựng đang tạm thời không khả dụng'};
  }
}

const app = express();
const PORT = process.env.WEB_PORT || 3000;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

// Initialize MongoDB once. Reuse its native MongoClient for the session
// store instead of opening a second connection to Atlas.
const databaseReady = connectDatabase();
const sessionStore = MongoStore.create({
  clientPromise: databaseReady.then(() => mongoose.connection.getClient()),
  collectionName: 'web_sessions',
  ttl: SESSION_TTL_SECONDS,
  touchAfter: 24 * 60 * 60
});

sessionStore.on('error', (error) => {
  console.error('MongoDB session store error:', error);
});

// Attach a rejection handler immediately: if Atlas is unreachable,
// both databaseReady and the store's collection initialization reject.
sessionStore.collectionP.catch(() => {});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('trust proxy', 1);

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_SECONDS * 1000
  }
}));

// FREE maintenance is server-enforced on every request, including API calls
// and already-authenticated sessions. PRO and admin users remain unaffected.
app.use(async (req, res, next) => {
  if (req.session?.authenticated !== true || !req.session.userId) return next();
  try {
    if (!(await freeMaintenanceEnabled())) return next();
    const user = await User.findById(req.session.userId)
      .select('role proExpiresAt isActive')
      .lean();
    if (user && user.isActive && effectiveRole(user) !== 'user') return next();
    await destroySession(req, res);
    res.set('Cache-Control', 'no-store');
    if (req.path.startsWith('/api/')) {
      return res.status(503).json({
        success: false,
        maintenance: true,
        code: 'FREE_MAINTENANCE',
        message: MAINTENANCE_NOTICE
      });
    }
    return res.redirect('/login?error=maintenance');
  } catch (error) {
    console.error('Maintenance gate error:', error.message);
    return res.status(503).send('Không thể kiểm tra trạng thái website');
  }
});

// Only administrators can change the site switch; reject cross-origin
// browser submissions as extra protection beyond SameSite session cookies.
app.get('/api/admin/maintenance', requireRole('admin'), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, enabled: await freeMaintenanceEnabled() });
  } catch (error) {
    console.error('Maintenance status error:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể xem trạng thái bảo trì' });
  }
});

app.put('/api/admin/maintenance', requireRole('admin'), async (req, res) => {
  const origin = req.get('origin');
  const expectedOrigin = req.protocol + '://' + req.get('host');
  if ((origin && origin !== expectedOrigin) ||
      (req.get('sec-fetch-site') && !['same-origin', 'none'].includes(req.get('sec-fetch-site')))) {
    return res.status(403).json({ success: false, message: 'Yêu cầu không cùng nguồn gốc' });
  }
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ success: false, message: 'enabled phải là boolean' });
  }
  try {
    const setting = await updateFreeMaintenance(req.body.enabled, req.user._id);
    let revokedSessions = 0;
    let sessionsRevoked = true;
    if (setting.enabled) {
      try {
        revokedSessions = await revokeActiveFreeSessions(
          mongoose.connection.collection('web_sessions')
        );
      } catch (error) {
        sessionsRevoked = false;
        console.error('FREE session revoke error:', error.message);
      }
    }
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true, enabled: setting.enabled, revokedSessions, sessionsRevoked,
      message: setting.enabled
        ? 'Đã bật bảo trì cho tài khoản FREE'
        : 'Đã tắt bảo trì, người dùng FREE có thể đăng nhập lại'
    });
  } catch (error) {
    console.error('Maintenance update error:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể cập nhật chế độ bảo trì' });
  }
});

app.use('/api/vocabulary', vocabularyRoutes);
app.use('/api/terminology',glossaryRoutes);
app.use('/api/admin/users', userRoutes);
app.use('/api/monitoring', apiMonitoringRoutes);
app.use('/api/telegram', telegramLinkRoutes);
// V2 is separately gated and disabled by default. The legacy /api/translate remains unchanged.
app.use('/api/translate/v2', createV2Router());
app.use('/auth', googleAuthRoutes);

app.post('/api/logout', (req, res) => {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({
        success: false
      });
    }

    res.clearCookie('connect.sid');

    res.json({
      success: true
    });
  });
});


app.get('/api/auth', async (req, res) => {
  try {
    if (
      req.session.authenticated !== true ||
      !req.session.userId
    ) {
      return res.json({
        success: true,
        authenticated: false,
        role: null,
        maintenance: await freeMaintenanceEnabled()
      });
    }

    const user = await User.findById(req.session.userId);

    if (!user || !user.isActive) {
      return res.json({
        success: true,
        authenticated: false,
        role: null,
        maintenance: await freeMaintenanceEnabled()
      });
    }

    let role = user.role;

    // PRO hết hạn sẽ được xem là FREE.
    if (
      role === 'pro' &&
      user.proExpiresAt &&
      user.proExpiresAt <= new Date()
    ) {
      role = 'user';
    }

    return res.json({
      success: true,
      authenticated: true,
      role,
      maintenance: await freeMaintenanceEnabled(),
      email: user.email,
      name: user.name,
      avatar: user.avatar
    });
  } catch (error) {
    console.error('Get auth error:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Không thể kiểm tra trạng thái đăng nhập'
    });
  }
});


const requireAuth = requireMongoAuth;

const requirePro = requireRole('pro', 'admin');


app.get('/login', async (req, res) => {
  try {
    if (
      req.session.authenticated === true &&
      req.session.userId
    ) {
      const user = await User.findById(req.session.userId);

      if (user && user.isActive) {
        return res.redirect('/');
      }
    }

    return res.sendFile(
      path.join(__dirname, 'public', 'login.html')
    );
  } catch (error) {
    console.error('Login page error:', error.message);

    return res.status(500).send(
      'Không thể kiểm tra trạng thái đăng nhập'
    );
  }
});


app.get('/telegram/connect', requireRole('pro','admin'), (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  return res.sendFile(path.join(__dirname, 'views', 'telegram-connect.html'));
});

app.get('/admin/monitoring', requireRole('admin'), (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.sendFile(path.join(__dirname, 'views', 'api-monitoring.html'));
});

app.get('/admin', requireRole('admin'), (req, res) => {
  return res.sendFile(
    path.join(__dirname, 'views', 'admin.html')
  );
});


app.get('/', async (req, res) => {
  try {
    if (
      req.session.authenticated !== true ||
      !req.session.userId
    ) {
      return res.redirect('/login');
    }

    const user = await User.findById(req.session.userId);

    if (!user || !user.isActive) {
      return req.session.destroy((error) => {
        if (error) {
          console.error('Destroy session error:', error);
          return res.status(500).send('Lỗi đăng xuất tài khoản');
        }

        res.clearCookie('connect.sid');
        return res.redirect('/login');
      });
    }

    return res.sendFile(
      path.join(__dirname, 'public', 'index.html')
    );

  } catch (error) {
    console.error('Home auth error:', error.message);

    return res.status(500).send(
      'Không thể xác thực tài khoản'
    );
  }
});


app.get('/login.html', (req, res) => {
  res.redirect('/login');
});

app.use(express.static(path.join(__dirname, 'public')));

// Authenticated Mandarin speech synthesis; never expose ElevenLabs credentials.
app.post('/api/tts/chinese', requireAuth, async (req, res) => {
  try {
    const { audio, cached } = await getChineseAudio(req.body?.text, req.body?.voiceId, req.body?.speed);
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Audio-Cache', cached ? 'HIT' : 'MISS');
    return res.send(audio);
  } catch (error) {
    console.error('Chinese TTS error:', error.message);
    return res.status(error.status || 502).json({
      success: false,
      message: error.status === 400 ? error.message : 'Không thể tạo giọng đọc lúc này'
    });
  }
});

// Vietnamese ElevenLabs voice is fixed server-side and available to PRO users.
app.post('/api/tts/vietnamese', requirePro, async (req, res) => {
  try {
    const { audio, cached } = await getVietnameseAudio(req.body?.text, req.body?.speed);
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Audio-Cache', cached ? 'HIT' : 'MISS');
    return res.send(audio);
  } catch (error) {
    console.error('Vietnamese TTS error:', error.message);
    return res.status(error.status || 502).json({
      success: false,
      message: error.status === 400 ? error.message : 'Không thể tạo giọng đọc tiếng Việt lúc này'
    });
  }
});

// PRO-only image conversation translation. Accept image bytes in memory;
// never write uploaded screenshots to disk, logs, history or MongoDB.
app.post(
  '/api/image/translate',
  requirePro,
  express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '5mb' }),
  async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      if (!req.is(['image/png', 'image/jpeg', 'image/webp'])) {
        return res.status(415).json({
          success: false,
          message: 'Chỉ hỗ trợ ảnh PNG, JPG và WebP'
        });
      }
      const language = req.get('X-Learning-Language') || 'zh';
      if (!['zh', 'en'].includes(language)) {
        return res.status(400).json({ success: false, message: 'Ngôn ngữ không hợp lệ' });
      }
      const result = await translateChatImage(req.body, language);
      const usage = result.usage;
      if ((usage?.total_tokens || 0) > 0) {
        await addUsage({
          userId: req.user._id,
          totalTokens: usage.total_tokens,
          cost: ((usage.prompt_tokens || 0) * 2.5 +
            (usage.completion_tokens || 0) * 10) / 1_000_000
        });
      }
      // Image translation has no PRO vocabulary-toggle payload: do not auto-collect.
      return res.json({
        success: true,
        sourceLanguage: result.sourceLanguage,
        targetLanguage: result.targetLanguage,
        messages: result.messages,
        notes: result.notes
      });
    } catch (error) {
      console.error('PRO image translation error:', error.message);
      return res.status(error.status || 502).json({
        success: false,
        message: error.status ? error.message : 'Không thể dịch ảnh lúc này, vui lòng thử lại'
      });
    }
  }
);

// Convert Chinese text to Pinyin
app.get('/api/pinyin', requireAuth, (req, res) => {
  try {
    const text = req.query.text;

    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > 1000
    ) {
      return res.status(400).json({
        error: 'Invalid text'
      });
    }

    const result = pinyin(text, {
      toneType: 'symbol',
      type: 'string',
      nonZh: 'consecutive'
    });

    return res.json({
      pinyin: result
    });
  } catch (error) {
    console.error('Pinyin API error:', error);

    return res.status(500).json({
      error: 'Failed to generate Pinyin'
    });
  }
});

// Test server
app.get('/api/status',requireAuth, (req, res) => {
  res.json({
    success: true,
    message: 'Web server is running'
  });
});

app.post(['/api/practice/chinese', '/api/practice/english'], requirePro, async (req, res) => {
  const englishPractice = req.path.endsWith('/english');
  try {
    const { text } = req.body;

    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập nội dung tiếng Trung'
      });
    }

    if (text.trim().length > 2000) {
      return res.status(400).json({
        success: false,
        message: 'Nội dung quá dài'
      });
    }

    if (!englishPractice && !/[\u3400-\u9FFF]/u.test(text)) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập ít nhất một chữ tiếng Trung để chấm bài' });
    }

    if (englishPractice && !/[a-z]/i.test(text)) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập câu tiếng Anh để chấm bài' });
    }

    const result = englishPractice ? await evaluateEnglish(text) : await evaluateChinese(text);

    const inputTokens = result.usage?.prompt_tokens || 0;
    const outputTokens = result.usage?.completion_tokens || 0;
    const totalTokens = result.usage?.total_tokens || 0;

    const cost =
      (inputTokens / 1_000_000) * 2.5 +
      (outputTokens / 1_000_000) * 10;

    await addUsage({
      userId: req.user._id,
      totalTokens,
      cost
    });

    return res.json({
      success: true,
      result: result.content
    });

  } catch (error) {
    console.error('Practice evaluation error:', error);

    return res.status(500).json({
      success: false,
      message: 'Không thể chấm bài lúc này'
    });
  }
});

function parseTranslationResult(content) {
  const translationMatch = content.match(
    /TRANSLATION:\s*([\s\S]*?)(?=BACK_TRANSLATION:|PRONUNCIATION:|VOCABULARY:|$)/i
  );

  const backTranslationMatch = content.match(
    /BACK_TRANSLATION:\s*([\s\S]*?)(?=PRONUNCIATION:|VOCABULARY:|$)/i
  );

  const pronunciationMatch = content.match(
    /PRONUNCIATION:\s*([\s\S]*?)(?=VOCABULARY:|$)/i
  );

  const vocabularyMatch = content.match(
    /VOCABULARY:\s*([\s\S]*?)$/i
  );

  const data = {};

  if (translationMatch?.[1]?.trim()) {
    data.translation = translationMatch[1].trim();
  }

  if (backTranslationMatch?.[1]?.trim()) {
    data.backTranslation = backTranslationMatch[1].trim();
  }

  if (pronunciationMatch?.[1]?.trim()) {
    data.pronunciation = pronunciationMatch[1].trim();
  }

  if (vocabularyMatch?.[1]?.trim()) {
    data.vocabulary = vocabularyMatch[1].trim();
  }

  return data;
}

async function persistProCache(text, lang, isFast, context, fields) {
  try {
    await setWebCachedText(text, lang, isFast, context, fields);
  } catch (error) {
    // Never make users repeat a paid translation if only cache persistence fails.
    console.error('PRO MongoDB cache write error:', error);
  }
}

function hasCacheField(data, field) {
  return (
    data &&
    Object.prototype.hasOwnProperty.call(data, field)
  );
}

function containsChinese(text) {
  return /[\u3400-\u9FFF]/u.test(text || '');
}

function addPinyinToVocabulary(vocabulary) {
  if (!vocabulary || !vocabulary.trim()) {
    return '';
  }

  return vocabulary
    .split('\n')
    .map(line => {
      const trimmed = line.trim();

      if (!trimmed) return '';

      const cleanLine = trimmed.replace(/^-\s*/, '');

      const separatorIndex = cleanLine.indexOf(':');

      if (separatorIndex === -1) {
        return trimmed;
      }

      const chinese = cleanLine
        .slice(0, separatorIndex)
        .trim();

      const meaning = cleanLine
        .slice(separatorIndex + 1)
        .trim();

      if (!containsChinese(chinese)) {
        return trimmed;
      }

      const pronunciation = generatePinyin(chinese);

      return `- ${chinese}(${pronunciation}) : ${meaning}`;
    })
    .filter(Boolean)
    .join('\n');
}

app.post(
  '/api/translate/free',
  requireAuth,
  async (req, res) => {
    try {
      const { text, targetLang: requestedLang = 'zh', context: freeContext = 'auto' } = req.body || {};

      if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Vui lòng nhập nội dung cần dịch'
        });
      }

      if (!['zh', 'en'].includes(requestedLang)) {
        return res.status(400).json({ success: false, message: 'Ngôn ngữ không được hỗ trợ' });
      }
      if (requestedLang === 'en') {
        if (text.length > 2000) {
          return res.status(400).json({ success: false, message: 'Nội dung quá dài' });
        }
        const en = await translateEnglishFree(text.trim());
        await addHistory({
          userId: req.user._id,
          text: text.trim(),
          targetLang: en.parsed.sourceLanguage === 'en' ? 'vi' : 'en',
          learningLang: 'en',
          result: en.content
        });
        return res.json({
          success: true,
          mode: 'free',
          provider: en.provider,
          cached: en.cached,
          sourceLanguage: en.parsed.sourceLanguage,
          result: {
            translation: en.parsed.translation,
            backTranslation: en.parsed.backTranslation,
            pronunciation: ''
          },
          rateLimit: en.rateLimit,
          requestUsage:freeRequestUsage(en)
        });
      }

      const freeIsChinese=containsChinese(text.trim());
      const freeTerms=await lookupUserTerms(req.user._id,text.trim(),{
        context:['auto','friend','colleague','superior'].includes(freeContext)?freeContext:'auto',
        sourceLang:freeIsChinese?'zh':'vi',
        targetLang:freeIsChinese?'vi':'zh'});
      const result = await translateFree(text.trim(),{
         terms:freeTerms,
         context:['auto','friend','colleague','superior'].includes(freeContext)
           ?freeContext:'auto'
       });

      const inputIsChinese =
  containsChinese(text);

const chineseText =
  inputIsChinese
    ? text.trim()
    : result.parsed.translation;

const pronunciation =
  generatePinyin(chineseText);

      await addHistory({
        userId: req.user._id,
        text: text.trim(),
        targetLang: inputIsChinese ? 'vi' : 'zh',
        learningLang: 'zh',
        result: [
          `TRANSLATION: ${result.parsed.translation || ''}`,
          `BACK_TRANSLATION: ${result.parsed.backTranslation || ''}`,
          `PRONUNCIATION: ${pronunciation || ''}`
        ].join('\n')
      });

      return res.json({
  success: true,
  mode: 'free',
  provider: result.provider,
  cached: result.cached || false,

  result: {
    translation:
      result.parsed.translation,

    pronunciation,

    backTranslation:
      result.parsed.backTranslation
  },

  rateLimit:result.rateLimit || null,
  requestUsage:freeRequestUsage(result),
  appliedTerms:termHighlights(result.parsed.translation,freeTerms),
  terminologyWarnings:validateAppliedTerms(result.parsed.translation,freeTerms)
});

    } catch (error) {
  console.error(
    'Free translate error:',
    error
  );

  const providers =
    error.providers || {};

  const groqError =
    providers.groq;

  const openRouterError =
    providers.openrouter;

  // OpenRouter bị giới hạn bởi shared pool
  // của provider phía sau, không phải quota user.
  if (
    openRouterError?.type ===
    'UPSTREAM_RATE_LIMIT'
  ) {
    return res.status(503).json({
      success: false,
      mode: 'free',
      errorCode:
        'FREE_PROVIDERS_BUSY',
      message:
        'Hệ thống dịch FREE đang bận. Vui lòng thử lại sau.'
    });
  }

  // Cả hai provider đều báo rate limit.
  if (
    groqError?.type === 'RATE_LIMIT' &&
    openRouterError?.type ===
      'RATE_LIMIT'
  ) {
    return res.status(429).json({
      success: false,
      mode: 'free',
      errorCode:
        'FREE_RATE_LIMIT',
      message:
        'Hạn mức dịch FREE hiện đã đạt giới hạn. Vui lòng thử lại sau.'
    });
  }

  // Provider/server gặp sự cố.
  if (
    groqError?.type ===
      'PROVIDER_ERROR' ||
    openRouterError?.type ===
      'PROVIDER_ERROR'
  ) {
    return res.status(503).json({
      success: false,
      mode: 'free',
      errorCode:
        'FREE_PROVIDER_ERROR',
      message:
        'Dịch FREE đang gặp sự cố từ nhà cung cấp. Vui lòng thử lại sau.'
    });
  }

  // Không xác định được nguyên nhân.
  return res.status(503).json({
    success: false,
    mode: 'free',
    errorCode:
      'FREE_UNAVAILABLE',
    message:
      'Dịch FREE hiện tạm thời không khả dụng.'
  });
}
  }
);

// Translation API
app.post('/api/translate',requirePro, async (req, res) => {
  try {
    const { text,
      targetLang = 'zh',
      fastMode = false,
      backTranslation = true,
      pronunciation = true,
      vocabulary = true,
      verification = false,
      context = 'auto'
     } = req.body;

    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập nội dung cần dịch'
      });
    }

    if (!['zh', 'en'].includes(targetLang)) {
      return res.status(400).json({ success: false, message: 'Ngôn ngữ không được hỗ trợ' });
    }
    if (targetLang === 'en') {
      if (typeof text !== 'string' || text.length > 2000) {
        return res.status(400).json({ success: false, message: 'Nội dung quá dài' });
      }
      const en = await translateEnglishPro(text.trim(), {
        backTranslation, vocabulary, verification, context
      });
      const tokens = en.usage?.total_tokens || 0;
      if (tokens > 0) {
        await addUsage({
          userId: req.user._id,
          totalTokens: tokens,
          cost: ((en.usage?.prompt_tokens || 0) * 2.5 +
            (en.usage?.completion_tokens || 0) * 10) / 1_000_000
        });
      }
      await addHistory({
        userId: req.user._id,
        text: text.trim(),
        targetLang: en.parsed.sourceLanguage === 'en' ? 'vi' : 'en',
        learningLang: 'en',
        result: en.content
      });
      const personal=vocabulary
        ? await personalVocabularyCards({
          userId:req.user._id,language:'en',
          foreignText:en.parsed.sourceLanguage==='en' ? text.trim() : en.parsed.translation,
          vocabulary:en.parsed.vocabulary || ''
        })
        : {items:[],error:null};
      return res.json({
        success: true,
        result: en.content,
        vocabularyItems:personal.items,
        vocabularyError:personal.error,
        cached: en.cached,
        sourceLanguage: en.parsed.sourceLanguage,
        usage: en.usage,
        requestUsage:proRequestUsage(en.usage,en.cached)
      });
    }

    const inputText = text.trim();
const inputIsChinese = containsChinese(inputText);
const appliedTerms=await lookupUserTerms(req.user._id,inputText,{
  context,sourceLang:inputIsChinese?'zh':'vi',targetLang:inputIsChinese?'vi':'zh'
});

const shouldBackTranslate =
  backTranslation &&
  !inputIsChinese &&
  targetLang === 'zh';

  // Bypass global shared cache when per-user terminology was matched;
  // never read or persist customized translations in the shared cache.
  const cachedData = appliedTerms.length ? null : await getWebCachedText(
  text.trim(),targetLang,fastMode,context
);

const missing = {
  translation: !cachedData?.translation,

  backTranslation:
    shouldBackTranslate &&
    !hasCacheField(cachedData, 'backTranslation'),

  vocabulary:
    vocabulary &&
    (!hasCacheField(cachedData, 'vocabulary') ||
      cachedData?.vocabularyVersion !== 2)
};


const hasMissingData =
  missing.translation ||
  missing.backTranslation ||
  missing.vocabulary;
  let result;
  let verificationUsage = null;

if (hasMissingData) {
  result = await translateFull(
    text.trim(),
    targetLang,
    fastMode,
    null,
    [],
    true,
    {
      backTranslation: missing.backTranslation,
      vocabulary: missing.vocabulary,
      existingTranslation: cachedData?.translation || null,
      terms:appliedTerms,
      context
    }
  );
}

let finalCache = cachedData || {};

if (result) {
  const newData = parseTranslationResult(result.content);
  // Previously cached translations contain legacy WORD-only vocabulary.
  // Upgrade only the lexical field, preserving the already cached translation.
  if (missing.vocabulary) newData.vocabularyVersion = 2;

  // Nếu đã có translation trong cache thì đây là request bổ sung.
  // Tuyệt đối không cho response bổ sung ghi đè bản dịch chính.
  if (cachedData?.translation) {
    delete newData.translation;
  }

  // Field đã được yêu cầu nhưng AI không trả về
  // => đánh dấu là đã xử lý, giá trị rỗng
  if (
    missing.backTranslation &&
    !hasCacheField(newData, 'backTranslation')
  ) {
    newData.backTranslation = '';
  }

  if (
    missing.vocabulary &&
    !hasCacheField(newData, 'vocabulary')
  ) {
    newData.vocabulary = '';
  }
  if (
    missing.backTranslation &&
    !hasCacheField(newData, 'backTranslation')
  ) {
    newData.backTranslation = '';
  }

  if (
    missing.vocabulary &&
    !hasCacheField(newData, 'vocabulary')
  ) {
    newData.vocabulary = '';
  }

  if(!appliedTerms.length) await persistProCache(
  text.trim(),
  targetLang,
  fastMode,
  context,
  newData
);

  finalCache = {
    ...finalCache,
    ...newData
  };
}

if (
  pronunciation &&
  !hasCacheField(finalCache, 'pronunciation')
) {
  // Nếu input chứa chữ Hán → lấy Pinyin từ input.
  // Nếu input không có chữ Hán → lấy Pinyin từ bản dịch tiếng Trung.
  const chineseText = /[\u3400-\u9FFF]/u.test(text.trim())
    ? text.trim()
    : finalCache.translation;

  if (
    chineseText &&
    /[\u3400-\u9FFF]/u.test(chineseText)
  ) {
    const localPinyin = generatePinyin(chineseText);

    finalCache.pronunciation = localPinyin;

    if(!appliedTerms.length) await persistProCache(
  text.trim(),
  targetLang,
  fastMode,
  context,
  {
    pronunciation: localPinyin
  }
);
  }
}

let hasValidVerification =
  verification &&
  finalCache.verification &&
  finalCache.verification.translation === finalCache.translation;

if (
  verification &&
  finalCache.translation &&
  !hasValidVerification
) {
  const verificationResult = await verifyTranslation(
    inputText,
    finalCache.translation,
    context
  );

  verificationUsage = verificationResult.usage;

  const verificationData = {
    translation: finalCache.translation,
    ...verificationResult.verification
  };

  finalCache.verification = verificationData;

  if(!appliedTerms.length) await persistProCache(
    inputText,
    targetLang,
    fastMode,
    context,
    {
      verification: verificationData
    }
  );

  hasValidVerification = true;
}

let responseContent = '';

if (finalCache.translation) {
  responseContent += `TRANSLATION: ${finalCache.translation}`;
}

if (shouldBackTranslate && finalCache.backTranslation) {
  responseContent += `\nBACK_TRANSLATION: ${finalCache.backTranslation}`;
}

if (pronunciation && finalCache.pronunciation) {
  responseContent += `\nPRONUNCIATION: ${finalCache.pronunciation}`;
}

if (vocabulary && finalCache.vocabulary) {
  // Typed V1.1 entries receive Pinyin from MongoDB, not mixed into the
  // AI1 payload. Keep the legacy renderer compatible with older cache.
  const vocabularyWithPinyin =
    /\[(?:WORD|PHRASE|PATTERN)\]/i.test(finalCache.vocabulary)
      ? finalCache.vocabulary
      : addPinyinToVocabulary(finalCache.vocabulary);

  responseContent +=
    `\nVOCABULARY:\n${vocabularyWithPinyin}`;
}

if (hasValidVerification) {
  responseContent += `\nVERIFICATION: ${JSON.stringify(
    finalCache.verification
  )}`;
}

await addHistory({
  userId: req.user._id,
  text: text.trim(),
  targetLang,
  learningLang: 'zh',
  result: responseContent
});

let usage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cost: 0
};

// Usage của lần dịch
if (result?.usage) {
  usage.promptTokens +=
    result.usage.prompt_tokens || 0;

  usage.completionTokens +=
    result.usage.completion_tokens || 0;

  usage.totalTokens +=
    result.usage.total_tokens || 0;
}

// Usage của lần kiểm chứng
if (verificationUsage) {
  usage.promptTokens +=
    verificationUsage.prompt_tokens || 0;

  usage.completionTokens +=
    verificationUsage.completion_tokens || 0;

  usage.totalTokens +=
    verificationUsage.total_tokens || 0;
}

// Tính tổng cost
const inputCost =
  usage.promptTokens * 2.5 / 1_000_000;

const outputCost =
  usage.completionTokens * 10 / 1_000_000;

usage.cost = inputCost + outputCost;

// Chỉ ghi usage nếu request này thực sự gọi OpenAI
if (usage.totalTokens > 0) {
  await addUsage({
    userId: req.user._id,
    totalTokens: usage.totalTokens,
    cost: usage.cost
  });
}

const personal=vocabulary
  ? await personalVocabularyCards({
    userId:req.user._id,language:'zh',
    foreignText:inputIsChinese ? inputText : finalCache.translation,
    vocabulary:finalCache.vocabulary || ''
  })
  : {items:[],error:null};

res.json({
  success: true,
  result: responseContent,
  vocabularyItems:personal.items,
  vocabularyError:personal.error,
  cached: !result && !verificationUsage,
  usage,
  requestUsage:proRequestUsage(usage,!result && !verificationUsage),
  appliedTerms:termHighlights(finalCache.translation||'',appliedTerms),
  terminologyWarnings:validateAppliedTerms(finalCache.translation||'',appliedTerms)
});


  } catch (error) {
  console.error('Translation error:', error);

  res.status(500).json({
    success: false,
    message: 'Dịch thất bại'
  });
}
});

app.get('/api/usage', requireAuth, async (req, res) => {
  try {
    const stats = await getUsageStats(req.user._id);

    res.json({ success: true, ...stats });
  } catch (error) {
    console.error('Usage API error:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể lấy thống kê'
    });
  }
});

app.get('/api/history', requireAuth, async (req, res) => {
  try {
    const history = await getHistory(req.user._id);
    res.json({ success: true, history });
  } catch (error) {
    console.error('History API error:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể tải lịch sử'
    });
  }
});

app.delete('/api/history', requireAuth, async (req, res) => {
  try {
    const lang = req.query.learningLang;
    if (lang && !['zh', 'en'].includes(lang)) {
      return res.status(400).json({ success: false, message: 'Ngôn ngữ không hợp lệ' });
    }
    await clearHistory(req.user._id, lang || null);
    res.json({ success: true });
  } catch (error) {
    console.error('Clear history API error:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể xóa lịch sử'
    });
  }
});


async function startServer() {
  try {
    await databaseReady;
    // Ensure the session collection and its TTL index are ready before
    // accepting Google OAuth callbacks.
    await sessionStore.collectionP;
    startVocabularyWorker();
    startQuotaPolling();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Không thể khởi động server');
    process.exit(1);
  }
}

startServer();