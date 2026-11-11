import { createClient } from "npm:@supabase/supabase-js@2";
import { getVivaAccessToken } from "../_shared/vivaAuth.ts";

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const constantTimeEqual = (left: string, right: string) => {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
};

const amountToCents = (value: unknown) => {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const match = String(value).match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
};

const getEnvironment = () => {
  const environment = Deno.env.get("VIVA_ENVIRONMENT");
  if (environment === "live") {
    return {
      accounts: "https://accounts.vivapayments.com",
      api: "https://api.vivapayments.com",
    };
  }
  if (environment === "demo") {
    return {
      accounts: "https://demo-accounts.vivapayments.com",
      api: "https://demo-api.vivapayments.com",
    };
  }
  throw new Error("VIVA_ENVIRONMENT must be set to demo or live.");
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const webhookKey = Deno.env.get("VIVA_WEBHOOK_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("VIVA_CLIENT_ID");
  const clientSecret = Deno.env.get("VIVA_CLIENT_SECRET");
  if (!webhookKey || !supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) {
    console.error("Viva webhook is missing required server configuration.");
    return respond({ error: "Webhook is not configured." }, 503);
  }
  let endpoints: ReturnType<typeof getEnvironment>;
  try {
    endpoints = getEnvironment();
  } catch (error) {
    console.error("Invalid Viva webhook configuration:", error);
    return respond({ error: "Webhook is not configured." }, 503);
  }

  const authorization = request.headers.get("authorization") || "";
  if (!constantTimeEqual(authorization, `Key ${webhookKey}`)) {
    return respond({ error: "Unauthorized." }, 401);
  }

  try {
    const payload = await request.json();
    if (Number(payload?.eventTypeId) !== 1796) {
      return respond({ received: true, ignored: true });
    }
    const eventData = payload?.eventData;
    const transactionId = String(eventData?.TransactionId ?? eventData?.transactionId ?? "");
    const orderCode = String(eventData?.OrderCode ?? eventData?.orderCode ?? "");
    if (!/^[A-Za-z0-9-]{1,100}$/.test(transactionId) || !/^[0-9]{6,24}$/.test(orderCode)) {
      return respond({ error: "Invalid Viva payment notification." }, 400);
    }

    const access = await getVivaAccessToken(endpoints, clientId, clientSecret);
    const transactionResponse = await fetch(
      `${endpoints.api}/checkout/v2/transactions/${encodeURIComponent(transactionId)}`,
      {
        headers: { Authorization: `Bearer ${access}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    const transaction = await transactionResponse.json();
    if (!transactionResponse.ok) {
      console.error("Viva transaction lookup failed with status:", transactionResponse.status);
      return respond({ error: "Could not verify the Viva transaction." }, 502);
    }
    if (
      String(transaction?.transactionId ?? transaction?.TransactionId ?? transactionId) !== transactionId ||
      String(transaction?.orderCode) !== orderCode ||
      typeof transaction?.merchantTrns !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        transaction.merchantTrns,
      ) ||
      transaction?.statusId !== "F"
    ) {
      return respond({ error: "The Viva transaction is not a completed payment." }, 400);
    }
    const amountCents = amountToCents(transaction?.amount);
    if (!amountCents || Number(transaction?.currencyCode) !== 978) {
      return respond({ error: "The Viva transaction amount or currency is invalid." }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.rpc("process_viva_payment", {
      event_id_input: `viva:${transactionId}`,
      order_code_input: orderCode,
      merchant_order_id_input: transaction.merchantTrns,
      transaction_id_input: transactionId,
      amount_total_cents_input: amountCents,
      currency_code_input: Number(transaction.currencyCode),
      email_input: typeof transaction.email === "string" ? transaction.email : null,
    });
    if (error) {
      console.error("Could not process verified Viva payment:", error.message);
      return respond({ error: "Could not process payment event." }, 500);
    }
    return respond({ received: true, duplicate: Boolean(data?.duplicate) });
  } catch (error) {
    console.error("Viva webhook processing failed:", error);
    return respond({ error: "Could not process the Viva notification." }, 500);
  }
});
