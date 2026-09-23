// Shared VAPID key validation.
// Called by scheduler, scan-consumer, and deliver-consumer before any D1 or
// crypto work is attempted.  Logs key lengths only — never logs key values.

const B64URL = /^[A-Za-z0-9\-_]+$/;

export function validateVapid(env) {
  const pub  = env.VAPID_PUBLIC_KEY;
  const priv = env.VAPID_PRIVATE_KEY;

  if (typeof pub !== 'string' || pub.length !== 87 || !B64URL.test(pub)) {
    console.error('vapid: invalid public key len=' +
      (typeof pub === 'string' ? pub.length : typeof pub));
    return false;
  }
  if (typeof priv !== 'string' || priv.length !== 43 || !B64URL.test(priv)) {
    console.error('vapid: invalid private key len=' +
      (typeof priv === 'string' ? priv.length : typeof priv));
    return false;
  }
  return true;
}
