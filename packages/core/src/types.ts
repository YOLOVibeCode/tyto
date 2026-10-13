export type Origin = string;
export type SecretRef = string;
export type ModelId = string;

/** Page-derived text. Always data, never instructions. */
export type UntrustedDocument = { kind: "untrusted"; text: string };

export type CompleteRequest = {
  system: string;
  user: string;
  page?: UntrustedDocument;
};

export type CompleteResponse = { text: string };
