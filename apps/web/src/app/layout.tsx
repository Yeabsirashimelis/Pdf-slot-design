import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

export const metadata: Metadata = {
  title: 'PDF Slot Editor',
  description: 'Add text anywhere on a PDF or document image, then download it.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${GeistSans.className}`}
    >
      {/* Browser extensions (ColorZilla's `cz-shortcut-listen`, Grammarly,
          password managers) add attributes to <body> before React hydrates,
          which React reports as a hydration mismatch. This suppresses the
          warning for <body>'s own attributes only; children are still
          checked. */}
      <body className="bg-background text-foreground antialiased" suppressHydrationWarning>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
