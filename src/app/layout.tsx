import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "sonner";
import { branding } from "@/config/branding";
import { PublicConfigProvider } from "@/components/PublicConfigProvider";
import { requestPublicConfig } from "@/lib/tenant";
import { STRIP_CREDENTIALS_BOOTSTRAP } from "@/lib/site-url";
import { THEME_BOOTSTRAP } from "@/lib/theme";
import { RumReporter } from "@/components/RumReporter";
import { sampleRateOf } from "@/lib/rum";

// Onest for the interface, Bricolage Grotesque for headings, greetings and expert names
// (`font-display`). Served from the repo (src/app/fonts, latin subset from Fontsource): with
// next/font/google every build downloads them from fonts.gstatic.com, and the build fails when
// Google does not answer.
const onest = localFont({
  src: "./fonts/onest-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-onest",
  display: "swap",
});
const bricolage = localFont({
  src: [
    { path: "./fonts/bricolage-grotesque-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/bricolage-grotesque-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-bricolage",
  display: "swap",
});

// Rendered per request: the public config comes from the env at runtime and, when one deployment
// serves every client, from the request's host. A prerendered page would freeze both.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: branding.appName,
  description:
    "Une IA pensée pour l'Afrique, prête à l'emploi, au service de vos équipes.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const config = await requestPublicConfig();
  return (
    // THEME_BOOTSTRAP adds `dark` to this element before React hydrates it.
    <html lang="fr" className={`${onest.variable} ${bricolage.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: STRIP_CREDENTIALS_BOOTSTRAP }} />
        {/* Pose la classe `dark` avant le premier rendu : sans ça, l'écran clignote en clair. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <PublicConfigProvider config={config}>{children}</PublicConfigProvider>
        <RumReporter sampleRate={sampleRateOf(process.env.RUM_SAMPLE_RATE)} />
        {/* Couleurs, police et bouton « Ouvrir » aux couleurs Yelema : globals.css (bloc sonner). */}
        {/* En long, à l'horizontale (Leslie, 19/10) : sonner pose --width en style inline, seul son prop style la remplace. */}
        <Toaster richColors closeButton position="top-center" style={{ "--width": "min(560px, calc(100vw - 32px))" } as React.CSSProperties} />
      </body>
    </html>
  );
}
