// Single point of product branding (TigerAI overlay). Upstream files import from here;
// change the name/logo here or via env, not in components.
export const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "OpenAgent Portal";
/** Shown where the sidebar is narrow (the logo already says TigerAI). */
export const BRAND_SHORT = process.env.NEXT_PUBLIC_BRAND_SHORT?.trim() || BRAND_NAME;
export const BRAND_LOGO = "/brand/tigerai-logo.png";

/** Required wording next to the product name (login page, name popup, README): the project builds on two MIT-licensed projects. See NOTICE. */
export const BRAND_BASED_ON = "based on pi-agent and pi-web";
export const BRAND_UPSTREAM = [
  { name: "pi-agent", href: "https://github.com/earendil-works/pi" },
  { name: "pi-web", href: "https://github.com/agegr/pi-web" },
] as const;
