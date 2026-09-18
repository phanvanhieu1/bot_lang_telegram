require('dotenv').config();


const express = require('express');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const { addUsage, getUsage } = require('./usage');
const {
  translateFull,
  evaluateChinese
} = require('./ai');
const {
  getCachedText,
  setCachedText
} = require('./cache');

const {
  addHistory,
  getHistory,
  clearHistory
} = require('./history');

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

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,

  message: {
    success: false,
    message: 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.'
  }
});

app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập tài khoản và mật khẩu'
      });
    }

    if (username !== process.env.WEB_USERNAME) {
      return res.status(401).json({
        success: false,
        message: 'Tài khoản hoặc mật khẩu không đúng'
      });
    }

    const passwordValid = await bcrypt.compare(
      password,
      process.env.WEB_PASSWORD_HASH
    );

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: 'Tài khoản hoặc mật khẩu không đúng'
      });
    }

    req.session.authenticated = true;
    req.session.username = username;

    res.json({
      success: true
    });

  } catch (error) {
    console.error('Login error:', error);

    res.status(500).json({
      success: false,
      message: 'Đăng nhập thất bại'
    });
  }
});

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

app.get('/api/auth', (req, res) => {
  res.json({
    success: true,
    authenticated: req.session.authenticated === true
  });
});

function requireAuth(req, res, next) {
  if (req.session.authenticated === true) {
    return next();
  }

  return res.status(401).json({
    success: false,
    message: 'Chưa đăng nhập'
  });
}

app.get('/login', (req, res) => {
  if (req.session.authenticated) {
    return res.redirect('/');
  }

  res.sendFile(
    path.join(__dirname, 'public', 'login.html')
  );
});

app.get('/', (req, res) => {
  if (!req.session.authenticated) {
    return res.redirect('/login');
  }

  res.sendFile(
    path.join(__dirname, 'public', 'index.html')
  );
});

app.get('/login.html', (req, res) => {
  res.redirect('/login');
});

app.use(express.static(path.join(__dirname, 'public')));

// Test server
app.get('/api/status',requireAuth, (req, res) => {
  res.json({
    success: true,
    message: 'Web server is running'
  });
});

app.post('/api/practice/chinese', requireAuth, async (req, res) => {
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

    addUsage({
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

// Translation API
app.post('/api/translate',requireAuth, async (req, res) => {
  try {
    const { text, targetLang = 'zh', fastMode = false } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập nội dung cần dịch'
      });
    }

    const cachedResult = getCachedText(
  text.trim(),
  targetLang,
  fastMode
);

if (cachedResult) {
  addHistory({
    text: text.trim(),
    targetLang,
    result: cachedResult
  });

  return res.json({
    success: true,
    result: cachedResult,
    cached: true
  });
}

    const result = await translateFull(
  text.trim(),
  targetLang,
  fastMode,
  null,
  [],
  true
);

setCachedText(
  text.trim(),
  targetLang,
  fastMode,
  result.content
);

addHistory({
  text: text.trim(),
  targetLang,
  result: result.content
});

const promptTokens = result.usage?.prompt_tokens || 0;
const completionTokens = result.usage?.completion_tokens || 0;

const inputCost = promptTokens * 2.5 / 1_000_000;
const outputCost = completionTokens * 10 / 1_000_000;

const cost = inputCost + outputCost;
addUsage({
  totalTokens: result.usage?.total_tokens || 0,
  cost
});

res.json({
  success: true,
  result: result.content,
  usage: {
    promptTokens,
    completionTokens,
    totalTokens: result.usage?.total_tokens || 0,
    cost
  }
});

  } catch (error) {
    console.error('Translation error:', error);

    res.status(500).json({
      success: false,
      message: 'Dịch thất bại'
    });
  }
});

app.get('/api/usage',requireAuth, (req, res) => {
  const usage = getUsage();

  const now = new Date();

  const todayUsage = usage.filter(item => {
    const date = new Date(item.time);

    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    );
  });

  const todayCost = todayUsage.reduce(
    (sum, item) => sum + Number(item.cost || 0),
    0
  );

  const todayTokens = todayUsage.reduce(
    (sum, item) => sum + Number(item.tokens || 0),
    0
  );

  const totalCost = usage.reduce(
    (sum, item) => sum + Number(item.cost || 0),
    0
  );

  const totalTokens = usage.reduce(
    (sum, item) => sum + Number(item.tokens || 0),
    0
  );

  res.json({
    success: true,
    today: {
      requests: todayUsage.length,
      tokens: todayTokens,
      cost: todayCost
    },
    total: {
      requests: usage.length,
      tokens: totalTokens,
      cost: totalCost
    }
  });
});

app.get('/api/history',requireAuth, (req, res) => {
  res.json({
    success: true,
    history: getHistory()
  });
});

app.delete('/api/history',requireAuth, (req, res) => {
  clearHistory();

  res.json({
    success: true
  });
});


app.listen(PORT, '127.0.0.1', () => {
  console.log(`Web server running at http://127.0.0.1:${PORT}`);
});