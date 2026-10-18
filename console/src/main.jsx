// SPDX-License-Identifier: Apache-2.0
import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import './styles/console.css';
import { Login } from './shell/Login.jsx';
import { Desktop } from './shell/Desktop.jsx';
import { phase, expired, user, board, start } from './state.js';

function App() {
 useEffect(() => { start(); }, []);
 const identity = board.value;
 useEffect(() => {
  document.title = phase.value === 'desktop' && identity
   ? `${user.value}@${location.hostname} (${identity.hostname}) - RouterDeck Console ${__VERSION__} on ${identity.model} (${identity.release?.target ?? identity.system})`
   : 'RouterDeck Console';
 }, [phase.value, identity, user.value]);

 if (phase.value === 'starting') return <div class="rd-starting" role="status">Connecting…</div>;
 if (phase.value === 'login') return <Login />;
 return (
  <>
   <Desktop inert={expired.value} />
   {expired.value && <Login overlay />}
  </>
 );
}

render(<App />, document.getElementById('app'));
