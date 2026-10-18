// SPDX-License-Identifier: Apache-2.0
import { useState, useRef, useEffect } from 'preact/hooks';
import { login, user } from '../state.js';

const mockHint = () => document.querySelector('meta[name="routerdeck-mock-login"]')?.content;

export function Login({ overlay = false }) {
 const [username, setUsername] = useState(user.value || 'root');
 const [password, setPassword] = useState('');
 const [error, setError] = useState('');
 const [busy, setBusy] = useState(false);
 const passwordRef = useRef();
 const hint = mockHint();

 useEffect(() => { passwordRef.current?.focus(); }, []);

 async function submit(event) {
  event.preventDefault();
  setBusy(true);
  setError('');
  try {
   await login(username.trim(), password);
  } catch (failure) {
   setError(failure.message || 'Could not connect');
   setPassword('');
   passwordRef.current?.focus();
  } finally {
   setBusy(false);
  }
 }

 const form = (
  <form class="rd-login-box" onSubmit={submit} aria-labelledby="rd-login-title" role={overlay ? 'dialog' : undefined} aria-modal={overlay ? 'true' : undefined}>
   <h1 id="rd-login-title"><img src="mark.svg" alt="" width="16" height="16" />{overlay ? 'Session expired' : 'RouterDeck Console'}</h1>
   {overlay && <p class="rd-login-note">Log in again to continue. Open windows stay as they are.</p>}
   {hint && !overlay && <p class="rd-login-note">Simulated router: {hint}.</p>}
   <div class="rd-login-fields">
    <label for="rd-connect-to">Connect To</label>
    <input id="rd-connect-to" value={location.host} readOnly />
    <label for="rd-username">Login</label>
    <input id="rd-username" name="username" autocomplete="username" autocapitalize="off" spellcheck={false} required
     value={username} onInput={event => setUsername(event.currentTarget.value)} />
    <label for="rd-password">Password</label>
    <input id="rd-password" ref={passwordRef} name="password" type="password" autocomplete="current-password"
     value={password} onInput={event => setPassword(event.currentTarget.value)} />
   </div>
   {error && <p class="rd-login-error" role="alert">{error}</p>}
   <div class="rd-login-actions">
    <button type="submit" class="rd-button" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button>
   </div>
  </form>
 );
 return overlay ? <div class="rd-login-overlay">{form}</div> : <main class="rd-login">{form}</main>;
}
