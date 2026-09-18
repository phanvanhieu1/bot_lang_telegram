const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, 'history.json');
const MAX_HISTORY = 200;

let historyData = [];

if (fs.existsSync(HISTORY_PATH)) {
  try {
    historyData = JSON.parse(
      fs.readFileSync(HISTORY_PATH, 'utf8')
    );

    if (!Array.isArray(historyData)) {
      historyData = [];
    }
  } catch (error) {
    historyData = [];
  }
}

function saveHistory() {
  fs.writeFileSync(
    HISTORY_PATH,
    JSON.stringify(historyData, null, 2),
    'utf8'
  );
}

function addHistory({ text, targetLang, result }) {
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    text,
    targetLang,
    result
  };

  historyData.unshift(item);

  if (historyData.length > MAX_HISTORY) {
    historyData = historyData.slice(0, MAX_HISTORY);
  }

  saveHistory();

  return item;
}

function getHistory() {
  return historyData;
}

function clearHistory() {
  historyData = [];
  saveHistory();
}

module.exports = {
  addHistory,
  getHistory,
  clearHistory
};