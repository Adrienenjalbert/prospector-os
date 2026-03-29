import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    )

    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.slice(7)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 403 })
    }

    const { data: row, error } = await supabase
      .from('ai_conversations')
      .select('messages')
      .eq('user_id', user.id)
      .eq('tenant_id', profile.tenant_id)
      .eq('thread_type', 'general')
      .is('thread_entity_id', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[agent/history]', error)
      return NextResponse.json({ error: 'Failed to load history' }, { status: 500 })
    }

    const raw = row?.messages
    const messages = Array.isArray(raw) ? raw : []

    return NextResponse.json({ messages })
  } catch (err) {
    console.error('[agent/history]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
