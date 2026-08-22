import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eve · Local enterprise agent",
  description:
    "A private, durable enterprise agent running locally on NVIDIA accelerated infrastructure.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
