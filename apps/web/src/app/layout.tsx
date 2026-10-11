import "@/ui/tokens/tokens.css";
import "@/ui/tokens/base.css";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import localFont from "next/font/local";
import { Suspense, type ReactNode } from "react";
import { DevBanner } from "@/features/shell/DevBanner.tsx";

const geist = Geist({ subsets: ["latin"], display: "swap", variable: "--ds-face-geist" });
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--ds-face-newsreader",
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--ds-face-geist-mono",
});

// The one file the signed PDF embeds, so the on-screen preview of a signature is the signed one.
// Only the signing screens use it, so it is not preloaded for every page.
const signature = localFont({
  src: "../../../../packages/core/assets/NotoSans-Regular.ttf",
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--ds-font-signature",
});

export const metadata: Metadata = {
  title: { default: "DripSign", template: "%s · DripSign" },
  description: "Prepare, negotiate and sign agreements.",
};

const FACES = [geist, newsreader, geistMono, signature].map((face) => face.variable).join(" ");

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={FACES}>
      <body>
        <Suspense fallback={null}>
          <DevBanner />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
