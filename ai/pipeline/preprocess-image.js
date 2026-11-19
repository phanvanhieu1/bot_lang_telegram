const MAX_BYTES = 5 * 1024 * 1024;

function actualImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  )
    return 'image/jpeg';
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

function preprocessImage(buffer) {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < 100 ||
    buffer.length > MAX_BYTES
  ) {
    throw Object.assign(
      new Error('Ảnh phải nhỏ hơn 5 MB và không được để trống'),
      { status: 400 }
    );
  }
  const mimeType = actualImageType(buffer);
  if (!mimeType)
    throw Object.assign(
      new Error('Chỉ hỗ trợ ảnh PNG, JPEG hoặc WebP hợp lệ'),
      { status: 400 }
    );
  return { mimeType, bytes: buffer.length };
}

module.exports = { preprocessImage, actualImageType, MAX_BYTES };
