/* Slice 11. Native messaging only. No chrome.runtime message type that executes CDP from the page. */
chrome.runtime.onMessage.addListener(() => false);
