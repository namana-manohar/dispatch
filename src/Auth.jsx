import { useState } from 'react'
import { supabase } from './supabase.js'

// Email + password sign in / sign up. The password goes straight from this
// form to Supabase; nothing is stored in the app.
export default function Auth() {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setMsg('')
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (!data.session) setMsg('Account created. Check your email for the confirmation link, then sign in.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      setMsg(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand" style={{ marginBottom: 18 }}>
          <span className="brand-mark">DP</span>
          <div>
            <h1>Dispatch Planner</h1>
            <p>{mode === 'signup' ? 'Create the account for your business.' : 'Sign in to see your clients and today\'s plan on any device.'}</p>
          </div>
        </div>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field" style={{ marginTop: 10 }}>
          <span>Password</span>
          <input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {msg && <p className="hint warn">{msg}</p>}
        <button className="btn-accent" type="submit" disabled={busy} style={{ marginTop: 14, width: '100%' }}>
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
        <button type="button" className="btn-link" style={{ marginTop: 10 }} onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setMsg('') }}>
          {mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
      </form>
    </div>
  )
}
