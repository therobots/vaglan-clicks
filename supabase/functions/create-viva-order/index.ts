import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildCheckoutLineItems,
  validateCheckoutSelection,
} from "../../../src/lib/pricing.js";
import { getVivaAccessToken } from "../_shared/vivaAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 8_192;

const readCheckoutBody = async (request: Request) => {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new RangeError("Request too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing request body.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError("Request too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
};

const hashClientIp = async (ip: string, secret: string) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const createAccessToken = async () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return { token, hash };
};

const safeSiteOrigin = (value: string) => {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))
  ) {
    throw new Error("SITE_URL must use HTTPS outside local development.");
  }
  return parsed.origin;
};

const vivaEndpoints = (environment: string) => {
  if (environment === "live") {
    return {
      accounts: "https://accounts.vivapayments.com",
      api: "https://api.vivapayments.com",
      checkout: "https://www.vivapayments.com",
    };
  }
  if (environment === "demo") {
    return {
      accounts: "https://demo-accounts.vivapayments.com",
      api: "https://demo-api.vivapayments.com",
      checkout: "https://demo.vivapayments.com",
    };
  }
  throw new Error("VIVA_ENVIRONMENT must be set to demo or live.");
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("VIVA_CLIENT_ID");
  const clientSecret = Deno.env.get("VIVA_CLIENT_SECRET");
  const sourceCode = Deno.env.get("VIVA_SOURCE_CODE");
  const configuredSiteUrl = Deno.env.get("SITE_URL");
  let endpoints: ReturnType<typeof vivaEndpoints>;
  let siteOrigin: string;
  try {
    endpoints = vivaEndpoints(Deno.env.get("VIVA_ENVIRONMENT") || "");
    if (!configuredSiteUrl) throw new Error("SITE_URL is not configured.");
    siteOrigin = safeSiteOrigin(configuredSiteUrl);
  } catch (error) {
    console.error("Invalid Viva checkout configuration:", error);
    return respond({ error: "Secure checkout is not configured yet." }, 503);
  }
  if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret || !sourceCode) {
    console.error("Viva checkout is missing required server configuration.");
    return respond({ error: "Secure checkout is not configured yet." }, 503);
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let createdOrderId: string | null = null;
  const expireOrder = async (orderId: string) => {
    const { error } = await client.rpc("expire_pending_photo_order", { order_id_input: orderId });
    if (error) console.error("Could not expire incomplete Viva order:", error.message);
  };

  try {
    const clientIp = request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-real-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const { data: allowed, error: rateError } = await client.rpc("consume_order_download_attempt", {
      ip_input: `checkout:${await hashClientIp(clientIp, serviceRoleKey)}`,
      window_seconds_input: 900,
      max_attempts_input: 60,
    });
    if (rateError) throw rateError;
    if (!allowed) return respond({ error: "Too many checkout attempts. Try again later." }, 429);
    let payload;
    try { payload = await readCheckoutBody(request); }
    catch (error) {
      return respond({ error: error instanceof RangeError ? "Checkout request is too large." : "Invalid checkout request." },
        error instanceof RangeError ? 413 : 400);
    }
    if (
      !Array.isArray(payload?.photoIds) ||
      payload.photoIds.length > 100 ||
      payload.photoIds.some((id: unknown) => typeof id !== "string" || !uuidPattern.test(id))
    ) {
      return respond({ error: "Your selection is invalid. Please review it and try again." }, 400);
    }
    const photoIds = [...new Set<string>(payload.photoIds)];
    if (!validateCheckoutSelection(photoIds, payload.tipCents)) {
      return respond(
        {
          error: photoIds.length === 0
            ? "Select at least one photo to continue."
            : "Choose one of the available tip amounts.",
        },
        400,
      );
    }

    const { data: orderRows, error: orderError } = await client.rpc(
      "create_pending_photo_order",
      { photo_ids_input: photoIds, tip_cents_input: payload.tipCents },
    );
    if (orderError) {
      if (["22023", "P0001"].includes(orderError.code || "")) {
        return respond({ error: orderError.message }, 400);
      }
      throw orderError;
    }
    const order = Array.isArray(orderRows) ? orderRows[0] : null;
    if (typeof order?.order_id === "string") createdOrderId = order.order_id;
    if (
      !order?.order_id ||
      !Number.isSafeInteger(Number(order.first_photo_cents)) ||
      !Number.isSafeInteger(Number(order.extra_photo_cents)) ||
      !Number.isSafeInteger(Number(order.total_cents))
    ) {
      throw new Error("The secure order record could not be created.");
    }
    const pricing = buildCheckoutLineItems(
      photoIds.length,
      Number(order.first_photo_cents),
      Number(order.extra_photo_cents),
      Number(order.tip_cents),
    );
    if (!pricing || pricing.totalCents !== Number(order.total_cents)) {
      throw new Error("The order amount does not match the server pricing.");
    }

    const access = await getVivaAccessToken(endpoints, clientId, clientSecret);
    const { token, hash } = await createAccessToken();
    const successUrl = new URL("/success", siteOrigin);
    successUrl.searchParams.set("token", token);
    const failureUrl = new URL("/", siteOrigin);
    failureUrl.searchParams.set("checkout", "cancelled");
    const vivaResponse = await fetch(`${endpoints.api}/checkout/v2/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: Number(order.total_cents),
        customerTrns: `Vaglan Clicks - ${photoIds.length} photo${photoIds.length === 1 ? "" : "s"}`,
        paymentTimeout: 1800,
        preauth: false,
        allowRecurring: false,
        paymentNotification: true,
        disableExactAmount: true,
        disableCash: true,
        sourceCode,
        merchantTrns: order.order_id,
        successUrl: successUrl.toString(),
        failureUrl: failureUrl.toString(),
      }),
      signal: AbortSignal.timeout(20000),
    });
    const vivaOrder = await vivaResponse.json();
    const orderCode = typeof vivaOrder?.orderCode === "string"
      ? vivaOrder.orderCode
      : Number.isSafeInteger(vivaOrder?.orderCode)
        ? String(vivaOrder.orderCode)
        : "";
    if (!vivaResponse.ok || !/^[0-9]{6,24}$/.test(orderCode)) {
      await expireOrder(order.order_id);
      console.error("Viva order creation failed with status:", vivaResponse.status);
      return respond({ error: "Could not open secure checkout. Please try again." }, 502);
    }

    const { data: linked, error: linkError } = await client.rpc("set_photo_order_viva_order", {
      order_id_input: order.order_id,
      viva_order_code_input: orderCode,
      access_token_hash_input: hash,
    });
    if (linkError || !linked) {
      await expireOrder(order.order_id);
      throw linkError || new Error("Could not attach Viva checkout to the order.");
    }

    const checkoutUrl = new URL("/web/checkout", endpoints.checkout);
    checkoutUrl.searchParams.set("ref", orderCode);
    return respond({ url: checkoutUrl.toString() });
  } catch (error) {
    if (createdOrderId) await expireOrder(createdOrderId);
    console.error("Viva checkout request failed:", error);
    return respond({ error: "Could not create secure checkout. Please try again." }, 500);
  }
});
