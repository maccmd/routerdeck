// SPDX-License-Identifier: Apache-2.0
// Window contents by kind.
import { WINDOW_KINDS } from './kinds.js';
import { ListWindow } from '../list/ListWindow.jsx';
import { ItemWindow } from '../item/ItemWindow.jsx';
import { TerminalWindow } from './TerminalWindow.jsx';

export function WindowBody({ win }) {
 const spec = WINDOW_KINDS[win.kind];
 const active = !win.minimized;
 if (spec.body === 'terminal') return <TerminalWindow active={active} />;
 if (spec.body === 'item') return <ItemWindow win={win} active={active} />;
 return <ListWindow spec={spec} kind={win.kind} active={active} />;
}
