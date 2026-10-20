import { createClient } from "npm:@supabase/supabase-js@2";

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
    if (!Array.isArray(payload?.photoIds) || payload.photoIds.length < 1) {
      return respond({ error: "Select at least one photo to continue." }, 400);
    }
    if (payload.photoIds.length > 100 || payload.photoIds.some((id: unknown) =>
      typeof id !== "string" || !uuidPattern.test(id)
    )) {
      return respond({ error: "Your selection is invalid. Please review it and try again." }, 400);
    }
    const photoIds = [...new Set<string>(payload.photoIds)];
    if (photoIds.length > 100) {
      return respond({ error: "Select no more than 100 photos per checkout." }, 400);
    }
    if (
      typeof payload.email !== "string" ||
      payload.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email.trim())
    ) {
      return respond({ error: "Enter a valid email address for your download receipt." }, 400);
    }

    const { data: orderRows, error: orderError } = await client.rpc(
      "create_pending_photo_order",
      { photo_ids_input: photoIds },
    );
    if (orderError) {
      if (["22023", "P0001"].includes(orderError.code || "")) {
        return respond({ error: orderError.message }, 400);
      }
      throw orderError;
    }
    const order = Array.isArray(orderRows) ? orderRows[0] : null;
    if (typeof order?.order_id === "string") createdOrderId = order.order_id;
    if (!order?.order_id || !Number.isSafeInteger(order.unit_amount_cents)) {
      throw new Error("The secure order record could not be created.");
    }

    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("client_reference_id", order.order_id);
    form.set("metadata[order_id]", order.order_id);
    form.set("customer_email", payload.email.trim());
    form.set("customer_creation", "always");
    form.set("expires_at", String(Math.floor(Date.now() / 1000) + 30 * 60));
    form.set("success_url", `${siteOrigin}/success?session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", `${siteOrigin}/`);
    form.set("line_items[0][quantity]", String(photoIds.length));
    form.set("line_items[0][price_data][currency]", String(order.currency).toLowerCase());
    form.set(
      "line_items[0][price_data][unit_amount]",
      String(order.unit_amount_cents),
    );
    form.set(
      "line_items[0][price_data][product_data][name]",
      photoIds.length === 1 ? "Event photo" : `${photoIds.length} event photos`,
    );

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
