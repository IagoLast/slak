import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Slak — chat de empresa",
  description: "Chat interno de la empresa: canales, mensajes directos y archivos.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="h-full">{children}</body>
    </html>
  );
}
