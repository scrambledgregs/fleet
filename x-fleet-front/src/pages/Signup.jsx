// src/pages/Signup.jsx
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'

export default function Signup() {            // <-- default export
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    // …your sign-up logic…
    nav('/onboarding')
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Create your account</h1>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input className="w-full bg-black/30 border border-white/10 px-3 py-2"
               placeholder="Work email" value={email} onChange={e=>setEmail(e.target.value)} />
        <input className="w-full bg-black/30 border border-white/10 px-3 py-2"
               placeholder="Company name" value={company} onChange={e=>setCompany(e.target.value)} />
        <button className="glass px-3 py-2">Continue</button>
      </form>
    </div>
  )
}