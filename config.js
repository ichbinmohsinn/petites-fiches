/*
 * Site settings — the only file you need to edit before launching.
 * Find both values in Supabase: Project Settings → API.
 * The "anon public" key is safe to put here: the database rules in
 * supabase/schema.sql decide what each visitor may read or write.
 * Never paste the "service_role" key into this file.
 */
window.APP_CONFIG = {
  appName: "Petites Fiches",
  supabaseUrl: "https://YOUR-PROJECT-ID.supabase.co",
  supabaseAnonKey: "YOUR-ANON-PUBLIC-KEY",
  // Turn on after enabling Google in Supabase → Authentication → Providers.
  googleSignIn: false,
  // Shown on the privacy page.
  contactEmail: "hello@example.com"
};
