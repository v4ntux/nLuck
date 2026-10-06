import crypto from 'node:crypto';

/**
 * Проверка Telegram WebApp initData.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyInitData(initData, botToken, maxAgeSec = 24 * 3600) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  const authDate = Number(params.get('auth_date'));
  if (maxAgeSec && Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    const user = JSON.parse(params.get('user'));
    return {
      id: 'tg' + user.id,
      name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Игрок',
      photo: user.photo_url || null,
      startParam: params.get('start_param') || null,
    };
  } catch {
    return null;
  }
}
