import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Observe | TTC Observation Portal",
  description: "A thoughtful space to manage your language learning.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
