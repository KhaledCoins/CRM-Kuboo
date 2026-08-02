// Teste da matemática do card Meta × Realizado.
// Rodar da raiz do CRM:  npx vite-node src/lib/__tests__/metaRealizado.test.mjs
//
// Por que existe: a validação visual do card depende de login no CRM, então a
// regra de negócio (dias úteis restantes e as faixas de cor) fica coberta aqui —
// é o que quebra silenciosamente numa refatoração futura.

import { diasUteisRestantes, corDoProgresso } from '../../components/MetaRealizado.tsx';
let ok=0, fail=0;
const t=(nome,real,esp)=>{ const p=JSON.stringify(real)===JSON.stringify(esp); if(p)ok++;else fail++; console.log(`  ${p?'OK  ':'FALHA'} ${nome} -> ${JSON.stringify(real)}${p?'':' (esperado '+JSON.stringify(esp)+')'}`); };

console.log('=== diasUteisRestantes ===');
// agosto/2026: dia 1 = sabado. Do dia 3 (segunda) ate 31 tem 21 dias uteis
t('03/08/2026 (seg)', diasUteisRestantes(new Date(2026,7,3)), 21);
t('31/08/2026 (seg, ultimo)', diasUteisRestantes(new Date(2026,7,31)), 1);
t('30/08/2026 (dom) -> min 1', diasUteisRestantes(new Date(2026,7,30)), 1);
t('01/08/2026 (sab)', diasUteisRestantes(new Date(2026,7,1)), 21);

console.log('\n=== corDoProgresso (verde/ambar/vermelho/neutro) ===');
t('bateu a meta', corDoProgresso(100, 50), '#16A34A');
t('passou da meta', corDoProgresso(130, 50), '#16A34A');
t('inicio do mes, 0% -> neutro', corDoProgresso(0, 6.5), '#36ABE2');
t('meio do mes no ritmo', corDoProgresso(45, 50), '#F59E0B');
t('meio do mes atrasado', corDoProgresso(10, 50), '#EF4444');
t('limite exato 80% do ritmo', corDoProgresso(40, 50), '#F59E0B');

console.log(`\n${ok} passaram, ${fail} falharam`);
process.exit(fail?1:0);
