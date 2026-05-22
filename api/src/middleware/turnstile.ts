import fetch from 'node-fetch';
import { Request, Response, NextFunction } from 'express';

const TURNSTILE_SECRET = process.env.CLOUDFLARE_TURNSTILE_SECRET;

export async function verifyTurnstileToken(token: string, remoteIp?: string) {
  if (!TURNSTILE_SECRET) return false;
  const params = new URLSearchParams();
  params.append('secret', TURNSTILE_SECRET);
  params.append('response', token);
  if (remoteIp) params.append('remoteip', remoteIp);

  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: params,
  });
  const data = (await resp.json()) as { success?: boolean };
  return data.success === true;
}

export async function requireTurnstile(req: Request, res: Response, next: NextFunction) {
  try {
    const token = (req.body && req.body.turnstile_token) || req.headers['x-turnstile-token'];
    const ip = req.headers['cf-connecting-ip'] as string || req.ip;
    if (!token) return res.status(400).json({ error: 'missing_turnstile' });
    const ok = await verifyTurnstileToken(String(token), ip);
    if (!ok) return res.status(403).json({ error: 'turnstile_failed' });
    return next();
  } catch (err) {
    return res.status(500).json({ error: 'turnstile_error' });
  }
}
