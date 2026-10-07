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
    // `dark` is the editor's theme (see globals.css's `.dark` block): a
    // neutral Figma-like palette. Set statically here -- there is no
    // switcher -- so the first paint is already dark and nothing flashes.
    <html
      lang="en"
      className={`dark ${GeistSans.variable} ${GeistMono.variable} ${GeistSans.className}`}
    >
      {/* Browser extensions (ColorZilla's `cz-shortcut-listen`, Grammarly,
          password managers) add attributes to <body> before React hydrates,
          which React reports as a hydration mismatch. This suppresses the
          warning for <body>'s own attributes only; children are still
          checked. */}
      <body className="bg-background text-foreground antialiased" suppressHydrationWarning>
        {children}
        {/* No next-themes provider exists, so the Toaster's own useTheme
            would report "system"; the theme is fixed above, so say so. */}
        <Toaster theme="dark" position="top-center" />
      </body>
    </html>
  )
}
