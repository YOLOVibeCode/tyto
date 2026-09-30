export { USAGE, main, type CliDeps } from "./main.ts";
export { composeDeps } from "./compose.ts";
export { requestControl, serveControl, type ControlReply, type ControlRequest } from "./learn/control.ts";
export { runListener, type ListenerDeps } from "./learn/listener.ts";
export { learnCommand, type LearnDeps } from "./learn/commands.ts";
