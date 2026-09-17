
const fs = require('fs');
const path = require('path');

const USAGE_PATH = path.join(__dirname, 'usage.json');

let usageData = [];

if (fs.existsSync(USAGE_PATH)) {
  try {
    usageData = JSON.parse(fs.readFileSync(USAGE_PATH, 'utf8'));
  } catch (error) {
    usageData = [];
  }
}

function saveUsage() {
  fs.writeFileSync(
    USAGE_PATH,
    JSON.stringify(usageData, null, 2),
    'utf8'
  );
}

function addUsage(usage) {
  usageData.push({
    time: new Date().toISOString(),
    tokens: usage.totalTokens || 0,
    cost: usage.cost || 0
  });

  saveUsage();
}

function getUsage() {
  return usageData;
}

module.exports = {
  addUsage,
  getUsage
};