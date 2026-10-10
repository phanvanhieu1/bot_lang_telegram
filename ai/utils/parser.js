
function parseFreeTranslation(content) {
  if (
    typeof content !== 'string' ||
    !content.trim()
  ) {
    throw new Error(
      'FREE provider returned empty content'
    );
  }

  const translationMatch = content.match(
    /TRANSLATION:\s*([\s\S]*?)(?=\nBACK_TRANSLATION:|$)/i
  );

  const backTranslationMatch = content.match(
    /BACK_TRANSLATION:\s*([\s\S]*?)$/i
  );

  const translation =
    translationMatch?.[1]?.trim();

  const backTranslation =
    backTranslationMatch?.[1]?.trim() || null;

  if (!translation) {
    throw new Error(
      'Invalid FREE translation format'
    );
  }

  return {
    translation,
    backTranslation
  };
}

module.exports = {
  parseFreeTranslation
};
