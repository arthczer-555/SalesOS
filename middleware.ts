import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/api/gmail/callback(.*)", // Google OAuth callback — user browser has session cookie
  "/api/deals/score-all(.*)", // Cron endpoint — authenticated via Bearer CRON_SECRET in handler
  "/api/webhooks/claap(.*)", // Claap webhook — authenticated via x-claap-webhook-secret in handler
  "/api/webhooks/netrows(.*)", // Netrows webhook — authenticated via HMAC SHA-256 (x-netrows-signature) in handler
  "/api/webhooks/hubspot-closed-won(.*)", // HubSpot webhook — authenticated via HMAC SHA-256 v3 (x-hubspot-signature-v3) in handler
  "/api/sales-coach/analyze(.*)", // Fire-and-forget internal trigger — authenticated via x-internal-secret in handler
  "/api/sales-coach/recover-stuck(.*)", // Cron / UI — accepts Bearer CRON_SECRET OR Clerk session (admin)
]);

export default clerkMiddleware(async (auth, request) => {
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

export const config = {
  matcher: [
    "/((?!_next|\\.netlify|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|txt|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
