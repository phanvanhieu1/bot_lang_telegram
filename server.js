require('dotenv').config();


const express = require('express');
const path = require('path');

const { addUsage, getUsage } = require('./usage');
const { translateFull, generateSpeech } = require('./ai');

const app = express();
const PORT = process.env.WEB_PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

// Test server
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    message: 'Web server is running'
  });
});

// Translation API
app.post('/api/translate', async (req, res) => {
  try {
    const { text, targetLang = 'zh', fastMode = false } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập nội dung cần dịch'
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

app.get('/api/usage', (req, res) => {
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


app.listen(PORT, '127.0.0.1', () => {
  console.log(`Web server running at http://127.0.0.1:${PORT}`);
});