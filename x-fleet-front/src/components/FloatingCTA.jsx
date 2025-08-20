import { useNavigate, useLocation } from 'react-router-dom'

export default function FloatingCTA() {
  const navigate = useNavigate()
  const location = useLocation()

  // Hide on affiliate page itself, otherwise show everywhere
  const hidden = location.pathname.startsWith('/affiliate')

  if (hidden) return null

  return (
    <button
      onClick={() => navigate('/affiliate')}
      className="fixed bottom-4 right-4 z-[999] px-4 py-3 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 shadow-lg hover:opacity-95 active:opacity-90 text-white text-sm font-semibold"
      title="Join our affiliate program"
    >
      Earn 40% lifetime revenue
    </button>
  )
}