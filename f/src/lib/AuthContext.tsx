import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string, name?: string) => Promise<{ error?: string }>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  getAccessToken: () => string | null;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const supabaseConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

  useEffect(() => {
    // If Supabase isn't configured, skip auth and let the user in with dev bypass.
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
    }).catch(() => {
      // Supabase unreachable — let the user through; API calls will use bypass auth or fail gracefully.
      setLoading(false);
    });

    // Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => subscription.unsubscribe();
  }, [supabaseConfigured]);

  const signUp = async (email: string, password: string, name?: string) => {
    try {
      const res = await fetch('/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });

      const contentType = res.headers.get('content-type') || '';
      let data: any = {};
      if (contentType.includes('application/json')) {
        data = await res.json().catch(() => ({}));
      } else {
        await res.text().catch(() => '');
        if (!res.ok) {
          // If server returned non-JSON error, try direct Supabase client signup
          const { data: sbData, error: sbErr } = await supabase.auth.signUp({
            email,
            password,
            options: { data: name ? { name } : {} },
          });
          if (sbErr) return { error: sbErr.message };
          if (sbData.session) {
            await supabase.auth.setSession(sbData.session);
          }
          return {};
        }
      }

      if (!res.ok) return { error: data.error || data.message || 'Signup failed' };

      // Auto-login after signup
      if (data.session) {
        await supabase.auth.setSession(data.session);
      }
      return {};
    } catch (err: any) {
      // If network / fetch failed (e.g. backend down), try direct Supabase client
      try {
        const { data: sbData, error: sbErr } = await supabase.auth.signUp({
          email,
          password,
          options: { data: name ? { name } : {} },
        });
        if (sbErr) return { error: sbErr.message };
        if (sbData.session) {
          await supabase.auth.setSession(sbData.session);
        }
        return {};
      } catch {
        return { error: err?.message || 'Signup failed. Please ensure the backend is running.' };
      }
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const contentType = res.headers.get('content-type') || '';
      let data: any = {};
      if (contentType.includes('application/json')) {
        data = await res.json().catch(() => ({}));
      } else {
        // If server returned HTML/non-JSON or proxy failure, fall back to direct Supabase signin
        const { error: directErr } = await supabase.auth.signInWithPassword({ email, password });
        if (directErr) return { error: directErr.message };
        return {};
      }

      if (!res.ok) return { error: data.error || data.message || 'Login failed' };

      if (data.session) {
        await supabase.auth.setSession(data.session);
      }
      return {};
    } catch (err: any) {
      // If network / fetch failed, try direct Supabase auth
      try {
        const { error: directErr } = await supabase.auth.signInWithPassword({ email, password });
        if (directErr) return { error: directErr.message };
        return {};
      } catch {
        return { error: err?.message || 'Login failed. Please check your credentials.' };
      }
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const getAccessToken = () => session?.access_token ?? null;

  return (
    <AuthContext.Provider value={{
      // When Supabase isn't configured, synthesize a minimal user so the app renders.
      user: session?.user ?? (!supabaseConfigured ? { id: 'dev-user', email: 'dev@local' } as any : null),
      session,
      loading,
      signUp,
      signIn,
      signOut,
      getAccessToken,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
