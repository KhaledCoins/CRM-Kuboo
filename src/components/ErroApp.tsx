import { Component, type ReactNode } from "react";

// Rede de segurança de RENDER do app inteiro. Sem isto, dois cenários viravam
// tela branca sem explicação:
//
// 1. Qualquer exceção de render em qualquer página (o React desmonta a árvore
//    toda quando não há boundary).
// 2. O mais frequente na prática: DEPLOY. O Vite gera chunks com hash no nome
//    e as rotas são lazy — publicou versão nova, os chunks antigos somem do
//    servidor, e quem estava com o CRM aberto leva "Failed to fetch
//    dynamically imported module" na próxima navegação. Com a equipe usando o
//    CRM o dia inteiro e deploys frequentes, isso é rotina, não borda.
//
// Chunk que sumiu tem cura conhecida: recarregar pega o index novo. Fazemos
// isso sozinhos UMA vez (guarda em sessionStorage contra loop de reload caso
// o problema seja outro). Erro que não é de chunk mostra a tela de recuperação
// com o botão de recarregar — nunca a tela branca.

const CHUNK_ERRO = /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported|chunkloaderror/i;
const RELOAD_GUARD = "kuboo-reload-pos-deploy";

interface State { erro: Error | null }

export class ErroApp extends Component<{ children: ReactNode }, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  componentDidCatch(erro: Error) {
    console.error("[ErroApp]", erro);
    if (CHUNK_ERRO.test(String(erro?.message))) {
      // Deploy no meio da sessão: o chunk antigo não existe mais. Recarregar
      // resolve — mas só tentamos uma vez por sessão pra não entrar em loop
      // se o erro tiver outra causa com a mesma cara.
      try {
        if (!sessionStorage.getItem(RELOAD_GUARD)) {
          sessionStorage.setItem(RELOAD_GUARD, "1");
          window.location.reload();
        }
      } catch { /* modo privado sem sessionStorage: cai na tela de recuperação */ }
    }
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div className="min-h-screen grid place-items-center px-6" style={{ background: "linear-gradient(135deg,#0A1628,#1873BA)" }}>
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
          <p className="font-extrabold text-lg" style={{ color: "#0A1628" }}>Algo deu errado nesta tela</p>
          <p className="text-sm mt-2" style={{ color: "#4B5563" }}>
            Pode ter sido uma atualização do sistema no meio do uso. Recarregar
            resolve na grande maioria das vezes — nada do que você salvou se perde.
          </p>
          <button
            type="button"
            onClick={() => { try { sessionStorage.removeItem(RELOAD_GUARD); } catch { /* ok */ } window.location.reload(); }}
            className="mt-5 inline-block rounded-full px-8 py-3 text-white font-bold text-sm"
            style={{ background: "linear-gradient(135deg,#1F86D4,#1560A0)" }}
          >
            Recarregar o CRM
          </button>
          <p className="text-xs mt-4" style={{ color: "#9CA3AF" }}>
            Se continuar acontecendo, avise um administrador informando o que
            você estava fazendo.
          </p>
        </div>
      </div>
    );
  }
}
