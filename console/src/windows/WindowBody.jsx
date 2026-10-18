// SPDX-License-Identifier: Apache-2.0
// Window contents by kind.
import { WINDOW_KINDS } from './kinds.js';
import { ListWindow } from '../list/ListWindow.jsx';
import { ItemWindow } from '../item/ItemWindow.jsx';
import { TerminalWindow } from './TerminalWindow.jsx';
import { PingWindow, TracerouteWindow, TorchWindow, BandwidthWindow, ScanWindow, GraphsWindow } from './ToolWindows.jsx';
import { CliWindow } from './CliWindow.jsx';

const TOOLS = { ping: PingWindow, traceroute: TracerouteWindow, torch: TorchWindow, bandwidth: BandwidthWindow, scan: ScanWindow, graphs: GraphsWindow };

export function WindowBody({ win }) {
 const spec = WINDOW_KINDS[win.kind];
 const active = !win.minimized;
 if (spec.body === 'shell') return <TerminalWindow active={active} />;
 if (spec.body === 'cli') return <CliWindow win={win} active={active} />;
 if (spec.body === 'item') return <ItemWindow win={win} active={active} />;
 const Tool = TOOLS[spec.body];
 if (Tool) return <Tool win={win} active={active} />;
 return <ListWindow spec={spec} kind={win.kind} win={win} active={active} />;
}
