'use client';

/**
 * eneleje.com · Piezas interactivas del cliente (useFormStatus, clipboard,
 * geolocalización del móvil, widget Turnstile).
 */
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

export function SubmitButton({
  children,
  pendingLabel = 'Guardando…',
  className = '',
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export function SecondarySubmit({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-emerald-400 disabled:opacity-60 ${className}`}
    >
      {pending ? '…' : children}
    </button>
  );
}

export function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [copiado, setCopiado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(text);
      setCopiado(true);
      timer.current = setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* clipboard no disponible (http): seleccionar manual */
    }
  }
  return (
    <button
      type="button"
      onClick={copiar}
      className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-emerald-400"
    >
      {copiado ? '✓ Copiado' : label}
    </button>
  );
}

/** Botón "usar mi ubicación": llena los inputs lat/lon con GPS del móvil. */
export function GeoButton({ latId, lonId }: { latId: string; lonId: string }) {
  const [estado, setEstado] = useState<'idle' | 'buscando' | 'ok' | 'error'>('idle');

  function ubicar() {
    if (!('geolocation' in navigator)) return setEstado('error');
    setEstado('buscando');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = document.getElementById(latId) as HTMLInputElement | null;
        const lon = document.getElementById(lonId) as HTMLInputElement | null;
        if (lat) lat.value = pos.coords.latitude.toFixed(6);
        if (lon) lon.value = pos.coords.longitude.toFixed(6);
        setEstado('ok');
      },
      () => setEstado('error'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={ubicar}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-emerald-400"
      >
        📍 Usar mi ubicación actual
      </button>
      {estado === 'buscando' && <span className="text-xs text-slate-500">Buscando…</span>}
      {estado === 'ok' && <span className="text-xs text-emerald-700">✓ Ubicación capturada</span>}
      {estado === 'error' && (
        <span className="text-xs text-rose-600">No se pudo obtener (escríbela manualmente)</span>
      )}
    </div>
  );
}

export function TurnstileWidget() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="lazyOnload" />
      <div className="cf-turnstile" data-sitekey={siteKey} data-theme="light" />
    </>
  );
}
