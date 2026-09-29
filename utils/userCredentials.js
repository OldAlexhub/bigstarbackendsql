export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;

const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const COMMON_PASSWORDS = new Set([
  "admin123456!",
  "changeme123!",
  "letmein123!",
  "password123!",
  "password1234!",
  "qwerty123456!",
  "temporary123!",
  "welcome12345!",
]);

export const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();

export const isValidEmail = (value) => {
  const email = normalizeEmail(value);
  if (!email || email.length > 254 || /\s/.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  const labels = domain.split(".");
  if (labels.length < 2 || !/^[a-z]{2,63}$/i.test(labels.at(-1))) return false;
  return labels.every((label) => (
    label.length >= 1
      && label.length <= 63
      && /^[a-z0-9-]+$/i.test(label)
      && !label.startsWith("-")
      && !label.endsWith("-")
  ));
};

export const passwordValidationMessage = (value, { username = "", email = "", allowHash = false } = {}) => {
  const password = String(value ?? "");
  if (allowHash && BCRYPT_HASH.test(password)) return null;
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) return `Password must be no more than ${PASSWORD_MAX_BYTES} UTF-8 bytes.`;
  if (!/[a-z]/.test(password)) return "Password must include a lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Password must include an uppercase letter.";
  if (!/\d/.test(password)) return "Password must include a number.";
  if (!/[^A-Za-z0-9\s]/.test(password)) return "Password must include a symbol.";
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return "Choose a less common password.";

  const lowerPassword = password.toLowerCase();
  const personalValues = [
    String(username || "").trim().toLowerCase(),
    normalizeEmail(email).split("@")[0],
  ].filter((item) => item.length >= 4);
  if (personalValues.some((item) => lowerPassword.includes(item))) {
    return "Password must not contain the username or email name.";
  }
  return null;
};
