require('dotenv').config();

const { pinyin } = require('pinyin-pro');
const express = require('express');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const googleAuthRoutes = require('./modules/auth/google.routes');
const connectDatabase = require('./config/database');
const userRoutes = require('./modules/users/user.routes');
const { addUsage, getUsageStats } = require('./usage');
const {
  translateFull,
  evaluateChinese,
  generatePinyin,
  verifyTranslation
} = require('./ai');
const {
   getWebCachedText,
  setWebCachedText,
} = require('./cache');

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

const app = express();
const PORT = process.env.WEB_PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('trust proxy', 1);

app.use(session({
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: __dirname
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use('/api/admin/users', userRoutes);
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


const User = require('./modules/users/user.model');

app.get('/api/auth', async (req, res) => {
  try {
    if (
      req.session.authenticated !== true ||
      !req.session.userId
    ) {
      return res.json({
        success: true,
        authenticated: false,
        role: null
      });
    }

    const user = await User.findById(req.session.userId);

    if (!user || !user.isActive) {
      return res.json({
        success: true,
        authenticated: false,
        role: null
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

app.post('/api/practice/chinese', requirePro, async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
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

    const result = await evaluateChinese(text.trim());

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
    console.error('Chinese practice error:', error);

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
      const { text } = req.body;

      if (!text || !text.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Vui lòng nhập nội dung cần dịch'
        });
      }

      const result = await translateFree(
        text.trim()
      );

      const inputIsChinese =
  containsChinese(text);

const chineseText =
  inputIsChinese
    ? text.trim()
    : result.parsed.translation;

const pronunciation =
  generatePinyin(chineseText);

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

  rateLimit:
    result.rateLimit || null
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

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập nội dung cần dịch'
      });
    }

    const inputText = text.trim();
const inputIsChinese = containsChinese(inputText);

const shouldBackTranslate =
  backTranslation &&
  !inputIsChinese &&
  targetLang === 'zh';

  const cachedData = getWebCachedText(
  text.trim(),
  targetLang,
  fastMode,
  context
);

const missing = {
  translation: !cachedData?.translation,

  backTranslation:
    shouldBackTranslate &&
    !hasCacheField(cachedData, 'backTranslation'),

  vocabulary:
    vocabulary &&
    !hasCacheField(cachedData, 'vocabulary')
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
      context
    }
  );
}

let finalCache = cachedData || {};

if (result) {
  const newData = parseTranslationResult(result.content);

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

  setWebCachedText(
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

    setWebCachedText(
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

  setWebCachedText(
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
  const vocabularyWithPinyin =
    addPinyinToVocabulary(finalCache.vocabulary);

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

res.json({
  success: true,
  result: responseContent,
  cached: !result && !verificationUsage,
  usage
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
    await clearHistory(req.user._id);
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
    await connectDatabase();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Không thể khởi động server');
    process.exit(1);
  }
}

startServer();