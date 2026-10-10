
const {
  containsChinese
} = require('../prompts/free.prompt');

function createInvalidOutputError(message) {
  const error = new Error(message);
  error.code = 'INVALID_OUTPUT';
  return error;
}

function validateFreeTranslation(
  originalText,
  parsed
) {
  const inputIsChinese =
    containsChinese(originalText);

  if (inputIsChinese) {
    // Trung → Việt: kết quả không được chứa chữ Hán
    if (containsChinese(parsed.translation)) {
      throw createInvalidOutputError(
        'Invalid FREE Chinese-to-Vietnamese translation'
      );
    }

    return;
  }

  // Việt → Trung: kết quả phải chứa chữ Hán
  if (!containsChinese(parsed.translation)) {
    throw createInvalidOutputError(
      'Invalid FREE Vietnamese-to-Chinese translation'
    );
  }
}

module.exports = {
  validateFreeTranslation,
  createInvalidOutputError
};
