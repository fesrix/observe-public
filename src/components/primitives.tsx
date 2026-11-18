"use client";
import { BookOpen } from "lucide-react";
export function Stat({
  label,
  value,
  text,
  icon,
}: {
  label: string;
  value: string | number;
  text: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="panel stat">
      <div>
        <span>{label}</span>
        <i>{icon}</i>
      </div>
      <strong>{value}</strong>
      <p>{text}</p>
    </div>
  );
}
export function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        min={type === "number" ? 1 : undefined}
        max={type === "number" ? 500 : undefined}
      />
    </label>
  );
}
export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <BookOpen size={32} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
