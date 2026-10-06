import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyInitData } from '../src/auth.js';

function sign(fields, token) {
  const check = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

test('валидный initData принимается, подделанный — нет', () => {
  const token = '123:ABC';
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 42, first_name: 'Ваня' }), start_param: 'ABCDE' };
  const ok = verifyInitData(sign(fields, token), token);
  assert.deepEqual(ok, { id: 'tg42', name: 'Ваня', photo: null, startParam: 'ABCDE' });
  assert.equal(verifyInitData(sign(fields, token), 'other:token'), null);
  assert.equal(verifyInitData(sign(fields, token).replace('42', '43'), token), null);
});
