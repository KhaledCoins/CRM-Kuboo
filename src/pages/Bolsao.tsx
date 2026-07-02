import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Inbox, Phone, MessageCircle, Hand, Clock, Flame, Tag, AlertTriangle } from "lucide-react";
import { PageHeader, Card, KpiCard, Button, Badge, EmptyState, Spinner, FilterBar, Select } from "../components/ui";
import { fetchLeads, pegarLead, noBolsao, type Lead } from "../lib/leads";
import { useAuth } from "../context/AuthContext";
import { brl, onlyDigits } from "../lib/format";

function esperaLabel(l: Lead): { txt: string; urgente: boolean } {
  const base = l.created_at ? new Date(l.created_at).getTime() : Date.now();
  const min = Math.floor((Date.now() - base) / 60000);
  const urgente = min >= 15;
  if (min < 1) return { txt: "agora mesmo", urgente: false };
  if (min < 60) return { txt: `há ${min} min`, urgente };
  const h = Math.floor(min / 60);
  if (h < 24) return { txt: `há ${h}h`, urgente: true };
  return { txt: `há ${Math.floor(h / 24)}d`, urgente: true };
}

const origemTone: Record<string, "blue" | "green" | "violet" | "amber" | "slate"> = {
  chatbot: "blue", formulario: "green", whatsapp: "green", indicacao: "violet", portal: "amber",
};

export function Bolsao() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [origem, setOrigem] = useState("");
  const [claiming, setClaiming] = useState<string | null>(null);
  const [, setTick] = useState(0);

  async function load() {
    const all = await fetchLeads();
    setLeads(all.filter(noBolsao));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  // Recalcula SLA/espera a cada 10s
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 10000); return () => clearInterval(t); }, []);

  const filtered = useMemo(
    () => leads.filter((l) => !origem || l.origem === origem),
    [leads, origem]
  );

  async function handlePegar(id: string) {
    if (!user) return;
    setClaiming(id);
    const ok = await pegarLead(id, user.id);
    if (ok) {
      toast.success("Lead é seu! Ele já está no seu Pipeline.");
    } else {
      toast.warning("Esse lead acabou de ser pego por outro consultor.");
    }
    setLeads((prev) => prev.filter((l) => l.id !== id));
    setClaiming(null);
  }

  const urgentes = leads.filter((l) => esperaLabel(l).urgente).length;

  return (
    <>
      <PageHeader
        title="Bolsão de Leads"
        subtitle="Leads aguardando atendimento — quem pegar primeiro, atende"
        icon={Inbox}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Leads no Bolsão" value={String(leads.length)} icon={Inbox} accent="brand" />
        <KpiCard label="Aguardando +15 min" value={String(urgentes)} icon={Flame} accent="danger" hint="Prioridade — atenda já" />
        <KpiCard label="SLA de 1º contato" value="15 min" icon={Clock} accent="sky" hint="Após pegar, contate dentro do prazo" />
      </div>

      <FilterBar>
        <Select value={origem} onChange={setOrigem} placeholder="Todas as origens" options={[
          { value: "chatbot", label: "Kubinho (chatbot)" }, { value: "formulario", label: "Formulário" },
          { value: "whatsapp", label: "WhatsApp" }, { value: "indicacao", label: "Indicação" }, { value: "portal", label: "Portal" },
        ]} />
      </FilterBar>

      {loading ? (
        <Spinner label="Carregando o bolsão..." />
      ) : filtered.length === 0 ? (
        <Card pad={false}>
          <EmptyState icon={Inbox} title="Bolsão vazio 🎉" hint="Nenhum lead aguardando. Assim que entrar um lead novo (site, Kubinho, WhatsApp) ou um SLA estourar, ele aparece aqui pra equipe pegar." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((l) => {
            const espera = esperaLabel(l);
            const wa = l.telefone ? `https://wa.me/55${onlyDigits(l.telefone)}` : null;
            const reciclado = !!l.vendedor_id; // voltou ao bolsão por SLA estourado
            return (
              <Card key={l.id} className={espera.urgente ? "ring-1 ring-red-200" : ""}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="font-bold text-ink">{l.nome}</p>
                  <span className={`text-xs font-bold flex items-center gap-1 ${espera.urgente ? "text-red-600" : "text-muted"}`}>
                    {espera.urgente && <AlertTriangle size={12} />}<Clock size={12} /> {espera.txt}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  {l.produto_interesse && <Badge tone="blue"><Tag size={11} /> {l.produto_interesse}</Badge>}
                  {l.origem && <Badge tone={origemTone[l.origem] ?? "slate"}>{l.origem}</Badge>}
                  {reciclado && <Badge tone="amber">SLA estourado</Badge>}
                  {l.valor_potencial ? <Badge tone="green">{brl(l.valor_potencial)}</Badge> : null}
                </div>

                {l.telefone && <p className="text-xs text-muted flex items-center gap-1 mb-1"><Phone size={12} /> {l.telefone}</p>}
                {l.mensagem && <p className="text-xs text-slate-500 line-clamp-2 mb-3">"{l.mensagem}"</p>}

                <div className="flex items-center gap-2 mt-3">
                  <Button size="sm" icon={Hand} onClick={() => handlePegar(l.id)} disabled={claiming === l.id}>
                    {claiming === l.id ? "Pegando..." : "Pegar lead"}
                  </Button>
                  {wa && (
                    <a href={wa} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="wa" icon={MessageCircle}>WhatsApp</Button>
                    </a>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
