import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="min-h-screen bg-hope-dark flex flex-col items-center justify-center p-6">
      <div className="max-w-sm w-full space-y-8 text-center">
        {/* Logo */}
        <div className="space-y-2">
          <div className="w-20 h-20 bg-hope-green rounded-2xl mx-auto flex items-center justify-center">
            <span className="text-4xl">🌿</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">HOPE Card</h1>
          <p className="text-hope-light text-sm">
            Closed-loop vouchers for essential needs.<br />
            Hamilton, Ontario.
          </p>
        </div>

        {/* Navigation cards */}
        <div className="space-y-3">
          <Link
            href="/donate"
            className="block w-full bg-hope-green hover:bg-hope-teal text-white rounded-xl p-4 text-left transition-colors group"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">❤️</span>
              <div>
                <div className="font-semibold">Fund a Card</div>
                <div className="text-xs text-hope-light">Load a HOPE Card for someone in need</div>
              </div>
              <span className="ml-auto text-hope-light group-hover:translate-x-1 transition-transform">→</span>
            </div>
          </Link>

          <Link
            href="/wallet"
            className="block w-full bg-white/10 hover:bg-white/20 text-white rounded-xl p-4 text-left transition-colors group"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">💳</span>
              <div>
                <div className="font-semibold">Check My Card</div>
                <div className="text-xs text-hope-light">View balance and nearby merchants</div>
              </div>
              <span className="ml-auto text-hope-light group-hover:translate-x-1 transition-transform">→</span>
            </div>
          </Link>

          <Link
            href="/merchant"
            className="block w-full bg-white/10 hover:bg-white/20 text-white rounded-xl p-4 text-left transition-colors group"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🏪</span>
              <div>
                <div className="font-semibold">Merchant Portal</div>
                <div className="text-xs text-hope-light">Accept HOPE Cards at your business</div>
              </div>
              <span className="ml-auto text-hope-light group-hover:translate-x-1 transition-transform">→</span>
            </div>
          </Link>

          <Link
            href="/advocate"
            className="block w-full bg-white/10 hover:bg-white/20 text-white rounded-xl p-4 text-left transition-colors group"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🤝</span>
              <div>
                <div className="font-semibold">Advocate Portal</div>
                <div className="text-xs text-hope-light">Load and distribute cards</div>
              </div>
              <span className="ml-auto text-hope-light group-hover:translate-x-1 transition-transform">→</span>
            </div>
          </Link>
        </div>

        <p className="text-xs text-hope-light/60">
          Powered by Living Rock Ministries · Hamilton, Ontario
        </p>
      </div>
    </main>
  )
}
