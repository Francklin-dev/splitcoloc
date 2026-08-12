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

-- colonne pour le statut premium (paiement débloqué)
alter table tickets add column premium boolean not null default false;

-- colonne pour signaler qu'un paiement Orange Money a été envoyé, en attente de validation
alter table tickets add column premium_requested boolean not null default false;
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

## 4. Activer la monétisation (Orange Money — manuel)

Stripe ne fonctionne pas en République Centrafricaine, et les agrégateurs comme CinetPay ne couvrent pas encore le pays. L'app utilise donc un flux **Orange Money manuel** : le client envoie le paiement, tu valides toi-même dans Supabase.

### 4.1 Si ton projet Supabase existe déjà

Ajoute la colonne manquante (SQL Editor → New query) :

```sql
alter table tickets add column premium_requested boolean not null default false;
```

### 4.2 Comment ça marche côté client

1. Le coloc clique "Débloquer" → un écran s'affiche avec le montant, ton numéro Orange Money et la référence (le code du ticket) à indiquer dans le transfert.
2. Il envoie le paiement via Orange Money, puis clique "J'ai envoyé le paiement".
3. Le ticket affiche alors "⏳ en attente de validation" — personne ne peut se donner le premium tout seul, ça reste toi qui valides.

### 4.3 Comment valider un paiement reçu (toi, l'admin)

Pas besoin de code, tout se fait dans l'interface Supabase :

1. Va sur ton app Orange Money (ou ton solde Orange Money) et vérifie que tu as bien reçu le montant, avec la référence (code du ticket) dans le message.
2. Va sur **supabase.com** → ton projet → **Table Editor** (menu de gauche) → table **tickets**.
3. Trouve la ligne avec le bon `code`. Repère la colonne `premium_requested` — elle doit être à `true` pour les tickets en attente.
4. Clique sur la cellule `premium` de cette ligne, coche-la à `true`, valide.
5. Le coloc voit le badge "★ PREMIUM" apparaître automatiquement, sans recharger la page (synchro en direct).

Astuce : pour retrouver rapidement les paiements en attente, clique sur l'en-tête de la colonne `premium_requested` dans le Table Editor pour filtrer/trier.

### 4.4 Changer le numéro ou le montant

Ouvre `src/App.jsx`, tout en haut du fichier :

```js
const OM_NUMBER = "+236 72 03 96 64";
const OM_AMOUNT_FCFA = "3 000 FCFA";
```

Modifie ces deux lignes si besoin, puis renvoie le code sur GitHub (`git add . && git commit -m "maj" && git push`) — Vercel redéploiera automatiquement.

### 4.5 Pour plus tard : automatiser avec l'API Orange Money

Quand tu auras un code marchand Orange Money (obtenu en boutique Orange à Bangui), l'API Orange Money Web Payment permet d'automatiser complètement ce flux, sans validation manuelle. C'est une évolution possible une fois que le principe est validé — dis-le moi le moment venu, je referai l'intégration technique.

## Notes importantes

- **Sécurité MVP** : n'importe qui avec un code à 6 caractères peut voir/modifier un ticket — comme un lien partagé. C'est volontairement simple pour ne pas obliger tes utilisateurs à créer un compte. Si tu veux plus tard restreindre l'accès (comptes utilisateurs, tickets privés), il faudra ajouter Supabase Auth — je peux t'aider à ce moment-là.
- **Monétisation** : cette version est gratuite et sans compte. Si tu veux ajouter un abonnement, un don, ou des pubs, dis-moi ce que tu as en tête (Stripe pour les paiements est l'option la plus simple à intégrer).
- **Coût réel** : Vercel et Supabase sont gratuits jusqu'à un usage assez large pour un petit projet. Le seul coût est le nom de domaine (~10€/an).
