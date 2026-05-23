import http from 'k6/http'
import { check, sleep } from 'k6'

const vus = __ENV.VUS ? Number(__ENV.VUS) : undefined
const duration = __ENV.DURATION || '2m'

export let options = {
  ...(vus
    ? {
        vus,
        duration,
      }
    : {
        stages: [
          { duration: '30s', target: 100 },
          { duration: '1m', target: 1000 },
          { duration: '2m', target: 2000 },
          // The full ramp to 10k should be used only in controlled environments
          // { duration: '5m', target: 10000 }
        ],
      }),
  thresholds: {
    http_req_duration: ['p(95)<500'],
    'http_req_failed{status:429}': ['rate<0.01']
  }
}

const BASE = __ENV.TARGET_URL || 'http://127.0.0.1:4173'

export default function () {
  const res = http.get(`${BASE}/api/leaderboard`)
  check(res, {
    'status is 200': (r) => r.status === 200
  })
  sleep(1)
}
