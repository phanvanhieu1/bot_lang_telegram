const fs = require('fs');
const path = require('path');
const { LANG_CONFIG, VOICES, SPEED_OPTIONS } = require('./config');

// Keep existing JSON data readable. Test mode uses a separate directory.
const DATA_DIR = process.env.TELEGRAM_DATA_DIR || __dirname;
if (process.env.TELEGRAM_DATA_DIR) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const DB_PATH = path.join(DATA_DIR, 'database.json');
const WL_PATH = path.join(DATA_DIR, 'whitelist.json');
const VOCAB_PATH = path.join(DATA_DIR, 'vocabulary.json');

// --- 1. QUẢN LÝ CÀI ĐẶT & LỊCH SỬ CHAT ---
let userSessions = {};
if (fs.existsSync(DB_PATH)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) throw new TypeError('Invalid session object');
    userSessions = loaded;
  } catch (error) {
    console.error('Cannot read Telegram sessions:', error.message);
    throw error;
  }
}

// Atomic replacement: a process crash must not leave a truncated JSON session.
function atomicWrite(file, data) {
  const temp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), { encoding:'utf8', mode:0o600 });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
const saveDatabase = () => atomicWrite(DB_PATH, userSessions);

const getUserConfig = (userId) => {
  // 1. NẾU LÀ NGƯỜI DÙNG HOÀN TOÀN MỚI
  if (!userSessions[userId]) {
    userSessions[userId] = { 
      targetLang: 'zh', 
      voiceKey: 'female1', 
      speed: 1.0, 
      showPronunciation: true,
      showBackTranslation: true,
      showVocabulary: true,
      pendingVocabs: {}, // Snapshot per translation message
      pendingSpeech: {} // On-demand speech per translation message
    };
    saveDatabase();
  } 
  // Safely migrate older settings and avoid malformed persisted history.
  else {
    let isUpdated = false;
    const defaults = {
      targetLang: 'zh', voiceKey: 'female1', speed: 1,
      showPronunciation: true,
      showBackTranslation: true, showVocabulary: true
    };
    for (const [key, value] of Object.entries(defaults)) {
      if (userSessions[userId][key] === undefined) {
        userSessions[userId][key] = value;
        isUpdated = true;
      }
    }
    if (!userSessions[userId].pendingVocabs || typeof userSessions[userId].pendingVocabs !== 'object' || Array.isArray(userSessions[userId].pendingVocabs)) {
      userSessions[userId].pendingVocabs = {};
      isUpdated = true;
    }
    if (!userSessions[userId].pendingSpeech || typeof userSessions[userId].pendingSpeech !== 'object' || Array.isArray(userSessions[userId].pendingSpeech)) {
      userSessions[userId].pendingSpeech = {};
      isUpdated = true;
    }
    if (!Object.prototype.hasOwnProperty.call(LANG_CONFIG, userSessions[userId].targetLang)) {
      userSessions[userId].targetLang = 'zh';
      isUpdated = true;
    }
    // Old Telegram voices are not among the PRO web voices.
    if (!Object.prototype.hasOwnProperty.call(VOICES, userSessions[userId].voiceKey)) {
      userSessions[userId].voiceKey = 'female1';
      isUpdated = true;
    }
    if (!Object.keys(SPEED_OPTIONS).some(k => Number(k) === Number(userSessions[userId].speed))) {
      userSessions[userId].speed = 1;
      isUpdated = true;
    }
    // Lưu lại ổ cứng nếu có vá thêm dữ liệu mới
    if (isUpdated) saveDatabase();
  }
  
  return userSessions[userId];
};

// --- 2. QUẢN LÝ DANH SÁCH TRẮNG (WHITELIST) ---
function readDataFile(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(fallback)) return Array.isArray(parsed) ? parsed.map(String) : fallback;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    console.error('Telegram data file is invalid:', path.basename(file), error.message);
    throw new Error('Cannot read Telegram user data: ' + path.basename(file));
  }
}
let whitelist = readDataFile(WL_PATH, []);
const saveWhitelist = () => atomicWrite(WL_PATH, whitelist);
const isAuthorized = (userId) => whitelist.includes(userId.toString());
const addAuthorizedUser = (userId) => { if (!whitelist.includes(userId.toString())) { whitelist.push(userId.toString()); saveWhitelist(); } };
const removeAuthorizedUser = (userId) => { whitelist = whitelist.filter(id => id !== userId.toString()); saveWhitelist(); };
const getWhitelist = () => whitelist;

// --- 3. QUẢN LÝ TỪ VỰNG (FLASHCARD) ---
let userVocabs = readDataFile(VOCAB_PATH, {});
// Legacy JSON is read-only, for /exportlocal. New saves use MongoDB.

const getVocabulary = (userId) => userVocabs[userId] || [];

module.exports = { 
  getUserConfig, saveDatabase, 
  isAuthorized, addAuthorizedUser, removeAuthorizedUser, getWhitelist,
  getVocabulary
};