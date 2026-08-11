# SplitColoc

App de partage de dépenses entre colocataires. Prête à être déployée sur ton propre domaine.

## 1. Créer la base de données (Supabase — gratuit)

1. Va sur https://supabase.com → **New project** (choisis un mot de passe, une région proche de toi).
2. Une fois le projet créé, va dans **SQL Editor** → **New query**, colle ceci, puis **Run** :

```sql
create table tickets (
  code text primary key,
  data jsonb not null default '{"people":[],"expenses":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

-- met à jour updated_at automatiquement
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tickets_updated_at
before update on tickets
for each row execute function set_updated_at();

-- active la sécurité au niveau des lignes
alter table tickets enable row level security;

-- MVP sans authentification : accès public via le code à 6 caractères
-- (comme une URL secrète — quiconque a le code peut lire/modifier)
create policy "public read" on tickets for select using (true);
create policy "public insert" on tickets for insert with check (true);
create policy "public update" on tickets for update using (true);

-- active la synchro en direct entre colocs
alter publication supabase_realtime add table tickets;
```

3. Va dans **Project Settings → API**. Note deux valeurs :
   - **Project URL** (ex: `https://xxxxx.supabase.co`)
   - **anon public key** (une longue clé qui commence par `eyJ...`)

⚠️ Utilise bien la clé **anon public**, jamais la `service_role` (celle-ci est secrète et ne doit jamais être exposée dans une app front-end).

## 2. Tester en local (optionnel)

```bash
npm install
cp .env.example .env
# ouvre .env et colle ton URL + ta clé anon
npm run dev
```

## 3. Mettre en ligne sur ton domaine (Vercel — gratuit)

1. Crée un dépôt GitHub et pousse ce dossier dedans :
   ```bash
   git init
   git add .
   git commit -m "SplitColoc"
   git branch -M main
   git remote add origin https://github.com/ton-compte/splitcoloc.git
   git push -u origin main
   ```
2. Va sur https://vercel.com → **Add New Project** → importe ton dépôt GitHub.
3. Dans **Environment Variables**, ajoute :
   - `VITE_SUPABASE_URL` → ton URL Supabase
   - `VITE_SUPABASE_ANON_KEY` → ta clé anon
4. Clique **Deploy**. Après 1-2 minutes, ton app est en ligne sur une URL `xxx.vercel.app`.
5. Pour ton propre domaine (`anything.com`) : dans le projet Vercel → **Settings → Domains** → ajoute `anything.com`, puis suis les instructions pour pointer les DNS chez ton registrar (généralement un enregistrement `A` ou `CNAME`). Ça prend entre 10 minutes et quelques heures selon le fournisseur.

## Notes importantes

- **Sécurité MVP** : n'importe qui avec un code à 6 caractères peut voir/modifier un ticket — comme un lien partagé. C'est volontairement simple pour ne pas obliger tes utilisateurs à créer un compte. Si tu veux plus tard restreindre l'accès (comptes utilisateurs, tickets privés), il faudra ajouter Supabase Auth — je peux t'aider à ce moment-là.
- **Monétisation** : cette version est gratuite et sans compte. Si tu veux ajouter un abonnement, un don, ou des pubs, dis-moi ce que tu as en tête (Stripe pour les paiements est l'option la plus simple à intégrer).
- **Coût réel** : Vercel et Supabase sont gratuits jusqu'à un usage assez large pour un petit projet. Le seul coût est le nom de domaine (~10€/an).
Franck@12363
czplqtcximqfejnrtrct
eu-west-3