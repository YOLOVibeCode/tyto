export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}
