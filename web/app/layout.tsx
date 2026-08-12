import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LMC vs Milky Way — how a satellite tells two galaxies apart",
  description:
    "An interactive 3D walkthrough of a machine-learning classifier that separates Large Magellanic Cloud stars from Milky Way foreground stars using Gaia astrometry.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
