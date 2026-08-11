import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "Variables d'environnement manquantes : VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY. " +
      "Vérifie ton fichier .env (en local) ou la config Vercel/Netlify (en production)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
