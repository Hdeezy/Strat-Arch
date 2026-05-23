import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Fund a Card',
  description: 'Load a HOPE Card for someone in Hamilton who needs it',
}

export default function DonateLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-hope-pale">
      <header className="bg-hope-dark text-white px-4 py-3 flex items-center gap-3">
        <a href="/" className="text-hope-light text-sm">← Home</a>
        <div className="flex-1 text-center">
          <span className="font-semibold text-sm">HOPE Card</span>
        </div>
        <div className="w-12" />
      </header>
      <main className="max-w-lg mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  )
}
