import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/api/gmail/callback(.*)", // Google OAuth callback — user browser has session cookie
  "/api/deals/score-all(.*)", // Cron endpoint — authenticated via Bearer CRON_SECRET in handler
  "/api/deals/ae-digest(.*)", // Cron / admin — accepts X-Cron-Secret OR Clerk session in handler
  "/api/webhooks/claap(.*)", // Claap webhook — authenticated via x-claap-webhook-secret in handler
  "/api/webhooks/hubspot-closed-won(.*)", // HubSpot webhook — authenticated via HMAC SHA-256 v3 (x-hubspot-signature-v3) in handler
  "/api/slack/events(.*)", // Slack Events API — authenticated via HMAC SHA-256 (x-slack-signature) in handler
  "/api/sales-coach/analyze(.*)", // Fire-and-forget internal trigger — authenticated via x-internal-secret in handler
  "/api/sales-coach/recover-stuck(.*)", // Cron / UI — accepts Bearer CRON_SECRET OR Clerk session (admin)
  "/api/team-pot/sync(.*)", // Cron / UI — accepts Bearer CRON_SECRET OR Clerk session (admin)
]);

const handleRequest = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }

  const response = NextResponse.next();

  // Security headers
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  return response;
});

// Cookies Clerk posés sur le navigateur. On les efface quand la session est
// illisible, sinon chaque requête suivante replante sur le même cookie.
const CLERK_COOKIES = ["__session", "__client_uat", "__clerk_db_jwt", "__clerk_handshake"];

// Un cookie `__session` corrompu (JWT tronqué, instance Clerk changée, clés
// tournées) fait jeter le décodage du token À L'INTÉRIEUR de clerkMiddleware :
// "Unexpected token ... is not valid JSON". Sans rattrapage, l'exception tue
// l'edge function Netlify et l'utilisateur voit "This edge function has
// crashed" sur TOUTE l'app, sans moyen de s'en sortir. On rattrape donc pour
// repartir proprement vers la connexion, cookies effacés.
export default async function middleware(request: NextRequest, event: NextFetchEvent) {
  try {
    return await handleRequest(request, event);
  } catch (error) {
    console.error("[middleware] session illisible, reset des cookies Clerk:", error);
    // Sur /sign-in on laisse passer (un redirect vers soi-même bouclerait),
    // ailleurs on renvoie vers la connexion.
    const response = isPublicRoute(request)
      ? NextResponse.next()
      : NextResponse.redirect(new URL("/sign-in", request.url));
    for (const name of CLERK_COOKIES) response.cookies.delete(name);
    return response;
  }
}

export const config = {
  matcher: [
    "/((?!_next|\\.netlify|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|txt|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
