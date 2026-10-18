// SPDX-License-Identifier: Apache-2.0
// Original outline icons on a 24-unit grid, drawn at 16px. No vendor artwork.

const PATHS = {
 quickset: 'M13 2 4 14h7l-1 8 9-12h-7z',
 interfaces: 'M8 2h8v6H8z M12 8v5 M5 13h14 M5 13v3 M19 13v3 M2 16h6v6H2z M16 16h6v6h-6z',
 ip: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
 wireless: 'M2 8a15 15 0 0 1 20 0 M5 12a10 10 0 0 1 14 0 M8.5 15.5a5 5 0 0 1 7 0 M12 19h.01',
 ppp: 'M4 12h4 M16 12h4 M8 8h8v8H8z M2 9v6 M22 9v6',
 ipv6: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z M17 17l4 4 M21 17l-4 4',
 bridge: 'M2 9h20 M5 9v9 M19 9v9 M9 9v5 M15 9v5 M2 18h20 M5 9c2-4 12-4 14 0',
 system: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M12 2v3 M12 19v3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M2 12h3 M19 12h3 M4.9 19.1 7 17 M17 7l2.1-2.1',
 routing: 'M6 3v12a4 4 0 0 0 4 4h8 M15 16l3 3-3 3 M6 3l-3 3 M6 3l3 3',
 queues: 'M3 6h18 M3 12h12 M3 18h6 M18 15l3 3-3 3',
 log: 'M4 2h11l5 5v15H4z M15 2v5h5 M8 11h8 M8 15h8 M8 19h5',
 files: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
 tools: 'M14.5 4.5a4.5 4.5 0 0 0-5.8 5.8L3 16l5 5 5.7-5.7a4.5 4.5 0 0 0 5.8-5.8l-2.8 2.8-3-1-1-3z',
 shell: 'M4 17l6-5-6-5 M12 19h8',
 terminal: 'M3 4h18v16H3z M6 8l4 4-4 4 M13 16h5',
 luci: 'M4 3h16a1 1 0 0 1 1 1v12H3V4a1 1 0 0 1 1-1Z M8 21h8 M12 16v5',
 exit: 'M10 3H3v18h7 M14 7l6 5-6 5 M8 12h12',
 undo: 'M9 14 4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3',
 redo: 'M15 14l5-5-5-5 M20 9H9a5 5 0 0 0 0 10h3',
 add: 'M12 5v14 M5 12h14',
 remove: 'M5 12h14',
 enable: 'M5 12.5l4.5 4.5L19 7.5',
 disable: 'M6 6l12 12 M18 6 6 18',
 comment: 'M4 4h16v12H9l-5 4z M8 9h8 M8 12h5',
 filter: 'M3 4h18l-7 8.5V19l-4 2v-8.5z',
 minimize: 'M6 17h12',
 maximize: 'M5 5h14v14H5z',
 restore: 'M8 8h11v11H8z M5 16V5h11',
 close: 'M6 6l12 12 M18 6 6 18',
 chevron: 'M9 6l6 6-6 6',
 window: 'M3 4h18v16H3z M3 8h18',
 sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
 moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z',
 contrast: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 3v18 M12 3a9 9 0 0 1 0 18'
};

export function Icon({ name, size = 16 }) {
 return (
  <svg class="rd-icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
   <path d={PATHS[name] || PATHS.window} />
  </svg>
 );
}
