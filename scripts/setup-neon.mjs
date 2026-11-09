// `npm run setup:neon` — the Neon backend's one-command setup. Invoked through scripts/setup.mjs
// (which owns the shared .env.local helpers), never on its own.
//
// No Neon account or token needed: with no DATABASE_URL configured, setup provisions a Claimable
// Neon project (Postgres + Neon Auth) over https://claimable.neon.tech, writes its credentials into
// .env.local, runs neon/migrations, and prints a link to claim the project into your Neon account.
// Unclaimed projects are deleted after 72 hours, so claim it to keep it.
//
// Docs: https://neon.com/docs/reference/claimable-neon · https://neon.com/docs/auth/overview

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const CLAIMABLE = "https://claimable.neon.tech";
const CONSOLE_API = "https://console.neon.tech/api/v2";

export async function setupNeon(ctx) {
  const { ROOT, ENV_FILE, ENV_EXAMPLE, args, ui, env: envLib } = ctx;
  const { log, step, ok, info, warn, die, bold, dim, green, yellow, cyan } = ui;
  const { loadEnv, setEnv, saveEnv, isBlank, get } = envLib;
  const claimOnly = args.includes("--claim");

  log(bold("Setting up agent37-starter-kit on Neon\n"));

  if (!fs.existsSync(ENV_FILE)) {
    if (!fs.existsSync(ENV_EXAMPLE)) die("Missing .env.example — are you in the project root?");
    fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
    step("Created .env.local");
  }
  const env = loadEnv(ENV_FILE);

  if (get(env, "NEXT_PUBLIC_BACKEND") !== "neon") {
    setEnv(env, "NEXT_PUBLIC_BACKEND", "neon");
    saveEnv(env);
    ok("Set NEXT_PUBLIC_BACKEND=neon");
  }

  const assertion = () => get(env, "NEON_CLAIM_ASSERTION");
  const projectId = () => get(env, "NEON_PROJECT_ID");

  if (claimOnly) {
    if (isBlank(assertion()) || isBlank(projectId())) {
      die("No unclaimed Neon project recorded in .env.local (NEON_CLAIM_ASSERTION / NEON_PROJECT_ID).");
    }
    await printClaimLink(await claimable(await exchange(assertion())), projectId());
    return;
  }

  if (isBlank(get(env, "AGENT37_API_KEY"))) {
    warn("AGENT37_API_KEY is still blank — the app needs it at runtime. Fill it in .env.local.");
  }

  // 1. A database + Neon Auth: either the one already in .env.local, or a fresh claimable project.
  let call = null; // claimable-proxy client, while the project is unclaimed
  if (!isBlank(get(env, "DATABASE_URL")) && !isBlank(get(env, "NEON_AUTH_BASE_URL"))) {
    step("Using the Neon project in .env.local");
    info("DATABASE_URL and NEON_AUTH_BASE_URL are set — leaving them.");
  } else {
    const hasDb = !isBlank(get(env, "DATABASE_URL"));
    if (hasDb && isBlank(assertion())) {
      // A DATABASE_URL the user pasted for their own project: never replace it with a new one.
      die(
        "DATABASE_URL is set but NEON_AUTH_BASE_URL is blank.",
        "Enable Auth on that project (Neon Console → Auth), paste its Auth URL into .env.local as\n" +
          "NEON_AUTH_BASE_URL, and re-run. Or clear DATABASE_URL to provision a new claimable project."
      );
    }
    if (isBlank(assertion())) {
      step("No Neon project configured — provisioning a claimable one (no account needed)");
      const reg = await request("POST", `${CLAIMABLE}/v1/agent/identity`, null, {
        type: "anonymous",
        capabilities: ["postgres", "auth"],
        source: "agent37-starter-kit",
        project_name: "agent37-starter-kit",
        ...(process.env.NEON_REGION ? { region_id: process.env.NEON_REGION } : {}),
      });
      const denied = (reg.capabilities || []).filter((c) => !c.granted);
      if (denied.length) {
        die(`Neon declined: ${denied.map((c) => `${c.capability} (${c.reason || "denied"})`).join(", ")}`);
      }
      // Record the project before anything else can fail, so a re-run reuses it instead of making a
      // second one. NEON_CLAIM_ASSERTION is a setup-only secret, like SUPABASE_ACCESS_TOKEN.
      setEnv(env, "NEON_CLAIM_ASSERTION", reg.identity_assertion);
      setEnv(env, "NEON_PROJECT_ID", reg.project.id);
      setEnv(env, "NEON_BRANCH_ID", reg.project.branch_id);
      saveEnv(env);
      ok(`Created project ${bold(reg.project.id)} in ${reg.project.region_id}`);
      info(`Unclaimed until ${reg.project.expires_at} — claim it to keep it (link at the end).`);
    } else {
      step(`Using claimable Neon project ${bold(projectId())}`);
    }

    call = claimable(await exchange(assertion()));
    const creds = await call("GET", `/v1/projects/${projectId()}/credentials`);
    const authUrl = creds.services?.auth?.base_url;
    if (!creds.database_url) die("Neon returned no database_url for the project.");
    if (!authUrl) die("Neon Auth isn't enabled on this project (no services.auth in its credentials).");
    setEnv(env, "DATABASE_URL", creds.database_url);
    setEnv(env, "NEON_AUTH_BASE_URL", authUrl);
    saveEnv(env);
    ok("Wrote DATABASE_URL (server-only) and NEON_AUTH_BASE_URL");
  }

  if (isBlank(get(env, "NEON_AUTH_COOKIE_SECRET"))) {
    setEnv(env, "NEON_AUTH_COOKIE_SECRET", crypto.randomBytes(32).toString("base64"));
    saveEnv(env);
    ok("Generated NEON_AUTH_COOKIE_SECRET (signs the session cookie; server-only)");
  }

  // 2. Schema.
  step("Applying database migrations");
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  if (globalThis.WebSocket) neonConfig.webSocketConstructor = globalThis.WebSocket;
  const pool = new Pool({ connectionString: get(env, "DATABASE_URL") });
  try {
    // The schema references neon_auth."user", so Neon Auth must be on before it can apply.
    const { rows } = await pool.query(`select to_regclass('neon_auth."user"') is not null as ok`);
    if (!rows[0]?.ok) {
      throw new Error(
        'neon_auth."user" not found — enable Neon Auth on this branch (Neon Console → Auth) and re-run'
      );
    }
    const dir = path.join(ROOT, "neon", "migrations");
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await pool.query(fs.readFileSync(path.join(dir, file), "utf8"));
      ok(`Applied ${file}`);
    }
  } catch (e) {
    die(`Migration failed: ${e.message}`, "Check DATABASE_URL in .env.local (after a claim, copy a fresh one).");
  } finally {
    await pool.end().catch(() => {});
  }

  // Still unclaimed (the assertion only works until the claim completes)? Then manage the project
  // through the claimable proxy for the steps below, and end with a fresh claim link.
  if (!call && !isBlank(assertion()) && !isBlank(projectId())) {
    try {
      call = claimable(await exchange(assertion()));
    } catch (e) {
      warn(e.message);
    }
  }

  // 3. Sign-in origins. Neon Auth pre-approves any localhost port; a production origin must be a
  //    trusted domain, or sign-in fails with INVALID_ORIGIN. The claimable proxy refuses this before
  //    the claim, so it needs the claimed project and a NEON_API_KEY.
  const siteUrl = (get(env, "NEXT_PUBLIC_SITE_URL") || "").replace(/\/$/, "");
  if (siteUrl && !/localhost|127\.0\.0\.1/.test(siteUrl)) {
    step(`Trusting ${siteUrl} for sign-in`);
    const branch = get(env, "NEON_BRANCH_ID");
    const apiKey = process.env.NEON_API_KEY;
    try {
      if (call) throw new Error("the project is still unclaimed — claim it first");
      if (!apiKey || isBlank(projectId()) || isBlank(branch)) {
        throw new Error("set NEON_API_KEY (plus NEON_PROJECT_ID / NEON_BRANCH_ID in .env.local) to do it from here");
      }
      await request("POST", `${CONSOLE_API}/projects/${projectId()}/branches/${branch}/auth/domains`, apiKey, {
        domain: siteUrl,
        auth_provider: "better_auth",
      });
      ok(`Added ${siteUrl} to Neon Auth trusted domains`);
    } catch (e) {
      if (/already|exists|409/i.test(e.message)) ok(`${siteUrl} is already a trusted domain`);
      else
        warn(
          `Couldn't add the trusted domain automatically (${e.message}).\n` +
            `    Add ${bold(siteUrl)} in the Neon Console → your project → Auth → Configuration → Domains.`
        );
    }
  }

  log(`\n${green("✓ Neon setup complete.")}`);
  log(`\nNext:`);
  log(`  ${bold("npm run dev")}   ${dim("# then open http://localhost:3000 and sign up")}`);
  log(
    `\n${yellow("!")} Creating an agent spends real money — fund your Agent37 wallet first\n` +
      `  ${dim("(dashboard → Cloud → Billing). An empty wallet returns a 402 at create time.")}`
  );

  if (call) await printClaimLink(call, projectId());

  async function printClaimLink(client, id) {
    try {
      const claim = await client("POST", `/v1/projects/${id}/claim`);
      log(
        `\n${yellow("!")} ${bold("Claim your Neon project to keep it")} — unclaimed projects are deleted after 72 hours.\n` +
          `  ${cyan(claim.verification_uri_complete)}\n` +
          `  ${dim(`This link expires in ${Math.round((claim.expires_in || 900) / 60)} minutes; \`npm run neon:claim\` prints a fresh one.`)}\n` +
          `  ${dim("Claiming rotates the database password: afterwards copy a new DATABASE_URL from the Neon")}\n` +
          `  ${dim("Console into .env.local, and remove NEON_CLAIM_ASSERTION (it stops working).")}`
      );
    } catch (e) {
      warn(`Couldn't create a claim link (${e.message}). Run \`npm run neon:claim\` to retry.`);
    }
  }
}

async function request(method, url, bearer, body) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const err = json?.error;
    const msg = (err && (err.message || err.code)) || json?.message || text || res.statusText;
    const e = new Error(`Neon ${res.status} (${method} ${new URL(url).pathname}): ${msg}`);
    e.status = res.status;
    e.code = err?.code;
    throw e;
  }
  return json;
}

// Trade the durable identity assertion for a short-lived access token (no refresh tokens).
async function exchange(assertion) {
  const res = await fetch(`${CLAIMABLE}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
      resource: `${CLAIMABLE}/`,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    const code = json?.error?.code;
    const hint =
      code === "project_claimed"
        ? "The project was claimed — remove NEON_CLAIM_ASSERTION and paste a DATABASE_URL from the Neon Console."
        : code === "project_expired" || code === "invalid_grant"
          ? "The unclaimed project expired — clear NEON_CLAIM_ASSERTION, NEON_PROJECT_ID, NEON_BRANCH_ID, DATABASE_URL and NEON_AUTH_BASE_URL, then re-run."
          : "";
    throw new Error(`Couldn't get a Neon access token (${code || res.status}). ${hint}`.trim());
  }
  return json.access_token;
}

function claimable(token) {
  return (method, endpoint, body) => request(method, `${CLAIMABLE}${endpoint}`, token, body);
}
