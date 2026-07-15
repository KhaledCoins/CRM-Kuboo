import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

// ─── Casca de acessibilidade compartilhada por todos os modais ─────────────
// role="dialog" + aria-modal, fecha no Esc e no clique do backdrop, foca o
// 1º elemento focável do card ao abrir, devolve o foco a quem abriu ao
// fechar, e prende Tab/Shift+Tab dentro do card (focus trap simples).
// backdropClassName e className preservam o visual de cada modal — este
// componente não estiliza nada, só empresta comportamento.
const FOCUSABLE_SELECTOR = [
  "a[href]", "area[href]", "button:not([disabled])", "input:not([disabled])",
  "select:not([disabled])", "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])", "[contenteditable='true']",
].join(", ");

function elementosFocaveis(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function ModalShell({
  onClose,
  children,
  className = "",
  backdropClassName = "fixed inset-0 bg-slate-900/45 backdrop-blur-sm grid place-items-center z-50 p-4",
  label,
  labelledBy,
  closeOnBackdrop = true,
}: {
  onClose: () => void;
  children: ReactNode;
  className?: string;
  backdropClassName?: string;
  label?: string;
  labelledBy?: string;
  closeOnBackdrop?: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const abridorRef = useRef<HTMLElement | null>(null);

  // Foco inicial no 1º elemento focável do card; devolve o foco a quem abriu ao desmontar.
  useEffect(() => {
    abridorRef.current = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    if (card) {
      const [primeiro] = elementosFocaveis(card);
      (primeiro ?? card).focus();
    }
    return () => {
      abridorRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc fecha o modal; Tab/Shift+Tab circula só dentro do card (focus trap).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const card = cardRef.current;
      if (!card) return;
      const focaveis = elementosFocaveis(card);
      if (!focaveis.length) { e.preventDefault(); return; }
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      const ativo = document.activeElement;
      if (e.shiftKey) {
        if (ativo === primeiro || !card.contains(ativo)) { e.preventDefault(); ultimo.focus(); }
      } else {
        if (ativo === ultimo || !card.contains(ativo)) { e.preventDefault(); primeiro.focus(); }
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  function onBackdropClick(e: MouseEvent<HTMLDivElement>) {
    if (closeOnBackdrop && e.target === e.currentTarget) onClose();
  }

  return (
    <div className={backdropClassName} onClick={onBackdropClick}>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={className}
      >
        {children}
      </div>
    </div>
  );
}
