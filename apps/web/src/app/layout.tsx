import "@/ui/tokens/tokens.css";
import "@/ui/tokens/base.css";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
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

export const metadata: Metadata = {
  title: { default: "DripSign", template: "%s · DripSign" },
  description: "Prepare, negotiate and sign agreements.",
};

const FACES = [geist, newsreader, geistMono].map((face) => face.variable).join(" ");

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
