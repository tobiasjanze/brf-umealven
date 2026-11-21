// Secure password-help request endpoint for BRF Umeälven.
// Required Supabase Edge Function secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.
// Optional: MAIL_FROM (must be a verified sender in Resend).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_EMAIL = "tobias.janze@gmail.com";
const FROM = Deno.env.get("MAIL_FROM") ?? "Styrelseportalen <onboarding@resend.dev>";
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_IP = 5;
const MAX_PER_EMAIL = 3;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function hash(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return response({ message: "Om begäran kan behandlas skickas information till administratören." });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!supabaseUrl || !serviceKey || !resendKey) {
      console.error("Missing server configuration");
      return response({ message: "Om begäran kan behandlas skickas information till administratören." });
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const emailHash = await hash(email);
    const ipHash = await hash(ip);

    // Rate limiting is persisted in a private table. Keep request details hashed.
    const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
    const { data: rows, error: rateError } = await admin.from("password_help_requests")
      .select("email_hash,ip_hash,created_at").gte("created_at", cutoff);
    if (rateError) {
      console.error("Rate-limit query failed");
      return response({ message: "Om begäran kan behandlas skickas information till administratören." });
    }
    const recent = rows ?? [];
    if (recent.filter(r => r.ip_hash === ipHash).length >= MAX_PER_IP ||
        recent.filter(r => r.email_hash === emailHash).length >= MAX_PER_EMAIL) {
      return response({ message: "Om begäran kan behandlas skickas information till administratören." });
    }
    const { error: insertError } = await admin.from("password_help_requests")
      .insert({ email_hash: emailHash, ip_hash: ipHash });
    if (insertError) {
      console.error("Rate-limit insert failed");
      return response({ message: "Om begäran kan behandlas skickas information till administratören." });
    }

    // Check registration server-side; never expose the result to the caller.
    let registered = false;
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error || !data?.users) break;
      registered = data.users.some(u => (u.email ?? "").toLowerCase() === email);
      if (registered || data.users.length < 1000) break;
    }
    if (!registered) return response({ message: "Om begäran kan behandlas skickas information till administratören." });

    const mail = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [ADMIN_EMAIL],
        subject: "Begäran om lösenordshjälp – Styrelseportalen",
        text: `En användare med registrerad e-postadress har begärt hjälp med inloggning.\n\nKontots e-postadress: ${email}\n\nKontrollera användaren och hantera återställningen manuellt. Skicka aldrig lösenord via e-post.`,
      }),
    });
    if (!mail.ok) console.error("Mail provider rejected request", mail.status);
    return response({ message: "Om begäran kan behandlas skickas information till administratören." });
  } catch (e) {
    console.error("Password-help request failed");
    return response({ message: "Om begäran kan behandlas skickas information till administratören." });
  }
});
