export interface ModuleDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
}

export const moduleDefs: ModuleDef[] = [
  { id: "01-page-existence", name: "Page Existence", desc: "HTML structure, DOCTYPE validation", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", color: "from-blue-400 to-blue-600" },
  { id: "02-sitemap", name: "Sitemap Audit", desc: "XML validation, URL coverage, subdirectory support", icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z", color: "from-emerald-400 to-emerald-600" },
  { id: "03-robots-txt", name: "robots.txt", desc: "Crawl directives, disallowed paths", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z", color: "from-amber-400 to-amber-600" },
  { id: "04-css-js-integrity", name: "CSS/JS Integrity", desc: "SRI, CSP, crossorigin, @import", icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4", color: "from-purple-400 to-purple-600" },
  { id: "05-nav-consistency", name: "Nav Consistency", desc: "Skip links, bypass blocks, tabindex, consistent help", icon: "M4 6h16M4 10h16M4 14h16M4 18h16", color: "from-pink-400 to-pink-600" },
  { id: "06-seo-adsense", name: "SEO & AdSense", desc: "Schema, OG tags, meta robots, ads.txt", icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6", color: "from-cyan-400 to-cyan-600" },
  { id: "07-dead-links", name: "Dead Links", desc: "404s, redirects, orphan pages", icon: "M18.364 5.636a9 9 0 11-12.728 0 9 9 0 0112.728 0zM12 8v4m0 4h.01", color: "from-rose-400 to-rose-600" },
  { id: "08-placeholder", name: "Placeholders", desc: "Lorem ipsum, TODOs, thin content, YMYL", icon: "M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z", color: "from-orange-400 to-orange-600" },
  { id: "09-layout-overflow", name: "Layout & Overflow", desc: "Viewport overflow, horizontal scroll", icon: "M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z", color: "from-teal-400 to-teal-600" },
  { id: "10-accessibility", name: "Accessibility", desc: "Alt text, ARIA, labels, color contrast, focus", icon: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z", color: "from-indigo-400 to-indigo-600" },
  { id: "11-performance", name: "Performance", desc: "Render-blocking, lazy loading, caching", icon: "M13 10V3L4 14h7v7l9-11h-7z", color: "from-yellow-400 to-yellow-600" },
  { id: "12-hosting-readiness", name: "Hosting Readiness", desc: "CNAME, SSL, .env exposure, server config", icon: "M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4", color: "from-sky-400 to-sky-600" },
  { id: "13-security", name: "Security", desc: "Headers, exposed files, mixed content", icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z", color: "from-red-400 to-red-600" },
  { id: "15-image-optimization", name: "Image Optimization", desc: "Formats, lazy loading, dimensions, oversized images", icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z", color: "from-green-400 to-green-600" },
  { id: "16-forms-interaction", name: "Forms & Interaction", desc: "Form validation, labels, submit buttons, mailto links", icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z", color: "from-sky-400 to-sky-600" },
  { id: "14-final-verification", name: "Final Verification", desc: "Cross-module consistency, recommendation summary", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", color: "from-violet-400 to-violet-600" },
];
