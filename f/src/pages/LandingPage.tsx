export function LandingPage() {
  return (
    <iframe
      src="/landing.html"
      title="CareerRizz Hero"
      className="fixed inset-0 w-screen h-screen border-none m-0 p-0 z-50 bg-[#0a0f14]"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        border: 'none',
        margin: 0,
        padding: 0,
        zIndex: 9999,
      }}
    />
  )
}

export default LandingPage
