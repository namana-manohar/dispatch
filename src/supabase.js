// Cloud sync through Supabase. If the two VITE_SUPABASE_* variables are not
// set, the app runs exactly as before: no login, data in this browser only.
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && key ? createClient(url, key) : null
export const cloudEnabled = !!supabase

// The whole app state lives in one row per user.
export async function loadRemote(userId) {
  const { data, error } = await supabase
    .from('dispatch_state')
    .select('state, updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function saveRemote(userId, state) {
  const { error } = await supabase
    .from('dispatch_state')
    .upsert({ user_id: userId, state, updated_at: new Date().toISOString() })
  if (error) throw error
}
