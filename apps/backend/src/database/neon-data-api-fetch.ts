type NeonDataApiFetchInput = {
  supabaseUrl: string;
  neonDataApiUrl: string;
  fetchImpl?: typeof fetch;
};

export function createNeonDataApiFetch({
  supabaseUrl,
  neonDataApiUrl,
  fetchImpl = fetch,
}: NeonDataApiFetchInput): typeof fetch {
  const supabaseOrigin = new URL(supabaseUrl).origin;
  const neonRestBase = new URL(neonDataApiUrl);

  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const isDatabaseRequest =
      url.origin === supabaseOrigin
      && (
        url.pathname === "/rest/v1"
        || url.pathname.startsWith("/rest/v1/")
      );

    if (!isDatabaseRequest) {
      return fetchImpl(request);
    }

    const target = new URL(neonRestBase);
    const suffix = url.pathname.slice("/rest/v1".length);

    target.pathname = `${target.pathname.replace(/\/$/, "")}${suffix}`;
    target.search = url.search;

    const rewritten = new Request(target, request);

    // A Supabase publishable key identifies the Auth project; it is not a
    // Neon credential and must not cross the database provider boundary.
    rewritten.headers.delete("apikey");

    return fetchImpl(rewritten);
  };
}
