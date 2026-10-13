type Params = Readonly<Record<string, unknown>>;

function s(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
}

const FIND_BY: Readonly<Record<string, [string, string]>> = {
  getbyrole: ["role", "role"],
  getbytext: ["text", "text"],
  getbylabel: ["label", "label"],
  getbyplaceholder: ["placeholder", "placeholder"],
  getbyalttext: ["alt", "text"],
  getbytitle: ["title", "text"],
  getbytestid: ["testid", "testId"],
};

function findTail(p: Params): string[] {
  const tail = [s(p.subaction) || "click"];
  if (p.value !== undefined) tail.push(s(p.value));
  if (typeof p.name === "string" && p.name !== "") tail.push("--name", p.name);
  if (p.exact === true) tail.push("--exact");
  return tail;
}

/** Map an agent-browser internal action back to its CLI argv (the form recipes use). Unknown → null. */
export function actionToArgv(action: string, p: Params): string[] | null {
  const by = FIND_BY[action];
  if (by) return ["find", by[0], s(p[by[1]]), ...findTail(p)];
  switch (action) {
    case "navigate":
      return ["open", s(p.url)];
    case "click":
    case "dblclick":
    case "check":
    case "uncheck":
    case "hover":
    case "scrollintoview":
      return [action, s(p.selector)];
    case "fill":
      return ["fill", s(p.selector), s(p.value)];
    case "type":
      return ["type", s(p.selector), s(p.text)];
    case "press":
      return ["press", s(p.key)];
    case "select":
      return ["select", s(p.selector), ...(Array.isArray(p.values) ? p.values.map(s) : [s(p.values)])];
    case "scroll":
      return ["scroll", ...[s(p.direction), s(p.amount)].filter(Boolean)];
    case "wait":
      if (p.text !== undefined) return ["wait", "--text", s(p.text)];
      if (p.selector !== undefined) return ["wait", s(p.selector)];
      return ["wait", s(p.timeout)];
    case "waitforurl":
      return ["wait", "--url", s(p.url)];
    case "waitforloadstate":
      return ["wait", "--load", s(p.state)];
    case "waitforfunction":
      return ["wait", "--fn", s(p.expression)];
    case "evaluate":
      return ["eval", s(p.script)];
    case "url":
      return ["get", "url"];
    case "title":
      return ["get", "title"];
    case "gettext":
      return ["get", "text", s(p.selector)];
    case "getattribute":
      return ["get", "attr", s(p.selector), s(p.attribute)];
    case "snapshot":
      return ["snapshot", ...(p.interactive === true ? ["-i"] : [])];
    case "back":
    case "forward":
    case "reload":
      return [action];
    case "nth": {
      const index = typeof p.index === "number" ? p.index : 0;
      const where = index === 0 ? ["first"] : index === -1 ? ["last"] : ["nth", String(index)];
      return ["find", ...where, s(p.selector), ...findTail(p)];
    }
    default:
      return null;
  }
}
