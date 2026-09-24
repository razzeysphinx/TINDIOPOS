import "server-only";

type NeonDataApiFetchInput = {
  supabaseUrl: string;
  neonDataApiUrl: string;
  fetchImpl?: typeof fetch;
};

export function createNeonDataApiFetch({
  supabaseUrl,
  neonDataApiUrl,
  fetchImpl = fetch,
}: NeonDataApiFetchInput):
  typeof fetch {
  const supabaseOrigin =
    new URL(
      supabaseUrl,
    ).origin;

  const supabaseRestPath =
    "/rest/v1";

  const neonRestBase =
    new URL(
      neonDataApiUrl,
    );

  return async (
    input,
    init,
  ) => {
    const request =
      new Request(
        input,
        init,
      );

    const url =
      new URL(
        request.url,
      );

    const isDatabaseRequest =
      url.origin
        === supabaseOrigin
      && (
        url.pathname
          === supabaseRestPath

        || url.pathname
          .startsWith(
            `${supabaseRestPath}/`,
          )
      );

    if (!isDatabaseRequest) {
      return fetchImpl(
        request,
      );
    }

    const suffix =
      url.pathname.slice(
        supabaseRestPath.length,
      );

    const target =
      new URL(
        neonRestBase.toString(),
      );

    target.pathname =
      `${target.pathname.replace(/\/$/, "")}${suffix}`;

    target.search =
      url.search;

    const rewritten =
      new Request(
        target,
        request,
      );

    // The Supabase publishable API key is not a Neon credential.
    // It is unnecessary at the Neon Data API boundary.
    rewritten.headers.delete(
      "apikey",
    );

    const response =
      await fetchImpl(
        rewritten,
      );

    if (!response.ok) {
      const requestId =
        response.headers.get(
          "x-request-id",
        )
        ?? response.headers.get(
          "x-neon-request-id",
        )
        ?? response.headers.get(
          "traceparent",
        )
        ?? null;

      console.error(
        "Neon Data API request failed",
        {
          status:
            response.status,

          method:
            rewritten.method,

          pathname:
            target.pathname,

          requestId,
        },
      );
    }

    return response;
  };
}
