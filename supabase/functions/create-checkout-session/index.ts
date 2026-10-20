import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildCheckoutLineItems,
  validateCheckoutSelection,
} from "../../../src/lib/pricing.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stripeApiVersion = "2025-03-31.basil";

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const configuredSiteUrl = Deno.env.get("SITE_URL");
  if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey || !configuredSiteUrl) {
    console.error("Checkout function is missing required server configuration.");
    return respond({ error: "Secure checkout is not configured yet." }, 503);
  }

  let siteOrigin: string;
  try {
    const siteUrl = new URL(configuredSiteUrl);
    if (
      siteUrl.protocol !== "https:" &&
      !(siteUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(siteUrl.hostname))
    ) {
      throw new Error("SITE_URL must use HTTPS outside local development.");
    }
    siteOrigin = siteUrl.origin;
  } catch (error) {
    console.error("Invalid checkout SITE_URL:", error);
    return respond({ error: "Secure checkout is not configured yet." }, 503);
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const expireOrder = async (orderId: string) => {
    const { error } = await client.rpc("expire_pending_photo_order", {
      order_id_input: orderId,
    });
    if (error) {
      console.error("Could not expire an incomplete checkout order:", error.message);
    }
  };

  let createdOrderId: string | null = null;
  try {
    const payload = await request.json();
    if (!Array.isArray(payload?.photoIds) || payload.photoIds.length > 100 || payload.photoIds.some((id: unknown) =>
      typeof id !== "string" || !uuidPattern.test(id)
    )) {
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
      {
        photo_ids_input: photoIds,
        tip_cents_input: payload.tipCents,
      },
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
      !Number.isSafeInteger(Number(order.subtotal_cents)) ||
      !Number.isSafeInteger(Number(order.tip_cents)) ||
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
    if (
      !pricing ||
      pricing.subtotalCents !== Number(order.subtotal_cents) ||
      pricing.totalCents !== Number(order.total_cents)
    ) {
      throw new Error("The order amount does not match the server pricing.");
    }

    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("client_reference_id", order.order_id);
    form.set("metadata[order_id]", order.order_id);
    form.set("metadata[tip_cents]", String(order.tip_cents));
    form.set("customer_creation", "always");
    form.set("expires_at", String(Math.floor(Date.now() / 1000) + 30 * 60));
    form.set("success_url", `${siteOrigin}/success?session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", `${siteOrigin}/`);
    const infoMessage = `Photo information: ${siteOrigin}/info`;
    if (infoMessage.length > 120) {
      throw new Error("SITE_URL is too long to include the required Stripe checkout information link.");
    }
    form.set(
      "custom_text[submit][message]",
      infoMessage,
    );

    const addLineItem = (
      index: number,
      name: string,
      quantity: number,
      unitAmount: number,
    ) => {
      form.set(`line_items[${index}][quantity]`, String(quantity));
      form.set(`line_items[${index}][price_data][currency]`, String(order.currency).toLowerCase());
      form.set(`line_items[${index}][price_data][unit_amount]`, String(unitAmount));
      form.set(`line_items[${index}][price_data][product_data][name]`, name);
    };
    pricing.lineItems.forEach((item, index) => {
      addLineItem(index, item.name, item.quantity, item.unitAmountCents);
    });

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `gallery-checkout-${order.order_id}`,
        "Stripe-Version": stripeApiVersion,
      },
      body: form,
    });
    const stripeResult = await stripeResponse.json();
    if (!stripeResponse.ok || !stripeResult?.id || !stripeResult?.url) {
      await expireOrder(order.order_id);
      console.error("Stripe checkout session creation failed:", stripeResult?.error?.type);
      return respond({ error: "Could not open secure checkout. Please try again." }, 502);
    }

    const { data: linked, error: linkError } = await client.rpc(
      "set_photo_order_stripe_session",
      {
        order_id_input: order.order_id,
        session_id_input: stripeResult.id,
      },
    );
    if (linkError || !linked) {
      const expireResponse = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(stripeResult.id)}/expire`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${stripeSecretKey}`,
            "Stripe-Version": stripeApiVersion,
          },
        },
      );
      if (!expireResponse.ok) {
        console.error("Could not expire an unlinked Stripe checkout session.");
      }
      await expireOrder(order.order_id);
      throw linkError || new Error("Could not attach secure checkout to the order.");
    }

    return respond({ url: stripeResult.url });
  } catch (error) {
    if (createdOrderId) await expireOrder(createdOrderId);
    console.error("Checkout session request failed:", error);
    return respond({ error: "Could not create secure checkout. Please try again." }, 500);
  }
});
