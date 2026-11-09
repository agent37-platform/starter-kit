#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env.local");
const ENV_EXAMPLE = path.join(ROOT, ".env.example");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const MGMT = "https://api.supabase.com";

const args = process.argv.slice(2);
const FLAGS = {
  noCreate: args.includes("--no-create"),
  neon: args.includes("--neon"),
  help: args.includes("--help") || args.includes("-h"),
};

const PLACEHOLDERS = new Set([
  "",
  "sk_live_replace_me",
  "sbp_replace_me",
  "https://your-project.supabase.co",
  "your-anon-public-key",
]);

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c("1", s);
const dim = (s) => c("2", s);
const green = (s) => c("32", s);
const yellow = (s) => c("33", s);
const red = (s) => c("31", s);
const cyan = (s) => c("36", s);

const log = (s = "") => console.log(s);
const step = (s) => log(`\n${cyan("▸")} ${bold(s)}`);
const ok = (s) => log(`  ${green("✓")} ${s}`);
const info = (s) => log(`  ${dim(s)}`);
const warn = (s) => log(`  ${yellow("!")} ${s}`);

function die(message, hint) {
  log(`\n${red("✗")} ${message}`);
  if (hint) log(`\n${hint}`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadEnv(file) {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = raw.length ? raw.split(/\r?\n/) : [];
  const map = {};
  for (const line of lines) {
    const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (m) map[m[1]] = unquote(m[2]);
  }
  return { file, lines, map, dirty: false };
}

function unquote(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function get(env, key) {
  const fromProc = process.env[key];
  if (fromProc != null && fromProc !== "") return fromProc;
  return env.map[key];
}

function isBlank(v) {
  return v == null || PLACEHOLDERS.has(String(v).trim());
}

function setEnv(env, key, value) {
  env.map[key] = value;
  const re = new RegExp(`^\\s*${key}\\s*=`);
  const idx = env.lines.findIndex((l) => re.test(l));
  const line = `${key}=${value}`;
  if (idx >= 0) env.lines[idx] = line;
  else {
    if (env.lines.length && env.lines[env.lines.length - 1].trim() !== "") env.lines.push("");
    env.lines.push(line);
  }
  env.dirty = true;
}

function saveEnv(env) {
  if (!env.dirty) return;
  fs.writeFileSync(env.file, env.lines.join("\n").replace(/\n*$/, "\n"));
}

function api(token) {
  return async function call(method, endpoint, body) {
    const res = await fetch(`${MGMT}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
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
      const msg = (json && (json.message || json.msg || json.error)) || text || res.statusText;
      const err = new Error(`Supabase API ${res.status} (${method} ${endpoint}): ${msg}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  };
}

function refFromUrl(url) {
  if (!url) return null;
  try {
    const sub = new URL(url).host.split(".")[0];
    return sub || null;
  } catch {
    return null;
  }
}

function pickPublicKey(keys) {
  if (!Array.isArray(keys)) return null;
  const val = (k) => k.api_key || k.apiKey || k.secret || (typeof k === "string" ? k : null);
  const anon = keys.find((k) => k.name === "anon" || k.id === "anon" || k.type === "anon");
  if (anon && val(anon)) return val(anon);
  const pub = keys.find(
    (k) =>
      k.type === "publishable" ||
      k.name === "publishable" ||
      (typeof val(k) === "string" && val(k).startsWith("sb_publishable_"))
  );
  if (pub && val(pub)) return val(pub);
  const safe = keys.find((k) => val(k) && !/service|secret/i.test(`${k.name || ""}${k.type || ""}`));
  return safe ? val(safe) : null;
}

// The privileged service-role secret (legacy `service_role` JWT or the newer `sb_secret_…` key).
// Server-only — it bypasses RLS, so it never gets a NEXT_PUBLIC_ prefix.
function pickServiceKey(keys) {
  if (!Array.isArray(keys)) return null;
  const val = (k) => k.api_key || k.apiKey || k.secret || (typeof k === "string" ? k : null);
  const svc = keys.find(
    (k) =>
      k.name === "service_role" ||
      k.id === "service_role" ||
      k.type === "service_role" ||
      k.type === "secret" ||
      k.name === "secret" ||
      (typeof val(k) === "string" && val(k).startsWith("sb_secret_"))
  );
  return svc && val(svc) ? val(svc) : null;
}

async function waitHealthy(call, ref) {
  const deadlineMs = Date.now() + 6 * 60 * 1000;
  let lastStatus = "";
  process.stdout.write("  ");
  while (Date.now() < deadlineMs) {
    let project;
    try {
      project = await call("GET", `/v1/projects/${ref}`);
    } catch (e) {
      if (e.status && e.status >= 500) {
        await sleep(5000);
        continue;
      }
      throw e;
    }
    const status = project.status || "UNKNOWN";
    if (status !== lastStatus) {
      lastStatus = status;
      process.stdout.write(`${dim(status)} `);
    } else {
      process.stdout.write(dim("."));
    }
    if (status === "ACTIVE_HEALTHY") {
      process.stdout.write("\n");
      return project;
    }
    await sleep(5000);
  }
  process.stdout.write("\n");
  throw new Error(`Project ${ref} did not become healthy within 6 minutes`);
}

async function createProject(call, { name, orgSlug, region }) {
  const dbPass = crypto.randomBytes(24).toString("base64url");
  const modern = {
    name,
    organization_slug: orgSlug,
    db_pass: dbPass,
    region_selection: { type: "smartGroup", code: region },
  };
  try {
    const project = await call("POST", "/v1/projects", modern);
    return { project, dbPass };
  } catch (e) {
    if (!e.status || e.status >= 500) throw e;
    const explicitRegion = { americas: "us-east-1", emea: "eu-west-2", apac: "ap-southeast-1" }[region] || "us-east-1";
    const legacy = { name, organization_id: orgSlug, db_pass: dbPass, region: explicitRegion };
    const project = await call("POST", "/v1/projects", legacy);
    return { project, dbPass };
  }
}

async function runMigrations(call, ref) {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (!files.length) {
    warn("No migrations found — skipping.");
    return;
  }
  for (const file of files) {
    const query = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    let lastErr;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await call("POST", `/v1/projects/${ref}/database/query`, { query });
        ok(`Applied ${file}`);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        const transient = !e.status || e.status >= 500 || e.status === 503 || e.status === 504;
        if (!transient || attempt === 4) break;
        await sleep(4000 * attempt);
      }
    }
    if (lastErr) throw new Error(`Migration ${file} failed: ${lastErr.message}`);
  }
}

async function configureAuth(call, ref, siteUrl) {
  const wanted = [
    `${siteUrl}/**`,
    `${siteUrl}/auth/callback`,
    "http://localhost:3000/**",
    "http://localhost:3000/auth/callback",
  ];
  let current = {};
  try {
    current = (await call("GET", `/v1/projects/${ref}/config/auth`)) || {};
  } catch {
    /* fall through with defaults */
  }
  const existing = String(current.uri_allow_list || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allow = Array.from(new Set([...existing, ...wanted]));
  await call("PATCH", `/v1/projects/${ref}/config/auth`, {
    site_url: siteUrl,
    uri_allow_list: allow.join(","),
    external_email_enabled: true,
    // Open signup, no email verification: signUp returns a session immediately,
    // so the login form can register-and-go with zero inbox round-trips.
    mailer_autoconfirm: true,
  });
  ok(`Auth Site URL set to ${siteUrl}`);
  info(`Redirect allow-list: ${allow.join(", ")}`);
}

function printHelp() {
  log(`${bold("agent37-starter-kit setup")}

Usage: npm run setup [-- options]

Supabase (default) — reads .env.local and finishes the Supabase setup for you using
SUPABASE_ACCESS_TOKEN (a personal access token):
  - runs the database migration(s)
  - configures the Site URL + redirect allow-list and turns on
    email + password auth (open signup, no email verification)
  - fills in NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY /
    SUPABASE_SERVICE_ROLE_KEY (server-only)

If NEXT_PUBLIC_SUPABASE_URL is blank, it creates a free project for you.

Options:
  --no-create   Don't create a project; fail if none is configured.
  --neon        Use the Neon backend instead (same as \`npm run setup:neon\`).
  -h, --help    Show this help.

Neon (--neon, or NEXT_PUBLIC_BACKEND=neon) — see SETUP.md:
  --claim       Only print a fresh claim link (same as \`npm run neon:claim\`).
  NEON_REGION   region for a new project                [default: aws-us-east-2]
  NEON_API_KEY  adds NEXT_PUBLIC_SITE_URL as a trusted domain (claimed projects only)

Env overrides:
  SUPABASE_ACCESS_TOKEN   personal access token (sbp_…)   [required]
  SUPABASE_PROJECT_REF    target an existing project by ref instead of URL
  SUPABASE_ORG            org slug to create the project under
  SUPABASE_REGION         americas | emea | apac          [default: americas]
`);
}

async function main() {
  if (FLAGS.help) {
    printHelp();
    return;
  }

  // Neon backend: `npm run setup:neon`, or NEXT_PUBLIC_BACKEND=neon already in .env.local.
  if (FLAGS.neon || get(loadEnv(ENV_FILE), "NEXT_PUBLIC_BACKEND") === "neon") {
    const { setupNeon } = await import("./setup-neon.mjs");
    await setupNeon({
      ROOT,
      ENV_FILE,
      ENV_EXAMPLE,
      args,
      ui: { log, step, ok, info, warn, die, bold, dim, green, yellow, cyan },
      env: { loadEnv, setEnv, saveEnv, isBlank, get },
    });
    return;
  }

  log(bold("Setting up agent37-starter-kit\n"));

  if (!fs.existsSync(ENV_FILE)) {
    if (!fs.existsSync(ENV_EXAMPLE)) die("Missing .env.example — are you in the project root?");
    fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
    step("Created .env.local");
    log(
      `\nPaste your two secrets into ${bold(".env.local")}, then run ${bold("npm run setup")} again:\n` +
        `  ${cyan("AGENT37_API_KEY")}        your sk_live_ key (Agent37 dashboard → Cloud → API keys)\n` +
        `  ${cyan("SUPABASE_ACCESS_TOKEN")}  a token from https://supabase.com/dashboard/account/tokens`
    );
    return;
  }

  const env = loadEnv(ENV_FILE);

  const token = get(env, "SUPABASE_ACCESS_TOKEN");
  if (isBlank(token)) {
    die(
      "SUPABASE_ACCESS_TOKEN is not set in .env.local",
      `Create one at ${bold("https://supabase.com/dashboard/account/tokens")}, paste it into\n` +
        `.env.local as SUPABASE_ACCESS_TOKEN=sbp_…, then run ${bold("npm run setup")} again.\n\n` +
        `${dim("Prefer not to use a token? Do the Supabase steps by hand — see the")}\n` +
        `${dim('"Manual Supabase setup" section in SETUP.md.')}`
    );
  }
  if (isBlank(get(env, "AGENT37_API_KEY"))) {
    warn("AGENT37_API_KEY is still blank — the app needs it at runtime. Fill it in .env.local.");
  }

  const call = api(token);
  const siteUrl = (get(env, "NEXT_PUBLIC_SITE_URL") || "http://localhost:3000").replace(/\/$/, "");

  let ref = process.env.SUPABASE_PROJECT_REF || refFromUrl(get(env, "NEXT_PUBLIC_SUPABASE_URL"));

  if (ref) {
    step(`Using Supabase project ${bold(ref)}`);
    try {
      await call("GET", `/v1/projects/${ref}`);
    } catch (e) {
      if (e.status === 401) die("That access token was rejected (401). Check SUPABASE_ACCESS_TOKEN.");
      if (e.status === 404)
        die(
          `No project ${ref} found for this token (404).`,
          "Either the token belongs to a different account, or NEXT_PUBLIC_SUPABASE_URL is wrong."
        );
      throw e;
    }
  } else if (FLAGS.noCreate) {
    die(
      "No Supabase project configured, and --no-create was passed.",
      "Paste an existing project's URL into NEXT_PUBLIC_SUPABASE_URL in .env.local and re-run."
    );
  } else {
    step("No Supabase project configured — creating a new free one");
    const orgs = await call("GET", "/v1/organizations");
    if (!Array.isArray(orgs) || orgs.length === 0)
      die("Your Supabase account has no organizations — create one at https://supabase.com/dashboard first.");

    // Guidance shared by every "couldn't create" path: list the real orgs with the exact override
    // to target each, so a multi-org account never has to guess.
    const orgList = orgs.map((o) => `      • ${o.name || o.slug || o.id}   →  SUPABASE_ORG=${o.slug || o.id}`).join("\n");
    const pickHint =
      `Re-run ${bold("npm run setup")} after choosing one:\n` +
      `  • Target a specific org — set one of these:\n${orgList}\n` +
      `  • Or reuse an existing project — paste its URL into NEXT_PUBLIC_SUPABASE_URL in .env.local`;

    const wantOrg = process.env.SUPABASE_ORG;
    if (wantOrg && !orgs.some((o) => o.id === wantOrg || o.slug === wantOrg)) {
      die(`No organization "${wantOrg}" is visible to this token.`, pickHint);
    }
    // Multiple orgs and none chosen: don't guess. Picking the wrong one (e.g. a shared company org
    // where this token can't create projects) is exactly what produces the confusing 403.
    if (!wantOrg && orgs.length > 1) {
      die("Your Supabase account belongs to more than one organization — tell setup which to use.", pickHint);
    }

    const org = wantOrg ? orgs.find((o) => o.id === wantOrg || o.slug === wantOrg) : orgs[0];
    const orgSlug = org.slug || org.id;
    const region = (process.env.SUPABASE_REGION || "americas").toLowerCase();
    info(`Organization: ${org.name || orgSlug}   Region: ${region}`);
    log(`  ${dim("Creating project (this takes a minute or two)…")}`);
    let project;
    try {
      ({ project } = await createProject(call, { name: "agent37-starter-kit", orgSlug, region }));
    } catch (e) {
      const atLimit = /maximum limits|free project|project limit/i.test(e.message || "");
      if (atLimit || e.status === 403) {
        die(
          atLimit
            ? `Organization "${org.name || orgSlug}" is at its free-project limit, so setup can't create one there.`
            : `This token can't create a project in organization "${org.name || orgSlug}" (403) — likely a shared org, or one out of free slots.`,
          `${pickHint}\n  • Or free up a slot — delete/pause a project at ${bold("https://supabase.com/dashboard")}`
        );
      }
      throw e;
    }
    ref = project.ref || project.id;
    ok(`Created project ${bold(ref)}`);
    // Record the URL immediately so a crash mid-provision can't orphan the project — a re-run then
    // configures this one instead of creating a second. The generated DB password is NOT stored:
    // nothing in this app uses a direct Postgres connection (all DB access is via the service-role
    // key over HTTPS), so reset it in the Supabase dashboard if you ever want raw DB access.
    setEnv(env, "NEXT_PUBLIC_SUPABASE_URL", `https://${ref}.supabase.co`);
    saveEnv(env);
    ok("Wrote NEXT_PUBLIC_SUPABASE_URL");
    await waitHealthy(call, ref);
  }

  step("Filling in Supabase credentials");
  const needAnon = isBlank(get(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY"));
  const needService = isBlank(get(env, "SUPABASE_SERVICE_ROLE_KEY"));
  if (needAnon || needService) {
    // One reveal fetches both the public (anon) and the secret (service-role) key.
    const keys = await call("GET", `/v1/projects/${ref}/api-keys?reveal=true`);
    if (needAnon) {
      const anon = pickPublicKey(keys);
      if (!anon) die("Could not read the project's anon/publishable key from the API.");
      setEnv(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY", anon);
      ok("Wrote NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }
    if (needService) {
      const svc = pickServiceKey(keys);
      if (!svc) die("Could not read the project's service-role key from the API.");
      setEnv(env, "SUPABASE_SERVICE_ROLE_KEY", svc);
      ok("Wrote SUPABASE_SERVICE_ROLE_KEY (server-only — the app reads/writes the DB with this)");
    }
  } else {
    info("Supabase keys already set — leaving them.");
  }
  saveEnv(env);

  step("Applying database migrations");
  await runMigrations(call, ref);

  step("Configuring authentication");
  await configureAuth(call, ref, siteUrl);

  log(`\n${green("✓ Setup complete.")}`);
  log(`\nNext:`);
  log(`  ${bold("npm run dev")}   ${dim("# then open http://localhost:3000 and sign in")}`);
  log(
    `\n${yellow("!")} Creating an agent spends real money — fund your Agent37 wallet first\n` +
      `  ${dim("(dashboard → Cloud → Billing). An empty wallet returns a 402 at create time.")}`
  );
  if (siteUrl.includes("localhost")) {
    log(
      `\n${dim("When you deploy, set NEXT_PUBLIC_SITE_URL to your production URL and re-run")}\n` +
        `${dim("`npm run setup` to add the production redirect URLs.")}`
    );
  }
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(self);
  } catch {
    return path.resolve(process.argv[1]) === self;
  }
}
if (invokedDirectly()) {
  main().catch((e) => {
    die(
      e.message || String(e),
      e.status === 401 ? "Check that SUPABASE_ACCESS_TOKEN is a valid personal access token." : undefined
    );
  });
}

export { loadEnv, setEnv, saveEnv, unquote, refFromUrl, pickPublicKey, pickServiceKey, isBlank };
