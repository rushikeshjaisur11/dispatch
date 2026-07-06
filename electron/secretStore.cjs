const path = require("path");
const fs = require("fs");
const { safeStorage } = require("electron");

/** Per-key `safeStorage`-encrypted files under userData/secure-keys/ — port of Dhwani's
 * environment.js/secretCrypto.js pattern, replacing the Rust `keyring` crate. One file per
 * secret name so BYOK provider keys and the Google refresh token share the same store. */
let secretsDir = null;

function init(userDataDir) {
  secretsDir = path.join(userDataDir, "secure-keys");
  fs.mkdirSync(secretsDir, { recursive: true });
}

function fileFor(name) {
  return path.join(secretsDir, `${name}.enc`);
}

function setSecret(name, value) {
  const encrypted = safeStorage.encryptString(value);
  fs.writeFileSync(fileFor(name), encrypted);
}

function getSecret(name) {
  const file = fileFor(name);
  if (!fs.existsSync(file)) return null;
  try {
    return safeStorage.decryptString(fs.readFileSync(file));
  } catch {
    return null;
  }
}

function deleteSecret(name) {
  const file = fileFor(name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

module.exports = { init, setSecret, getSecret, deleteSecret };
