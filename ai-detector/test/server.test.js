'use strict';
process.env.DB_PATH = ':memory:';
delete process.env.SIGHTENGINE_API_USER; delete process.env.STRIPE_SECRET_KEY;
const test = require('node:test');
const assert = require('node:assert');
const app = require('../server');

test('account, analysis, credit spending and paywall', async (t) => {
  const server = app.listen(0); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let r = await fetch(`${base}/api/me`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const me = await r.json();
  assert.equal(me.credits, 5);

  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000004000000040008020000000000000000000000000049454e44ae426082', 'hex');
  const send = () => { const f = new FormData(); f.append('file', new Blob([png], { type: 'image/png' }), 'x.png');
    return fetch(`${base}/api/analyze`, { method: 'POST', body: f, headers: { cookie } }); };
  for (let i = 4; i >= 0; i--) { r = await send(); assert.equal(r.status, 200); assert.equal((await r.json()).credits, i); }
  r = await send();
  assert.equal(r.status, 402);

  r = await fetch(`${base}/api/checkout`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{"pack":"pro"}' });
  assert.equal(r.status, 503);
});
