import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Locator Workbench",
  description: "Paste HTML, inspect a page snapshot, and copy robust locator snippets."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
