/**
 * Cloudflare Worker to verify Cloudflare Turnstile tokens at the edge
 * Usage:
 * - Deploy to Cloudflare Workers and route the registration POST path to this worker
 * - The worker validates the `cf-turnstile-response` token with Cloudflare API
 * - If valid, it forwards the request to the origin (your API)
 */

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  // Only POST requests expected for registration endpoints — adjust as needed
  if (request.method !== 'POST') {
    return fetch(request)
  }

  let cfTurnstileToken = request.headers.get('cf-turnstile-response')
  if (!cfTurnstileToken) {
    try {
      const fd = await request.clone().formData()
      cfTurnstileToken = fd.get('cf-turnstile-response')
    } catch (e) {
      // ignore
    }
  }

  if (!cfTurnstileToken) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_turnstile' }), { status: 400, headers: { 'content-type': 'application/json' } })
  }

  const secret = CLOUD_TURNSTILE_SECRET()
  const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(cfTurnstileToken)}`,
  })

  const json = await verify.json()
  if (!json.success) {
    return new Response(JSON.stringify({ ok: false, error: 'turnstile_failed', details: json }), { status: 403, headers: { 'content-type': 'application/json' } })
  }

  // Forward original request to origin (preserve headers body)
  const forwarded = new Request(request, { headers: request.headers })
  return fetch(forwarded)
}

// Replace with your method to access secrets (e.g., Wrangler secrets or KV)
function CLOUD_TURNSTILE_SECRET() {
  // Wrangler secret name: TURNSTILE_SECRET
  try {
    return GLOBAL_TURNSTILE_SECRET || ''
  } catch (e) {
    return ''
  }
}

// Note: set GLOBAL_TURNSTILE_SECRET via Wrangler secret or Cloudflare Pages environment.
