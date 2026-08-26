import { PageTextGuard, type CompleteRequest, type InjectionGuard } from "@tyto/core";

export function resolveInject(inject: InjectionGuard | undefined): InjectionGuard {
  return inject ?? new PageTextGuard();
}

export function userContent(req: CompleteRequest, inject: InjectionGuard): string {
  if (!req.page) return req.user;
  const doc = inject.wrapPageText(req.page.text);
  return `${req.user}\n\n<untrusted kind="${doc.kind}">\n${doc.text}\n</untrusted>`;
}

export function openaiMessages(req: CompleteRequest, inject: InjectionGuard): Array<{ role: "system" | "user"; content: string }> {
  const user = { role: "user" as const, content: userContent(req, inject) };
  if (!req.system) return [user];
  return [{ role: "system", content: req.system }, user];
}
