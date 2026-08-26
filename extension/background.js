/* Slice 11. Native messaging only. No chrome.runtime message type that executes CDP from the page. */
import { onPageMessage } from "./native-protocol.js";

chrome.runtime.onMessage.addListener(onPageMessage);
