// Regressão do bug que custou dois deploys: o token gravado no Vercel por pipe
// do PowerShell (`Get-Content x | vercel env add`) chegou com um "\r" grudado —
// o CLI removeu o "\n" do CRLF e deixou o "\r". O painel mostrava o valor
// idêntico ao esperado e TODA requisição levava 401, sem nenhuma pista.
// Rodar com:  npx vite-node api/__tests__/env.test.mjs
import assert from "node:assert/strict";
import { env, segredoConfere } from "../_env.js";

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log(`  ok  ${nome}`); };

const TOKEN = "I01g-5-Yk8igPy0MVgmHsOiaioR6oMFaNwqCXyT--tI";

// ── env() ───────────────────────────────────────────────────────────────────
t("o caso real: valor gravado com \\r no fim", () => {
  process.env.__T = TOKEN + "\r";
  assert.equal(env("__T"), TOKEN);
});

t("espaço, tab, CRLF e quebra de linha nas duas pontas", () => {
  for (const sujeira of ["\r", "\n", "\r\n", " ", "\t", "  \r\n\t "]) {
    process.env.__T = sujeira + TOKEN + sujeira;
    assert.equal(env("__T"), TOKEN, `falhou com ${JSON.stringify(sujeira)}`);
  }
});

t("espaço invisível de copiar-colar (NBSP, zero-width, BOM)", () => {
  process.env.__T = " " + TOKEN + "​﻿";
  assert.equal(env("__T"), TOKEN);
});

t("não mexe no MIOLO do valor", () => {
  process.env.__T = "  Kuboo Seguros <acesso@kubooseguros.com.br>  ";
  assert.equal(env("__T"), "Kuboo Seguros <acesso@kubooseguros.com.br>");
});

t("ausente ou só espaço cai no default", () => {
  delete process.env.__T;
  assert.equal(env("__T", "padrao"), "padrao");
  process.env.__T = "   \r\n  ";
  assert.equal(env("__T", "padrao"), "padrao");
  assert.equal(env("__T"), "");
});

// ── segredoConfere() ────────────────────────────────────────────────────────
t("o caso real: env com \\r x query string limpa", () => {
  assert.equal(segredoConfere(TOKEN, TOKEN + "\r"), true);
  assert.equal(segredoConfere(TOKEN + "\r", TOKEN), true);
  assert.equal(segredoConfere(" " + TOKEN + "\n", "\r\n" + TOKEN + " "), true);
});

t("continua rejeitando o que tem que rejeitar", () => {
  assert.equal(segredoConfere("chute", TOKEN), false);
  assert.equal(segredoConfere(TOKEN.slice(0, -1), TOKEN), false);   // 1 char a menos
  assert.equal(segredoConfere(TOKEN + "a", TOKEN), false);          // 1 char a mais
  assert.equal(segredoConfere(TOKEN.toUpperCase(), TOKEN), false);  // caixa importa
});

t("vazio, nulo e undefined NUNCA passam", () => {
  for (const v of ["", null, undefined, "   ", "\r\n"]) {
    assert.equal(segredoConfere(v, TOKEN), false, `recebido=${JSON.stringify(v)}`);
    assert.equal(segredoConfere(TOKEN, v), false, `esperado=${JSON.stringify(v)}`);
    assert.equal(segredoConfere(v, v), false, "dois vazios não podem conferir");
  }
});

t("não explode com tipo estranho", () => {
  assert.equal(segredoConfere(123, TOKEN), false);
  assert.equal(segredoConfere({}, TOKEN), false);
  assert.equal(segredoConfere([TOKEN], TOKEN), true); // array vira string do item
});

delete process.env.__T;
console.log(`\n${ok}/${ok} testes passaram`);
