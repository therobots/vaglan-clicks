type VivaAccountsEndpoint = {
  accounts: string;
};

type CachedVivaToken = {
  token: string;
  expiresAt: number;
};

const TOKEN_EXPIRY_SAFETY_MS = 60_000;
const tokenCache = new Map<string, CachedVivaToken>();
const inFlightTokens = new Map<string, Promise<string>>();

export const getVivaAccessToken = async (
  endpoints: VivaAccountsEndpoint,
  clientId: string,
  clientSecret: string,
) => {
  const cacheKey = `${endpoints.accounts}:${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + TOKEN_EXPIRY_SAFETY_MS) {
    return cached.token;
  }

  const inFlight = inFlightTokens.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async () => {
    const response = await fetch(`${endpoints.accounts}/connect/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "urn:viva:payments:core:api:redirectcheckout",
      }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok || typeof result?.access_token !== "string") {
      throw new Error("Viva authentication failed.");
    }

    const expiresInSeconds = Number(result.expires_in);
    if (Number.isFinite(expiresInSeconds) && expiresInSeconds > 60) {
      tokenCache.set(cacheKey, {
        token: result.access_token,
        expiresAt: Date.now() + expiresInSeconds * 1000,
      });
    }
    return result.access_token as string;
  })();

  inFlightTokens.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (inFlightTokens.get(cacheKey) === request) {
      inFlightTokens.delete(cacheKey);
    }
  }
};
