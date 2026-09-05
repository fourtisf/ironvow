'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '../../../lib/api';

/**
 * Magic-link landing page.
 *
 * The token is redeemed once, server-side, in exchange for an httpOnly session
 * cookie. Nothing durable is kept in JavaScript's reach.
 */
function Callback() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [needsName, setNeedsName] = useState(false);
  const token = params.get('token');

  useEffect(() => {
    if (!token) {
      setError('That link is missing its token.');
      return;
    }
    api.redeemLogin(token)
      .then(() => router.replace('/'))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.code === 'nameRequired') setNeedsName(true);
        else if (e instanceof ApiError && e.code === 'linkInvalid') setError('That link has expired or was already used.');
        else setError('Could not sign you in. Ask for a new link.');
      });
  }, [token, router]);

  return (
    <div className="ovl">
      <div className="modal">
        <h2>IRONVOW</h2>
        {needsName ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem('name') as HTMLInputElement | null;
              if (!input?.value || !token) return;
              api.redeemLogin(token, input.value)
                .then(() => router.replace('/'))
                .catch((err: unknown) => {
                  setError(err instanceof ApiError && err.code === 'nameTaken'
                    ? 'Somebody already holds that name.'
                    : 'Could not create your hold.');
                });
            }}
          >
            <p className="lead">Name your hold. Two to twenty-four characters.</p>
            <input
              name="name"
              required
              minLength={2}
              maxLength={24}
              placeholder="Ironhold"
              style={{
                width: '100%', padding: 12, borderRadius: 12, border: '2px solid #46608a',
                background: '#141d2b', color: '#f2e4c4', fontFamily: 'Arial', fontWeight: 700, fontSize: 13,
              }}
            />
            <button className="btn gold big" type="submit">CLAIM IT</button>
          </form>
        ) : (
          <p className="lead">{error ?? 'Signing you in…'}</p>
        )}
      </div>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<div className="ovl"><div className="modal"><p className="lead">Loading…</p></div></div>}>
      <Callback />
    </Suspense>
  );
}
