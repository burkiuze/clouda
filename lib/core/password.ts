/**
 * Password policy.
 *
 * The rule that actually stops account takeover is "not a password everyone
 * else already uses", so the checks here weigh reuse and predictability rather
 * than demanding a symbol. Composition rules push people toward `Password1!`,
 * which is on every cracking list ever published.
 */

/** The passwords that dominate every credential dump, plus local favourites. */
const COMMON = new Set([
  "password", "password1", "password123", "passw0rd", "12345678", "123456789",
  "1234567890", "qwerty123", "qwertyuiop", "111111111", "iloveyou", "sunshine",
  "princess", "football", "baseball", "welcome1", "admin123", "letmein1",
  "monkey123", "dragon123", "abc12345", "trustno1", "superman", "starwars",
  "whatever", "zaq12wsx", "asdfghjkl", "1q2w3e4r", "1qaz2wsx", "qazwsxedc",
  "sifre123", "parola123", "galatasaray", "fenerbahce", "besiktas", "trabzonspor",
  "istanbul", "turkiye1", "ankara123", "sifrem123", "deneme123", "qwerty12",
]);

export interface PasswordVerdict {
  ok: boolean;
  /** Message shown to the user; empty when ok. */
  message: string;
}

const MIN_LENGTH = 10;

function isRepeated(value: string): boolean {
  return /^(.)\1+$/.test(value);
}

function isSequential(value: string): boolean {
  const lower = value.toLowerCase();
  const runs = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i + lower.length <= runs.length; i += 1) {
    const window = runs.slice(i, i + lower.length);
    if (window === lower) return true;
    if ([...window].reverse().join("") === lower) return true;
  }
  return false;
}

/**
 * Whether the password is padded out with repetition rather than content.
 *
 * Measured two different ways on purpose. A share-of-length test is right for
 * short passwords but wrong for long ones: any real passphrase reuses letters,
 * so "bu benim cok uzun parolam ve bunu kimse tahmin edemez" scores 0.34 and
 * would be refused while the far weaker "Xk7#mQ2vLp9" passes. Past passphrase
 * length the question that matters is whether the alphabet is wide at all.
 */
function hasEnoughVariety(value: string): boolean {
  const distinct = new Set(value).size;
  return value.length >= 16 ? distinct >= 8 : distinct / value.length >= 0.4;
}

export function checkPassword(password: string, email?: string, name?: string): PasswordVerdict {
  if (password.length < MIN_LENGTH) {
    return { ok: false, message: `Şifre en az ${MIN_LENGTH} karakter olmalı.` };
  }
  if (password.length > 200) {
    return { ok: false, message: "Şifre en fazla 200 karakter olabilir." };
  }

  const lower = password.toLowerCase();

  if (COMMON.has(lower)) {
    return { ok: false, message: "Bu şifre çok yaygın kullanılıyor, başka bir şey seç." };
  }
  if (isRepeated(password) || isSequential(password)) {
    return { ok: false, message: "Şifre tahmin edilebilir bir dizi. Daha rastgele bir şey seç." };
  }
  if (!hasEnoughVariety(password)) {
    return { ok: false, message: "Şifrede çok fazla tekrar var. Daha çeşitli karakterler kullan." };
  }

  // A password built from the account's own identifiers is the first thing
  // anyone tries.
  const localPart = email?.split("@")[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && lower.includes(localPart)) {
    return { ok: false, message: "Şifre e-posta adresini içeremez." };
  }
  if (name && name.trim().length >= 4 && lower.includes(name.trim().toLowerCase())) {
    return { ok: false, message: "Şifre adını içeremez." };
  }

  return { ok: true, message: "" };
}

/** Work factor for bcrypt. 12 is the current sensible floor for new hashes. */
export const BCRYPT_ROUNDS = 12;
