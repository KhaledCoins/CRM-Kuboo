// Tema claro/escuro do CRM — classe .dark no <html>, persistido em localStorage.
const KEY = "kuboo_crm_theme";

export function temaAtual(): "light" | "dark" {
  try {
    const salvo = localStorage.getItem(KEY);
    if (salvo === "dark" || salvo === "light") return salvo;
  } catch { /* sem storage */ }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function aplicarTema(t: "light" | "dark") {
  document.documentElement.classList.toggle("dark", t === "dark");
  try { localStorage.setItem(KEY, t); } catch { /* ok */ }
}

export function initTema() {
  aplicarTema(temaAtual());
}

export function alternarTema(): "light" | "dark" {
  const novo = temaAtual() === "dark" ? "light" : "dark";
  aplicarTema(novo);
  return novo;
}
