import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'PitchPrism', description: 'Business idea screening for Tata STRIVE' };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
