// CR-009 stage 3: images as source materials. An image goes only from the browser to the local
// connector on this PC and from there to Codex as an image input (codex exec -i); it is never
// sent to the Worker or to Claude's cloud Routine. The type is decided by the file signature.
export const IMAGE_LIMITS = Object.freeze({ count: 10, bytesEach: 10 * 1024 * 1024, bytesTotal: 30 * 1024 * 1024 });

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif', 'ico']);
const EXTENSIONS = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
export const imageExtension = (mime) => EXTENSIONS[mime];

// Whether an attachment is an image, from its name or MIME type (SVG is text and is read as such).
export function isImageAttachment(attachment) {
  const type = typeof attachment?.type === 'string' ? attachment.type.toLowerCase() : '';
  if (type === 'image/svg+xml') return false;
  if (type.startsWith('image/')) return true;
  const extension = /\.([^./\\]+)$/.exec(String(attachment?.name ?? ''))?.[1]?.toLowerCase();
  return IMAGE_EXTENSIONS.has(extension);
}

// The image type Codex accepts, read from the first bytes: PNG, JPEG, GIF or WebP; otherwise null.
export function imageKind(bytes) {
  const at = (index) => bytes[index];
  const ascii = (start, text) => [...text].every((char, index) => at(start + index) === char.charCodeAt(0));
  if (bytes.length >= 8 && at(0) === 0x89 && ascii(1, 'PNG') && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return 'image/png';
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && (ascii(0, 'GIF87a') || ascii(0, 'GIF89a'))) return 'image/gif';
  if (bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  return null;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_BASE64 = Math.ceil(IMAGE_LIMITS.bytesEach / 3) * 4;

export function encodeImageData(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

// Validates one image's base64 data: size first (before decoding), then the signature.
export function checkedImage(data) {
  if (typeof data !== 'string') throw new TypeError('Image data must be base64');
  if (data.length > MAX_BASE64) throw new RangeError('An image can be at most 10 MB');
  if (data.length % 4 !== 0 || !BASE64.test(data)) throw new TypeError('Image data must be base64');
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytes.length > IMAGE_LIMITS.bytesEach) throw new RangeError('An image can be at most 10 MB');
  const mime = imageKind(bytes);
  if (!mime) throw new TypeError('Images must be PNG, JPEG, GIF or WebP');
  return { mime, bytes };
}
