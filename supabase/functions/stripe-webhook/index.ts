import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const cryptoProvider = Stripe.createSubtleCryptoProvider();

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const createAccessToken = async () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return { token, hash };
};

const sendReceiptEmail = async (
  apiKey: string,
  from: string,
  recipient: string,
  downloadUrl: string,
) => {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: "Your Vaglan Clicks photos are ready",
      html: `<p>Thank you for your purchase.</p><p><a href="${downloadUrl}">Open your secure photo downloads</a></p><p>This link grants access to your purchased photos. Keep it private.</p><p><a href="${new URL("/info", downloadUrl).toString()}">Photo information</a></p>`,
    }),
  });
  if (!response.ok) {
    console.error("Receipt email provider returned status:", response.status);
  }
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const siteUrl = Deno.env.get("SITE_URL");
  if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !serviceRoleKey || !siteUrl) {
    console.error("Stripe webhook is missing required server configuration.");
    return respond({ error: "Webhook is not configured." }, 503);
  }
  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-02-24.acacia" });

  let siteOrigin: string;
  try {
    const parsedSiteUrl = new URL(siteUrl);
    if (
      parsedSiteUrl.protocol !== "https:" &&
      !(parsedSiteUrl.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(parsedSiteUrl.hostname))
    ) {
      throw new Error("SITE_URL must use HTTPS outside local development.");
    }
    siteOrigin = parsedSiteUrl.origin;
  } catch (error) {
    console.error("Invalid Stripe webhook SITE_URL:", error);
    return respond({ error: "Webhook is not configured." }, 503);
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return respond({ error: "Missing Stripe signature." }, 400);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await request.text(),
      signature,
      webhookSecret,
      undefined,
      cryptoProvider,
    );
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error);
    return respond({ error: "Invalid webhook signature." }, 400);
  }

  let sessionId: string | null = null;
  let paymentIntentId: string | null = null;
  let email: string | null = null;
  let amountTotalCents: number | null = null;
  let currency: string | null = null;
  let accessToken: string | null = null;
  let accessTokenHash: string | null = null;

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded" ||
    event.type === "checkout.session.expired"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    if (
      event.type !== "checkout.session.expired" &&
      session.payment_status !== "paid"
    ) {
      return respond({ received: true, awaitingPayment: true });
    }
    sessionId = session.id;
    paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
    email = session.customer_details?.email ?? session.customer_email ?? null;
    amountTotalCents = session.amount_total;
    currency = session.currency?.toUpperCase() ?? null;
    if (event.type !== "checkout.session.expired") {
      ({ token: accessToken, hash: accessTokenHash } = await createAccessToken());
    }
  } else if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    if (charge.amount_refunded < charge.amount) {
      return respond({ received: true, partialRefund: true });
    }
    paymentIntentId = typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id ?? null;
  } else if (event.type === "charge.dispute.created") {
    const charge = event.data.object as Stripe.Dispute;
    paymentIntentId = typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id ?? null;
  } else {
    return respond({ received: true, ignored: true });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.rpc("process_stripe_event", {
    event_id_input: event.id,
    event_type_input: event.type,
    session_id_input: sessionId,
    payment_intent_input: paymentIntentId,
    email_input: email,
    amount_total_cents_input: amountTotalCents,
    currency_input: currency,
    access_token_hash_input: accessTokenHash,
  });
  if (error) {
    console.error("Could not process verified Stripe event:", event.type, error.message);
    return respond({ error: "Could not process payment event." }, 500);
  }

  if (data?.notify && accessToken && email) {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const emailFrom = Deno.env.get("EMAIL_FROM");
    if (!resendApiKey || !emailFrom) {
      console.error("Purchase is paid, but receipt email is not configured.");
    } else {
      const downloadUrl = new URL("/success", siteOrigin);
      downloadUrl.searchParams.set("token", accessToken);
      EdgeRuntime.waitUntil(
        sendReceiptEmail(resendApiKey, emailFrom, email, downloadUrl.toString())
          .catch((emailError) =>
            console.error("Could not send purchase receipt email:", emailError)
          ),
      );
    }
  }

  return respond({ received: true, duplicate: Boolean(data?.duplicate) });
});
