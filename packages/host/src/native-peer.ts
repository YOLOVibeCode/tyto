/** Native messaging peers must be the Tyto extension, not a random add-on. */
export function nativePeerAllowed(senderId: string, expectedExtensionId: string): boolean {
  return senderId.length > 0 && senderId === expectedExtensionId;
}
