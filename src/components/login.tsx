"use client";
import { useState } from "react";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { json } from "@/lib/api";
import { Field } from "./primitives";
export function Login({
  onLogin,
  schoolName,
}: {
  onLogin: () => Promise<void>;
  schoolName: string;
}) {
  const [admin, setAdmin] = useState(false),
    [code, setCode] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-shell">
      <section className="login-story">
        <a className="brand" href="/">
          <span className="brand-mark">
            N<span>·</span>
          </span>
          <span>{schoolName}</span>
        </a>
        <div>
          <span className="pill">A WORLD OF POSSIBILITY</span>
          <h1>
            A new language.
            <br />A wider world.
          </h1>
          <p>
            A thoughtful space to learn, connect, and find your voice. Your next
            chapter starts here.
          </p>
          <div className="login-art" aria-hidden="true">
            <span>hello</span>
            <span>connect</span>
            <span>discover</span>
            <span>grow</span>
          </div>
        </div>
        <small>Small steps. Meaningful connections. Every day.</small>
      </section>
      <section className="login-form">
        <div>
          <span className="eyebrow">YOUR LEARNING SPACE</span>
          <h2>{admin ? "Welcome back, admin." : "Let’s keep growing."}</h2>
          <p>
            {admin
              ? "Sign in to keep your school moving."
              : "Enter the private access code shared by your school."}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await json(
                  "/api/auth/login",
                  admin ? { email, password } : { code: code.trim() },
                );
                await onLogin();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {error && (
              <p className="alert error" role="alert">
                {error}
              </p>
            )}
            {admin ? (
              <>
                <Field
                  label="Email address"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  required
                />
                <Field
                  label="Password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  required
                />
              </>
            ) : (
              <label className="field">
                <span>Private access code</span>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="Paste your access code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </label>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? "Signing in…" : "Enter your workspace"}
              <ArrowUpRight size={18} />
            </button>
          </form>
          <p className="helper">
            <ShieldCheck size={15} />
            Private access. A space that’s yours.
          </p>
          <button
            className="login-switch"
            onClick={() => {
              setAdmin(!admin);
              setError("");
            }}
          >
            {admin ? "Student access →" : "School administrator? Sign in →"}
          </button>
          <p className="login-help">
            Need an access code? Contact your school administrator.
          </p>
        </div>
      </section>
    </div>
  );
}
