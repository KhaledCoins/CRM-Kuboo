import { supabase } from "./supabase";

// Telemetria de erros de front, caseira de propósito: sem Sentry, sem conta
// nova, sem dado saindo de casa. Grava em public.erros_front (INSERT liberado
// pra equipe logada; leitura só gestor — ver telemetria na migration).
//
// Regras de sobrevivência:
// - NUNCA lançar: reportar erro não pode causar erro (fire-and-forget).
// - Teto por sessão + dedup por mensagem: um render quebrado em loop geraria
//   milhares de linhas idênticas e viraria o problema.
const TETO_POR_SESSAO = 10;
let enviados = 0;
const vistos = new Set<string>();

export function reportarErro(mensagem: string, stack?: string | null) {
  try {
    if (!supabase || enviados >= TETO_POR_SESSAO) return;
    const chave = mensagem.slice(0, 200);
    if (vistos.has(chave)) return;
    vistos.add(chave);
    enviados++;
    void supabase.auth.getUser().then(({ data }) =>
      supabase!.from("erros_front").insert({
        user_id: data?.user?.id ?? null,
        rota: typeof window !== "undefined" ? window.location.pathname : null,
        mensagem: mensagem.slice(0, 2000),
        stack: stack ? String(stack).slice(0, 8000) : null,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
      })
    ).then(undefined, () => { /* telemetria nunca propaga falha */ });
  } catch { /* idem */ }
}

// Pega o que o ErrorBoundary não vê: erro fora do render (handlers, timers)
// e promise rejeitada sem catch. Chamar UMA vez, no main.tsx.
export function instalarTelemetriaGlobal() {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (e) => {
    // Erro de carregamento de recurso (img/script) dispara 'error' sem message.
    if (e?.message) reportarErro(e.message, e.error?.stack);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e?.reason;
    reportarErro(r?.message ? `unhandled: ${r.message}` : `unhandled: ${String(r).slice(0, 300)}`, r?.stack);
  });
}
