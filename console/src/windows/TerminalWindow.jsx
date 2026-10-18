// SPDX-License-Identifier: Apache-2.0
// Terminal: the router's shell through ttyd, embedded from its own port.
// ttyd asks for a login itself; this console never handles that password.
import { useSources } from '../api/sources.js';
import { errorText } from '../api/actions.js';

export function terminalUrl(info, page = location) {
 if (info?.url_override) return info.url_override;
 const secure = !!info?.ssl;
 const host = page.hostname.includes(':') ? `[${page.hostname}]` : page.hostname;
 return `${secure ? 'https' : 'http'}://${host}:${info?.port ?? 7681}/`;
}

export function TerminalWindow({ active }) {
 const { data, errors } = useSources(['terminal'], active);
 const info = data.terminal;
 if (errors.length) return <div class="rd-terminal-note">Could not check ttyd: {errorText(errors[0])}</div>;
 if (!info) return <div class="rd-terminal-note">Checking ttyd…</div>;
 if (!info.installed) {
  return (
   <div class="rd-terminal-note">
    <p>The terminal uses the ttyd package, which is not installed.</p>
    <p><code>apk add ttyd</code> on OpenWrt 25.12, <code>opkg install ttyd</code> on 24.10.</p>
   </div>
  );
 }
 if (!info.running) return <div class="rd-terminal-note"><p>ttyd is installed but not running.</p><p><code>/etc/init.d/ttyd enable &amp;&amp; /etc/init.d/ttyd start</code></p></div>;
 const url = terminalUrl(info);
 const mixed = location.protocol === 'https:' && url.startsWith('http:');
 if (mixed) return <div class="rd-terminal-note"><p>This page uses HTTPS but ttyd does not, so the browser blocks it.</p><p>Enable SSL for ttyd or open <a href={url} target="_blank" rel="noopener">{url}</a>.</p></div>;
 return <iframe class="rd-terminal-frame" title="Router terminal" src={url} allow="clipboard-read; clipboard-write" />;
}
