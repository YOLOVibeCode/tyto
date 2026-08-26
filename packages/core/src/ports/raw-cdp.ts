export interface RawCdpPort {
  send(method: string, params?: object): Promise<unknown>;
}
