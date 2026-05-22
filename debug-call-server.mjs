import server from './dist/server/server.js';

async function test() {
  const url = 'http://localhost/';
  const req = new Request(url, { method: 'GET', headers: { host: 'localhost' } });
  try {
    const res = await server.fetch(req);
    console.log('STATUS:', res.status);
    console.log('HEADERS:');
    for (const [k, v] of res.headers) console.log(k + ':', v);
    try {
      const text = await res.text();
      console.log('BODY (first 2000 chars):');
      console.log(text.slice(0, 2000));
    } catch (e) {
      console.error('Error reading body:', e);
    }
  } catch (err) {
    console.error('server.fetch threw:', err);
  }
}

test();
