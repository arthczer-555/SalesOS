// ─── GA4 Data API catalog — metrics & dimensions with descriptions ──────────
// Used by the /admin/ga4-debug playground so the user can pick what to query
// without reading the official docs.
//
// Source: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema

export interface CatalogItem {
  name: string;
  label: string;
  description: string;
}

export interface CatalogCategory {
  id: string;
  label: string;
  items: CatalogItem[];
}

// ─── METRICS ─────────────────────────────────────────────────────────────────

export const GA4_METRICS: CatalogCategory[] = [
  {
    id: "users",
    label: "Users",
    items: [
      { name: "activeUsers", label: "Active Users", description: "Users who engaged with the site/app. This is what GA4 UI shows by default as 'Users'." },
      { name: "totalUsers", label: "Total Users", description: "All users, including non-engaged. Typically higher than activeUsers." },
      { name: "newUsers", label: "New Users", description: "Users who interacted with the site for the first time." },
      { name: "userEngagementDuration", label: "User Engagement Duration", description: "Total time users were engaged (seconds)." },
    ],
  },
  {
    id: "sessions",
    label: "Sessions",
    items: [
      { name: "sessions", label: "Sessions", description: "Number of sessions that started on the site/app." },
      { name: "engagedSessions", label: "Engaged Sessions", description: "Sessions > 10s, OR with 1+ conversion event, OR with 2+ pageviews." },
      { name: "engagementRate", label: "Engagement Rate", description: "engagedSessions / sessions. Replaces bounceRate in GA4." },
      { name: "bounceRate", label: "Bounce Rate", description: "1 − engagementRate. Deprecated in GA4 UI; prefer engagementRate." },
      { name: "averageSessionDuration", label: "Avg. Session Duration", description: "Average session length in seconds." },
      { name: "sessionsPerUser", label: "Sessions per User", description: "Average sessions per active user." },
    ],
  },
  {
    id: "pages",
    label: "Pages",
    items: [
      { name: "screenPageViews", label: "Page Views", description: "Total number of page (web) or screen (app) views." },
      { name: "screenPageViewsPerSession", label: "Views per Session", description: "Average number of page views per session." },
      { name: "screenPageViewsPerUser", label: "Views per User", description: "Average number of page views per active user." },
      { name: "scrolledUsers", label: "Scrolled Users", description: "Users who scrolled at least 90% of any page. Requires scroll event." },
    ],
  },
  {
    id: "events",
    label: "Events",
    items: [
      { name: "eventCount", label: "Event Count", description: "Total number of events (page_view, scroll, click, etc.). NOT conversions." },
      { name: "eventCountPerUser", label: "Events per User", description: "Average number of events per active user." },
      { name: "eventsPerSession", label: "Events per Session", description: "Average number of events per session." },
      { name: "eventValue", label: "Event Value", description: "Sum of value parameter across all events (if set)." },
      { name: "keyEvents", label: "Key Events", description: "Events marked as 'Key Event' in GA4 Admin → Events. Replaces 'conversions' (March 2024)." },
      { name: "conversions", label: "Conversions (legacy)", description: "Legacy conversion count. GA4 now uses keyEvents; kept for backward compat." },
    ],
  },
  {
    id: "ecommerce",
    label: "Ecommerce",
    items: [
      { name: "totalRevenue", label: "Total Revenue", description: "Sum of purchase, in-app purchase, subscription and ads revenue." },
      { name: "purchaseRevenue", label: "Purchase Revenue", description: "Sum of revenue from purchase events only." },
      { name: "transactions", label: "Transactions", description: "Number of completed purchase transactions." },
      { name: "averagePurchaseRevenue", label: "Avg. Purchase Revenue", description: "purchaseRevenue / transactions." },
      { name: "itemsPurchased", label: "Items Purchased", description: "Total quantity of items purchased." },
      { name: "itemsViewed", label: "Items Viewed", description: "Total count of items viewed in product detail pages." },
      { name: "cartToViewRate", label: "Cart-to-View Rate", description: "addToCart / viewItem ratio." },
      { name: "purchaseToViewRate", label: "Purchase-to-View Rate", description: "Purchases / viewItem ratio." },
    ],
  },
  {
    id: "advertising",
    label: "Advertising",
    items: [
      { name: "advertiserAdClicks", label: "Ad Clicks", description: "Number of clicks from linked advertising accounts." },
      { name: "advertiserAdCost", label: "Ad Cost", description: "Total cost from linked ad accounts (Google Ads, etc.)." },
      { name: "advertiserAdImpressions", label: "Ad Impressions", description: "Number of ad impressions from linked ad accounts." },
      { name: "returnOnAdSpend", label: "ROAS", description: "totalRevenue / adCost. Needs linked Google Ads." },
    ],
  },
  {
    id: "prediction",
    label: "Prediction (ML)",
    items: [
      { name: "purchaseProbability", label: "Purchase Probability", description: "Predicted probability a user will purchase in the next 7 days." },
      { name: "churnProbability", label: "Churn Probability", description: "Predicted probability a user will NOT return in the next 7 days." },
      { name: "inAppPurchaseProbability", label: "In-App Purchase Probability", description: "Predicted probability of an in-app purchase in 7 days." },
    ],
  },
];

// ─── DIMENSIONS ──────────────────────────────────────────────────────────────

export const GA4_DIMENSIONS: CatalogCategory[] = [
  {
    id: "time",
    label: "Time",
    items: [
      { name: "date", label: "Date", description: "Date of the event, format YYYYMMDD." },
      { name: "dateHour", label: "Date + Hour", description: "Date and hour, format YYYYMMDDHH." },
      { name: "year", label: "Year", description: "Year (YYYY)." },
      { name: "month", label: "Month", description: "Month (01–12)." },
      { name: "week", label: "Week of Year", description: "Week number (00–53)." },
      { name: "dayOfWeek", label: "Day of Week", description: "0 = Sunday, 6 = Saturday." },
      { name: "hour", label: "Hour", description: "Hour of day (00–23)." },
    ],
  },
  {
    id: "source",
    label: "Traffic Source",
    items: [
      { name: "sessionDefaultChannelGroup", label: "Channel Group", description: "Default channel grouping at session level: Organic Search, Direct, Social, etc." },
      { name: "sessionSource", label: "Session Source", description: "Specific source at session start (e.g. google, newsletter, linkedin.com)." },
      { name: "sessionMedium", label: "Session Medium", description: "Medium at session start (organic, cpc, email, referral)." },
      { name: "sessionSourceMedium", label: "Source / Medium", description: "Concatenation of source and medium: 'google / organic'." },
      { name: "sessionCampaignName", label: "Session Campaign", description: "Campaign parameter (utm_campaign) at session start." },
      { name: "firstUserSource", label: "First User Source", description: "Source for the user's first-ever session (attribution)." },
      { name: "firstUserMedium", label: "First User Medium", description: "Medium for the user's first-ever session." },
      { name: "firstUserDefaultChannelGroup", label: "First User Channel", description: "Default channel group of the user's first session." },
    ],
  },
  {
    id: "page",
    label: "Page / Content",
    items: [
      { name: "pagePath", label: "Page Path", description: "Path only (e.g. /blog/why-coaching)." },
      { name: "pageTitle", label: "Page Title", description: "Document title (<title> tag)." },
      { name: "pageLocation", label: "Page Location", description: "Full URL including hostname and query string." },
      { name: "pageReferrer", label: "Page Referrer", description: "Previous URL the user came from." },
      { name: "landingPage", label: "Landing Page", description: "First page of the session (path + params)." },
      { name: "hostName", label: "Host Name", description: "Domain of the page (coachello.ai, www.coachello.ai)." },
    ],
  },
  {
    id: "events",
    label: "Events",
    items: [
      { name: "eventName", label: "Event Name", description: "Name of the event: page_view, scroll, click, session_start, first_visit, etc." },
      { name: "isKeyEvent", label: "Is Key Event", description: "true/false — whether this event is marked as a key event in GA4 Admin." },
    ],
  },
  {
    id: "device",
    label: "Device / Platform",
    items: [
      { name: "deviceCategory", label: "Device Category", description: "desktop, mobile, tablet." },
      { name: "browser", label: "Browser", description: "Chrome, Safari, Firefox, etc." },
      { name: "operatingSystem", label: "Operating System", description: "Windows, macOS, iOS, Android, Linux." },
      { name: "deviceModel", label: "Device Model", description: "e.g. 'iPhone', 'Pixel 7'." },
      { name: "platform", label: "Platform", description: "web, iOS, Android." },
    ],
  },
  {
    id: "location",
    label: "Location",
    items: [
      { name: "country", label: "Country", description: "Full country name (France, United States)." },
      { name: "region", label: "Region", description: "State / region / province (Île-de-France, California)." },
      { name: "city", label: "City", description: "City (Paris, San Francisco)." },
      { name: "continent", label: "Continent", description: "Europe, North America, etc." },
      { name: "language", label: "Language", description: "Browser language (fr-fr, en-us)." },
    ],
  },
  {
    id: "user",
    label: "User",
    items: [
      { name: "newVsReturning", label: "New vs Returning", description: "'new' or 'returning' based on prior visits." },
      { name: "userAgeBracket", label: "Age Bracket", description: "18-24, 25-34, 35-44, 45-54, 55-64, 65+. Requires demographic reporting." },
      { name: "userGender", label: "Gender", description: "male / female / unknown. Requires demographic reporting." },
      { name: "audienceName", label: "Audience", description: "GA4 audience this user belongs to." },
    ],
  },
  {
    id: "ecommerce",
    label: "Ecommerce",
    items: [
      { name: "itemName", label: "Item Name", description: "Product name from ecommerce events." },
      { name: "itemCategory", label: "Item Category", description: "Product category." },
      { name: "itemBrand", label: "Item Brand", description: "Product brand." },
      { name: "transactionId", label: "Transaction ID", description: "Unique ID of a purchase transaction." },
    ],
  },
];

// ─── PRESETS ─────────────────────────────────────────────────────────────────
// Ready-to-run report bodies for common queries. The playground lets the user
// click one to load it, then tweak.

export interface Preset {
  id: string;
  label: string;
  description: string;
  body: Record<string, unknown>;
}

export const GA4_PRESETS: Preset[] = [
  {
    id: "current-kpis",
    label: "KPIs actuels (overview)",
    description: "Les 6 métriques affichées aujourd'hui sur l'overview, 30 derniers jours.",
    body: {
      dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "screenPageViews" },
        { name: "bounceRate" },
        { name: "averageSessionDuration" },
        { name: "eventCount" },
      ],
    },
  },
  {
    id: "fixed-kpis",
    label: "KPIs corrigés (proposition)",
    description: "Même période mais endDate=yesterday, activeUsers au lieu de totalUsers, keyEvents au lieu d'eventCount.",
    body: {
      dateRanges: [{ startDate: "30daysAgo", endDate: "yesterday" }],
      metrics: [
        { name: "sessions" },
        { name: "activeUsers" },
        { name: "newUsers" },
        { name: "screenPageViews" },
        { name: "engagementRate" },
        { name: "engagedSessions" },
        { name: "averageSessionDuration" },
        { name: "keyEvents" },
      ],
    },
  },
  {
    id: "events-inventory",
    label: "Inventaire des events (important)",
    description: "Liste tous les events qui ont fire sur le site + count + isKeyEvent. Utile pour construire un funnel.",
    body: {
      dateRanges: [{ startDate: "30daysAgo", endDate: "yesterday" }],
      dimensions: [{ name: "eventName" }, { name: "isKeyEvent" }],
      metrics: [{ name: "eventCount" }, { name: "eventCountPerUser" }],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 50,
    },
  },
  {
    id: "traffic-daily",
    label: "Traffic quotidien",
    description: "Sessions / active users / views par jour.",
    body: {
      dateRanges: [{ startDate: "30daysAgo", endDate: "yesterday" }],
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "sessions" },
        { name: "activeUsers" },
        { name: "screenPageViews" },
      ],
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: 100,
    },
  },
  {
    id: "source-medium",
    label: "Source / Medium détaillé",
    description: "Plus granulaire que le channelGroup actuel.",
    body: {
      dateRanges: [{ startDate: "30daysAgo", endDate: "yesterday" }],
      dimensions: [{ name: "sessionSourceMedium" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "engagementRate" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 20,
    },
  },
  {
    id: "top-blog-pages",
    label: "Top blog pages",
    description: "Pages du blog les plus visitées.",
    body: {
      dateRanges: [{ startDate: "30daysAgo", endDate: "yesterday" }],
      dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
      metrics: [
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "activeUsers" },
        { name: "engagementRate" },
      ],
      dimensionFilter: {
        filter: {
          fieldName: "pagePath",
          stringFilter: { matchType: "BEGINS_WITH", value: "/blog/" },
        },
      },
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 20,
    },
  },
  {
    id: "device-split",
    label: "Split device",
    description: "Sessions / CTR / engagement par desktop/mobile/tablet.",
    body: {
      dateRanges: [{ startDate: "30daysAgo", endDate: "yesterday" }],
      dimensions: [{ name: "deviceCategory" }],
      metrics: [
        { name: "sessions" },
        { name: "activeUsers" },
        { name: "engagementRate" },
        { name: "averageSessionDuration" },
      ],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    },
  },
  {
    id: "top-countries",
    label: "Top countries",
    description: "Pays d'où viennent les sessions.",
    body: {
      dateRanges: [{ startDate: "30daysAgo", endDate: "yesterday" }],
      dimensions: [{ name: "country" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 15,
    },
  },
  {
    id: "new-vs-returning",
    label: "New vs Returning",
    description: "Split nouveaux / récurrents avec engagement.",
    body: {
      dateRanges: [{ startDate: "30daysAgo", endDate: "yesterday" }],
      dimensions: [{ name: "newVsReturning" }],
      metrics: [
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "engagementRate" },
        { name: "averageSessionDuration" },
      ],
    },
  },
  {
    id: "landing-pages",
    label: "Landing pages (entrées)",
    description: "Première page de chaque session — où les gens arrivent.",
    body: {
      dateRanges: [{ startDate: "30daysAgo", endDate: "yesterday" }],
      dimensions: [{ name: "landingPage" }],
      metrics: [
        { name: "sessions" },
        { name: "engagementRate" },
        { name: "averageSessionDuration" },
      ],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 20,
    },
  },
];
