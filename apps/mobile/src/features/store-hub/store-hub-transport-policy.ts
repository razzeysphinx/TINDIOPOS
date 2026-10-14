export function isStoreHubTransportAllowed(input: {
  protocol: string;
  allowInsecureHttp: boolean;
}) {
  return input.protocol === "https:"
    || (
      input.protocol === "http:"
      && input.allowInsecureHttp
    );
}
