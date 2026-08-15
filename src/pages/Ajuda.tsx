import {
  HelpCircle, Inbox, MessageCircle, KanbanSquare, ShoppingCart, UserCircle,
  ShieldAlert, Printer, Clock,
} from "lucide-react";
import { PageHeader, Card } from "../components/ui";

// Guia da equipe — a página que responde "e agora, o que eu faço?" sem
// precisar chamar ninguém. Conteúdo espelhado em docs/GUIA-EQUIPE.md (o .md é
// pra mandar no grupo; ESTA página é a fonte que fica sempre atualizada).
// Linguagem de balcão de propósito: quem lê é consultor, não desenvolvedor.

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-extrabold text-ink text-lg flex items-center gap-2 mb-3">{children}</h2>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm text-muted leading-relaxed mb-2">{children}</p>
);
const LI = ({ children }: { children: React.ReactNode }) => (
  <li className="text-sm text-muted leading-relaxed flex gap-2">
    <span className="text-brand-500 font-bold shrink-0">›</span>
    <span>{children}</span>
  </li>
);
const B = ({ children }: { children: React.ReactNode }) => (
  <b className="text-ink">{children}</b>
);

export function Ajuda() {
  return (
    <>
      <PageHeader
        title="Guia rápido da equipe"
        subtitle="Como trabalhar no CRM no dia a dia — leva 5 minutos pra ler"
        icon={HelpCircle}
        actions={
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-600 hover:text-brand-700"
          >
            <Printer size={15} /> Imprimir / salvar PDF
          </button>
        }
      />

      <div className="grid gap-4 max-w-3xl">
        <Card className="p-6">
          <H><MessageCircle size={18} className="text-brand-500" /> Lead novo chegou — o que eu faço?</H>
          <ul className="space-y-1.5">
            <LI>Leads dos anúncios e do site <B>caem sozinhos</B> pra alguém da equipe, em rodízio. Quando cair pra você, ele aparece em <B>Meus Leads</B> e no sino.</LI>
            <LI>Você tem <B>20 minutos</B> pra fazer o primeiro contato. Falou com o cliente (ou tentou)? Clique em <B>Registrar 1º contato</B> — é isso que para o relógio.</LI>
            <LI>Se o relógio estourar, o lead <B>volta pro bolsão</B> e qualquer colega pode pegar. Não é castigo, é pro cliente não esfriar.</LI>
            <LI>Usou o botão de <B>WhatsApp</B> dentro do lead? O 1º contato é registrado sozinho.</LI>
          </ul>
        </Card>

        <Card className="p-6">
          <H><Inbox size={18} className="text-brand-500" /> Bolsão de Leads</H>
          <ul className="space-y-1.5">
            <LI>É a vitrine de leads <B>sem dono</B>: os que ninguém atendeu a tempo e os que chegaram sem rodízio. Clicou em <B>Pegar lead</B>, ele é seu — e o relógio de 20 min começa.</LI>
            <LI>De férias ou fora do expediente? Desligue sua <B>disponibilidade</B> em <B>Meu Perfil</B> — o rodízio pula você e nada fica te esperando.</LI>
          </ul>
        </Card>

        <Card className="p-6">
          <H><KanbanSquare size={18} className="text-brand-500" /> Trabalhando o lead</H>
          <ul className="space-y-1.5">
            <LI>Abra o lead e registre tudo por lá: <B>observações</B>, <B>atividades</B> ("retornar amanhã 10h" — atrasada fica vermelha), <B>etiquetas</B> e as <B>mensagens prontas</B> pro WhatsApp.</LI>
            <LI>No <B>Pipeline</B>, arraste o cartão conforme o cliente avança: Novos → Em contato → Cotação → Negociação.</LI>
            <LI>Cliente desistiu? Arraste pra <B>Perdido</B> e escolha o motivo — é isso que mostra pro gestor onde estamos perdendo negócio.</LI>
            <LI>Fechou? Arraste pra <B>Fechado</B> e registre a venda na hora (valor, parcelas, comissão). A produção do mês e o ranking saem dali.</LI>
          </ul>
        </Card>

        <Card className="p-6">
          <H><ShoppingCart size={18} className="text-brand-500" /> Vendas, apólices e consórcios</H>
          <ul className="space-y-1.5">
            <LI><B>Vendas</B> é o registro comercial (produção e comissão). <B>Apólices</B> e <B>Consórcios</B> são o contrato do cliente — é o que ele vê logado no Portal do site.</LI>
            <LI>Cadastrou um cliente novo? Pode ser <B>pessoa física (CPF)</B> ou <B>empresa (CNPJ)</B>. Sem e-mail? Marque a caixinha e repasse o acesso por WhatsApp.</LI>
            <LI>Planilha do Excel? Use o botão <B>Importar</B> — ele confere os dados antes e explica linha por linha o que não entrou.</LI>
          </ul>
        </Card>

        <Card className="p-6">
          <H><ShieldAlert size={18} className="text-brand-500" /> Sinistros</H>
          <P>O <B>Kubinho</B> (robô do site) faz a triagem completa com o cliente e o chamado cai em <B>Sinistros &amp; Assistências</B>, com alerta vermelho no sino. Quem pegar clica em <B>Assumir</B> — o resumo e a conversa inteira ficam no chamado.</P>
        </Card>

        <Card className="p-6">
          <H><UserCircle size={18} className="text-brand-500" /> Meu Perfil</H>
          <ul className="space-y-1.5">
            <LI><B>Disponibilidade</B>: seu botão de plantão. Desligou, o rodízio pula você. <B>Ligue de volta quando retornar</B> — ninguém liga por você.</LI>
            <LI><B>Assinatura</B>: entra no lugar de [ASSINATURA] nas mensagens prontas.</LI>
            <LI><B>Trocar senha</B>: sempre que precisar, sem chamar ninguém.</LI>
          </ul>
        </Card>

        <Card className="p-6">
          <H><Clock size={18} className="text-brand-500" /> Travou? Deu erro?</H>
          <ul className="space-y-1.5">
            <LI>Apareceu tela de erro ou algo estranho: <B>recarregue a página</B> (F5). Resolve a grande maioria — e o erro já fica registrado pra gente investigar, sem você precisar printar nada.</LI>
            <LI>Continua travado? Avise um gestor dizendo <B>o que você estava fazendo</B> e em qual tela.</LI>
            <LI>Esqueceu a senha? Na tela de login, <B>Esqueci minha senha</B> — chega um e-mail pra criar outra.</LI>
          </ul>
        </Card>

        <p className="text-xs text-muted text-center pb-6">
          Guia do CRM Kuboo · atualizado em agosto/2026 · dúvidas com um gestor ou administrador
        </p>
      </div>
    </>
  );
}

export default Ajuda;
