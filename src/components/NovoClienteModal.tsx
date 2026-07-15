import { useState } from "react";
import { X, UserPlus, Check, Copy, Mail, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui";
import { ModalShell } from "./ModalShell";
import { supabase } from "../lib/supabase";
import { onlyDigits } from "../lib/format";

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none text-ink focus:border-brand-400 transition-colors";
const labelCls = "text-xs font-bold text-muted uppercase tracking-wide block mb-1.5";

interface Resultado { loginEmail: string; tempPassword: string | null; convidado: boolean }

export function NovoClienteModal({ onFechar, onCriado }: { onFechar: () => void; onCriado: () => void }) {
  const [form, setForm] = useState({ name: "", cpf: "", email: "", phone: "", birth_date: "", address: "", city: "São José dos Campos", state: "SP", cep: "" });
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setSalvando(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada — faça login novamente.");

      const r = await fetch("/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...form,
          cpf: onlyDigits(form.cpf),
          cep: onlyDigits(form.cep),
        }),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) throw new Error(json?.error || "Não foi possível criar o cliente. Tente novamente em instantes.");
      if (!json) throw new Error("Resposta inesperada do servidor.");

      setResultado(json);
      onCriado();
      toast.success("Cliente criado com sucesso!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar o cliente.");
    } finally {
      setSalvando(false);
    }
  }

  function copiar(texto: string) {
    navigator.clipboard.writeText(texto);
    toast.success("Copiado.");
  }

  return (
    <ModalShell onClose={onFechar} label="Novo Cliente" className="bg-white rounded-2xl shadow-2xl w-[min(560px,94vw)] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-brand-50 text-brand-500 grid place-items-center shrink-0"><UserPlus size={18} /></span>
            <h3 className="font-extrabold text-ink text-lg">Novo Cliente</h3>
          </div>
          <button onClick={onFechar} aria-label="Fechar" className="text-slate-500 hover:text-slate-700"><X size={20} /></button>
        </div>

        {resultado ? (
          <div className="p-6">
            <div className="text-center py-4">
              <span className="w-14 h-14 rounded-2xl bg-green-50 text-green-600 grid place-items-center mx-auto mb-4"><Check size={26} /></span>
              <p className="font-extrabold text-ink text-lg">Cliente cadastrado</p>
              <p className="text-sm text-muted mt-1">
                {resultado.convidado
                  ? "Enviamos um e-mail de convite — o cliente define a própria senha."
                  : "Sem e-mail próprio: repasse este acesso por WhatsApp/telefone. Ele(a) vai trocar a senha no 1º login."}
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 mt-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm min-w-0">
                  <Mail size={15} className="text-brand-500 shrink-0" />
                  <span className="font-mono truncate">{resultado.loginEmail}</span>
                </div>
                <button type="button" onClick={() => copiar(resultado.loginEmail)} title="Copiar e-mail" aria-label="Copiar e-mail" className="text-slate-400 hover:text-brand-600 shrink-0"><Copy size={14} /></button>
              </div>
              {resultado.tempPassword && (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm min-w-0">
                    <KeyRound size={15} className="text-brand-500 shrink-0" />
                    <span className="font-mono truncate">{resultado.tempPassword}</span>
                  </div>
                  <button type="button" onClick={() => copiar(resultado.tempPassword!)} title="Copiar senha" aria-label="Copiar senha" className="text-slate-400 hover:text-brand-600 shrink-0"><Copy size={14} /></button>
                </div>
              )}
            </div>
            {resultado.tempPassword && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mt-3">
                Esta senha só aparece agora — anote antes de fechar.
              </p>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <Button onClick={onFechar}>Fechar</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={salvar} className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block sm:col-span-2">
              <span className={labelCls}>Nome completo *</span>
              <input className={inputCls} required value={form.name} onChange={set("name")} placeholder="Nome do cliente" />
            </label>
            <label className="block">
              <span className={labelCls}>CPF *</span>
              <input className={inputCls} required value={form.cpf} onChange={set("cpf")} placeholder="000.000.000-00" />
            </label>
            <label className="block">
              <span className={labelCls}>Telefone/WhatsApp</span>
              <input className={inputCls} value={form.phone} onChange={set("phone")} placeholder="(12) 90000-0000" />
            </label>
            <label className="block sm:col-span-2">
              <span className={labelCls}>E-mail</span>
              <input className={inputCls} type="email" value={form.email} onChange={set("email")} placeholder="Deixe em branco se o cliente não tiver e-mail" />
            </label>
            <label className="block">
              <span className={labelCls}>Data de nascimento</span>
              <input className={inputCls} type="date" value={form.birth_date} onChange={set("birth_date")} />
            </label>
            <label className="block">
              <span className={labelCls}>CEP</span>
              <input className={inputCls} value={form.cep} onChange={set("cep")} placeholder="00000-000" />
            </label>
            <label className="block sm:col-span-2">
              <span className={labelCls}>Endereço</span>
              <input className={inputCls} value={form.address} onChange={set("address")} placeholder="Rua, número, bairro" />
            </label>
            <label className="block">
              <span className={labelCls}>Cidade</span>
              <input className={inputCls} value={form.city} onChange={set("city")} />
            </label>
            <label className="block">
              <span className={labelCls}>Estado</span>
              <select className={inputCls} value={form.state} onChange={(e) => setForm((p) => ({ ...p, state: e.target.value }))}>
                {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </label>

            <p className="sm:col-span-2 text-xs text-muted bg-slate-50 rounded-xl px-3 py-2">
              O cliente sempre recebe um acesso ao Portal: com e-mail, vai um convite pra ele criar a própria senha; sem e-mail, geramos uma senha temporária pra equipe repassar.
            </p>

            <div className="sm:col-span-2 flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={onFechar}>Cancelar</Button>
              <Button type="submit" disabled={salvando}>{salvando ? "Criando…" : "Criar cliente"}</Button>
            </div>
          </form>
        )}
    </ModalShell>
  );
}
