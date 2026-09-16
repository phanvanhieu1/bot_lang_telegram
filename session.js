const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.json');
const WL_PATH = path.join(__dirname, 'whitelist.json');
const VOCAB_PATH = path.join(__dirname, 'vocabulary.json'); // File lưu từ vựng

// --- 1. QUẢN LÝ CÀI ĐẶT & LỊCH SỬ CHAT ---
let userSessions = {};
if (fs.existsSync(DB_PATH)) {
  try { userSessions = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch (e) {}
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
      lastVocab: "" // Thuộc tính mới
    };
    saveDatabase();
  } 
  // 2. NẾU LÀ NGƯỜI DÙNG CŨ (Fix lỗi undefined ở đây)
  else {
    let isUpdated = false;
    
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
    
    // Lưu lại ổ cứng nếu có vá thêm dữ liệu mới
    if (isUpdated) saveDatabase();
  }
  
  return userSessions[userId];
};

// --- 2. QUẢN LÝ DANH SÁCH TRẮNG (WHITELIST) ---
let whitelist = fs.existsSync(WL_PATH) ? JSON.parse(fs.readFileSync(WL_PATH, 'utf8')) : [];
const saveWhitelist = () => fs.writeFileSync(WL_PATH, JSON.stringify(whitelist, null, 2), 'utf8');
const isAuthorized = (userId) => whitelist.includes(userId.toString());
const addAuthorizedUser = (userId) => { if (!whitelist.includes(userId.toString())) { whitelist.push(userId.toString()); saveWhitelist(); } };
const removeAuthorizedUser = (userId) => { whitelist = whitelist.filter(id => id !== userId.toString()); saveWhitelist(); };
const getWhitelist = () => whitelist;

// --- 3. QUẢN LÝ TỪ VỰNG (FLASHCARD) ---
let userVocabs = fs.existsSync(VOCAB_PATH) ? JSON.parse(fs.readFileSync(VOCAB_PATH, 'utf8')) : {};
const saveVocabDB = () => fs.writeFileSync(VOCAB_PATH, JSON.stringify(userVocabs, null, 2), 'utf8');

const saveVocabulary = (userId, vocabText) => {
  if (!userVocabs[userId]) userVocabs[userId] = [];
  // Tách từng dòng từ vựng và đẩy vào mảng
  const lines = vocabText.split('\n').filter(l => l.trim().startsWith('-'));
  userVocabs[userId].push(...lines);
  saveVocabDB();
  return lines.length;
};

const getVocabulary = (userId) => userVocabs[userId] || [];
const clearVocabulary = (userId) => { userVocabs[userId] = []; saveVocabDB(); };

module.exports = { 
  getUserConfig, saveDatabase, 
  isAuthorized, addAuthorizedUser, removeAuthorizedUser, getWhitelist,
  saveVocabulary, getVocabulary, clearVocabulary
};