export interface Navigation {
  goto(url: URL): Promise<void>;
  currentUrl(): Promise<URL>;
}
