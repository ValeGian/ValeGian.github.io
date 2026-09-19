/**
 * Encryption for the personal files.
 *
 * The repository is public, so the password is not a curtain over readable data — it is
 * the decryption key, and the only thing between a stranger and the contents.
 *
 * Every file is a self-describing envelope with two layers:
 *
 *   password --PBKDF2--> wrapping key --unwraps--> file key --decrypts--> payload
 *
 * The indirection is what lets one file be opened by two different passwords. Each file
 * has its own random AES-256-GCM key; that key is wrapped under the owner's password in
 * the file itself, and again under the admin password in the keyring. Opening the
 * keyring therefore opens everything, while a friend's password opens exactly one file.
 * It also means changing a password re-wraps a key rather than re-encrypting the data.
 *
 * Runs unmodified in the browser and in Node: both expose the same WebCrypto API.
 */

const subtle = globalThis.crypto.subtle;

export const KDF = {
  name: 'PBKDF2',
  hash: 'SHA-256',
  /**
   * The ciphertext is public and can be attacked offline forever, so the only defence is
   * making each guess expensive. 600k is the OWASP floor for PBKDF2-SHA256 and costs
   * well under a second on the oldest phone this has to run on.
   */
  iterations: 600_000,
};

const CIPHER = 'AES-GCM';
const KEY_BITS = 256;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const randomBytes = (length) => globalThis.crypto.getRandomValues(new Uint8Array(length));

export const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export const fromBase64 = (text) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

/** Stretches a password into the key that wraps a file key. Never used on data directly. */
async function wrappingKey(password, salt) {
  const material = await subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: KDF.name, hash: KDF.hash, iterations: KDF.iterations, salt },
    material,
    { name: CIPHER, length: KEY_BITS },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function seal(key, value) {
  const iv = randomBytes(IV_BYTES);
  const data = await subtle.encrypt({ name: CIPHER, iv }, key, encoder.encode(JSON.stringify(value)));
  return { iv: toBase64(iv), data: toBase64(data) };
}

async function open(key, sealed) {
  const plain = await subtle.decrypt({ name: CIPHER, iv: fromBase64(sealed.iv) }, key, fromBase64(sealed.data));
  return JSON.parse(decoder.decode(plain));
}

/** A fresh key for one file. Exported raw only to be wrapped, never stored in the clear. */
export const newFileKey = () => subtle.generateKey({ name: CIPHER, length: KEY_BITS }, true, ['encrypt', 'decrypt']);

export const exportFileKey = async (key) => toBase64(await subtle.exportKey('raw', key));

export const importFileKey = (base64) =>
  subtle.importKey('raw', fromBase64(base64), { name: CIPHER, length: KEY_BITS }, true, ['encrypt', 'decrypt']);

/**
 * Builds an envelope: the payload under a file key, and that file key under a password.
 * Pass an existing key to keep a file readable through the keyring after a rewrite.
 */
export async function encrypt(password, payload, fileKey = null) {
  const key = fileKey ?? (await newFileKey());
  const salt = randomBytes(SALT_BYTES);
  const wrapper = await wrappingKey(password, salt);
  const iv = randomBytes(IV_BYTES);
  const wrapped = await subtle.wrapKey('raw', key, wrapper, { name: CIPHER, iv });

  return {
    envelope: {
      v: 1,
      kdf: { ...KDF, salt: toBase64(salt) },
      wrapped: { iv: toBase64(iv), data: toBase64(wrapped) },
      payload: await seal(key, payload),
    },
    key,
  };
}

/**
 * Opens an envelope with its password.
 *
 * A wrong password fails when AES-GCM rejects the authentication tag, so there is no
 * separate check to get wrong and no way to tell a wrong password from corrupt data
 * without decrypting. Callers get `null`; distinguishing the two would leak whether a
 * password was close.
 */
export async function decrypt(password, envelope) {
  if (envelope?.v !== 1) throw new Error(`Unsupported envelope version: ${envelope?.v}`);

  try {
    const wrapper = await wrappingKey(password, fromBase64(envelope.kdf.salt));
    const key = await subtle.unwrapKey(
      'raw',
      fromBase64(envelope.wrapped.data),
      wrapper,
      { name: CIPHER, iv: fromBase64(envelope.wrapped.iv) },
      { name: CIPHER, length: KEY_BITS },
      true,
      ['encrypt', 'decrypt'],
    );
    return { payload: await open(key, envelope.payload), key };
  } catch {
    return null;
  }
}

/** Opens an envelope with the file key straight from the keyring, skipping the password. */
export async function decryptWithKey(key, envelope) {
  if (envelope?.v !== 1) throw new Error(`Unsupported envelope version: ${envelope?.v}`);
  try {
    return await open(key, envelope.payload);
  } catch {
    return null;
  }
}

/**
 * Replaces an envelope's contents, keeping its wrapping exactly as it was.
 *
 * Saving therefore needs the file key, which is held from the unlock, and never the
 * password. Nothing has to keep a password in memory to write, and the keyring still
 * opens the file because its key did not change.
 */
export async function resealPayload(envelope, key, payload) {
  if (envelope?.v !== 1) throw new Error(`Unsupported envelope version: ${envelope?.v}`);
  return { ...envelope, payload: await seal(key, payload) };
}

/** Re-wraps a file's key under a new password. The payload is untouched. */
export async function changePassword(oldPassword, envelope, newPassword) {
  const opened = await decrypt(oldPassword, envelope);
  if (!opened) return null;
  const { envelope: next } = await encrypt(newPassword, opened.payload, opened.key);
  return next;
}
