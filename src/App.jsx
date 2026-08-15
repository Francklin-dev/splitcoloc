import { useState, useMemo, useEffect, useRef } from "react";
import {
  Plus,
  Trash2,
  ArrowRight,
  RotateCcw,
  Users,
  Receipt,
  Copy,
  Check,
  LogOut,
  Loader2,
  Lock,
  Star,
  Download,
} from "lucide-react";
import { supabase } from "./supabaseClient";

const INK = "#1a1a1a";
const PAPER = "#fdfcf7";
const RULE = "#d9d4c4";
const CREDIT = "#2f6844";
const DEBT = "#b23a11";
const MUTED = "#8a8474";
const GOLD = "#a4790a";

const uid = () => Math.random().toString(36).slice(2, 9);
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O/1/I
const genCode = () =>
  Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");

const FREE_EXPENSE_LIMIT = 15;

// ---- Paiement Orange Money (manuel, pas d'API marchand pour l'instant) ----
const OM_NUMBER = "+236 72 03 96 64";
const OM_AMOUNT_FCFA = "5 000 FCFA";

export default function App() {
  const [screen, setScreen] = useState("landing"); // landing | app
  const [code, setCode] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [landingError, setLandingError] = useState("");
  const [landingBusy, setLandingBusy] = useState(false);

  const [people, setPeople] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [copied, setCopied] = useState(false);
  const [premium, setPremium] = useState(false);
  const [premiumRequested, setPremiumRequested] = useState(false);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payCopied, setPayCopied] = useState(false);

  const [newPerson, setNewPerson] = useState("");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [expDate, setExpDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paidBy, setPaidBy] = useState("");
  const [splitWith, setSplitWith] = useState([]);
  const [formError, setFormError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  const loadedRef = useRef(false);
  const saveTimer = useRef(null);
  const lastPushedRef = useRef(""); // dernier JSON envoyé par nous, pour ignorer notre propre écho realtime
  const channelRef = useRef(null);

  // ---- création / jointure d'un ticket ----
  const createGroup = async () => {
    setLandingBusy(true);
    setLandingError("");
    const newCode = genCode();
    const payload = { people: [], expenses: [] };
    const { error } = await supabase
      .from("tickets")
      .insert({ code: newCode, data: payload, premium: false, premium_requested: false });
    if (error) {
      setLandingError("Impossible de créer le ticket. Vérifie la config Supabase.");
      setLandingBusy(false);
      return;
    }
    lastPushedRef.current = JSON.stringify(payload);
    setCode(newCode);
    setPeople([]);
    setExpenses([]);
    setPremium(false);
    setPremiumRequested(false);
    loadedRef.current = true;
    setScreen("app");
    setLandingBusy(false);
  };

  const joinGroup = async (forcedCode) => {
    const c = (forcedCode || joinInput).trim().toUpperCase();
    if (c.length < 4) {
      setLandingError("Entre un code valide.");
      return;
    }
    setLandingBusy(true);
    setLandingError("");
    const { data: row, error } = await supabase
      .from("tickets")
      .select("data, premium, premium_requested")
      .eq("code", c)
      .single();
    if (error || !row) {
      setLandingError("Aucun ticket trouvé avec ce code.");
      setLandingBusy(false);
      return;
    }
    const data = row.data || { people: [], expenses: [] };
    lastPushedRef.current = JSON.stringify(data);
    setCode(c);
    setPeople(data.people || []);
    setExpenses(data.expenses || []);
    setPremium(!!row.premium);
    setPremiumRequested(!!row.premium_requested);
    loadedRef.current = true;
    setScreen("app");
    setLandingBusy(false);
  };

  const leaveGroup = () => {
    loadedRef.current = false;
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    setScreen("landing");
    setCode("");
    setJoinInput("");
    setPeople([]);
    setExpenses([]);
    setPremium(false);
    setPremiumRequested(false);
    setSaveState("idle");
  };

  const markPaymentSent = async () => {
    setPremiumRequested(true);
    setPayModalOpen(false);
    await supabase.from("tickets").update({ premium_requested: true }).eq("code", code);
  };

  const copyOMNumber = async () => {
    try {
      await navigator.clipboard.writeText(OM_NUMBER);
      setPayCopied(true);
      setTimeout(() => setPayCopied(false), 1500);
    } catch {
      /* silencieux */
    }
  };

  const exportCSV = () => {
    if (!premium) return;
    const rows = [["Date", "Description", "Montant", "Payé par", "Partagé entre"]];
    expenses.forEach((e) => {
      rows.push([e.date, e.desc, Math.round(e.amount), nameOf(e.paidBy), e.shared.map(nameOf).join(" / ")]);
    });
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `splitcoloc-${code}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- synchro en direct : on écoute les changements des autres colocs ----
  useEffect(() => {
    if (screen !== "app" || !code) return;
    const channel = supabase
      .channel(`ticket-${code}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tickets", filter: `code=eq.${code}` },
        (payload) => {
          setPremium(!!payload.new.premium);
          setPremiumRequested(!!payload.new.premium_requested);
          const incoming = JSON.stringify(payload.new.data);
          if (incoming === lastPushedRef.current) return; // c'est notre propre sauvegarde, on ignore
          lastPushedRef.current = incoming;
          setPeople(payload.new.data.people || []);
          setExpenses(payload.new.data.expenses || []);
        }
      )
      .subscribe();
    channelRef.current = channel;
    return () => supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, code]);

  // ---- sauvegarde auto (debounce) ----
  useEffect(() => {
    if (!loadedRef.current || screen !== "app") return;
    const payload = { people, expenses };
    const serialized = JSON.stringify(payload);
    if (serialized === lastPushedRef.current) return; // rien de nouveau à sauvegarder
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const { error } = await supabase.from("tickets").update({ data: payload }).eq("code", code);
      if (error) {
        setSaveState("error");
      } else {
        lastPushedRef.current = serialized;
        setSaveState("saved");
      }
    }, 450);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, expenses]);

  // ---- colocs ----
  const addPerson = () => {
    const name = newPerson.trim();
    if (!name) return;
    if (people.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      setFormError("Ce coloc existe déjà.");
      return;
    }
    setPeople([...people, { id: uid(), name }]);
    setNewPerson("");
    setFormError("");
  };

  const removePerson = (id) => {
    setPeople(people.filter((p) => p.id !== id));
    setExpenses(expenses.filter((e) => e.paidBy !== id));
    setSplitWith((s) => s.filter((pid) => pid !== id));
    if (paidBy === id) setPaidBy("");
    setConfirmDelete(null);
  };

  const toggleSplit = (id) => {
    setSplitWith((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // ---- dépenses ----
  const addExpense = () => {
    setFormError("");
    const amt = parseFloat(amount.replace(",", "."));
    if (!desc.trim()) return setFormError("Ajoute une description.");
    if (!amt || amt <= 0) return setFormError("Montant invalide.");
    if (!paidBy) return setFormError("Choisis qui a payé.");
    if (people.length < 2) return setFormError("Ajoute au moins 2 colocs d'abord.");
    if (!premium && expenses.length >= FREE_EXPENSE_LIMIT) {
      return setFormError(`Limite gratuite atteinte (${FREE_EXPENSE_LIMIT} dépenses). Passe premium pour continuer.`);
    }
    const shared = splitWith.length > 0 ? splitWith : people.map((p) => p.id);
    setExpenses([
      { id: uid(), desc: desc.trim(), amount: amt, paidBy, shared, date: expDate },
      ...expenses,
    ]);
    setDesc("");
    setAmount("");
    setSplitWith([]);
  };

  const removeExpense = (id) => {
    setExpenses(expenses.filter((e) => e.id !== id));
    setConfirmDelete(null);
  };

  const resetAll = () => {
    setExpenses([]);
    setFormError("");
    setConfirmDelete(null);
  };

  const nameOf = (id) => people.find((p) => p.id === id)?.name || "coloc supprimé";

  const balances = useMemo(() => {
    const bal = {};
    people.forEach((p) => (bal[p.id] = 0));
    expenses.forEach((e) => {
      const share = e.amount / e.shared.length;
      bal[e.paidBy] = (bal[e.paidBy] || 0) + e.amount;
      e.shared.forEach((pid) => {
        bal[pid] = (bal[pid] || 0) - share;
      });
    });
    return bal;
  }, [people, expenses]);

  const settlements = useMemo(() => {
    const debtors = [];
    const creditors = [];
    Object.entries(balances).forEach(([id, v]) => {
      const cents = Math.round(v * 100);
      if (cents < -1) debtors.push({ id, amt: -cents });
      else if (cents > 1) creditors.push({ id, amt: cents });
    });
    debtors.sort((a, b) => b.amt - a.amt);
    creditors.sort((a, b) => b.amt - a.amt);
    const tx = [];
    let i = 0,
      j = 0;
    while (i < debtors.length && j < creditors.length) {
      const d = debtors[i];
      const c = creditors[j];
      const pay = Math.min(d.amt, c.amt);
      tx.push({ from: d.id, to: c.id, amt: pay / 100 });
      d.amt -= pay;
      c.amt -= pay;
      if (d.amt <= 1) i++;
      if (c.amt <= 1) j++;
    }
    return tx;
  }, [balances]);

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const fmt = (n) => `${Math.round(n).toLocaleString("fr-FR")} FCFA`;
  const fmtDate = (d) => {
    try {
      return new Date(d + "T00:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
    } catch {
      return d;
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* silencieux */
    }
  };

  const globalStyle = (
    <style>{`
      .sc-input {
        font-family: 'IBM Plex Mono', monospace;
        border: none;
        border-bottom: 1px dashed ${RULE};
        background: transparent;
        padding: 6px 2px;
        font-size: 13px;
        color: ${INK};
        outline: none;
        width: 100%;
      }
      .sc-input:focus { border-bottom: 1px solid ${INK}; }
      .sc-btn {
        font-family: 'Space Grotesk', sans-serif;
        font-weight: 700;
        font-size: 12px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        background: ${INK};
        color: ${PAPER};
        border: none;
        padding: 9px 14px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        justify-content: center;
      }
      .sc-btn:hover { background: #3a3a3a; }
      .sc-btn:disabled { background: ${MUTED}; cursor: not-allowed; }
      .sc-btn-ghost { background: transparent; color: ${INK}; border: 1px solid ${INK}; }
      .sc-btn-ghost:hover { background: ${INK}; color: ${PAPER}; }
      .sc-chip {
        font-size: 11px;
        border: 1px solid ${INK};
        padding: 4px 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 5px;
        background: ${PAPER};
      }
      .sc-chip.active { background: ${INK}; color: ${PAPER}; }
      .sc-dotted { flex: 1; border-bottom: 1px dotted ${MUTED}; margin: 0 6px; transform: translateY(-3px); }
      .sc-danger-btn { font-size: 10px; color: ${DEBT}; background: none; border: 1px solid ${DEBT}; padding: 3px 7px; cursor: pointer; }
      .sc-spin { animation: sc-rotate 1s linear infinite; }
      @keyframes sc-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    `}</style>
  );

  const pageWrap = (content) => (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        background: "repeating-linear-gradient(45deg, #e8e4d8, #e8e4d8 2px, #ece8dc 2px, #ece8dc 4px)",
        display: "flex",
        justifyContent: "center",
        padding: "28px 12px",
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      {globalStyle}
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          height: "fit-content",
          background: PAPER,
          boxShadow: "0 18px 40px rgba(0,0,0,0.18)",
          position: "relative",
          clipPath:
            "polygon(0% 0.8%,3% 0%,6% 0.8%,9% 0%,12% 0.8%,15% 0%,18% 0.8%,21% 0%,24% 0.8%,27% 0%,30% 0.8%,33% 0%,36% 0.8%,39% 0%,42% 0.8%,45% 0%,48% 0.8%,51% 0%,54% 0.8%,57% 0%,60% 0.8%,63% 0%,66% 0.8%,69% 0%,72% 0.8%,75% 0%,78% 0.8%,81% 0%,84% 0.8%,87% 0%,90% 0.8%,93% 0%,96% 0.8%,100% 0%,100% 100%,0% 100%)",
          padding: "26px 24px 22px",
        }}
      >
        {content}
      </div>
    </div>
  );

  // ---------- ÉCRAN D'ACCUEIL ----------
  if (screen === "landing") {
    return pageWrap(
      <div>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: "0.03em", color: INK }}>
            SPLIT·COLOC
          </div>
          <div style={{ fontSize: 10, color: MUTED, letterSpacing: "0.08em", marginTop: 2 }}>
            GRAND LIVRE DES DÉPENSES PARTAGÉES
          </div>
        </div>
        <div style={{ borderBottom: `1px dashed ${RULE}`, marginBottom: 20 }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>
            Crée un ticket pour ta coloc. Tu recevras un code à 6 caractères à partager avec les
            autres pour qu'ils rejoignent le même ticket, depuis n'importe quel appareil.
          </div>
          <button className="sc-btn" onClick={createGroup} disabled={landingBusy}>
            {landingBusy ? <Loader2 size={13} className="sc-spin" /> : <Plus size={13} />}
            Créer un nouveau ticket
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0" }}>
          <div style={{ flex: 1, borderBottom: `1px dashed ${RULE}` }} />
          <span style={{ fontSize: 10, color: MUTED }}>OU</span>
          <div style={{ flex: 1, borderBottom: `1px dashed ${RULE}` }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>
            Un coloc a déjà créé le ticket ? Entre son code ici :
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="sc-input"
              placeholder="EX: 7GX3QP"
              value={joinInput}
              maxLength={6}
              onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && joinGroup()}
              style={{ textAlign: "center", letterSpacing: "0.15em", fontWeight: 600 }}
            />
            <button className="sc-btn sc-btn-ghost" onClick={joinGroup} disabled={landingBusy}>
              Rejoindre
            </button>
          </div>
          {landingError && <div style={{ fontSize: 11, color: DEBT }}>{landingError}</div>}
        </div>

        <div style={{ fontSize: 9, color: MUTED, marginTop: 26, textAlign: "center", lineHeight: 1.5 }}>
          Toute personne ayant le code peut voir et modifier ce ticket.
          <br />
          Ne le partage qu'avec ta coloc.
        </div>
      </div>
    );
  }

  // ---------- ÉCRAN APPLICATION ----------
  return pageWrap(
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: "0.03em", color: INK }}>
            SPLIT·COLOC
          </div>
          <div style={{ fontSize: 9, color: MUTED, marginTop: 1 }}>
            {saveState === "saving" && "sauvegarde…"}
            {saveState === "saved" && "✓ sauvegardé"}
            {saveState === "error" && "⚠ échec de sauvegarde"}
            {saveState === "idle" && " "}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            onClick={copyCode}
            title="Copier le code"
            style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", border: `1px solid ${INK}`, padding: "4px 8px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
          >
            {code} {copied ? <Check size={11} color={CREDIT} /> : <Copy size={11} />}
          </div>
          {premium && (
            <div style={{ fontSize: 9, color: GOLD, fontWeight: 700, marginTop: 5, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
              <Star size={10} fill={GOLD} /> PREMIUM
            </div>
          )}
          <button
            onClick={leaveGroup}
            style={{ background: "none", border: "none", color: MUTED, fontSize: 9, cursor: "pointer", marginTop: 5, display: "flex", alignItems: "center", gap: 3 }}
          >
            <LogOut size={10} /> quitter
          </button>
        </div>
      </div>
      <div style={{ borderBottom: `1px dashed ${RULE}`, marginBottom: 16 }} />

      {premiumRequested && !premium && (
        <div
          style={{
            fontSize: 11,
            border: `1px dashed ${GOLD}`,
            color: GOLD,
            padding: "8px 10px",
            marginBottom: 16,
          }}
        >
          ⏳ Paiement signalé — en attente de validation par ton coloc-hébergeur (généralement sous quelques heures).
        </div>
      )}

      {!premium && (
        <div
          style={{
            border: `1px solid ${INK}`,
            padding: "10px 12px",
            marginBottom: 18,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
              <Star size={12} color={GOLD} fill={GOLD} /> Passer premium
            </div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
              Dépenses illimitées + export CSV, à vie sur ce ticket — {OM_AMOUNT_FCFA}.
            </div>
          </div>
          <button className="sc-btn" onClick={() => setPayModalOpen(true)} style={{ whiteSpace: "nowrap" }}>
            Débloquer
          </button>
        </div>
      )}

      {payModalOpen && (
        <div
          onClick={() => setPayModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(26,26,26,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: PAPER,
              maxWidth: 360,
              width: "100%",
              padding: "22px 20px",
              border: `1px solid ${INK}`,
            }}
          >
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
              <Star size={13} color={GOLD} fill={GOLD} /> Débloquer Premium
            </div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 4, marginBottom: 16 }}>
              Dépenses illimitées + export CSV pour ce ticket, à vie.
            </div>

            <div style={{ border: `1px dashed ${RULE}`, padding: "12px 10px", marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: MUTED, marginBottom: 3 }}>MONTANT À ENVOYER</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{OM_AMOUNT_FCFA}</div>
            </div>

            <div style={{ border: `1px dashed ${RULE}`, padding: "12px 10px", marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: MUTED, marginBottom: 5 }}>NUMÉRO ORANGE MONEY</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.03em" }}>{OM_NUMBER}</span>
                <button
                  onClick={copyOMNumber}
                  style={{ background: "none", border: `1px solid ${INK}`, padding: "4px 7px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}
                >
                  {payCopied ? <Check size={11} color={CREDIT} /> : <Copy size={11} />}
                  {payCopied ? "copié" : "copier"}
                </button>
              </div>
            </div>

            <div style={{ fontSize: 10, color: MUTED, marginBottom: 16, lineHeight: 1.6 }}>
              1. Envoie <strong>{OM_AMOUNT_FCFA}</strong> via Orange Money au numéro ci-dessus.
              <br />
              2. Indique la référence <strong>{code}</strong> dans le message de transfert.
              <br />
              3. Clique "J'ai envoyé le paiement" ci-dessous — le premium est activé après vérification.
            </div>

            <button className="sc-btn" onClick={markPaymentSent} style={{ width: "100%", marginBottom: 8 }}>
              J'ai envoyé le paiement
            </button>
            <button
              onClick={() => setPayModalOpen(false)}
              style={{ width: "100%", background: "none", border: "none", color: MUTED, fontSize: 11, cursor: "pointer", padding: "4px 0" }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      <Section icon={<Users size={13} />} title="Colocs">
        {people.length === 0 && (
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 8 }}>
            Aucun coloc pour l'instant — ajoute au moins 2 personnes pour commencer.
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {people.map((p) => (
            <span key={p.id} className="sc-chip">
              {p.name}
              {confirmDelete?.type === "person" && confirmDelete.id === p.id ? (
                <span style={{ display: "flex", gap: 4 }}>
                  <Check size={11} style={{ cursor: "pointer" }} onClick={() => removePerson(p.id)} />
                  <Trash2 size={11} style={{ opacity: 0.3, cursor: "pointer" }} onClick={() => setConfirmDelete(null)} />
                </span>
              ) : (
                <Trash2 size={11} style={{ cursor: "pointer" }} onClick={() => setConfirmDelete({ type: "person", id: p.id })} />
              )}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="sc-input"
            placeholder="Prénom du coloc…"
            value={newPerson}
            onChange={(e) => setNewPerson(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPerson()}
          />
          <button className="sc-btn" onClick={addPerson}>
            <Plus size={13} />
          </button>
        </div>
      </Section>

      <Section icon={<Receipt size={13} />} title="Nouvelle dépense" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input className="sc-input" placeholder="Description (ex: Courses Carrefour)" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <div style={{ display: "flex", gap: 8 }}>
            <input className="sc-input" placeholder="Montant FCFA" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 100 }} />
            <input className="sc-input" type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} style={{ maxWidth: 130 }} />
          </div>
          <select className="sc-input" value={paidBy} onChange={(e) => setPaidBy(e.target.value)} style={{ borderBottom: `1px dashed ${RULE}` }}>
            <option value="">Payé par…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div>
            <div style={{ fontSize: 10, color: MUTED, marginBottom: 5 }}>PARTAGÉ ENTRE (aucune sélection = tout le monde) :</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {people.map((p) => (
                <span key={p.id} className={`sc-chip ${splitWith.includes(p.id) ? "active" : ""}`} onClick={() => toggleSplit(p.id)}>
                  {p.name}
                </span>
              ))}
            </div>
          </div>
          <button className="sc-btn" onClick={addExpense} style={{ marginTop: 4 }}>
            <Plus size={13} /> Ajouter la dépense
          </button>
          {formError && <div style={{ fontSize: 11, color: DEBT }}>{formError}</div>}
        </div>
      </Section>

      {expenses.length > 0 && (
        <Section icon={<Receipt size={13} />} title="Ticket" style={{ marginTop: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {expenses.map((e) => (
              <div key={e.id} style={{ fontSize: 12 }}>
                <div style={{ display: "flex", alignItems: "baseline" }}>
                  <span style={{ color: MUTED, fontSize: 10, marginRight: 6 }}>{fmtDate(e.date)}</span>
                  <span>{e.desc}</span>
                  <span className="sc-dotted" />
                  <span style={{ fontWeight: 600 }}>{fmt(e.amount)}</span>
                  {confirmDelete?.type === "expense" && confirmDelete.id === e.id ? (
                    <span style={{ display: "flex", gap: 4, marginLeft: 8 }}>
                      <button className="sc-danger-btn" onClick={() => removeExpense(e.id)}>confirmer</button>
                      <button className="sc-danger-btn" style={{ color: MUTED, borderColor: RULE }} onClick={() => setConfirmDelete(null)}>annuler</button>
                    </span>
                  ) : (
                    <Trash2 size={11} style={{ marginLeft: 8, cursor: "pointer", color: MUTED }} onClick={() => setConfirmDelete({ type: "expense", id: e.id })} />
                  )}
                </div>
                <div style={{ fontSize: 10, color: MUTED }}>
                  payé par {nameOf(e.paidBy)} · partagé entre {e.shared.map(nameOf).join(", ")}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${INK}`, marginTop: 10, paddingTop: 6, fontWeight: 700, fontSize: 13 }}>
            <span>TOTAL</span>
            <span>{fmt(total)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
            <span style={{ fontSize: 9, color: MUTED }}>
              {premium ? "dépenses illimitées" : `${expenses.length}/${FREE_EXPENSE_LIMIT} dépenses gratuites`}
            </span>
            <button
              onClick={premium ? exportCSV : () => setPayModalOpen(true)}
              className="sc-btn-ghost"
              style={{
                fontSize: 10,
                padding: "5px 9px",
                display: "flex",
                alignItems: "center",
                gap: 4,
                border: `1px solid ${premium ? INK : RULE}`,
                color: premium ? INK : MUTED,
                background: "none",
                cursor: "pointer",
              }}
              title={premium ? "Exporter en CSV" : "Passe premium pour exporter"}
            >
              {premium ? <Download size={11} /> : <Lock size={11} />} export CSV
            </button>
          </div>
        </Section>
      )}

      {expenses.length > 0 && (
        <Section title="Soldes" style={{ marginTop: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {people.map((p) => {
              const v = balances[p.id] || 0;
              const positive = v >= 0.005;
              const negative = v <= -0.005;
              return (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span>{p.name}</span>
                  <span style={{ fontWeight: 600, color: positive ? CREDIT : negative ? DEBT : MUTED }}>
                    {positive ? "+" : ""}{fmt(v)}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {settlements.length > 0 && (
        <Section title="Pour équilibrer" style={{ marginTop: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {settlements.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, border: `1px dashed ${RULE}`, padding: "7px 9px" }}>
                <span style={{ fontWeight: 600 }}>{nameOf(s.from)}</span>
                <ArrowRight size={12} color={MUTED} />
                <span style={{ fontWeight: 600 }}>{nameOf(s.to)}</span>
                <span className="sc-dotted" />
                <span style={{ fontWeight: 700, color: DEBT }}>{fmt(s.amt)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {expenses.length === 0 && (
        <div style={{ fontSize: 11, color: MUTED, marginTop: 18, textAlign: "center" }}>
          Aucune dépense pour l'instant. Ajoute la première ci-dessus.
        </div>
      )}

      <div style={{ borderTop: `1px dashed ${RULE}`, marginTop: 20, paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: MUTED }}>code : {code} · partagé avec ta coloc</span>
        <button onClick={resetAll} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: MUTED, background: "none", border: "none", cursor: "pointer" }}>
          <RotateCcw size={11} /> vider le ticket
        </button>
      </div>
    </div>
  );
}

function Section({ icon, title, children, style }) {
  return (
    <div style={style}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: INK, marginBottom: 9 }}>
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}
