/**
 * eneleje.com · Piezas de UI compartidas (server-safe).
 * Las piezas interactivas (useFormStatus, clipboard, geolocation) están en
 * client-bits.tsx.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

export function Field({
  label,
  name,
  type = 'text',
  required = false,
  placeholder,
  hint,
  defaultValue,
  autoComplete,
  inputMode,
  inputId,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  defaultValue?: string;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'url';
  inputId?: string;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </span>
      <input
        name={name}
        id={inputId}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function TextArea({
  label,
  name,
  required = false,
  rows = 3,
  placeholder,
  hint,
  defaultValue,
  maxLength,
}: {
  label: string;
  name: string;
  required?: boolean;
  rows?: number;
  placeholder?: string;
  hint?: string;
  defaultValue?: string;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </span>
      <textarea
        name={name}
        required={required}
        rows={rows}
        placeholder={placeholder}
        defaultValue={defaultValue}
        maxLength={maxLength}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function SelectField({
  label,
  name,
  options,
  required = false,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  required?: boolean;
  defaultValue?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </span>
      <select
        name={name}
        required={required}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {message}
    </p>
  );
}

export function FormOk({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      {message}
    </p>
  );
}

/** Armadura anti-bot: el bot rellena esto; los humanos no lo ven. */
export function Honeypot() {
  return (
    <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
      <label>
        No llenes este campo
        <input type="text" name="sitio_web" tabIndex={-1} autoComplete="off" />
      </label>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-5 ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  back,
}: {
  title: string;
  subtitle?: string;
  back?: { href: string; label: string };
}) {
  return (
    <header className="space-y-1">
      {back && (
        <Link href={back.href} className="text-sm text-slate-500 hover:text-emerald-700">
          ← {back.label}
        </Link>
      )}
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="text-sm text-slate-600">{subtitle}</p>}
    </header>
  );
}
