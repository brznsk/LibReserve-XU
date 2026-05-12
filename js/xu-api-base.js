/**
 * Resolve API root for fetch(). Load this script before auth-store.js / login.js.
 *
 * - Local / LAN → Express API on 127.0.0.1:3000
 * - Netlify (*.netlify.app or hosts you list below) → same-site Functions
 * - Else → set your real backend URL in REMOTE_API_FALLBACK
 */
(function () {
  const h = window.location.hostname;
  const isLoopback = h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  const isPrivateLan =
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h);

  const NETLIFY_PRODUCTION_HOSTS = [libreserve-xu.netlify.app];

  const useNetlifyFunctions =
    h.endsWith(".netlify.app") || NETLIFY_PRODUCTION_HOSTS.indexOf(h) !== -1;

  if (isLoopback || isPrivateLan) {
    window.XU_API_BASE = "http://127.0.0.1:3000/api";
  } else if (useNetlifyFunctions) {
    window.XU_API_BASE = "/.netlify/functions";
  } else {
    window.XU_API_BASE = REMOTE_API_FALLBACK;
  }
})();
