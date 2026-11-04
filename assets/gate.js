// Password screen shown before the hub loads. The hub code (app.js) is only imported after
// the right password is entered. This keeps casual visitors out; it is not server-side security,
// because the published files are still public if someone knows their exact address.
import { GATE } from './gate-config.js';

const STORAGE_KEY = 'hub-gate-unlocked';
const APP_URL = './app.js?v=20261104a';

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(GATE.salt), iterations: GATE.iterations },
    key,
    256,
  );
  return toHex(bits);
}

function remembered() {
  try {
    return localStorage.getItem(STORAGE_KEY) === GATE.hash;
  } catch {
    return false;
  }
}

function remember() {
  try {
    localStorage.setItem(STORAGE_KEY, GATE.hash);
  } catch {
    // private mode: the visitor just types the password again next time
  }
}

function showGate() {
  const gate = document.createElement('div');
  gate.className = 'gate';
  gate.innerHTML = `
    <form class="gate__card" autocomplete="off">
      <h1>Exhibition Hub</h1>
      <p>Enter the password to continue.</p>
      <input class="gate__input" type="password" name="password" placeholder="Password" autocomplete="current-password" aria-label="Password" required />
      <p class="gate__error" role="alert" hidden></p>
      <button class="gate__button" type="submit">Open</button>
    </form>`;
  document.body.append(gate);

  const form = gate.querySelector('form');
  const input = gate.querySelector('input');
  const error = gate.querySelector('.gate__error');
  const button = gate.querySelector('button');
  input.focus();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;

    if (!globalThis.crypto?.subtle) {
      error.textContent = 'This page must be opened over https to check the password.';
      error.hidden = false;
      return;
    }

    button.disabled = true;
    const hash = await hashPassword(input.value);
    if (hash === GATE.hash) {
      remember();
      gate.remove();
      await import(APP_URL);
      return;
    }

    button.disabled = false;
    error.textContent = 'Wrong password.';
    error.hidden = false;
    input.select();
  });
}

if (!GATE || remembered()) {
  await import(APP_URL);
} else {
  showGate();
}
