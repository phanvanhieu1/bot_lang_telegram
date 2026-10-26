const fs = require('fs');
const path = require('path');
const { LANG_CONFIG, VOICES, SPEED_OPTIONS } = require('./config');

// The production bot uses the repository's legacy data files.
 // The test entry point sets TELEGRAM_DATA_DIR before this module is loaded.
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

const saveDatabase = () => fs.writeFileSync(DB_PATH, JSON.stringify(userSessions, null, 2), 'utf8');

const getUserConfig = (userId) => {
  // 1. NẾU LÀ NGƯỜI DÙNG HOÀN TOÀN MỚI
  if (!userSessions[userId]) {
    userSessions[userId] = { 
      targetLang: 'zh', 
      voiceKey: 'sarah', 
      speed: 1.0, 
      showTranslation: true, 
      showPronunciation: true, 
      showVocabulary: true, 
      enableVoice: true,
      history: [],  // Thuộc tính mới
      lastVocab: "", // Legacy pending vocab
      pendingVocabs: {} // Snapshot per translation message
    };
    saveDatabase();
  } 
  // Safely migrate older settings and avoid malformed persisted history.
  else {
    let isUpdated = false;
    const defaults = {
      targetLang: 'zh', voiceKey: 'sarah', speed: 1,
      showTranslation: true, showPronunciation: true,
      showVocabulary: true, enableVoice: true
    };
    for (const [key, value] of Object.entries(defaults)) {
      if (userSessions[userId][key] === undefined) {
        userSessions[userId][key] = value;
        isUpdated = true;
      }
    }
    if (!Array.isArray(userSessions[userId].history)) {
      userSessions[userId].history = [];
      isUpdated = true;
    }
    
    // Nếu dữ liệu cũ chưa có mảng history -> Khởi tạo mảng rỗng
    if (!userSessions[userId].history) {
      userSessions[userId].history = [];
      isUpdated = true;
    }
    
    // Nếu dữ liệu cũ chưa có biến lưu từ vựng -> Khởi tạo chuỗi rỗng
    if (userSessions[userId].lastVocab === undefined) {
      userSessions[userId].lastVocab = "";
      isUpdated = true;
    }
    
    if (!userSessions[userId].pendingVocabs || typeof userSessions[userId].pendingVocabs !== 'object' || Array.isArray(userSessions[userId].pendingVocabs)) {
      userSessions[userId].pendingVocabs = {};
      isUpdated = true;
    }
    if (!Object.prototype.hasOwnProperty.call(LANG_CONFIG, userSessions[userId].targetLang)) {
      userSessions[userId].targetLang = 'zh';
      isUpdated = true;
    }
    if (!Object.prototype.hasOwnProperty.call(VOICES, userSessions[userId].voiceKey)) {
      userSessions[userId].voiceKey = 'sarah';
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
const saveWhitelist = () => fs.writeFileSync(WL_PATH, JSON.stringify(whitelist, null, 2), 'utf8');
const isAuthorized = (userId) => whitelist.includes(userId.toString());
const addAuthorizedUser = (userId) => { if (!whitelist.includes(userId.toString())) { whitelist.push(userId.toString()); saveWhitelist(); } };
const removeAuthorizedUser = (userId) => { whitelist = whitelist.filter(id => id !== userId.toString()); saveWhitelist(); };
const getWhitelist = () => whitelist;

// --- 3. QUẢN LÝ TỪ VỰNG (FLASHCARD) ---
let userVocabs = readDataFile(VOCAB_PATH, {});
const saveVocabDB = () => fs.writeFileSync(VOCAB_PATH, JSON.stringify(userVocabs, null, 2), 'utf8');

const saveVocabulary = (userId, vocabText) => {
  if (!userVocabs[userId]) userVocabs[userId] = [];
  // Tách từng dòng từ vựng và đẩy vào mảng
  const lines = vocabText.split('\n').filter(l => l.trim().startsWith('-'));
  const existing = new Set(userVocabs[userId]);
  const unique = lines.filter(line => {
    const item = line.trim();
    if (existing.has(item)) return false;
    existing.add(item);
    return true;
  }).map(line => line.trim());
  userVocabs[userId].push(...unique);
  if (unique.length) saveVocabDB();
  return unique.length;
};

const getVocabulary = (userId) => userVocabs[userId] || [];
const clearVocabulary = (userId) => { userVocabs[userId] = []; saveVocabDB(); };

module.exports = { 
  getUserConfig, saveDatabase, 
  isAuthorized, addAuthorizedUser, removeAuthorizedUser, getWhitelist,
  saveVocabulary, getVocabulary, clearVocabulary
};