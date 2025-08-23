// src/lib/tenant.ts
import type { Request, Response, NextFunction } from 'express';

export function resolveTenant(req: Request): string {
  const hdr = req.header('X-Tenant-Id');
  const q   = (req.query.clientId || (req.body as any)?.clientId) as string | undefined;
  const sub = req.hostname?.split('.')?.[0];
  const t =
    (hdr && String(hdr)) ||
    (q && String(q)) ||
    (sub && sub !== 'www' ? sub : '') ||
    'default';
  (req as any).tenantId = t.toLowerCase();
  return (req as any).tenantId;
}

export function withTenant(req: Request, _res: Response, next: NextFunction) {
  resolveTenant(req);
  next();
}