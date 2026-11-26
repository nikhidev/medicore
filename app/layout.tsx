import "./style.css";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "MediCore | Hospital Operations",
  description: "Synthetic hospital operations workspace",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
